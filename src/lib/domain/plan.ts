import { buildGraph, reverseClosure, type GraphNode } from './graph.ts';

export type Strategy = 'treatment' | 'baseline';
export type AnswerStatus = 'fresh' | 'stale' | 'unknown';

export type PlanInput = {
  /** Source, fact and answer nodes. Facts depend on their support sources; answers on facts/answers. */
  nodes: GraphNode[];
  /** Facts whose verified semantic value changed (typed hash differs). Content-only edits never appear here. */
  changedFacts: string[];
  /** Facts that lost support (failed/partial/deleted/missing/conflicting). They make dependents unknown, never falsified. */
  degradedFacts: string[];
  /** Fact IDs currently supported (complete, nonconflicting DNF set). */
  supportedFacts: Set<string>;
  /** Answers that were already awaiting recomputation (affected earlier, never regenerated). */
  dirtyAnswers: string[];
  /** Answers whose wording depends on user requirements; `null` = dependency mapping unknown. */
  requirementUse: Record<string, boolean | null>;
  requirementsChanged: boolean;
  strategy: Strategy;
  /** Upper bound on regenerations (budget/deadline). Unresolved affected answers stay stale. */
  maxRecompute?: number;
};

export type Plan = {
  order: string[];
  /** Complete logical closure: everything that could differ after this observation. Same for both strategies. */
  affected: string[];
  /** Answers that must be regenerated because an input changed (subset of affected). */
  needsRecompute: string[];
  /** Answers whose evidence is unavailable/unmapped — freshness unknown, never regenerated from unsupported facts. */
  unknown: string[];
  /** Actually attempted regenerations, in dependency order. Baseline = every computable answer. */
  recompute: string[];
  /** Needed but not attempted (cap): stay stale. */
  deferred: string[];
  /** Verified unaffected and not regenerated. Disjoint from recompute/deferred/unknown. */
  reused: string[];
};

export function planRefresh(i: PlanInput): Plan {
  const g = buildGraph(i.nodes);
  const answers = g.order.filter((id) => g.nodes.get(id)!.kind === 'answer');

  const unknown = new Set<string>();
  for (const id of answers) {
    const deps = g.nodes.get(id)!.depends_on;
    // Unmapped dependencies are never assumed independent of the changed facts.
    if (!deps.length || deps.some((d) => (g.nodes.get(d)!.kind === 'fact' ? !i.supportedFacts.has(d) : unknown.has(d)))) unknown.add(id);
  }

  const reqSeeds = i.requirementsChanged ? answers.filter((a) => i.requirementUse[a] !== false) : []; // null/undefined -> conservative
  const isAnswer = (id: string): boolean => g.nodes.get(id)!.kind === 'answer';
  const needs = new Set(reverseClosure(g, [...i.changedFacts, ...i.dirtyAnswers, ...reqSeeds], true).filter(isAnswer));
  const affected = new Set([...needs, ...reverseClosure(g, i.degradedFacts).filter(isAnswer)]);

  const computable = answers.filter((a) => !unknown.has(a));
  const wanted = i.strategy === 'baseline' ? computable : computable.filter((a) => needs.has(a));
  const recompute = wanted.slice(0, i.maxRecompute ?? wanted.length);
  const done = new Set(recompute);
  return {
    order: g.order,
    affected: answers.filter((a) => affected.has(a)),
    needsRecompute: answers.filter((a) => needs.has(a)),
    unknown: answers.filter((a) => unknown.has(a)),
    recompute,
    deferred: wanted.filter((a) => !done.has(a) && needs.has(a)),
    reused: computable.filter((a) => !done.has(a) && !needs.has(a)),
  };
}

/** Final answer statuses. `dirty` = needed regeneration that did not happen. Never fresh when dirty, unknown or downstream of either. */
export function answerStatuses(nodes: GraphNode[], supportedFacts: Set<string>, dirty: Set<string>): Map<string, AnswerStatus> {
  const g = buildGraph(nodes);
  const out = new Map<string, AnswerStatus>();
  for (const id of g.order) {
    const n = g.nodes.get(id)!;
    if (n.kind !== 'answer') continue;
    const dep = (d: string): AnswerStatus => (g.nodes.get(d)!.kind === 'fact' ? (supportedFacts.has(d) ? 'fresh' : 'unknown') : out.get(d)!);
    const ds = n.depends_on.map(dep);
    out.set(id, !n.depends_on.length || ds.includes('unknown') ? 'unknown' : dirty.has(id) || ds.includes('stale') ? 'stale' : 'fresh');
  }
  return out;
}
