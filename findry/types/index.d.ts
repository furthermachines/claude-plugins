export type RepoFacts = { root: string; remote: string; head: string; branch: string }

export type Reach = {
  files: string[]
  contracts: number
  repositories: string[]
  owners: string[]
}

// What needs the person: approvals, failed runs, queued changes and opportunities.
export type InboxSummary = { count: number }

export type Bound = { blueprintId: string; status: string; consoleUrl: string }

export type Tab = 'change' | 'inbox' | 'run' | 'map'

export type MapNode = { id: string; type: string; name: string }

export type MapAnswer = { nodes: MapNode[]; more: boolean; error: string | null }

export type NodeEdge = { type: string; direction: 'in' | 'out'; peer: MapNode; status: string; evidence: number }
// The node open in the Map tab; edges null while get_node is in flight or when it failed.
export type NodeAnswer = { node: MapNode; edges: NodeEdge[] | null; error: string | null }

export type Connection = 'unknown' | 'ok' | 'signed-out' | 'update-plugin' | 'update-server' | 'offline' | 'no-repo' | 'repo-unknown'

// A change as the act tools answer it.
export type Impact = { services: number; apis: number; events: number; tables: number; owners: number }
export type Grade = { trusted: number; total: number; trustedShare: number }
// agent_runs.gate: the semgrep record at the top level, the five-gate pipeline beside it.
export type Gate = { passed?: boolean; noChange?: boolean; pipeline?: unknown[]; pipelinePassed?: boolean }
export type Lane = { repository: string; adapter: string; simulated: boolean; branch: string; gate?: Gate | null }
export type Change = {
  blueprintId: string
  requirement: string
  status: string
  risk: string
  impact: Impact
  evidenceGrade: Grade | null
  consoleUrl: string
  lanes: Lane[]
}
export type Attempt = { attemptNo: number; mode: string; outcome: string; startedAt: string; endedAt?: string; lanes: Lane[] }
export type RunStatus = Change & { attempts?: Attempt[] | null; seal?: { hash: string; at: string } | null }
export type InboxItems = { approval: Change[]; failed_run: Change[]; queued: Change[]; sealed: Change[]; opportunity: Change[] }

export type InboxAnswer = { items: InboxItems; error: null } | { items: null; error: string }
export type RunAnswer = { change: RunStatus; error: null } | { change: null; error: string }
// What the pane says under a row after a press: a refusal, or work under way.
export type Note = { text: string; failed: boolean }

export type FileContext = {
  known: boolean
  repository: { id: string; name: string } | null
  path?: string
  lastScan?: { commit: string; finishedAt: string }
  drift: { head?: string; scanned?: string; behind: 'yes' | 'no' | 'unknown'; scannedAt?: string }
  inFlight: { id: string; status: string; requirement: string; consoleUrl: string; touchesPath?: boolean }[]
  // File-level lists: [] for a known file, null (or absent) at repository level.
  symbols?: { id: string; name: string; kind?: string; span?: string }[] | null
  contracts?: { id: string; type: string; name: string; naturalKey: string; edges: { id: string; status: string; evidenceIds: string[] }[] }[] | null
  consumers?:
    | {
        service: { id: string; name: string; naturalKey: string }
        repository?: string
        // Trusted first; a candidate owner is an inference.
        owners: { id: string; name: string; status: string }[]
        contracts: { id: string; edges: { id: string; type: string; status: string }[]; status: string }[]
        tier: string
        // A peer only shares a contract the file calls or reads.
        relation: 'consumes' | 'provides' | 'peer'
        unconfirmed: boolean
      }[]
    | null
  decisions?: { rationale: string; decider: string; kind: string; at: string; blueprintId: string; requirement: string; attestationHash: string }[] | null
}

declare module 'claude-code' {
  interface PluginState {
    findry: {
      connection: Connection
      repo: RepoFacts | null
      reach: Reach
      inbox: InboxSummary
      bound: Bound | null
      contexts: Record<string, FileContext>
      // From whoami; '' until it answers.
      console: string
      tab: Tab
      mapQuery: string
      // null while a search is in flight.
      mapResults: MapAnswer | null
      // null while the results show.
      mapNode: NodeAnswer | null
      // null until the inbox is first read; a refresh keeps the last answer until the next.
      inboxItems: InboxAnswer | null
      // The bound change's run_status, null until first read.
      run: RunAnswer | null
      // Typed rationales by blueprint id, and the line under each row by key.
      rationales: Record<string, string>
      rowNotes: Record<string, Note>
      // The requirement last submitted, kept in the field until it is proposed.
      requirement: string
    }
  }
}
