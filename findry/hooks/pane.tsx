import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import type { Bound, Change, FileContext, InboxAnswer, MapAnswer, MapNode, NodeAnswer, NodeEdge, Note, Reach, RunAnswer, RunStatus, Tab } from '../types'
import { reachPhrase } from './band'
import { isTerminal } from './acts'
import { attemptLine, changeFacts, laneText, NOT_BOUND, sealLine, short } from './commands'
import type { CallResult } from './findry'
import { consumerLabel, RELATIONS, trust } from './note'

const TABS = [
  ['change', 'This change'],
  ['inbox', 'Inbox'],
  ['run', 'Run'],
  ['map', 'Map'],
] as const satisfies readonly (readonly [Tab, string])[]

const KINDS = [
  ['approval', 'Waiting for your decision'],
  ['failed_run', 'Failed, resumable'],
  ['queued', 'Queued behind a collision'],
  ['sealed', 'Sealed in the last fourteen days'],
] as const

export function tabOf(args: string): Tab | undefined {
  const which = args.trim()
  return TABS.find(([t]) => t === which)?.[0]
}

export type SearchNodes = { results?: MapNode[]; abstained?: boolean; nextCursor?: string }

export function mapAnswer(found: CallResult<SearchNodes>): MapAnswer {
  if (!found.ok) return { nodes: [], more: false, error: found.message }
  const nodes = (found.value.results ?? []).map(({ id, type, name }) => ({ id, type, name }))
  return { nodes, more: Boolean(found.value.nextCursor), error: null }
}

export type GetNode = { edges: (Omit<NodeEdge, 'evidence'> & { evidenceIds: string[] })[] }

export function nodeAnswer(node: MapNode, found: CallResult<GetNode>): NodeAnswer {
  if (!found.ok) return { node, edges: null, error: found.message }
  const edges = found.value.edges.map(({ type, direction, peer, status, evidenceIds }) => ({
    type,
    direction,
    peer: { id: peer.id, type: peer.type, name: peer.name },
    status,
    evidence: evidenceIds.length,
  }))
  return { node, edges, error: null }
}

export type PaneView = {
  tab: Tab
  contexts: Record<string, FileContext>
  reach: Reach
  query: string
  answer: MapAnswer | null
  node: NodeAnswer | null
  console: string
  bound: Bound | null
  run: RunAnswer | null
  inbox: InboxAnswer | null
  rationales: Record<string, string>
  notes: Record<string, Note>
  requirement: string
}
export type PaneActions = {
  show: (tab: Tab) => void
  search: (query: string) => void
  open: (node: MapNode) => void
  back: () => void
  propose: (requirement: string) => void
  submit: (id: string) => void
  draft: (id: string, rationale: string) => void
  decide: (id: string, decision: 'approve' | 'reject') => void
  resume: (id: string, mode: 'blind' | 'feedback') => void
}

type Els = Elements[RenderSurface]
// Mobile's table completes Input to a fragment that draws nothing, so the surface decides.
type Typed = Elements['terminal' | 'desktop' | 'vscode']

export function paneTree(els: Els, surface: RenderSurface, view: PaneView, act: PaneActions): RenderElement {
  const { Box, Button, Link, Text } = els
  let body: RenderElement
  switch (view.tab) {
    case 'map':
      body = mapTab(els, surface, view, act)
      break
    case 'inbox':
      body = inboxTab(els, surface, view, act)
      break
    case 'run':
      body = runTab(els, view)
      break
    default:
      body = changeTab(els, surface, view, act)
  }
  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={1}>
        {TABS.map(([t, label]) => (
          <Button key={`tab-${t}`} label={label} variant={t === view.tab ? 'primary' : 'secondary'} onPress={() => act.show(t)} />
        ))}
        {view.console !== '' && <Link href={view.console} label="Console" />}
      </Box>
      {body}
    </Box>
  )
}

function changeTab(els: Els, surface: RenderSurface, view: PaneView, act: PaneActions): RenderElement {
  const { Box, Text } = els
  const paths = Object.keys(view.contexts).sort()
  return (
    <Box flexDirection="column" gap={1}>
      {paths.length === 0 ? (
        <Text dimColor>No file touched yet. Read or edit a file and what it carries appears here.</Text>
      ) : (
        <Box flexDirection="column" gap={1}>
          <Text bold>{reachPhrase(view.reach)}</Text>
          {paths.map(p => fileBlock(els, p, view.contexts[p]!))}
        </Box>
      )}
      {view.bound && boundChange(els, view.bound, current(view), view.notes[view.bound.blueprintId], act)}
      {proposal(els, surface, view, act)}
    </Box>
  )
}

// The run read for the bound change, never one left over from another.
function current(view: PaneView): RunStatus | null {
  const c = view.run?.change
  return c && c.blueprintId === view.bound?.blueprintId ? c : null
}

function noteLine(els: Els, note: Note | undefined): RenderElement | false {
  const { Text } = els
  return !!note && (note.failed ? <Text color="error">{note.text}</Text> : <Text dimColor>{note.text}</Text>)
}

function heading(els: Els, c: { blueprintId: string; status: string }): RenderElement {
  const { Box, Text } = els
  return (
    <Box gap={1}>
      <Text bold>{`Change ${short(c.blueprintId)}`}</Text>
      <Text>{c.status}</Text>
    </Box>
  )
}

function boundChange(els: Els, b: Bound, c: RunStatus | null, note: Note | undefined, act: PaneActions): RenderElement {
  const { Box, Button, Link, Text } = els
  const status = c?.status ?? b.status
  return (
    <Box flexDirection="column">
      {heading(els, { ...b, status })}
      {c && <Text>{c.requirement}</Text>}
      {c && <Text dimColor>{changeFacts(c)}</Text>}
      <Link href={b.consoleUrl} label="Open in console" />
      {status === 'planned' && <Button key="submit-change" label="Submit for approval" variant="primary" onPress={() => act.submit(b.blueprintId)} />}
      {noteLine(els, note)}
    </Box>
  )
}

function proposal(els: Els, surface: RenderSurface, view: PaneView, act: PaneActions): RenderElement {
  const { Box, Text } = els
  if (surface === 'mobile') return <Text dimColor>Propose from the terminal or the desktop app.</Text>
  const { Input } = els as Typed
  return (
    <Box flexDirection="column">
      <Input
        key="requirement"
        label="Propose a governed change"
        placeholder="goal, context, affected flows, constraints, success criteria"
        value={view.requirement}
        autoFocus
        submitLabel="propose"
        onSubmit={act.propose}
      />
      {noteLine(els, view.notes.propose)}
    </Box>
  )
}

function inboxTab(els: Els, surface: RenderSurface, view: PaneView, act: PaneActions): RenderElement {
  const { Box, Text } = els
  const answer = view.inbox
  if (!answer) return <Text dimColor>Reading the inbox…</Text>
  if (answer.error !== null) return <Text color="error">{answer.error}</Text>
  const items = answer.items
  const kinds = KINDS.filter(([kind]) => items[kind].length)
  if (!kinds.length) return <Text dimColor>Nothing needs you.</Text>
  return (
    <Box flexDirection="column" gap={1}>
      {kinds.map(([kind, title]) => (
        <Box flexDirection="column" gap={1}>
          <Text bold>{`${title} (${items[kind].length})`}</Text>
          {items[kind].map((c, i) => inboxRow(els, surface, kind, c, view, act, kind === 'approval' && i === 0))}
        </Box>
      ))}
    </Box>
  )
}

// Only the first rationale field takes the keys when the tab opens.
function inboxRow(els: Els, surface: RenderSurface, kind: (typeof KINDS)[number][0], c: Change, view: PaneView, act: PaneActions, first: boolean): RenderElement {
  const { Box, Button, Link, Text } = els
  const id = c.blueprintId
  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Box gap={1}>
        <Text dimColor>{short(id)}</Text>
        <Text>{c.requirement}</Text>
      </Box>
      <Text dimColor>{changeFacts(c)}</Text>
      <Link href={c.consoleUrl} label="Console" />
      {kind === 'sealed' && c.lanes.map(l => <Text dimColor>{laneText(l)}</Text>)}
      {kind === 'approval' && decision(els, surface, id, view, act, first)}
      {kind === 'failed_run' && (
        <Box gap={1}>
          <Button key={`resume-blind-${id}`} label="Resume blind" variant="primary" onPress={() => act.resume(id, 'blind')} />
          <Button key={`resume-feedback-${id}`} label="Resume with feedback" variant="secondary" onPress={() => act.resume(id, 'feedback')} />
        </Box>
      )}
      {noteLine(els, view.notes[id])}
    </Box>
  )
}

function decision(els: Els, surface: RenderSurface, id: string, view: PaneView, act: PaneActions, focus: boolean): RenderElement {
  const { Box, Button, Text } = els
  if (surface === 'mobile') return <Text dimColor>{`Decide from the terminal or the desktop app: /findry approve ${short(id)} <rationale>`}</Text>
  const { Input } = els as Typed
  return (
    <Box flexDirection="column">
      <Input
        key={`rationale-${id}`}
        label="Rationale"
        placeholder="one or two sentences, sealed verbatim"
        value={view.rationales[id] ?? ''}
        autoFocus={focus || undefined}
        submitLabel="keep"
        onInput={text => act.draft(id, text)}
        onSubmit={text => act.draft(id, text)}
      />
      <Box gap={1}>
        <Button key={`approve-${id}`} label="Approve" variant="primary" onPress={() => act.decide(id, 'approve')} />
        <Button key={`reject-${id}`} label="Reject" variant="secondary" onPress={() => act.decide(id, 'reject')} />
      </Box>
    </Box>
  )
}

// The change that ended and released the branch stays in view until the binding changes.
function ended(view: PaneView): RunStatus | null {
  const c = view.run?.change
  return !view.bound && c && isTerminal(c.status) ? c : null
}

function runTab(els: Els, view: PaneView): RenderElement {
  const { Box, Link, Text } = els
  const over = ended(view)
  if (!view.bound && !over) return <Text dimColor>{NOT_BOUND}</Text>
  const c = current(view) ?? over
  if (!c) return view.run?.error ? <Text color="error">{view.run.error}</Text> : <Text dimColor>Reading the run…</Text>
  const attempts = c.attempts ?? []
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        {heading(els, c)}
        <Text>{c.requirement}</Text>
        <Text dimColor>{changeFacts(c)}</Text>
        <Link href={c.consoleUrl} label="Open in console" />
      </Box>
      {attempts.length === 0 && <Text dimColor>No attempt yet.</Text>}
      {attempts.map(t => (
        <Box flexDirection="column">
          <Text bold>{attemptLine(t)}</Text>
          {t.lanes.map(l => (
            <Box paddingLeft={2}>
              <Text>{laneText(l)}</Text>
            </Box>
          ))}
        </Box>
      ))}
      {c.seal && <Text>{sealLine(c.seal)}</Text>}
      <Text dimColor>{over ? 'This change has ended; the branch is no longer bound to it.' : 'Refreshed every ten seconds while this tab is open.'}</Text>
    </Box>
  )
}

function fileBlock(els: Els, path: string, ctx: FileContext): RenderElement {
  const { Box, Link, Text } = els
  const contracts = ctx.contracts ?? []
  const consumers = ctx.consumers ?? []
  const said = !ctx.known ? 'not in the map' : contracts.length || consumers.length || ctx.inFlight.length ? null : 'no contract the map knows'
  return (
    <Box flexDirection="column">
      <Box gap={2}>
        <Text bold>{path}</Text>
        {ctx.drift.behind === 'yes' && <Text dimColor>scan behind HEAD</Text>}
        {said && <Text dimColor>{said}</Text>}
      </Box>
      {contracts.map(c => (
        <Box paddingLeft={2} gap={2}>
          <Text>{c.name}</Text>
          <Text dimColor>{trust(c)}</Text>
        </Box>
      ))}
      {RELATIONS.flatMap(([relation, verb, prep]) =>
        consumers
          .filter(c => c.relation === relation)
          .map(c => (
            <Box paddingLeft={4}>
              <Text>{`${verb} ${prep} ${consumerLabel(c)}`}</Text>
            </Box>
          )),
      )}
      {ctx.inFlight.map(f => (
        <Box paddingLeft={2}>
          <Link href={f.consoleUrl} label={`in flight ${f.id.slice(0, 8)} ${f.status}: ${f.requirement}`} />
        </Box>
      ))}
    </Box>
  )
}

function mapTab(els: Els, surface: RenderSurface, view: PaneView, act: PaneActions): RenderElement {
  const { Box, Text } = els
  if (surface === 'mobile') return <Text dimColor>Search the map from the terminal or the desktop app.</Text>
  const { Input } = els as Typed
  return (
    <Box flexDirection="column" gap={1}>
      <Input key="map-query" label="Search the map" placeholder="a name, POST /payments, or a description" value={view.query} autoFocus onSubmit={act.search} />
      {view.node ? nodeView(els, view.node, act.back) : view.query !== '' && mapRows(els, view.query, view.answer, act.open)}
    </Box>
  )
}

function mapRows(els: Els, query: string, answer: MapAnswer | null, open: (node: MapNode) => void): RenderElement {
  const { Box, Button, Text } = els
  if (!answer) return <Text dimColor>Searching the map…</Text>
  if (answer.error) return <Text dimColor>{answer.error}</Text>
  if (!answer.nodes.length) return <Text dimColor>{`Nothing in the map matches "${query}".`}</Text>
  return (
    <Box flexDirection="column">
      {answer.nodes.map(n => (
        <Box gap={1}>
          <Text dimColor>{n.type}</Text>
          <Button key={`node-${n.id}`} label={n.name} plain onPress={() => open(n)} />
          <Text dimColor>{n.id.slice(0, 8)}</Text>
        </Box>
      ))}
      {answer.more && <Text dimColor>{`The first ${answer.nodes.length} matches; a narrower search finds the rest.`}</Text>}
    </Box>
  )
}

function nodeView(els: Els, answer: NodeAnswer, back: () => void): RenderElement {
  const { Box, Button, Text } = els
  return (
    <Box flexDirection="column" gap={1}>
      <Button key="map-back" label="Back to results" variant="secondary" onPress={back} />
      <Box gap={1}>
        <Text bold>{answer.node.name}</Text>
        <Text dimColor>{answer.node.type}</Text>
      </Box>
      {nodeEdges(els, answer)}
    </Box>
  )
}

function nodeEdges(els: Els, answer: NodeAnswer): RenderElement {
  const { Box, Text } = els
  if (answer.error !== null) return <Text dimColor>{answer.error}</Text>
  if (!answer.edges) return <Text dimColor>Reading the node…</Text>
  if (!answer.edges.length) return <Text dimColor>No trusted or candidate edge in the map.</Text>
  return (
    <Box flexDirection="column">
      {answer.edges.map(e => (
        <Box gap={1}>
          <Text>{`${e.type} ${e.direction === 'out' ? 'to' : 'from'} ${e.peer.name} (${e.peer.type})`}</Text>
          <Text dimColor>{`${e.status}, evidence ${e.evidence}`}</Text>
        </Box>
      ))}
    </Box>
  )
}
