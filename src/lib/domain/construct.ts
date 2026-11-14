import type { Board } from '../contracts/board.ts';
import { answerHash, semanticHash, stableId, valueType } from './hash.ts';
import { buildGraph, type GraphNode } from './graph.ts';
import { answerStatuses } from './plan.ts';
import { boardFactStatus, evaluateSupport, type SourceState } from './support.ts';
import type { DomainState } from './state.ts';

export type LegacyMeta = { factKeys: Record<string, string>; usesReq: Record<string, boolean> };

const srcState = (s: Board['sources'][number]['status']): SourceState => (s === 'succeeded' ? 'ok' : s === 'partial' ? 'partial' : 'failed');

/** Graph nodes for a board: sources, facts (depend on every source of their support sets) and answers. */
export function boardNodes(board: Board, dom: Pick<DomainState, 'facts'>): GraphNode[] {
  return [
    ...board.sources.map((s) => ({ id: s.id, kind: 'source' as const, depends_on: [] })),
    ...board.facts.map((f) => ({ id: f.id, kind: 'fact' as const, depends_on: [...new Set((dom.facts[f.id]?.supportSets ?? [[f.source_id]]).flat())] })),
    ...board.answers.map((a) => ({ id: a.id, kind: 'answer' as const, depends_on: a.depends_on })),
  ];
}

export const supportedFactIds = (dom: Pick<DomainState, 'facts'>): Set<string> => new Set(Object.entries(dom.facts).filter(([, f]) => f.state === 'supported').map(([id]) => id));

/** Answer hash from the verified inputs it was generated against. */
export function answerHashFor(board: Board, dom: Pick<DomainState, 'facts' | 'answers'>, id: string): string {
  const a = board.answers.find((x) => x.id === id)!;
  return answerHash(a.text, a.depends_on.map((d) => ({ id: d, hash: dom.facts[d]?.semanticHash ?? dom.answers[d]?.answerHash ?? '' })));
}

/**
 * Build the typed domain state from a board of observed sources/verified quotes (what the extraction pipeline produced).
 * - `remap` replaces positional IDs by stable semantic IDs (source URL / fact key / dependency set);
 * - facts that share a key across sources become ONE fact with alternative support sets (DNF OR), disagreement -> conflicting;
 * - status of every fact/answer is derived here, never copied from the model.
 * Also used to adopt snapshots written before domain state existed (remap=false keeps the IDs the client already stored).
 */
export function constructBoard(input: Board, meta: LegacyMeta, remap: boolean): { board: Board; domain: DomainState } {
  const sid = new Map(input.sources.map((s) => [s.id, remap ? stableId('s', s.url) : s.id]));
  const sources = input.sources.map((s) => ({ ...s, id: sid.get(s.id)! }));

  const groups = new Map<string, Board['facts']>();
  for (const f of input.facts) groups.set(meta.factKeys[f.id] ?? f.id, [...(groups.get(meta.factKeys[f.id] ?? f.id) ?? []), f]);

  const domain: DomainState = { v: 1, reqVersion: 0, sources: {}, facts: {}, answers: {}, history: [] };
  for (const s of sources) domain.sources[s.id] = { contentHash: s.contentHash, contentVersion: s.contentHash ? 1 : 0, state: srcState(s.status) };

  const fid = new Map<string, string>();
  const facts: Board['facts'] = [];
  for (const [key, members] of groups) {
    const id = remap ? stableId('f', key) : members[0]!.id;
    const claims: DomainState['facts'][string]['claims'] = {};
    const supportSets: string[][] = [];
    for (const m of members) {
      const src = sid.get(m.source_id)!;
      if (!supportSets.some((s) => s[0] === src)) supportSets.push([src]);
      fid.set(m.id, id);
      // A quote that was not verified (empty) is an absent claim: the fact is missing there, never supported.
      if (m.quote && m.status !== 'unknown') claims[src] = { hash: semanticHash(key, m.value), value: m.value, quote: m.quote };
    }
    const res = evaluateSupport(supportSets, (s) => (domain.sources[s] ? { state: domain.sources[s]!.state, claim: claims[s] } : undefined));
    const first = Object.entries(claims)[0];
    const claim = res.claim ?? first?.[1];
    const value = claim?.value ?? members[0]!.value;
    const hash = semanticHash(key, value);
    domain.facts[id] = { key, type: valueType(value), semanticHash: hash, verifiedHash: res.state === 'supported' ? hash : null, semanticVersion: res.state === 'supported' ? 1 : 0, state: res.state, supportSets, claims };
    facts.push({ id, value: value as never, status: boardFactStatus(res.state), source_id: res.set?.[0] ?? first?.[0] ?? supportSets[0]![0]!, quote: claim?.quote ?? '', support_sets: supportSets });
  }

  const aid = new Map<string, string>();
  const used = new Set<string>();
  const answers: Board['answers'] = input.answers.map((a) => {
    const deps = [...new Set(a.depends_on.map((d) => fid.get(d) ?? aid.get(d) ?? d))];
    let id = remap ? stableId('a', ...[...deps].sort()) : a.id;
    for (let n = 2; used.has(id); n++) id = stableId('a', ...[...deps].sort(), String(n));
    used.add(id);
    aid.set(a.id, id);
    return { ...a, id, depends_on: deps };
  });

  const board: Board = { ...input, sources, facts, answers };
  const nodes = boardNodes(board, domain);
  buildGraph(nodes); // rejects dangling/duplicate/cyclic structure before anything is signed
  const status = answerStatuses(nodes, supportedFactIds(domain), new Set());
  const oldAnswerId = new Map([...aid].map(([o, n]) => [n, o]));
  for (const a of answers) {
    a.status = status.get(a.id)!;
    domain.answers[a.id] = { answerHash: '', version: 1, usesReq: meta.usesReq[oldAnswerId.get(a.id)!] ?? null, dirty: false };
  }
  for (const id of buildGraph(nodes).order) if (domain.answers[id]) domain.answers[id]!.answerHash = answerHashFor(board, domain, id); // dependencies first
  return { board, domain };
}
