// Perspective layer: mirrors PerspectiveSearch tests/test_engine_scores.py cases on Tide facts.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Board, FactRecord } from '../src/lib/contracts/board.ts';
import { FactRecord as FactSchema } from '../src/lib/contracts/board.ts';
import { authorityOf, effectiveWeights, DEFAULT_WEIGHTS, popularityOf, rank, scoreBoard, sensitivity, timeOf, verdictOf, weightedScore, stanceOf } from '../src/lib/perspective/index.ts';

const fact = (id: string, source_id: string, stance?: FactRecord['stance'], status: FactRecord['status'] = 'supported'): FactRecord => ({ id, value: id, status, source_id, quote: 'q', ...(stance ? { stance } : {}) });
const board = (facts: FactRecord[], urls: Record<string, string>): Board =>
  ({ facts, sources: Object.entries(urls).map(([id, url]) => ({ id, url })), answers: [], revisions: [] }) as unknown as Board;

test('missing stance is neutral and old fact records still parse', () => {
  const old = FactSchema.parse({ id: 'f1', value: 1, status: 'supported', source_id: 's1', quote: 'x' });
  assert.equal(stanceOf(old), 'neutral');
  assert.equal(FactSchema.parse({ ...old, stance: 'opposes' }).stance, 'opposes');
  assert.throws(() => FactSchema.parse({ ...old, stance: 'maybe' }));
});

test('authority tiers by host', () => {
  assert.equal(authorityOf('https://www.nih.gov/x').score, 95);
  assert.equal(authorityOf('https://cs.stanford.edu/x').score, 90);
  assert.equal(authorityOf('https://docs.telem.ai/api/').score, 85);
  assert.equal(authorityOf('https://github.com/a/b').score, 70);
  assert.equal(authorityOf('https://medium.com/p').score, 40);
  assert.equal(authorityOf('https://example.com').score, 60);
  assert.equal(authorityOf('not a url').score, 50);
});

test('missing score renormalizes and coverage is distinct (PS test_missing_score_renormalizes)', () => {
  const r = weightedScore({ authority: 80, popularity: 60, time: null }, DEFAULT_WEIGHTS);
  assert.ok(Math.abs((r.score ?? 0) - 75.555555) < 1e-4);
  assert.equal(r.coverage, 0.6);
  assert.deepEqual(r.contributing, ['authority', 'popularity']);
  assert.equal(weightedScore({ authority: null, popularity: null, time: 60 }, { authority: 1, popularity: 1, time: 0 }).score, null);
});

test('zero weights restore defaults and rerank is pure (PS test_zero_weights_restore_defaults)', () => {
  assert.deepEqual(effectiveWeights({ authority: 0, popularity: 0, time: 0 }), DEFAULT_WEIGHTS);
  const b = board([fact('f1', 's1', 'supports'), fact('f2', 's2', 'opposes')], { s1: 'https://medium.com/a', s2: 'https://www.nih.gov/b' });
  const before = JSON.stringify(b);
  const scored = scoreBoard(b);
  assert.deepEqual(rank(scored, { authority: 0, popularity: 0, time: 0 }).map((r) => r.fact.id), rank(scored, DEFAULT_WEIGHTS).map((r) => r.fact.id));
  assert.equal(JSON.stringify(b), before);
});

test('popularity counts origins once, negative symmetry (PS test_scoped_popularity)', () => {
  const facts = Array.from({ length: 8 }, (_, i) => fact(`f${i}`, `s${i}`, i < 3 ? 'supports' : 'opposes'));
  assert.equal(popularityOf('supports', facts), 37.5);
  assert.equal(popularityOf('opposes', facts), 62.5);
  assert.equal(popularityOf('supports', [...facts, fact('dup', 's0', 'supports')]), 37.5, 'duplicate origin counts once');
  assert.equal(popularityOf('supports', [...facts, fact('n', 's9', 'neutral')]), 37.5, 'neutral does not vote');
  assert.equal(popularityOf('supports', [fact('a', 's1', 'supports')]), null, 'needs two origins');
  assert.equal(popularityOf('neutral', facts), null);
  assert.equal(popularityOf('supports', [fact('a', 's1', 'supports'), fact('b', 's1', 'opposes'), fact('c', 's2', 'supports')]), 50, 'contradictory origin is mixed');
});

test('time: coverage-scaled weakest period and minimum evidence (PS test_time_weakest_period)', () => {
  const p2024 = [fact('a', 's0', 'supports')];
  const p2025 = [fact('b', 's1', 'supports'), fact('c', 's2', 'opposes')];
  assert.ok(Math.abs((timeOf('supports', [p2024, p2025]) ?? 0) - 100 / 3) < 1e-9);
  p2025[1] = fact('c', 's2', 'supports');
  assert.ok(Math.abs((timeOf('supports', [p2024, p2025]) ?? 0) - 200 / 3) < 1e-9);
  assert.equal(timeOf('supports', [p2024, [fact('b', 's1', 'supports')], [fact('c', 's2', 'supports')]]), 100);
  assert.equal(timeOf('supports', [p2024]), null, 'one period is not longitudinal evidence');
  assert.equal(timeOf('supports', [p2024, [fact('b', 's1', 'supports')]]), null, 'needs three observations');
});

test('verdict, ranking change and sensitivity under different lenses', () => {
  // Two low-authority blogs say yes; one government page says no.
  const b = board([fact('f1', 's1', 'supports'), fact('f2', 's2', 'supports'), fact('f3', 's3', 'opposes'), fact('f4', 's3', 'neutral'), fact('f5', 's1', 'supports', 'unknown')], {
    s1: 'https://medium.com/a',
    s2: 'https://dev.to/b',
    s3: 'https://www.cdc.gov/c',
  });
  const scored = scoreBoard(b);
  assert.equal(scored.length, 4, 'unknown facts are excluded');
  const authorityLens = { authority: 100, popularity: 0, time: 0 };
  const crowdLens = { authority: 0, popularity: 100, time: 0 };
  assert.equal(rank(scored, authorityLens)[0]!.fact.id, 'f3');
  assert.equal(rank(scored, crowdLens)[0]!.fact.id, 'f1');
  assert.equal(verdictOf(rank(scored, authorityLens)).verdict, 'Contested'); // 80 vs 95
  assert.equal(verdictOf(rank(scored, crowdLens)).verdict, 'Leans yes');
  const s = sensitivity(scored, crowdLens);
  assert.equal(s.stable, false);
  assert.deepEqual(s.flippers, ['popularity'], 'dropping crowd weight to 0 flips it');
  assert.ok(s.holds > 0 && s.holds < s.lenses);
  assert.equal(verdictOf(rank(scoreBoard(board([fact('f1', 's1')], { s1: 'https://x.org' })), DEFAULT_WEIGHTS)).verdict, 'Insufficient evidence');
  assert.equal(sensitivity(scoreBoard(board([], {})), DEFAULT_WEIGHTS).stable, true);
});
