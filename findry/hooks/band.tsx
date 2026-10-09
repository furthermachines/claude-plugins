import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import type { Bound, Connection, InboxSummary, Reach } from '../types'

export const counted = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function reachPhrase(r: Reach): string {
  return [
    counted(r.files.length, 'file', 'files'),
    counted(r.contracts, 'contract', 'contracts'),
    counted(r.repositories.length, 'other repository', 'other repositories'),
    counted(r.owners.length, 'owner', 'owners'),
  ].join(', ')
}

// Signed out, offline or on another contract, the status line already says so.
export function bandLine(c: Connection, r: Reach, box: InboxSummary, b: Bound | null): string | null {
  if (c === 'repo-unknown') return 'Findry: this repository is not in the map'
  if (c !== 'ok' && c !== 'offline') return null
  const parts: string[] = []
  if (r.files.length) parts.push(reachPhrase(r))
  if (box.count) parts.push(`inbox ${box.count}`)
  if (b) parts.push(`change ${b.blueprintId.slice(0, 8)} ${b.status}`)
  return parts.length ? `Findry: ${parts.join(' · ')}` : null
}

// `add` is where the console connects a repository, when the band says it is not in the map.
export function bandTree(els: Elements[RenderSurface], line: string, open: () => void, add?: string): RenderElement {
  const { Box, Button, Link, Text } = els
  return (
    <Box gap={1}>
      <Text dimColor wrap="truncate-end">
        {line}
      </Text>
      {add !== undefined && <Link href={add} label="Add it in the console" />}
      <Button key="open" label="Open pane" onPress={open} />
    </Box>
  )
}
