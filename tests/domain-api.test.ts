// End-to-end through the guarded route specs (fake Telem + model transports, fake quota): real domain results, no canned output.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardEnvelope, type Board } from '../src/lib/contracts/board.ts';
import { runGuarded, type GuardSpec } from '../src/lib/server/guarded.ts';
import { createBoardSpec, refreshBoardSpec } from '../src/app/api/_lib/specs.ts';
import { refreshBoardDomain } from '../src/lib/search/planner.ts';
import { openState } from '../src/lib/server/snapshots.ts';
import { ENV, SECRET, TEXT_A, TEXT_B, URL_A, URL_B, deps, fakeFetch, newWorld, type World } from './retrieval-fakes.ts';

const ORIGIN = 'https://ripple.example.test';
const HOSTS = ['docs.telem.ai', 'developer.mozilla.org'];
const create = { request_id: 'c1', title: 'Fetch plan', question: 'How should I batch fetches?', requirements: 'batch of 7', urls: [URL_A, URL_B] };

const run = async <T,>(spec: GuardSpec<T>, path: string, body: unknown, w: World) => {
  const r = await runGuarded(new Request(new URL(path, ORIGIN), { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify(body) }), spec, { env: ENV, quota: { async reserve() { return { allowed: true, retryAfter: 0 }; } }, fetchImpl: fakeFetch(w) });
  return { status: r.status, env: r.status < 300 ? BoardEnvelope.parse(await r.json()) : null };
};
const refresh = (snapshot: string, w: World, extra: Record<string, unknown> = { force: true }) => run(refreshBoardSpec, '/api/boards/refresh', { request_id: 'r', snapshot, ...extra }, w);

const byQuote = (b: Board, part: string) => b.facts.find((f) => f.quote.includes(part))!;
const answerOf = (b: Board, text: string) => b.answers.find((a) => a.text.includes(text))!;
const sorted = (x: string[]): string[] => [...x].sort();

async function created() {
  const w = newWorld();
  const { env } = await run(createBoardSpec, '/api/boards', create, w);
  return { env: env!, w };
}
const factsFor = (b: Board, sourceUrl: string, facts: { key: string; value: unknown; quote: string }[]) => ({ facts: facts.map((f, i) => ({ ref: `F${i}`, source: b.sources.find((s) => s.url === sourceUrl)!.id, ...f })) });
const FACT_A = (n: number) => ({ key: 'max_urls_per_fetch', value: n, quote: `Telem fetch accepts at most ${n} URLs per request.` });
const FACT_A2 = { key: 'per_page_errors', value: true, quote: 'Failed pages return a per-page error even when HTTP status is 200.' };

test('create: stable semantic IDs, DNF support sets, explicit unknown for the unverified claim, signed domain state', async () => {
  const { env } = await created();
  const b = env.board;
  assert.ok(b.sources.every((s) => /^s_[0-9a-f]{8}$/.test(s.id)) && b.facts.every((f) => /^f_[0-9a-f]{8}$/.test(f.id)));
  assert.deepEqual(byQuote(b, 'at most 5 URLs').support_sets, [[b.sources.find((s) => s.url === URL_A)!.id]]);
  const answer = answerOf(b, 'Send at most 5');
  assert.equal(answer.status, 'fresh');
  assert.equal(answer.dependency_review, 'proposed', 'a model-proposed edge is never presented as reviewed');
  assert.equal(answerOf(b, 'invented').status, 'unknown', 'a quote that is not on the page cannot support an answer');
  const st = openState(env.snapshot, SECRET, HOSTS);
  assert.equal(st.meta.domain.history.length, 1);
  assert.equal(st.meta.domain.facts[byQuote(b, 'at most 5 URLs').id]!.state, 'supported');
  assert.equal(Object.values(st.meta.domain.facts).filter((f) => f.state === 'missing').length, 1);
});

test('no-change refresh: zero model calls, every supported answer reused, an observation revision is still recorded', async () => {
  const { env, w } = await created();
  const before = w.calls.filter((c) => c.host === 'api.anthropic.com').length;
  const { env: r } = await refresh(env.snapshot, w);
  assert.equal(w.calls.filter((c) => c.host === 'api.anthropic.com').length, before);
  assert.equal(r!.trace.model_calls, 0);
  assert.deepEqual(r!.update.affected, []);
  assert.deepEqual(r!.update.recomputed, []);
  assert.equal(sorted(r!.update.reused).length, env.board.answers.filter((a) => a.status === 'fresh').length);
  assert.equal(r!.board.revisions.length, 2);
  assert.match(r!.board.revisions[1]!.summary, /2 source check\(s\), 0 extraction call\(s\), 0 recomputation\(s\)/);
  assert.deepEqual(r!.board.revisions[0], env.board.revisions[0], 'earlier revisions are immutable');
  assert.deepEqual(r!.board.answers.map((a) => a.text), env.board.answers.map((a) => a.text));
});

test('a changed fact value affects exactly its dependent closure; unrelated answers are reused with original timestamps', async () => {
  const { env, w } = await created();
  const b = env.board;
  w.pages[URL_A] = { text: TEXT_A.replace('at most 5', 'at most 8') };
  w.refreshFacts = factsFor(b, URL_A, [FACT_A(8), FACT_A2]);
  const { env: r } = await refresh(env.snapshot, w);
  const a1 = answerOf(b, 'Send at most 5').id;
  const a4 = answerOf(b, 'Plan the number').id;
  const a2 = answerOf(b, 'AbortController').id;
  assert.deepEqual(sorted(r!.update.affected), sorted([a1, a4]));
  assert.deepEqual(sorted(r!.update.recomputed), sorted([a1, a4]));
  assert.deepEqual(r!.update.reused, [a2]);
  assert.equal(r!.board.answers.find((a) => a.id === a2)!.observedAt, b.answers.find((a) => a.id === a2)!.observedAt);
  assert.match(r!.board.answers.find((a) => a.id === a1)!.text, /rewritten/);
  assert.equal(byQuote(r!.board, 'at most 8').id, byQuote(b, 'at most 5').id, 'the semantic fact keeps its ID across versions');
  assert.equal(r!.trace.model_calls, 2);
  const dom = openState(r!.snapshot, SECRET, HOSTS).meta.domain;
  assert.equal(dom.facts[byQuote(b, 'at most 5').id]!.semanticVersion, 2);
  assert.equal(r!.board.answers.every((a) => a.status !== 'fresh' || r!.update.unknown.indexOf(a.id) < 0), true);
});

test('a page-body edit that leaves every fact unchanged recomputes nothing (content version != semantic version)', async () => {
  const { env, w } = await created();
  w.pages[URL_A] = { text: `${TEXT_A}\n\nUnrelated footer text added.` };
  w.refreshFacts = factsFor(env.board, URL_A, [FACT_A(5), FACT_A2]);
  const { env: r } = await refresh(env.snapshot, w);
  assert.deepEqual([r!.update.affected, r!.update.recomputed], [[], []]);
  assert.equal(r!.trace.model_calls, 1, 'one extraction, no regeneration');
  const dom = openState(r!.snapshot, SECRET, HOSTS).meta.domain;
  const src = env.board.sources.find((s) => s.url === URL_A)!;
  assert.equal(dom.sources[src.id]!.contentVersion, 2);
  assert.equal(dom.facts[byQuote(env.board, 'at most 5 URLs').id]!.semanticVersion, 1);
  assert.notEqual(r!.board.sources.find((s) => s.id === src.id)!.contentHash, src.contentHash);
});

test('failed fetch: freshness unknown, facts not falsified, history preserved; recovery with the same value restores without a model call', async () => {
  const { env, w } = await created();
  w.pages[URL_B] = { fail: true };
  const { env: f } = await refresh(env.snapshot, w);
  const abort = answerOf(env.board, 'AbortController').id;
  assert.ok(f!.update.unknown.includes(abort) && f!.update.affected.includes(abort));
  assert.ok(!f!.update.recomputed.includes(abort) && !f!.update.reused.includes(abort));
  const failed = f!.board.sources.find((s) => s.url === URL_B)!;
  assert.equal(failed.status, 'failed');
  assert.equal(failed.contentHash, env.board.sources.find((s) => s.url === URL_B)!.contentHash, 'last good observation is kept');
  assert.equal(byQuote(f!.board, 'AbortController aborts').quote, byQuote(env.board, 'AbortController aborts').quote);
  assert.equal(f!.trace.model_calls, 0);
  w.pages[URL_B] = { text: TEXT_B };
  const { env: ok } = await refresh(f!.snapshot, w);
  assert.equal(ok!.board.answers.find((a) => a.id === abort)!.status, 'fresh');
  assert.equal(ok!.trace.model_calls, 0);
  assert.equal(ok!.board.revisions.length, 3);
});

test('requirement edit is a labeled user change: no Telem call, only requirement-dependent closure recomputed', async () => {
  const { env, w } = await created();
  const telem = w.calls.filter((c) => c.host === 'router.telem.ai').length;
  const { env: r } = await refresh(env.snapshot, w, { force: false, requirements: 'batch of 9' });
  assert.equal(w.calls.filter((c) => c.host === 'router.telem.ai').length, telem);
  const a1 = answerOf(env.board, 'Send at most 5').id;
  const a4 = answerOf(env.board, 'Plan the number').id;
  assert.deepEqual(sorted(r!.update.recomputed), sorted([a1, a4]));
  assert.equal(r!.board.requirements, 'batch of 9');
  const rev = r!.board.revisions.at(-1)!;
  assert.equal(rev.kind, 'requirements_edit');
  assert.match(rev.summary, /edited by the user/);
  assert.equal(openState(r!.snapshot, SECRET, HOSTS).meta.domain.reqVersion, 1);
});

test('baseline strategy is a real execution over the SAME observations, model and limits; decisions agree, work does not', async () => {
  const { env, w } = await created();
  w.pages[URL_A] = { text: TEXT_A.replace('at most 5', 'at most 8') };
  w.refreshFacts = factsFor(env.board, URL_A, [FACT_A(8), FACT_A2]);
  const state = openState(env.snapshot, SECRET, HOSTS);
  const body = { request_id: 'r', snapshot: env.snapshot, force: true };
  const fork = (): World => ({ ...w, pages: structuredClone(w.pages), calls: [] });
  const tw = fork(), bw = fork();
  const t = await refreshBoardDomain(body, state, deps(tw), 'treatment');
  const b = await refreshBoardDomain(body, state, deps(bw), 'baseline');
  assert.deepEqual(b.update.affected, t.update.affected, 'same logical closure');
  assert.ok(b.update.recomputed.length > t.update.recomputed.length, `baseline ${b.update.recomputed.length} vs treatment ${t.update.recomputed.length}`);
  assert.ok(t.update.recomputed.every((id) => b.update.recomputed.includes(id)));
  assert.deepEqual(t.update.reused.filter((id) => b.update.recomputed.includes(id)), t.update.reused, 'reused answers were regenerated by the baseline');
  assert.deepEqual(t.board.answers.map((a) => [a.id, a.status]), b.board.answers.map((a) => [a.id, a.status]), 'resulting decision states agree');
  assert.deepEqual(tw.calls.filter((c) => c.host === 'router.telem.ai').map((c) => c.body.urls), bw.calls.filter((c) => c.host === 'router.telem.ai').map((c) => c.body.urls), 'identical source checks');
  assert.equal(tw.calls.filter((c) => c.host === 'api.anthropic.com').length, bw.calls.filter((c) => c.host === 'api.anthropic.com').length);
  const rewriteItems = (x: World): number => JSON.parse(/Answers to rewrite[^:]*: (\[.*\])/.exec(x.calls.filter((c) => c.host === 'api.anthropic.com').at(-1)!.body.messages[0].content)![1]!).length;
  assert.ok(rewriteItems(bw) > rewriteItems(tw), 'the baseline actually sent more answers to the model');
});

test('requirement edit with unmapped dependency use is recomputed conservatively; tampered domain state is refused', async () => {
  const { env, w } = await created();
  const st = openState(env.snapshot, SECRET, HOSTS);
  const aid = answerOf(env.board, 'AbortController').id;
  st.meta.domain.answers[aid]!.usesReq = null;
  const d = deps(w);
  const r = await refreshBoardDomain({ request_id: 'r', snapshot: 'x', force: false, requirements: 'new' }, st, d);
  assert.ok(r.update.recomputed.includes(aid), 'unknown mapping -> marked for review/recomputed, never assumed independent');
  // a dependency that points outside the board is rejected when a snapshot is opened (graph validation)
  const { signSnapshot } = await import('../src/lib/server/guards.ts');
  const bad = structuredClone(st);
  bad.board.answers[0]!.depends_on = [bad.board.answers[0]!.id];
  assert.throws(() => openState(signSnapshot(bad, SECRET), SECRET, HOSTS), /REVALIDATION|unverified|could not|invalid/i);
});
