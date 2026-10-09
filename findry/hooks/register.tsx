import { atom, read, update } from 'claude-code'
import type { EngineInterface, OpValueOf, PromptOrigin, Register, Timer } from 'claude-code'

import type { Bound, Change, Connection, FileContext, InboxItems, MapNode, Note, RepoFacts, RunAnswer, RunStatus, Tab } from '../types'
import { byPerson, DENY, FROM_PROMPT, hintFiles, isFindryAct, isTerminal, keyable, ownCheck, storeKey, trailer } from './acts'
import type { ActTool } from './acts'
import { bandLine, bandTree } from './band'
import { CANDIDATE_LATER, heldIds, inboxSummary, NOT_BOUND, parseCommand, personal, RATIONALE_REQUIRED, resolveId, runAnswer, runText, short } from './commands'
import type { Resolution } from './commands'
import { BUDGET_MS, cacheKey, parseToolResult, rejected, SERVER, SERVER_KEY, shadowedBy, toolPrefix } from './findry'
import type { CallResult } from './findry'
import { moreChanged, noteFor, reachOf } from './note'
import { mapAnswer, nodeAnswer, paneTree, tabOf } from './pane'
import type { GetNode, SearchNodes } from './pane'
import { changedPaths, keptPaths, relativePath, repoFacts, statable } from './repo'

// The engine follows $ into functions of this file only, never across an
// import, and reads atoms only as consts of the file that uses them: every
// call on $ and every atom lives here, other modules are pure.
export const connection = atom({ plugin: 'findry', key: 'connection' } as const, 'unknown')
export const repo = atom({ plugin: 'findry', key: 'repo' } as const, null)
export const reach = atom({ plugin: 'findry', key: 'reach' } as const, { files: [], contracts: 0, repositories: [], owners: [] })
export const inbox = atom({ plugin: 'findry', key: 'inbox' } as const, { count: 0 })
export const bound = atom({ plugin: 'findry', key: 'bound' } as const, null)
export const contexts = atom({ plugin: 'findry', key: 'contexts' } as const, {})
const consoleUrl = atom({ plugin: 'findry', key: 'console' } as const, '')
const PANE = 'findry'
const tab = atom({ plugin: 'findry', key: 'tab' } as const, 'change')
const mapQuery = atom({ plugin: 'findry', key: 'mapQuery' } as const, '')
const mapResults = atom({ plugin: 'findry', key: 'mapResults' } as const, null)
const mapNode = atom({ plugin: 'findry', key: 'mapNode' } as const, null)
const inboxItems = atom({ plugin: 'findry', key: 'inboxItems' } as const, null)
const run = atom({ plugin: 'findry', key: 'run' } as const, null)
const rationales = atom({ plugin: 'findry', key: 'rationales' } as const, {})
const rowNotes = atom({ plugin: 'findry', key: 'rowNotes' } as const, {})
const requirement = atom({ plugin: 'findry', key: 'requirement' } as const, '')

const PROCESS_TIMEOUT_MS = 1000
// Listing a large working tree takes longer than a rev-parse.
const SWEEP_TIMEOUT_MS = 2000
const MAX_ASKED = 10
// The spec gives each session-start call one second; hooks get BUDGET_MS.
const START_BUDGET_MS = 1000
// The person asked and waits on the answer.
const ASKED_BUDGET_MS = 2000
const POLL_MS = 10_000
const MIN_CONTRACT = 1
const MAX_CONTRACT = 1

// Every tool of the plugin's own server, for its own calls' permission check.
const OWN = [
  'mcp__plugin_findry_findry__whoami',
  'mcp__plugin_findry_findry__file_context',
  'mcp__plugin_findry_findry__estate_overview',
  'mcp__plugin_findry_findry__search_nodes',
  'mcp__plugin_findry_findry__get_node',
  'mcp__plugin_findry_findry__blast_radius',
  'mcp__plugin_findry_findry__path_between',
  'mcp__plugin_findry_findry__evidence_for_edge',
  'mcp__plugin_findry_findry__list_blueprints',
  'mcp__plugin_findry_findry__get_blueprint',
  'mcp__plugin_findry_findry__decision_history',
  'mcp__plugin_findry_findry__change_targets',
  'mcp__plugin_findry_findry__inbox',
  'mcp__plugin_findry_findry__run_status',
  'mcp__plugin_findry_findry__propose_change',
  'mcp__plugin_findry_findry__submit_change',
  'mcp__plugin_findry_findry__decide',
  'mcp__plugin_findry_findry__resume_run',
  'mcp__plugin_findry_findry__register_candidate',
]
// An act tool on any server: the one Claude Code runs Findry under is known only once it is connected.
const ACT_CALLS = /^mcp__.+__(propose_change|submit_change|decide|resume_run|register_candidate)$/
const SIGN_IN = 'Findry: run /mcp to sign in'
const OFFLINE = 'Findry: offline'

const UNDERSTAND = [
  'mcp__plugin_findry_findry__whoami',
  'mcp__plugin_findry_findry__file_context',
  'mcp__plugin_findry_findry__estate_overview',
  'mcp__plugin_findry_findry__search_nodes',
  'mcp__plugin_findry_findry__get_node',
  'mcp__plugin_findry_findry__blast_radius',
  'mcp__plugin_findry_findry__path_between',
  'mcp__plugin_findry_findry__evidence_for_edge',
  'mcp__plugin_findry_findry__list_blueprints',
  'mcp__plugin_findry_findry__get_blueprint',
  'mcp__plugin_findry_findry__decision_history',
  'mcp__plugin_findry_findry__change_targets',
]

// A fire-and-forget promise never rejects unhandled.
function quiet(p: Promise<unknown>): void {
  p.catch(() => undefined)
}

async function runProcess($: EngineInterface, cwd: string, argv: readonly string[], timeoutMs = PROCESS_TIMEOUT_MS): Promise<string | null> {
  try {
    const ran = await $.process.run(argv, { cwd, timeoutMs })
    // Not trim(): a status line can start with a space.
    return ran.exitCode === 0 ? ran.stdout.trimEnd() : null
  } catch {
    return null
  }
}

function git($: EngineInterface, cwd: string, args: readonly string[], timeoutMs?: number): Promise<string | null> {
  return runProcess($, cwd, ['git', ...args], timeoutMs)
}

// The name Claude Code runs Findry's server under, as the last connect that answered connected named it.
let server = SERVER
// While the last connect answered not connected, each turn's start asks again.
let linked = false

// Per turn: a call that went unanswered, or two that errored, end the
// turn's calls; whether the server refuses the credential, its message if so.
let backoff: CallResult<never> | null = null
let errors = 0
let refusal: Promise<string | null> | null = null
let signedOut = false

function markTurnStarted(): void {
  backoff = null
  errors = 0
  refusal = null
  // The person spoke again: a Stop is theirs to give anew.
  for (const key of stopped) holds.delete(key)
  stopped.clear()
}

// What the status line shows, and what it returns to when a call answers: the shadow, when there is one.
let shown: string | undefined
let idle: string | undefined

function showStatus($: EngineInterface, text: string | undefined): void {
  shown = text
  $.ui.status(text)
}

function within<T>($: EngineInterface, work: Promise<T>, ms: number, late: T): Promise<T> {
  const timeout = new Promise<T>(resolve => {
    const timer = $.clock.after(ms, () => resolve(late))
    quiet(work.finally(() => timer.cancel()))
  })
  return Promise.race([work, timeout])
}

// A shadow can be named only once connected, which a sign-in mid-session makes it.
function adopt($: EngineInterface, link: OpValueOf['mcp.connect']): void {
  linked = link.isConnected
  if (!link.isConnected || link.server === SERVER) return
  server = link.server
  idle = shadowedBy(server)
  // Another contract's line is the one to act on.
  if (!mismatch) showStatus($, idle)
}

async function resolveServer($: EngineInterface): Promise<void> {
  refusal = null
  await within($, signInRefusal($), START_BUDGET_MS, null)
}

// A server refusing the credential reaches a call as one with no tools.
function signInRefusal($: EngineInterface): Promise<string | null> {
  return (refusal ??= $.mcp.connect(SERVER_KEY).then(
    link => {
      adopt($, link)
      return !link.isConnected && link.reason === 'auth' ? link.message : null
    },
    () => null,
  ))
}

// The call and the sign-in probe share one budget.
async function call<T>($: EngineInterface, tool: string, args: Record<string, unknown>, budgetMs = BUDGET_MS): Promise<CallResult<T>> {
  if (backoff) return backoff
  const late: CallResult<T> = { ok: false, reason: 'offline', message: `Findry: no answer within ${budgetMs} ms` }
  const answer = (async (): Promise<CallResult<T>> => {
    let got: CallResult<T>
    try {
      got = parseToolResult<T>(await $.mcp.call(server, tool, args))
    } catch (err) {
      got = rejected(err)
    }
    if (got.ok || got.reason === 'signed-out') return got
    const message = await signInRefusal($)
    return message === null ? got : { ok: false, reason: 'signed-out', message }
  })()
  const outcome = await within($, answer, budgetMs, late)
  // Another contract found while this call was out keeps its status line.
  if (mismatch) return outcome
  // A server still connecting asks for sign-in after the budget: say so then.
  if (outcome === late) quiet(signInRefusal($).then(message => (message === null ? undefined : signOut($))))
  if (outcome.ok) {
    if (shown !== idle) showStatus($, idle)
    if (signedOut) {
      signedOut = false
      // A whoami that answers is a contract check's own; its caller reads what follows.
      if (tool !== 'whoami') await recover($)
    }
  } else if (outcome.reason === 'offline') {
    backoff = { ok: false, reason: 'offline', message: 'Findry: offline for the rest of this turn' }
    // A shadowing server's calls wait on the session's own permission prompt: the shadow is the cause to name.
    showStatus($, idle ?? OFFLINE)
  } else if (outcome.reason === 'signed-out') {
    signedOut = true
    showStatus($, SIGN_IN)
  } else if (++errors >= 2) {
    backoff = { ok: false, reason: 'error', message: 'Findry: two errors this turn; asking again next turn' }
  }
  return outcome
}

// The turn's back-off spares the model's latency, not a person's question.
function ask<T>($: EngineInterface, tool: string, args: Record<string, unknown>, budgetMs = ASKED_BUDGET_MS): Promise<CallResult<T>> {
  backoff = null
  return call<T>($, tool, args, budgetMs)
}

// Through the engine's tool path, as the model's calls go, so the server's
// confirmation reaches the person; consent is the person's own words.
async function act<T>($: EngineInterface, tool: ActTool, args: Record<string, unknown>, consent: string): Promise<CallResult<T>> {
  try {
    const ran = await $.tool.call({ tool: `${toolPrefix(server)}${tool}`, consent, ...args })
    if (ran.deny !== undefined) return { ok: false, reason: 'error', message: ran.deny }
    return parseToolResult<T>({ content: [{ type: 'text', text: ran.text ?? '' }], isError: ran.isError === true })
  } catch (err) {
    return rejected(err)
  }
}

async function bind($: EngineInterface, b: Bound): Promise<void> {
  await update($, bound, () => b)
  const facts = await read($, repo)
  if (facts && keyable(facts.branch)) await $.store.set(storeKey(facts.remote, facts.branch), b).catch(() => undefined)
}

async function unbind($: EngineInterface): Promise<void> {
  await update($, bound, () => null)
  const facts = await read($, repo)
  if (facts && keyable(facts.branch)) await $.store.delete(storeKey(facts.remote, facts.branch)).catch(() => undefined)
}

// Binding is per remote and branch: a branch's change follows it, and the
// run read for another change goes with the old binding.
async function rebind($: EngineInterface, facts: RepoFacts): Promise<void> {
  const key = keyable(facts.branch) ? storeKey(facts.remote, facts.branch) : null
  const stored = key ? ((await $.store.get(key).catch(() => undefined)) as Bound | undefined) : undefined
  if (!stored && !(await read($, bound))) return
  await update($, bound, () => stored ?? null)
  await update($, run, () => null)
}

async function refreshInbox($: EngineInterface, budgetMs?: number): Promise<void> {
  const got = await ask<InboxItems>($, 'inbox', {}, budgetMs)
  await update($, inboxItems, () => (got.ok ? { items: got.value, error: null } : { items: null, error: got.message }))
  if (got.ok) await update($, inbox, () => inboxSummary(got.value))
}

// A change that ended releases its branch. The poll keeps the turn's back-off.
async function refreshRun($: EngineInterface, polled = false, budgetMs = ASKED_BUDGET_MS): Promise<RunAnswer | null> {
  const b = await read($, bound)
  if (!b) return null
  const args = { blueprintId: b.blueprintId }
  const got = polled ? await call<RunStatus>($, 'run_status', args, budgetMs) : await ask<RunStatus>($, 'run_status', args, budgetMs)
  const answer = runAnswer(got)
  await update($, run, () => answer)
  if (got.ok && got.value.status !== b.status) await (isTerminal(got.value.status) ? unbind($) : bind($, { ...b, status: got.value.status }))
  return answer
}

async function say($: EngineInterface, key: string, n: Note | null): Promise<void> {
  await update($, rowNotes, ({ [key]: _, ...rest }) => (n ? { ...rest, [key]: n } : rest))
}

const BUSY: Note = { text: 'Sending to Findry…', failed: false }

// After a press: its line under the row, then what the act changed.
async function settle($: EngineInterface, key: string, got: CallResult<unknown>): Promise<void> {
  await say($, key, got.ok ? null : { text: got.message, failed: true })
  if (got.ok) await refreshAll($)
}

async function refreshAll($: EngineInterface): Promise<void> {
  await refreshInbox($)
  await refreshRun($)
}

// Per session: the repo-relative paths an edit, a write or a command changed.
const edited = new Set<string>()

async function propose($: EngineInterface, typed: string): Promise<void> {
  const text = typed.trim()
  await update($, requirement, () => text)
  if (!text) return
  await say($, 'propose', { text: 'Proposing the change…', failed: false })
  const facts = await read($, repo)
  const hints = facts ? hintFiles(facts.remote, [...edited].sort(), (await read($, reach)).files) : { files: [], readFiles: [] }
  const got = await act<Change>($, 'propose_change', { requirement: text, repos: facts ? [facts.remote] : [], ...hints }, 'The user pressed Propose in the Findry pane')
  if (!got.ok) return say($, 'propose', { text: got.message, failed: true })
  const { blueprintId, status, consoleUrl } = got.value
  await bind($, { blueprintId, status, consoleUrl })
  await update($, run, () => ({ change: got.value, error: null }))
  await update($, requirement, () => '')
  await say($, 'propose', null)
}

async function submit($: EngineInterface, id: string): Promise<void> {
  await say($, id, BUSY)
  await settle($, id, await act($, 'submit_change', { blueprintId: id }, 'The user pressed Submit for approval in the Findry pane'))
}

async function decide($: EngineInterface, id: string, decision: 'approve' | 'reject'): Promise<void> {
  const rationale = ((await read($, rationales))[id] ?? '').trim()
  if (!rationale) return say($, id, { text: RATIONALE_REQUIRED, failed: true })
  await say($, id, BUSY)
  const pressed = decision === 'approve' ? 'Approve' : 'Reject'
  const got = await act($, 'decide', { blueprintId: id, decision, rationale }, `The user pressed ${pressed} on change ${short(id)} in the Findry pane`)
  if (got.ok) await update($, rationales, ({ [id]: _, ...rest }) => rest)
  await settle($, id, got)
}

async function resume($: EngineInterface, id: string, mode: 'blind' | 'feedback'): Promise<void> {
  await say($, id, BUSY)
  await settle($, id, await act($, 'resume_run', { blueprintId: id, mode }, `The user pressed Resume ${mode} on change ${short(id)} in the Findry pane`))
}

type Resumed = Change & { resume: { attemptNo: number; status: string } }

// The full id a typed prefix names among the changes held, reading the inbox once when none does.
async function idFor($: EngineInterface, typed: string): Promise<Resolution> {
  const held = async () => heldIds(await read($, bound), await read($, inboxItems))
  const first = resolveId(typed, await held())
  if (first.kind !== 'none') return first
  await refreshInbox($)
  return resolveId(typed, await held())
}

// Opening the pane and status answer anyone; an act or a release only the person's own prompt.
async function command($: EngineInterface, args: string, origin: PromptOrigin): Promise<string> {
  if (mismatch) return mismatch
  const c = parseCommand(args)
  if (personal(c) && !byPerson(origin)) return FROM_PROMPT
  const consent = `The user ran /findry ${args.trim()}`
  switch (c.verb) {
    case 'usage':
      return c.text
    case 'decide': {
      const named = await idFor($, c.id)
      if (named.kind !== 'id') return named.text
      const got = await act($, 'decide', { blueprintId: named.id, decision: c.decision, rationale: c.rationale }, consent)
      if (!got.ok) return got.message
      await refreshAll($)
      return `Change ${short(named.id)} ${c.decision === 'approve' ? 'approved' : 'rejected'}; the rationale is sealed.`
    }
    case 'resume': {
      const named = await idFor($, c.id)
      if (named.kind !== 'id') return named.text
      const got = await act<Resumed>($, 'resume_run', { blueprintId: named.id, mode: c.mode }, consent)
      if (!got.ok) return got.message
      await refreshAll($)
      return `Change ${short(named.id)} resumed (${c.mode}), attempt ${got.value.resume.attemptNo}: ${got.value.resume.status}.`
    }
    case 'status': {
      if (!c.id) {
        const answer = await refreshRun($)
        return answer ? runText(answer) : NOT_BOUND
      }
      const named = await idFor($, c.id)
      if (named.kind !== 'id') return named.text
      return runText(runAnswer(await ask<RunStatus>($, 'run_status', { blueprintId: named.id })))
    }
    case 'unbind': {
      const b = await read($, bound)
      if (!b) return NOT_BOUND
      await unbind($)
      return `Change ${short(b.blueprintId)} is no longer bound to this branch; commits and pull requests stop naming it.`
    }
    case 'candidate':
      return CANDIDATE_LATER
    default: {
      const opened = await openPane($, tabOf(c.word))
      return opened.isPlaced ? 'Findry pane opened.' : `Findry pane waits: ${opened.reason}`
    }
  }
}

async function signOut($: EngineInterface): Promise<void> {
  backoff = null
  signedOut = true
  showStatus($, SIGN_IN)
  await update($, connection, () => 'signed-out')
}

// Per session: Findry's answers by path@head, the loops already told about
// each, and each hold's answer by path and change, shared by every edit that
// waits on it; Stop lasts the turn.
const answers = new Map<string, FileContext>()
const told = new Set<string>()
const holds = new Map<string, Promise<string | null>>()
const stopped = new Set<string>()
// Every answer kept, as the contexts atom holds it.
let latest: Record<string, FileContext> = {}

type Found = { ctx: FileContext; path: string; key: string }

// On a contract either side cannot read, the plugin says so and does nothing else.
let mismatch: string | null = null

async function working($: EngineInterface): Promise<RepoFacts | null> {
  return mismatch ? null : read($, repo)
}

async function contextFor($: EngineInterface, absolute: string, fresh = false): Promise<Found | null> {
  const facts = await working($)
  if (!facts) return null
  const path = relativePath(facts.root, absolute)
  if (!path) return null
  const key = cacheKey(path, facts.head)
  const cached = answers.get(key)
  if (cached && !fresh) return { ctx: cached, path, key }
  const answer = await call<FileContext>($, 'file_context', { remoteUrl: facts.remote, path, head: facts.head })
  // Session start, or the sign-in this answer brought back, found another contract meanwhile.
  if (mismatch) return null
  if (!answer.ok) {
    const reason = answer.reason
    if (reason !== 'error') await update($, connection, () => reason)
    // An unavailable refresh must not erase a known conflict or its Stop.
    return cached ? { ctx: cached, path, key } : null
  }
  const ctx = answer.value
  answers.set(key, ctx)
  await update($, contexts, prev => (latest = { ...prev, [path]: ctx }))
  // Lookups run side by side: the reach is drawn from every answer kept, never one lookup's.
  await update($, reach, () => reachOf(latest))
  await update($, connection, () => (ctx.repository !== null ? 'ok' : 'repo-unknown'))
  return { ctx, path, key }
}

async function noteEdit($: EngineInterface, absolute: string): Promise<void> {
  const facts = await working($)
  const path = facts && relativePath(facts.root, absolute)
  if (path) edited.add(path)
}

// The note for a loop not yet told about this file at this HEAD, once.
function untold(found: Found, agentId: string | undefined): string | null {
  const loop = `${found.key}\0${agentId ?? ''}`
  if (told.has(loop)) return null
  told.add(loop)
  return noteFor(found.ctx)
}

// An approved change in flight already changed this path. Stop denies until
// the turn ends, Edit anyway lets the change's edits through, and any other
// answer, or none, decides nothing.
async function hold($: EngineInterface, found: Found): Promise<string | null> {
  const change = found.ctx.inFlight.find(c => c.touchesPath)
  if (!change) return null
  const key = `${found.path}\0${change.id}`
  let answer = holds.get(key)
  if (!answer) {
    const question = `${found.path} is in approved change ${change.id.slice(0, 8)} (${change.status}). Edit anyway?`
    answer = $.ui.ask(question, ['Edit anyway', 'Stop']).catch(() => null)
    holds.set(key, answer)
    const got = await answer
    if (got === 'Stop') stopped.add(key)
    else if (got !== 'Edit anyway') holds.delete(key)
  }
  if ((await answer) !== 'Stop') return null
  return `Findry: ${found.path} is being changed by governed change ${change.id} (${change.status}); the person chose not to edit it here. See ${change.consoleUrl}.`
}

async function moveHead($: EngineInterface, facts: RepoFacts, head: string): Promise<void> {
  answers.clear()
  told.clear()
  const branch = (await git($, facts.root, ['rev-parse', '--abbrev-ref', 'HEAD'])) ?? ''
  const moved = { ...facts, head, branch }
  await update($, repo, () => moved)
  await rebind($, moved)
}

// The engine composes a turn's first request while turn.start runs: the
// trailer waits for the turn's check of the branch.
let headChecked: Promise<void> = Promise.resolve()

// One git call a turn, HEAD then its branch; one that fails changes nothing.
// A new branch at the same commit keeps the cache but not the binding.
async function refreshHead($: EngineInterface): Promise<void> {
  const facts = await working($)
  if (!facts) return
  const out = await git($, facts.root, ['rev-parse', 'HEAD', '--abbrev-ref', 'HEAD'])
  if (out === null) return
  const [head, branch = ''] = out.split('\n') as [string, string?]
  if (head !== facts.head) return moveHead($, facts, head)
  if (branch === facts.branch) return
  const moved = { ...facts, branch }
  await update($, repo, () => moved)
  await rebind($, moved)
}

type Snapshot = { head: string | null; status: string }

async function snapshot($: EngineInterface, root: string): Promise<Snapshot | null> {
  const head = await git($, root, ['rev-parse', 'HEAD'])
  // No optional locks: a status that refreshes the index can make a git command beside it fail.
  const status = await git($, root, ['--no-optional-locks', 'status', '--porcelain', '-z', '-uall'], SWEEP_TIMEOUT_MS)
  return status === null ? null : { head, status }
}

// Each file's size and mtime as one value, side by side; a failed stat leaves none.
async function statsOf($: EngineInterface, root: string, paths: readonly string[]): Promise<Map<string, string>> {
  const stats = new Map<string, string>()
  await Promise.all(paths.map(path => $.fs.stat(`${root}/${path}`).then(s => void stats.set(path, `${s.size}:${s.mtimeMs}`), () => undefined)))
  return stats
}

// What one Bash call changed: the status entries it added, recoded or
// rewrote under the same code, and the files of any commit it made, at most
// MAX_ASKED looked up, side by side, so the call waits one budget at most.
async function sweep($: EngineInterface, facts: RepoFacts, before: Snapshot, after: Snapshot, stats: Map<string, string>, agentId: string | undefined): Promise<string[]> {
  const paths = new Set(changedPaths(before.status, after.status))
  const kept = keptPaths(before.status, after.status).filter(path => stats.has(path))
  const now = await statsOf($, facts.root, kept)
  for (const path of kept) if (now.has(path) && now.get(path) !== stats.get(path)) paths.add(path)
  if (before.head && after.head && before.head !== after.head) {
    const committed = await git($, facts.root, ['diff', '--name-only', '-z', before.head, after.head], SWEEP_TIMEOUT_MS)
    for (const path of (committed ?? '').split('\0')) if (path) paths.add(path)
    await moveHead($, facts, after.head)
  }
  const sorted = [...paths].sort()
  for (const path of sorted) edited.add(path)
  const found = await Promise.all(sorted.slice(0, MAX_ASKED).map(path => contextFor($, `${facts.root}/${path}`)))
  const notes = found.flatMap(f => (f && untold(f, agentId)) || [])
  if (sorted.length > MAX_ASKED) notes.push(moreChanged(sorted.length - MAX_ASKED))
  return notes
}

let poll: Timer | null = null

function stopPoll(): void {
  poll?.cancel()
  poll = null
}

// A tab reads what it shows each time it is shown; the run tab polls while
// shown in a placed pane.
async function follow($: EngineInterface, which: Tab, placed: boolean): Promise<void> {
  if (which !== 'run') stopPoll()
  if (mismatch) return
  if (which === 'inbox') await refreshInbox($)
  if (which === 'run' && placed) poll ??= $.clock.every(POLL_MS, () => quiet(refreshRun($, true)))
  if (which === 'run' || which === 'change') await refreshRun($)
}

async function showTab($: EngineInterface, which: Tab): Promise<void> {
  await update($, tab, () => which)
  await follow($, which, true)
}

// Opened only by the person's command or press, never unasked; they came to
// type or press in it, so it asks for the keys.
async function openPane($: EngineInterface, which?: Tab) {
  if (which) await update($, tab, () => which)
  const opened = await $.ui.open({ id: PANE, title: 'Findry', focus: true })
  await follow($, which ?? (await read($, tab)), opened.isPlaced)
  return opened
}

type Whoami = { contractVersion?: number; consoleUrl: string }

const lost = (reason: 'offline' | 'signed-out' | 'error'): Connection => (reason === 'error' ? 'unknown' : reason)

// whoami and the contract both ways; null when both sides speak one contract.
async function contractState($: EngineInterface, budgetMs: number): Promise<Connection | null> {
  const who = await call<Whoami>($, 'whoami', {}, budgetMs)
  if (!who.ok) return lost(who.reason)
  // An answer with no version predates the contract.
  const version = who.value.contractVersion ?? 0
  if (version < MIN_CONTRACT || version > MAX_CONTRACT) {
    mismatch = version < MIN_CONTRACT ? 'Findry: this Findry is older than the plugin; ask your admin to update it' : 'Findry: update the plugin'
    stopPoll()
    showStatus($, mismatch)
    return version < MIN_CONTRACT ? 'update-server' : 'update-plugin'
  }
  await update($, consoleUrl, () => who.value.consoleUrl)
  return null
}

async function connectionFor($: EngineInterface, facts: RepoFacts, budgetMs: number): Promise<Connection> {
  const state = await contractState($, budgetMs)
  if (state) return state
  const at = await call<FileContext>($, 'file_context', { remoteUrl: facts.remote, head: facts.head }, budgetMs)
  if (!at.ok) return lost(at.reason)
  return at.value.repository !== null ? 'ok' : 'repo-unknown'
}

// What session start reads of Findry, and a turn start once Findry answers again.
async function connect($: EngineInterface, facts: RepoFacts, budgetMs: number): Promise<void> {
  const state = await connectionFor($, facts, budgetMs)
  await update($, connection, () => state)
  if (state !== 'ok') return
  await refreshInbox($, budgetMs)
  // A change bound in an earlier session may have ended since.
  await refreshRun($, false, budgetMs)
}

// Each turn: while not connected, which server Claude Code runs (a sign-in may
// name a shadow); and, as Bash looks up nothing unless connected, Findry again.
async function reconnect($: EngineInterface): Promise<void> {
  if (mismatch) return
  if (!linked) await signInRefusal($)
  const facts = await read($, repo)
  const was = await read($, connection)
  if (facts && (was === 'offline' || was === 'signed-out')) await connect($, facts, BUDGET_MS)
}

// Signed in again mid-session: what session start could not read, on a
// hook's budget, once.
async function recover($: EngineInterface): Promise<void> {
  const state = await contractState($, BUDGET_MS)
  if (!state) return refreshInbox($, BUDGET_MS)
  if (mismatch) await update($, connection, () => state)
}

let searches = 0

let opens = 0

// Only the latest node opened writes its answer; going back or searching drops it.
async function openNode($: EngineInterface, node: MapNode): Promise<void> {
  const mine = ++opens
  await update($, mapNode, () => ({ node, edges: null, error: null }))
  const found = await ask<GetNode>($, 'get_node', { id: node.id })
  if (mine === opens) await update($, mapNode, () => nodeAnswer(node, found))
}

async function closeNode($: EngineInterface): Promise<void> {
  opens++
  await update($, mapNode, () => null)
}

// Only the latest search writes its answer.
async function searchMap($: EngineInterface, typed: string): Promise<void> {
  const mine = ++searches
  const query = typed.trim()
  await closeNode($)
  await update($, mapQuery, () => query)
  if (!query) return
  await update($, mapResults, () => null)
  const found = await ask<SearchNodes>($, 'search_nodes', { query })
  if (mine === searches) await update($, mapResults, () => mapAnswer(found))
}

// A press that would ask Findry does nothing on a contract either side cannot read.
const pressed =
  <A extends unknown[]>(f: (...a: A) => Promise<unknown>) =>
  (...a: A): void => {
    if (!mismatch) quiet(f(...a))
  }

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command
      .register({
        name: 'findry',
        description: 'Open the Findry pane, or propose, decide and resume a governed change.',
        argumentHint: '[change|inbox|run|map|status [<id>]|approve <id> <rationale>|reject <id> <rationale>|resume <id> [blind|feedback]|unbind|candidate]',
      })
      .catch(() => undefined)
    const facts = await repoFacts((cwd, argv) => runProcess($, cwd, argv), e.cwd)
    await update($, repo, () => facts)
    if (facts) await rebind($, facts)
    else await update($, connection, () => 'no-repo')
    // The session never waits on Findry: its answers reach the atoms and the band when they come.
    quiet(resolveServer($).then(() => facts && connect($, facts, START_BUDGET_MS)))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    markTurnStarted()
    headChecked = refreshHead($)
    await headChecked
    // A probe that runs over goes on without the turn.
    await within($, reconnect($), BUDGET_MS, undefined)
    return next(e)
  })

  // An edit is looked up first, for its hold; a read only once it has run.
  on('tool.call', { tool: ['Read', 'Edit', 'Write', 'NotebookEdit'] }, async ($, e, next) => {
    const absolute = e.tool === 'NotebookEdit' ? e.notebook_path : e.file_path
    const editing = e.tool !== 'Read'
    // Governed runs move independently of this working tree's HEAD.
    let found = editing ? await contextFor($, absolute, true) : null
    const deny = found && (await hold($, found))
    if (deny) return { deny }
    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    if (editing) await noteEdit($, absolute)
    else found = await contextFor($, absolute)
    const note = found && untold(found, e.agentId)
    return note ? { ...ran, context: [...(ran.context ?? []), note] } : ran
  })

  // Only where Findry answers for this repository. A git failure returns the
  // result as it is; so does a throw after next(e), the engine keeping the
  // result it returned.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const facts = (await read($, connection)) === 'ok' ? await read($, repo) : null
    const before = facts && (await snapshot($, facts.root))
    const stats = facts && before ? await statsOf($, facts.root, statable(before.status)) : new Map<string, string>()
    const ran = await next(e)
    if (!facts || !before || ran.deny !== undefined) return ran
    const after = await snapshot($, facts.root)
    if (!after) return ran
    const notes = await sweep($, facts, before, after, stats, e.agentId)
    return notes.length ? { ...ran, context: [...(ran.context ?? []), ...notes] } : ran
  })

  on('tool.describe', { tool: UNDERSTAND }, async ($, e, next) => ({ ...(await next(e)), isDeferred: false }))

  // The plugin's own calls to its own server need no allow rule of the
  // customer's, but keep every deny; the model's calls, and every other
  // plugin's, keep the session's decision.
  on('tool.check', { tool: OWN }, async ($, e, next) => (next.origin.plugin === $.plugin.name ? ownCheck(await next(e)) : next(e)))

  // The model never acts. This plugin calls an act tool only for a person's
  // press or command; the engine sets the origin and strips consent first.
  on('tool.call', { tool: ACT_CALLS }, async ($, e, next) =>
    next.origin.plugin !== $.plugin.name && isFindryAct(e.tool, [SERVER, SERVER_KEY, server]) ? { deny: DENY } : next(e),
  )

  on('attribution.text', async ($, e, next) => {
    const base = await next(e)
    await headChecked
    return { text: trailer(e.kind, base.text, await read($, bound)) }
  })

  on('command.run', { command: 'findry' }, async ($, e) => ({ text: await command($, e.args, e.origin) }))

  on('ui.close', { id: PANE }, async ($, e, next) => {
    stopPoll()
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const c = await read($, connection)
    const line = bandLine(c, await read($, reach), await read($, inbox), await read($, bound))
    if (!line) return next(e)
    const at = await read($, consoleUrl)
    const add = c === 'repo-unknown' && at ? `${at}/repositories` : undefined
    return bandTree($.ui.resolve(e), line, () => quiet(openPane($)), add)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const view = {
      tab: await read($, tab),
      contexts: await read($, contexts),
      reach: await read($, reach),
      query: await read($, mapQuery),
      answer: await read($, mapResults),
      node: await read($, mapNode),
      console: await read($, consoleUrl),
      bound: await read($, bound),
      run: await read($, run),
      inbox: await read($, inboxItems),
      rationales: await read($, rationales),
      notes: await read($, rowNotes),
      requirement: await read($, requirement),
    }
    return paneTree($.ui.resolve(e), e.surface, view, {
      show: which => quiet(showTab($, which)),
      search: pressed((query: string) => searchMap($, query)),
      open: pressed((node: MapNode) => openNode($, node)),
      back: () => quiet(closeNode($)),
      propose: pressed((typed: string) => propose($, typed)),
      submit: pressed((id: string) => submit($, id)),
      draft: (id, text) => quiet(update($, rationales, prev => ({ ...prev, [id]: text }))),
      decide: pressed((id: string, decision: 'approve' | 'reject') => decide($, id, decision)),
      resume: pressed((id: string, mode: 'blind' | 'feedback') => resume($, id, mode)),
    })
  })
}
