import type { Attempt, Bound, Change, Gate, Grade, InboxAnswer, InboxItems, InboxSummary, Lane, RunAnswer, RunStatus } from '../types'
import { counted } from './band'
import type { CallResult } from './findry'

export const NOT_BOUND = 'No change is bound to this branch. /findry change proposes one.'
const RATIONALE = 'A one-sentence rationale is required; it is sealed into the ledger'
export const RATIONALE_REQUIRED = `${RATIONALE}.`
const RESUME_USAGE = 'Name the change to resume: /findry resume <id> [blind|feedback]'
export const CANDIDATE_LATER = 'Candidate registration arrives with candidate fan-out; until then Findry builds the candidates.'
export const USAGE =
  'Usage: /findry [change|inbox|run|map], /findry status [<id>], /findry approve <id> <rationale>, /findry reject <id> <rationale>, /findry resume <id> [blind|feedback], /findry unbind, /findry candidate'
const TABS = ['change', 'inbox', 'run', 'map']

export type Command =
  | { verb: 'open'; word: string }
  | { verb: 'status'; id?: string }
  | { verb: 'candidate' }
  | { verb: 'unbind' }
  | { verb: 'decide'; decision: 'approve' | 'reject'; id: string; rationale: string }
  | { verb: 'resume'; id: string; mode: string }
  | { verb: 'usage'; text: string }

function split(s: string): [string, string] {
  const t = s.trim()
  const at = t.search(/\s/)
  return at < 0 ? [t, ''] : [t.slice(0, at), t.slice(at).trim()]
}

// The rationale is sealed verbatim, so it is cut from the text, never re-joined.
export function parseCommand(args: string): Command {
  const [word, rest] = split(args)
  const [id, tail] = split(rest)
  if (word === 'approve' || word === 'reject') {
    if (!id || !tail) return { verb: 'usage', text: `${RATIONALE}: /findry ${word} <id> <rationale>` }
    return { verb: 'decide', decision: word, id, rationale: tail }
  }
  if (word === 'resume') return id ? { verb: 'resume', id, mode: split(tail)[0] || 'blind' } : { verb: 'usage', text: RESUME_USAGE }
  if (word === 'status') return id ? { verb: word, id } : { verb: word }
  if (word === 'candidate' || word === 'unbind') return { verb: word }
  return !word || TABS.includes(word) ? { verb: 'open', word } : { verb: 'usage', text: USAGE }
}

// What a command does that only the person may: an act, or releasing a binding.
export const personal = (c: Command) => c.verb === 'decide' || c.verb === 'resume' || c.verb === 'unbind'

export const short = (id: string) => id.slice(0, 8)

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const PREFIX = /^[0-9a-f-]{8,}$/i

export type Resolution = { kind: 'id'; id: string } | { kind: 'none' | 'many'; text: string }

// A full id, or anything not a prefix, goes to the server as typed: it decides.
export function resolveId(typed: string, held: readonly string[]): Resolution {
  if (UUID.test(typed) || !PREFIX.test(typed)) return { kind: 'id', id: typed }
  const prefix = typed.toLowerCase()
  const found = [...new Set(held)].filter(id => id.toLowerCase().startsWith(prefix))
  if (found.length === 1) return { kind: 'id', id: found[0]! }
  if (!found.length) return { kind: 'none', text: `No change starting ${typed} in your inbox or this session; use the full id from the console.` }
  return { kind: 'many', text: `${typed} matches ${found.length} changes; add characters.` }
}

export function heldIds(b: Bound | null, box: InboxAnswer | null): string[] {
  const items = box?.items ? Object.values(box.items).flat() : []
  return [...(b ? [b.blueprintId] : []), ...items.map(c => c.blueprintId)]
}

export function runAnswer(got: CallResult<RunStatus>): RunAnswer {
  return got.ok ? { change: got.value, error: null } : { change: null, error: got.message }
}

function gradePhrase(g: Grade | null): string {
  return g ? `evidence ${Math.round(g.trustedShare * 100)}% trusted` : 'no evidence graded'
}

export function changeFacts(c: Change): string {
  const { services, apis, events, tables, owners } = c.impact
  const impact = [counted(services, 'service', 'services'), counted(apis + events + tables, 'contract', 'contracts'), counted(owners, 'owner', 'owners')]
  return `risk ${c.risk} · ${impact.join(', ')} · ${gradePhrase(c.evidenceGrade)}`
}

// The pipeline's verdict when it ran; a failing pipeline can carry a passing scanner.
export function gateSummary(g: Gate | null | undefined): string {
  if (g?.noChange) return 'no change to gate'
  if (g?.passed === undefined) return 'gates not run'
  return (g.pipeline ? g.pipelinePassed === true : g.passed) ? 'gates passed' : 'gates failed'
}

// The simulated flag is always shown; an adapter named simulated already says it.
export function laneText(l: Lane): string {
  const adapter = l.simulated && l.adapter !== 'simulated' ? `${l.adapter} (simulated)` : l.adapter
  return [l.repository || 'unnamed repository', adapter, l.branch || 'no branch yet', gateSummary(l.gate)].join(' · ')
}

export const attemptLine = (t: Attempt) => `Attempt ${t.attemptNo} · ${t.mode} · ${t.outcome}`
export const sealLine = (s: { hash: string; at: string }) => `Sealed ${s.hash.slice(0, 12)} at ${s.at}`

export function runText(a: RunAnswer): string {
  if (a.error !== null) return a.error
  const c = a.change
  const lines = [`Change ${short(c.blueprintId)} ${c.status}: ${c.requirement}`, changeFacts(c)]
  const attempts = c.attempts ?? []
  if (!attempts.length) lines.push('No attempt yet.')
  for (const t of attempts) lines.push(attemptLine(t), ...t.lanes.map(l => `  ${laneText(l)}`))
  if (c.seal) lines.push(sealLine(c.seal))
  lines.push(c.consoleUrl)
  return lines.join('\n')
}

// What needs the person: sealed news does not.
export function inboxSummary(items: InboxItems): InboxSummary {
  return { count: items.approval.length + items.failed_run.length + items.queued.length + items.opportunity.length }
}
