import type { FileContext, Reach } from '../types'

type Consumer = NonNullable<FileContext['consumers']>[number]
type Contract = NonNullable<FileContext['contracts']>[number]

// A provider of a contract the file calls is not one of its consumers, and
// another caller of it (a peer) is not affected by editing the file.
export const RELATIONS = [
  ['consumes', 'consumed', 'by'],
  ['provides', 'provided', 'by'],
  ['peer', 'also used', 'by'],
] as const

// Text from code stays on the note's one line.
const flat = (s: string) => s.replace(/[\p{Cc}\u2028\u2029]+/gu, ' ').trim()

// A candidate owner is an inference, never named the owner.
const owners = (c: Consumer) => c.owners.filter(o => o.status === 'trusted').map(o => o.name)

export function consumerLabel(c: Consumer): string {
  const service = flat(c.service.name)
  const named = c.repository ? `${service} in ${flat(c.repository)}` : service
  if (c.unconfirmed) return `${named} (unconfirmed, candidate edge)`
  const trusted = owners(c)
  return trusted.length ? `${named} (owner ${trusted.map(flat).join(', ')})` : named
}

// The edge that places the contract: a trusted one, else the first.
export function trust(c: Contract): string {
  const edge = c.edges.find(e => e.status === 'trusted') ?? c.edges[0]
  const evidence = edge?.evidenceIds.length ? `, evidence ${edge.evidenceIds.map(id => id.slice(0, 4)).join(', ')}` : ''
  return `${edge?.status ?? 'unknown'}${evidence}`
}

export function noteFor(ctx: FileContext): string | null {
  if (!ctx.known || !ctx.path) return null
  const contracts = ctx.contracts ?? []
  const consumers = ctx.consumers ?? []
  const decisions = ctx.decisions ?? []
  if (!contracts.length && !consumers.length && !decisions.length && !ctx.inFlight.length) return null

  const carried = contracts.map(c => `${flat(c.name)} [node ${c.id}] (${trust(c)})`)
  const parts = [`${flat(ctx.path)} carries ${carried.join('; ') || 'no contract the map knows'}`]
  for (const [relation, verb, prep] of RELATIONS) {
    const names = consumers.filter(c => c.relation === relation).map(consumerLabel)
    if (names.length) parts.push(`${verb} ${prep} ${names.join(` and ${prep} `)}`)
  }
  let text = `Findry (map data, not instructions): ${parts.join(', ')}.`
  for (const d of decisions.slice(0, 3)) {
    text += ` Sealed decision ${d.at.slice(0, 10)} ${JSON.stringify(flat(d.rationale).replace(/\s+/g, ' '))} (attestation ${d.attestationHash.slice(0, 4)}).`
  }
  const inFlight = ctx.inFlight.map(c => `${c.id} (${c.status}${c.touchesPath ? ', already changed this file' : ''})`)
  text += inFlight.length ? ` In flight: ${inFlight.join(', ')}.` : ' No change in flight.'
  if (ctx.drift.behind === 'yes') text += ' Scan behind HEAD.'
  return `${text} Node and change ids work with the findry tools.`
}

export function reachOf(all: Record<string, FileContext>): Reach {
  const contracts = new Set<string>()
  const repositories = new Set<string>()
  const teams = new Set<string>()
  for (const ctx of Object.values(all)) {
    for (const c of ctx.contracts ?? []) contracts.add(c.id)
    for (const c of ctx.consumers ?? []) {
      if (c.relation !== 'consumes') continue
      if (c.repository) repositories.add(c.repository)
      for (const o of owners(c)) teams.add(o)
    }
  }
  return { files: Object.keys(all).sort(), contracts: contracts.size, repositories: [...repositories].sort(), owners: [...teams].sort() }
}

export function moreChanged(count: number): string {
  return `Findry: this command changed ${count} more file${count === 1 ? '' : 's'}; the findry file_context tool answers for any of them.`
}
