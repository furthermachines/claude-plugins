import type { AttributionTextKind, PromptOrigin, ResultOf } from 'claude-code'

import type { Bound } from '../types'
import { toolPrefix } from './findry'

export const ACT_TOOLS = ['propose_change', 'submit_change', 'decide', 'resume_run', 'register_candidate'] as const
export type ActTool = Exclude<(typeof ACT_TOOLS)[number], 'register_candidate'>

export const DENY = 'Decisions are made by people. Run /findry to propose, decide or resume a change.'
export const FROM_PROMPT = 'Run /findry from your own prompt.'

// An act tool of any of these servers, as the engine names it.
export function isFindryAct(tool: string, servers: readonly string[]): boolean {
  return servers.some(s => ACT_TOOLS.some(a => tool === `${toolPrefix(s)}${a}`))
}

type Check = ResultOf['tool.check']

// Lifts only the session's ask for the plugin's own call: a deny beneath,
// a managed policy's included, stands.
export function ownCheck(below: Check): Check {
  return below.decision === 'deny' ? below : { decision: 'allow', reason: 'Findry plugin calling its own server' }
}

// The person's own prompt: their Enter, the Remote Control bridge, or the SDK host's turn.
export function byPerson(origin: PromptOrigin): boolean {
  return origin.kind === 'composer' || origin.kind === 'bridge' || origin.kind === 'sdk'
}

const TERMINAL = ['sealed', 'rejected', 'rolled_back']
export const isTerminal = (status: string) => TERMINAL.includes(status)

// A detached HEAD, or a branch git could not name, carries no change.
export const keyable = (branch: string) => branch !== '' && branch !== 'HEAD'

export function storeKey(remote: string, branch: string): string {
  return `findry.bound.${remote}#${branch}`
}

// A commit carries the change as a git trailer; a pull request's footer links it.
export function trailer(kind: AttributionTextKind, text: string, b: Bound | null): string {
  if (!b || isTerminal(b.status) || (kind !== 'commit' && kind !== 'pr')) return text
  const line = kind === 'commit' ? `Findry-Change: ${b.blueprintId}` : `Governed by Findry: ${b.consoleUrl}`
  return text ? `${text}${kind === 'commit' ? '\n' : '\n\n'}${line}` : line
}

const MAX_HINTS = 1000

// What the session changed seeds a proposal; what it only read is context.
export function hintFiles(remote: string, edited: readonly string[], seen: readonly string[]) {
  const pair = (path: string) => ({ remoteUrl: remote, path })
  const files = edited.slice(0, MAX_HINTS)
  const readOnly = seen.filter(p => !edited.includes(p)).slice(0, MAX_HINTS - files.length)
  return { files: files.map(pair), readFiles: readOnly.map(pair) }
}
