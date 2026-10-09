import type { RepoFacts } from '../types'

// A process's answer: its stdout less trailing whitespace, or null when it
// failed or could not run.
export type Run = (cwd: string, argv: readonly string[]) => Promise<string | null>

export async function repoFacts(run: Run, cwd: string): Promise<RepoFacts | null> {
  const git = (at: string, args: readonly string[]) => run(at, ['git', ...args])
  const root = await git(cwd, ['rev-parse', '--show-toplevel'])
  if (!root) return null
  const remote = await git(root, ['remote', 'get-url', 'origin'])
  if (!remote) return null
  const head = (await git(root, ['rev-parse', 'HEAD'])) ?? ''
  const branch = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])) ?? ''
  return { root, remote: await withoutAlias(run, root, withoutCredentials(remote)), head, branch }
}

// An http(s) remote can carry a token as its userinfo; any other keeps its
// user, which is no secret, but never a password.
export function withoutCredentials(remote: string): string {
  return remote.replace(/^([a-z][a-z0-9+.-]*:\/\/)([^/]*)@/i, (_, scheme: string, info: string) =>
    /^https?:/i.test(scheme) ? scheme : `${scheme}${info.split(':')[0]}@`,
  )
}

const SSH_URL = /^((?:git\+)?ssh:\/\/(?:[^@/]+@)?)([^/:]+)(.*)$/i
const SCP_LIKE = /^([^@/:]+@)?([^/:]+)(:.*)$/
// A Host alias from ~/.ssh/config: no dot, and nothing ssh could read as an option.
const ALIAS = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/

// Findry knows a repository by its real host, so an ssh alias is resolved
// before the remote leaves the machine; ssh -G reads the config and connects
// to nothing. On any failure the remote goes as it is.
export async function withoutAlias(run: Run, cwd: string, remote: string): Promise<string> {
  const m = (remote.includes('://') ? SSH_URL : SCP_LIKE).exec(remote)
  if (!m || !ALIAS.test(m[2]!)) return remote
  const host = (await run(cwd, ['ssh', '-G', m[2]!]))?.match(/^hostname (\S+)$/m)?.[1]
  return host ? `${m[1] ?? ''}${host}${m[3]}` : remote
}

export function relativePath(root: string, absolute: string): string | null {
  const prefix = root.endsWith('/') ? root : root + '/'
  if (!absolute.startsWith(prefix)) return null
  const rel = absolute.slice(prefix.length)
  return rel === '' || rel.split('/').includes('..') ? null : rel
}

// `git status --porcelain -z` as path to status code. A rename or copy gives
// its new path, then its old one as a field of its own.
function statusOf(out: string): Map<string, string> {
  const status = new Map<string, string>()
  const fields = out.split('\0')
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!
    if (!field) continue
    const code = field.slice(0, 2)
    status.set(field.slice(3), code)
    if (/[RC]/.test(code)) i++
  }
  return status
}

// The paths a command changed: entries new after it, or with a new code.
export function changedPaths(before: string, after: string): string[] {
  const was = statusOf(before)
  return [...statusOf(after)].filter(([path, code]) => was.get(path) !== code).map(([path]) => path)
}

// The entries a command left with the code they had: only a stat can say
// whether it rewrote them.
export function keptPaths(before: string, after: string): string[] {
  const was = statusOf(before)
  return [...statusOf(after)].filter(([path, code]) => was.get(path) === code).map(([path]) => path)
}

// ponytail: past 200 dirty entries a sweep compares codes only; stat in batches if bigger trees need it.
const MAX_STATTED = 200

// The entries to stat before a command: on disk, and none past MAX_STATTED.
export function statable(status: string): string[] {
  const paths = [...statusOf(status)].filter(([, code]) => !code.includes('D')).map(([path]) => path)
  return paths.length > MAX_STATTED ? [] : paths
}
