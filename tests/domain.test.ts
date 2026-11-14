// Pure algorithm invariants: typed hashes, graph validation, DNF support, dirty closure and refresh planning.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, GraphError, reverseClosure, type GraphNode } from '../src/lib/domain/graph.ts';
import { answerHash, semanticHash, stableId } from '../src/lib/domain/hash.ts';
import { answerStatuses, planRefresh, type PlanInput } from '../src/lib/domain/plan.ts';
import { appendHistory, DomainState } from '../src/lib/domain/state.ts';
import { evaluateSupport, type SourceObservation } from '../src/lib/domain/support.ts';
import { constructBoard } from '../src/lib/domain/construct.ts';
import type { Board } from '../src/lib/contracts/board.ts';

const n = (id: string, kind: GraphNode['kind'], ...depends_on: string[]): GraphNode => ({ id, kind, depends_on });
const codeOf = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    return (e as GraphError).code;
  }
  return 'none';
};

test('typed semantic hashes: type and value matter, page cosmetics do not', () => {
  assert.notEqual(semanticHash('k', 7), semanticHash('k', '7'));
  assert.notEqual(semanticHash('k', true), semanticHash('k', 'true'));
  assert.notEqual(semanticHash('k', 'Max 5'), semanticHash('k', 'max 5'), 'case is meaning');
  assert.equal(semanticHash('k', 'at  most\n5 URLs '), semanticHash('k', 'at most 5 URLs'), 'only documented whitespace is normalized');
  assert.equal(semanticHash('k', { b: 1, a: [2] }), semanticHash('k', { a: [2], b: 1 }));
  assert.equal(semanticHash('k', -0), semanticHash('k', 0));
  assert.notEqual(semanticHash('a', 1), semanticHash('b', 1));
  assert.equal(stableId('f', 'max_urls'), stableId('f', 'max_urls'));
  assert.notEqual(answerHash('t', [{ id: 'f', hash: '1' }]), answerHash('t', [{ id: 'f', hash: '2' }]));
});

test('graph: rejects duplicates, dangling, self edges, cycles and >40 nodes; orders dependencies first', () => {
  assert.equal(codeOf(() => buildGraph([n('a', 'fact'), n('a', 'answer')])), 'DUPLICATE_ID');
  assert.equal(codeOf(() => buildGraph([n('a', 'answer', 'ghost')])), 'DANGLING_DEPENDENCY');
  assert.equal(codeOf(() => buildGraph([n('a', 'answer', 'a')])), 'SELF_DEPENDENCY');
  assert.equal(codeOf(() => buildGraph([n('s', 'source'), n('a', 'answer', 'b'), n('b', 'answer', 'c'), n('c', 'answer', 'a')])), 'CYCLE');
  assert.equal(codeOf(() => buildGraph(Array.from({ length: 41 }, (_, i) => n(`s${i}`, 'source')))), 'TOO_MANY_NODES');
  const g = buildGraph([n('a2', 'answer', 'a1'), n('a1', 'answer', 'f'), n('f', 'fact', 's'), n('s', 'source')]);
  assert.deepEqual(g.order, ['s', 'f', 'a1', 'a2']);
  assert.deepEqual(reverseClosure(g, ['f']), ['a1', 'a2']);
  assert.deepEqual(reverseClosure(g, ['f'], true), ['f', 'a1', 'a2']);
  assert.deepEqual(reverseClosure(g, ['a2']), []);
});

const ok = (hash: string, value: unknown = hash): SourceObservation => ({ state: 'ok', claim: { hash, value, quote: `q ${hash}` } });
const obsOf = (m: Record<string, SourceObservation>) => (id: string) => m[id];

test('DNF support: OR across sets, AND inside a set, failures are unknown not false, conflicts are not support', () => {
  const both = [['s1', 's2']];
  assert.equal(evaluateSupport(both, obsOf({ s1: ok('h'), s2: ok('h') })).state, 'supported');
  assert.equal(evaluateSupport(both, obsOf({ s1: ok('h'), s2: { state: 'failed' } })).state, 'unknown', 'AND: one failed source leaves freshness unknown');
  assert.equal(evaluateSupport(both, obsOf({ s1: ok('h'), s2: { state: 'ok' } })).state, 'missing', 'AND: a source that no longer states it cannot complete the set');
  const alt = [['s1'], ['s2']];
  assert.deepEqual(evaluateSupport(alt, obsOf({ s1: { state: 'failed' }, s2: ok('h') })).set, ['s2'], 'OR: a surviving alternative keeps support');
  assert.equal(evaluateSupport(alt, obsOf({ s1: { state: 'failed' }, s2: { state: 'failed' } })).state, 'unknown');
  assert.equal(evaluateSupport(alt, obsOf({ s1: { state: 'deleted' }, s2: { state: 'deleted' } })).state, 'deleted');
  assert.equal(evaluateSupport(alt, obsOf({ s1: { state: 'ok' }, s2: { state: 'ok' } })).state, 'missing');
  assert.equal(evaluateSupport(alt, obsOf({ s1: ok('a'), s2: ok('b') })).state, 'conflicting');
  assert.equal(evaluateSupport(alt, obsOf({ s1: ok('a'), s2: { state: 'failed' } })).state, 'supported', 'an unread alternative is not a contradiction');
  assert.equal(evaluateSupport([], obsOf({})).state, 'missing');
  assert.equal(evaluateSupport([['s1']], obsOf({ s1: { state: 'partial', claim: { hash: 'a', value: 1, quote: 'q' } } })).state, 'unknown', 'truncated read is not complete support');
});

// s1,s2 sources; f1(s1) f2(s2) f3(s1|s2 irrelevant here); answers: a1(f1,f2) a2(f2) a3(f3) a4(a1) a5()
const NODES: GraphNode[] = [n('s1', 'source'), n('s2', 'source'), n('f1', 'fact', 's1'), n('f2', 'fact', 's2'), n('f3', 'fact', 's2'), n('a1', 'answer', 'f1', 'f2'), n('a2', 'answer', 'f2'), n('a3', 'answer', 'f3'), n('a4', 'answer', 'a1'), n('a5', 'answer')];
const base = (over: Partial<PlanInput> = {}): PlanInput => ({ nodes: NODES, changedFacts: [], degradedFacts: [], supportedFacts: new Set(['f1', 'f2', 'f3']), dirtyAnswers: [], requirementUse: { a1: false, a2: false, a3: false, a4: false, a5: false }, requirementsChanged: false, strategy: 'treatment', ...over });

test('plan: fan-out closure is exact; affected/recomputed/reused are separate and disjoint; unmapped answers are unknown', () => {
  const p = planRefresh(base({ changedFacts: ['f1'] }));
  assert.deepEqual(p.affected, ['a1', 'a4']);
  assert.deepEqual(p.recompute, ['a1', 'a4']);
  assert.deepEqual(p.reused, ['a2', 'a3'].sort());
  assert.deepEqual(p.unknown, ['a5'], 'an answer with no mapped dependency is never assumed fresh');
  const b = planRefresh(base({ changedFacts: ['f1'], strategy: 'baseline' }));
  assert.deepEqual(b.affected, p.affected, 'the logical closure is strategy independent');
  assert.deepEqual(b.recompute, ['a1', 'a2', 'a3', 'a4'], 'baseline regenerates every computable answer');
  assert.deepEqual(b.reused, []);
});

test('plan: unchanged facts, cosmetic edits and unrelated changes do no answer work', () => {
  const none = planRefresh(base());
  assert.deepEqual([none.affected, none.recompute], [[], []]);
  assert.deepEqual(planRefresh(base({ changedFacts: ['f3'] })).recompute, ['a3'], 'unrelated branch stays untouched');
});

test('plan: failed/unsupported evidence makes dependents unknown and unrecomputed; recovery needs no regeneration', () => {
  const p = planRefresh(base({ degradedFacts: ['f2'], supportedFacts: new Set(['f1', 'f3']) }));
  assert.deepEqual(p.affected, ['a1', 'a2', 'a4']);
  assert.deepEqual(p.unknown.sort(), ['a1', 'a2', 'a4', 'a5']);
  assert.deepEqual(p.recompute, []);
  assert.deepEqual(p.reused, ['a3']);
  const status = answerStatuses(NODES, new Set(['f1', 'f3']), new Set());
  assert.deepEqual([...status].filter(([, s]) => s === 'unknown').map(([id]) => id).sort(), ['a1', 'a2', 'a4', 'a5']);
  // same value comes back: nothing changed, nothing dirty -> fresh again with zero regeneration
  const back = planRefresh(base());
  assert.deepEqual(back.recompute, []);
});

test('plan: requirement edits seed only answers that use them; unknown mapping is conservative; dirty work carries over; cap defers', () => {
  const use = { a1: true, a2: false, a3: false, a4: false, a5: false };
  const r = planRefresh(base({ requirementsChanged: true, requirementUse: use }));
  assert.deepEqual(r.recompute, ['a1', 'a4']);
  const cons = planRefresh(base({ requirementsChanged: true, requirementUse: { a1: false, a2: false, a3: null, a4: false, a5: false } }));
  assert.deepEqual(cons.recompute, ['a3'], 'null mapping is recomputed for review, never assumed independent');
  const carry = planRefresh(base({ dirtyAnswers: ['a2'] }));
  assert.deepEqual(carry.recompute, ['a2']);
  const cap = planRefresh(base({ changedFacts: ['f1'], maxRecompute: 1 }));
  assert.deepEqual([cap.recompute, cap.deferred], [['a1'], ['a4']]);
  assert.ok(!cap.reused.includes('a4'));
  const st = answerStatuses(NODES, new Set(['f1', 'f2', 'f3']), new Set(cap.deferred));
  assert.equal(st.get('a4'), 'stale');
});

test('plan: randomized DAGs satisfy the closure, disjointness and baseline-superset invariants', () => {
  let seed = 7;
  const rnd = (m: number): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % m);
  for (let t = 0; t < 200; t++) {
    const nf = 1 + rnd(5);
    const na = 1 + rnd(6);
    const nodes: GraphNode[] = [n('s', 'source')];
    for (let i = 0; i < nf; i++) nodes.push(n(`f${i}`, 'fact', 's'));
    for (let i = 0; i < na; i++) {
      const pool = [...Array.from({ length: nf }, (_, k) => `f${k}`), ...Array.from({ length: i }, (_, k) => `a${k}`)];
      nodes.push(n(`a${i}`, 'answer', ...pool.filter(() => rnd(3) === 0)));
    }
    const changed = Array.from({ length: nf }, (_, k) => `f${k}`).filter(() => rnd(3) === 0);
    const input = { nodes, changedFacts: changed, degradedFacts: [], supportedFacts: new Set(Array.from({ length: nf }, (_, k) => `f${k}`)), dirtyAnswers: [], requirementUse: {}, requirementsChanged: false };
    const tr = planRefresh({ ...input, strategy: 'treatment' });
    const bl = planRefresh({ ...input, strategy: 'baseline' });
    // brute-force closure
    const hit = new Set(changed);
    for (let k = 0; k < na + 1; k++) for (const a of nodes) if (a.kind === 'answer' && a.depends_on.some((d) => hit.has(d))) hit.add(a.id);
    const expected = nodes.filter((x) => x.kind === 'answer' && hit.has(x.id) && x.depends_on.length).map((x) => x.id);
    assert.deepEqual(tr.needsRecompute.filter((a) => nodes.find((x) => x.id === a)!.depends_on.length).sort(), expected.sort());
    assert.equal(tr.recompute.filter((a) => tr.reused.includes(a)).length, 0);
    assert.ok(tr.recompute.every((a) => bl.recompute.includes(a)) && bl.recompute.length >= tr.recompute.length);
    assert.deepEqual(tr.affected, bl.affected);
    const pos = (id: string): number => tr.order.indexOf(id);
    for (const a of tr.recompute) for (const d of nodes.find((x) => x.id === a)!.depends_on) if (tr.recompute.includes(d)) assert.ok(pos(d) < pos(a));
  }
});

const BOARD = (): Board => ({
  id: 'b', title: 't', question: 'q', requirements: '', revisions: [],
  sources: [
    { id: 's1', url: 'https://docs.telem.ai/a', title: 'a', status: 'succeeded', observedAt: '2026-11-14T10:00:00.000Z', contentHash: 'ha', excerpt: '' },
    { id: 's2', url: 'https://nodejs.org/b', title: 'b', status: 'succeeded', observedAt: '2026-11-14T10:00:00.000Z', contentHash: 'hb', excerpt: '' },
  ],
  facts: [
    { id: 'f1', value: 5, status: 'supported', source_id: 's1', quote: 'five urls', support_sets: [['s1']] },
    { id: 'f2', value: 5, status: 'supported', source_id: 's2', quote: 'also five', support_sets: [['s2']] },
    { id: 'f3', value: 9, status: 'unknown', source_id: 's2', quote: '', support_sets: [['s2']] },
  ],
  answers: [{ id: 'a1', text: 'use 5', depends_on: ['f1'], status: 'fresh' }, { id: 'a2', text: 'use 9', depends_on: ['f3'], status: 'fresh' }],
});

test('constructBoard: stable IDs ignore list order; same-key facts become DNF alternatives; unverified facts are missing, never supported', () => {
  const meta = { factKeys: { f1: 'max_urls', f2: 'max_urls', f3: 'burst' }, usesReq: { a1: true } };
  const a = constructBoard(BOARD(), meta, true);
  const rev = BOARD();
  rev.sources.reverse();
  const b = constructBoard(rev, meta, true);
  assert.deepEqual(a.board.sources.map((s) => s.id).sort(), b.board.sources.map((s) => s.id).sort());
  const f = a.board.facts.find((x) => a.domain.facts[x.id]!.key === 'max_urls')!;
  assert.equal(a.board.facts.length, 2, 'two sources stating one key are one fact with alternatives');
  assert.equal(f.support_sets!.length, 2);
  assert.equal(f.status, 'supported');
  const burst = a.board.facts.find((x) => a.domain.facts[x.id]!.key === 'burst')!;
  assert.equal(a.domain.facts[burst.id]!.state, 'missing');
  assert.equal(a.board.answers.find((x) => x.depends_on.includes(burst.id))!.status, 'unknown');
  assert.equal(a.board.answers.find((x) => x.depends_on.includes(f.id))!.status, 'fresh');
  assert.equal(DomainState.safeParse(a.domain).success, true);
  // disagreement between sources is conflict, not "latest wins"
  const c = BOARD();
  c.facts[1]!.value = 6;
  const conflict = constructBoard(c, meta, true);
  assert.equal(conflict.board.facts.find((x) => conflict.domain.facts[x.id]!.key === 'max_urls')!.status, 'conflicting');
  assert.equal(conflict.board.answers[0]!.status, 'unknown');
  // an existing graph that is cyclic/dangling is rejected
  const bad = BOARD();
  bad.answers[0]!.depends_on = ['ghost'];
  assert.throws(() => constructBoard(bad, meta, true), /DANGLING/);
});

test('history is append-only and hash-chained; earlier entries never change', () => {
  const { domain } = constructBoard(BOARD(), { factKeys: { f1: 'k' }, usesReq: {} }, true);
  const d1 = appendHistory(domain, { revisionId: 'r1', kind: 'created', at: '2026-11-14T10:00:00.000Z' });
  const frozen = JSON.stringify(d1.history[0]);
  const d2 = appendHistory({ ...d1, reqVersion: 1 }, { revisionId: 'r2', kind: 'requirements_edit', at: '2026-11-14T11:00:00.000Z' });
  assert.equal(JSON.stringify(d2.history[0]), frozen);
  assert.equal(d2.history[1]!.parent, d1.history[0]!.digest);
  assert.notEqual(d2.history[1]!.digest, d1.history[0]!.digest);
});
