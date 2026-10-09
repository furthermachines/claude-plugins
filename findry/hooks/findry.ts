import type { McpToolResult } from 'claude-code'

export const SERVER = 'plugin:findry:findry'
// The server's key in .mcp.json, as $.mcp.connect takes it.
export const SERVER_KEY = 'findry'
export const BUDGET_MS = 300

// The engine's spelling of a server in its tools' names.
export function toolPrefix(server: string): `mcp__${string}__` {
  let name = server.replace(/[^a-zA-Z0-9_-]/g, '_')
  if (server.startsWith('claude.ai ')) name = name.replace(/_+/g, '_').replace(/^_|_$/g, '')
  return `mcp__${name}__`
}

// Claude Code runs a URL it already has configured under that name, not the plugin's.
export const shadowedBy = (server: string) => `Findry: your MCP server "${server}" shadows the plugin's; remove it from your MCP settings`

export type CallResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'offline' | 'signed-out' | 'error'; message: string }

const SIGNED_OUT = /\bsign[ -]?in\b|authentication required|unauthori[sz]ed|\b401\b/i

export function parseToolResult<T>(result: McpToolResult): CallResult<T> {
  const text = result.content.map(block => block.text ?? '').join('')
  if (result.isError) return { ok: false, reason: SIGNED_OUT.test(text) ? 'signed-out' : 'error', message: text }
  try {
    return { ok: true, value: (result.structuredContent ?? JSON.parse(text)) as T }
  } catch (err) {
    return { ok: false, reason: 'error', message: `Findry: unreadable answer (${String(err)})` }
  }
}

// A rejected call never reached Findry, unless the transport refused it for
// want of sign-in (the MCP SDK rejects a 401 with UnauthorizedError).
export function rejected(err: unknown): CallResult<never> {
  const message = String(err)
  return { ok: false, reason: SIGNED_OUT.test(message) ? 'signed-out' : 'offline', message }
}

export function cacheKey(path: string, head: string): string {
  return `${path}@${head}`
}
