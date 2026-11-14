// Bounded Telem/model adapters, quote verification, source scope, create/refresh invalidation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { BoardEnvelope, DiscoverResponse } from '../src/lib/contracts/board.ts';
import { completeStructured, ModelFailure } from '../src/lib/model/client.ts';
import { affectedClosure, validateGraph } from '../src/lib/search/dag.ts';
import { TelemClient, TelemFailure } from '../src/lib/search/telem.ts';
import { buildExcerpt, locateQuote, normalizeWs } from '../src/lib/search/text.ts';
import { ApiError } from '../src/lib/server/guarded.ts';
import { verifySnapshot, signSnapshot } from '../src/lib/server/guards.ts';
import { createBoard, discover, openSnapshot, refreshBoard } from '../src/lib/server/research.ts';
import { deps, ENV, EXTRACTION, newWorld, SECRET, TEXT_A, TEXT_B, URL_A, URL_B, URL_C, fakeFetch } from './retrieval-fakes.ts';

const HOSTS = deps(newWorld()).config.sourceHosts;
const create = { request_id: 'c1', title: 'Board', question: 'How should I batch fetches?', requirements: 'batch of 7', urls: [URL_A, URL_B, URL_C] };
const client = (w = newWorld(), limits = { maxQueries: 2, maxPages: 5, maxHttp: 6 }) => new TelemClient({ apiKey: 'k', signal: AbortSignal.timeout(5000), deadline: Date.now() + 30_000, limits, fetchImpl: fakeFetch(w) });

test('text: quotes must occur literally after whitespace normalization; excerpts embed them verbatim', () => {
  const t = normalizeWs(TEXT_A);
  assert.equal(locateQuote(t, 'Telem fetch accepts\n at most 5 URLs per request.'), 'Telem fetch accepts at most 5 URLs per request.');
  assert.equal(locateQuote(t, 'Telem fetch accepts at most 6 URLs per request.'), null);
  assert.equal(locateQuote(t, 'telem fetch accepts at most 5 urls per request.'), null, 'no case folding');
  const q = 'Failed pages return a per-page error';
  const { excerpt, kept } = buildExcerpt(t, [q]);
  assert.ok(kept.has(q) && excerpt.includes(q) && excerpt.length < t.length + 10);
});

test('dag: cycle, dangling and duplicate IDs rejected; closure is the reverse transitive set', () => {
  assert.throws(() => validateGraph(['f1'], [{ id: 'a', depends_on: ['b'] }, { id: 'b', depends_on: ['a'] }]), /CYCLE/);
  assert.throws(() => validateGraph(['f1'], [{ id: 'a', depends_on: ['zz'] }]), /DANGLING/);
  assert.throws(() => validateGraph(['a'], [{ id: 'a', depends_on: [] }]), /DUPLICATE/);
  assert.throws(() => validateGraph([], Array.from({ length: 41 }, (_, i) => ({ id: `a${i}`, depends_on: [] }))), /TOO_MANY/);
  const g = [{ id: 'a1', depends_on: ['f1'] }, { id: 'a2', depends_on: ['a1'] }, { id: 'a3', depends_on: ['f2'] }];
  assert.deepEqual([...affectedClosure(g, ['f1'])].sort(), ['a1', 'a2']);
});

test('telem search: authenticated, bounded providers/domains, provider errors preserved, no credentials leak into results', async () => {
  const w = newWorld({ search: [{ provider: 'brave', results: [{ url: URL_A, title: ' Fetch\n best ' }] }, { provider: 'tavily', status: 'failed', error: { type: 'RateLimited', message: 'secret detail' } }] });
  const out = await client(w).search('abort fetch', HOSTS, 8);
  const call = w.calls[0]!;
  assert.equal(call.host, 'hack.telem.ai');
  assert.equal(call.headers.Authorization, 'Bearer k');
  assert.deepEqual(call.body.search.providers.include, ['brave', 'tavily']);
  assert.equal(call.body.search.auto_routing, 'accuracy');
  assert.deepEqual(call.body.search.include_domains, [...HOSTS]);
  assert.deepEqual(out.providers.map((p) => [p.provider, p.status, p.error]), [['brave', 'succeeded', null], ['tavily', 'failed', 'RateLimited']]);
  assert.deepEqual(out.hits, [{ url: URL_A, title: 'Fetch best', provider: 'brave' }]);
  assert.equal(out.requestId, 'int-1');
  assert.ok(!JSON.stringify(out).includes('PROVIDER-SECRET') && !JSON.stringify(out).includes('secret detail'));
});

test('telem search: query count is capped', async () => {
  const c = client(newWorld(), { maxQueries: 2, maxPages: 5, maxHttp: 6 });
  await c.search('a', HOSTS);
  await c.search('b', HOSTS);
  await assert.rejects(c.search('c', HOSTS), (e: unknown) => e instanceof TelemFailure && e.kind === 'limit');
});

test('telem fetch: each page judged individually; policy rechecked on canonical URL; truncation reported; no_cache honored', async () => {
  const w = newWorld();
  w.pages[URL_B] = { text: TEXT_B, canonical: 'https://evil.example/redirect' };
  w.pages[URL_A] = { text: 'x '.repeat(20_000), truncated: false };
  const pages = await client(w).fetchPages([URL_A, URL_B, URL_C, URL_A], HOSTS, { noCache: true });
  assert.equal(pages.length, 3, 'duplicates collapse');
  assert.equal(w.calls[0]!.body.options.no_cache, true);
  assert.equal(w.calls[0]!.body.urls.length, 3);
  assert.deepEqual([pages[0]!.cached, pages[0]!.cacheState], [false, 'live'], 'boolean cached wins over cache_state');
  assert.deepEqual(pages.map((p) => [p.status, p.error]), [['succeeded', null], ['failed', 'destination_out_of_policy'], ['failed', 'HTTPStatusError']]);
  assert.equal(pages[0]!.truncated, true);
  assert.equal(pages[0]!.text.length, 12_000);
});

test('telem fetch: more than five pages is refused before any request', async () => {
  const w = newWorld();
  const six = Array.from({ length: 6 }, (_, i) => `https://docs.telem.ai/p${i}`);
  await assert.rejects(client(w).fetchPages(six, HOSTS), (e: unknown) => e instanceof TelemFailure && e.kind === 'limit');
  assert.equal(w.calls.length, 0);
});

test('telem transport: auth errors are never retried; one transient retry; attempts are counted and capped', async () => {
  const auth = newWorld({ telemStatus: [401, 200] });
  const c1 = client(auth);
  await assert.rejects(c1.search('q', HOSTS), (e: unknown) => e instanceof TelemFailure && e.kind === 'auth');
  assert.equal(c1.http, 1);

  const flaky = newWorld({ telemStatus: [503] });
  const c2 = client(flaky);
  assert.equal((await c2.search('q', HOSTS)).providers.length, 2);
  assert.equal(c2.http, 2);

  const down = newWorld({ telemStatus: [503, 503, 503] });
  const c3 = client(down);
  await assert.rejects(c3.search('q', HOSTS), (e: unknown) => e instanceof TelemFailure && e.kind === 'transient');
  assert.equal(c3.http, 2, 'exactly one retry');

  const c4 = client(newWorld({ telemStatus: [503] }), { maxQueries: 2, maxPages: 5, maxHttp: 1 });
  await assert.rejects(c4.search('q', HOSTS), (e: unknown) => e instanceof TelemFailure && e.kind === 'limit', 'retry blocked by the HTTP budget');
});

test('telem transport: no retry past the deadline', async () => {
  const w = newWorld({ telemStatus: [503] });
  const c = new TelemClient({ apiKey: 'k', signal: AbortSignal.timeout(5000), deadline: Date.now() + 1000, limits: { maxQueries: 2, maxPages: 5, maxHttp: 6 }, fetchImpl: fakeFetch(w) });
  await assert.rejects(c.search('q', HOSTS), TelemFailure);
  assert.equal(c.http, 1);
});

test('model: every attempt (including the single retry) is counted; limits are explicit', async () => {
  const w = newWorld({ modelStatus: [500, 500, 500] });
  const d = deps(w);
  const m = { provider: 'anthropic' as const, model: 'm', apiKey: 'k', budget: d.budget, signal: d.signal, deadline: d.deadlineAt, fetchImpl: d.fetchImpl };
  await assert.rejects(completeStructured(m, 's', 'u', (r) => r), (e: unknown) => e instanceof ModelFailure && e.kind === 'transient');
  assert.equal(d.budget.attempts, 2);
  assert.equal(w.calls[0]!.body.max_tokens, 2048);
  assert.equal(w.calls[0]!.headers['x-api-key'], 'k');

  const w2 = newWorld({ modelStatus: [401, 200] });
  const d2 = deps(w2);
  await assert.rejects(completeStructured({ ...m, budget: d2.budget, fetchImpl: d2.fetchImpl }, 's', 'u', (r) => r), (e: unknown) => e instanceof ModelFailure && e.kind === 'auth');
  assert.equal(d2.budget.attempts, 1, 'auth is not retried');

  const d3 = deps(newWorld());
  for (let i = 0; i < 6; i++) d3.budget.take();
  await assert.rejects(completeStructured({ ...m, budget: d3.budget, fetchImpl: d3.fetchImpl }, 's', 'u', (r) => r), (e: unknown) => e instanceof ModelFailure && e.kind === 'budget');
});

test('discover: provider-attributed, filtered through source policy, deduped, honest empties and failures', async () => {
  const w = newWorld({ search: [
    { provider: 'brave', results: [{ url: URL_A, title: 'A' }, { url: 'https://evil.example/x', title: 'E' }, { url: 'https://docs.telem.ai.evil.invalid/', title: 'L' }, { url: 'http://docs.telem.ai/insecure', title: 'H' }] },
    { provider: 'tavily', results: [{ url: `${URL_A}#frag`, title: 'A again' }, { url: URL_B, title: '' }] },
  ] });
  const r = await discover({ request_id: 'd1', query: 'abort fetch' }, deps(w));
  DiscoverResponse.parse(r);
  assert.deepEqual(r.results.map((x) => x.url), [URL_A, URL_B]);
  assert.equal(r.trace.model_calls, 0);
  assert.deepEqual(r.trace.retrieval.map((t) => [t.kind, t.provider, t.status]), [['search', 'brave', 'succeeded'], ['search', 'tavily', 'succeeded']]);
  assert.equal(w.calls.filter((c) => c.host === 'api.anthropic.com').length, 0, 'discovery makes no model call');

  const empty = await discover({ request_id: 'd2', query: 'x' }, deps(newWorld({ search: [{ provider: 'brave', results: [] }] })));
  assert.deepEqual(empty.results, []);
  assert.ok(empty.trace.limitations.some((l) => /No supported-host candidates/.test(l)));

  await assert.rejects(discover({ request_id: 'd3', query: 'x' }, deps(newWorld({ search: [{ provider: 'brave', status: 'failed', error: { type: 'E' } }] }))), (e: unknown) => e instanceof ApiError && e.code === 'UPSTREAM_UNAVAILABLE');
});

test('create: only quote-verified facts support answers; hallucinated quote -> unknown; failed source is unavailable not false', async () => {
  const w = newWorld();
  const d = deps(w);
  const env = await createBoard(create, d);
  BoardEnvelope.parse(env);
  const { board } = env;
  assert.equal(env.request_id, 'req-test');
  assert.equal(board.sources.length, 3);
  assert.deepEqual(board.sources.map((s) => s.status), ['succeeded', 'succeeded', 'failed']);
  assert.match(board.sources[0]!.contentHash, /^[0-9a-f]{64}$/);
  const byId = Object.fromEntries(board.facts.map((f) => [f.id, f]));
  assert.equal(byId.f1!.status, 'supported');
  assert.ok(board.sources[0]!.excerpt.includes(byId.f1!.quote), 'quote is literal inside preserved excerpt');
  assert.equal(byId.f4!.status, 'unknown');
  assert.equal(byId.f4!.quote, '');
  const st = Object.fromEntries(board.answers.map((a) => [a.id, a.status]));
  assert.deepEqual(st, { a1: 'fresh', a2: 'fresh', a3: 'unknown', a4: 'fresh' });
  assert.ok(board.answers.every((a) => a.dependency_review === 'proposed'));
  assert.equal(env.trace.model_calls, 1);
  assert.equal(env.trace.retrieval.length, 4, 'three Telem fetch traces + one batched direct Tavily trace');
  assert.equal(env.trace.retrieval[2]!.status, 'failed:HTTPStatusError');
  assert.deepEqual(env.trace.retrieval.map((r) => `${r.service}/${r.transport}`), ['telem/telem', 'telem/telem', 'telem/telem', 'tavily/direct']);
  assert.deepEqual(env.update.unknown, ['a3']);
  const snap = verifySnapshot(env.snapshot, SECRET) as { board: { id: string } };
  assert.equal(snap.board.id, board.id);
  assert.ok(!JSON.stringify(env).includes('telem-test-key') && !JSON.stringify(env).includes('PROVIDER-SECRET'));
});

test('partial source reads preserve quotations but cannot make dependent answers fresh', async () => {
  const w = newWorld();
  w.pages[URL_A] = { text: TEXT_A, truncated: true };
  const made = await createBoard(create, deps(w));
  assert.equal(made.board.sources.find((s) => s.url === URL_A)!.status, 'partial');
  assert.ok(made.board.facts.find((f) => f.id === 'f1')!.quote, 'the literal observation is retained');
  assert.equal(made.board.answers.find((a) => a.id === 'a1')!.status, 'unknown');
  const next = await refreshBoard({ request_id: 'partial-refresh', snapshot: made.snapshot, force: true }, openSnapshot(made.snapshot, SECRET, HOSTS), deps(w));
  assert.equal(next.board.answers.find((a) => a.id === 'a1')!.status, 'unknown');
  assert.ok(!next.update.reused.includes('a1'), 'equal truncated content does not establish full freshness');
});

test('create: no readable source -> 422 SOURCE_UNAVAILABLE and zero model calls; model auth failure -> 502, nothing fabricated', async () => {
  const w = newWorld({ pages: {} });
  await assert.rejects(createBoard(create, deps(w)), (e: unknown) => e instanceof ApiError && e.code === 'SOURCE_UNAVAILABLE');
  assert.equal(w.calls.filter((c) => c.host === 'api.anthropic.com').length, 0);

  const w2 = newWorld({ modelStatus: [401] });
  await assert.rejects(createBoard(create, deps(w2)), (e: unknown) => e instanceof ApiError && e.code === 'UPSTREAM_UNAVAILABLE' && !/anthropic-test-key/.test(e.message));
});

test('create: facts citing unknown sources or conflicting values across sources are handled', async () => {
  const ext = { facts: [
    { ref: 'F1', source: 's9', key: 'x', value: 1, quote: 'Telem fetch accepts at most 5 URLs per request.' },
    { ref: 'F2', source: 's1', key: 'limit', value: 5, quote: 'Telem fetch accepts at most 5 URLs per request.' },
    { ref: 'F3', source: 's2', key: 'limit', value: 7, quote: 'AbortController aborts fetch requests.' },
  ], answers: [{ ref: 'A1', text: 'Limit?', depends_on: ['F2', 'F3'] }, { ref: 'A2', text: 'no deps', depends_on: ['Z'] }] };
  const env = await createBoard(create, deps(newWorld({ extraction: ext })));
  assert.deepEqual(env.board.facts.map((f) => [f.source_id, f.status]), [['s1', 'conflicting'], ['s2', 'conflicting']]);
  assert.deepEqual(env.board.answers.map((a) => [a.id, a.status]), [['a1', 'unknown']], 'answer with no supporting dependency is dropped; conflict -> unknown');
});

async function baseline(over = {}) {
  const w = newWorld(over);
  const env = await createBoard(create, deps(w));
  return { w, env };
}
const open = (snapshot: string) => openSnapshot(snapshot, SECRET, HOSTS);

test('refresh: unchanged sources are a no-op observation that reuses answers and spends no model call', async () => {
  const { w, env } = await baseline();
  w.calls.length = 0;
  const d = deps(w);
  const r = await refreshBoard({ request_id: 'r1', snapshot: env.snapshot, force: true }, open(env.snapshot), d);
  BoardEnvelope.parse(r);
  assert.equal(r.trace.model_calls, 0);
  assert.equal(w.calls.filter((c) => c.host === 'api.anthropic.com').length, 0);
  assert.equal(w.calls[0]!.body.options.no_cache, true);
  assert.deepEqual(r.update.recomputed, []);
  assert.deepEqual(r.update.reused.sort(), ['a1', 'a2', 'a4']);
  assert.deepEqual(r.update.unknown, ['a3']);
  assert.equal(r.board.revisions.length, 2);
  assert.equal(r.board.revisions[1]!.parent_id, 'r1');
  assert.equal(r.board.revisions[1]!.kind, 'source_refresh');
  assert.equal(r.board.sources[2]!.status, 'failed', 'still unreadable: unknown, not false');
  assert.equal(r.board.answers.find((a) => a.id === 'a1')!.observedAt, env.board.answers.find((a) => a.id === 'a1')!.observedAt, 'reused answers keep their original observation time');
});

test('refresh: source body edit with identical facts recomputes nothing; fact change recomputes exactly the dependent closure', async () => {
  const { w, env } = await baseline();
  // cosmetic/body edit of page A: new hash, same extracted values
  w.pages[URL_A] = { text: `${TEXT_A} Updated footer.` };
  w.refreshFacts = { facts: [EXTRACTION.facts[0], EXTRACTION.facts[1]] };
  const same = await refreshBoard({ request_id: 'r2', snapshot: env.snapshot, force: true }, open(env.snapshot), deps(w));
  assert.equal(same.board.sources[0]!.contentHash === env.board.sources[0]!.contentHash, false);
  assert.deepEqual(same.update.recomputed, []);
  assert.deepEqual(same.update.affected, []);
  assert.equal(same.trace.model_calls, 1, 're-extraction only');

  // real semantic change: 5 -> 10
  w.pages[URL_A] = { text: TEXT_A.replace('at most 5', 'at most 10') };
  w.refreshFacts = { facts: [{ ...EXTRACTION.facts[0], value: 10, quote: 'Telem fetch accepts at most 10 URLs per request.' }, EXTRACTION.facts[1]] };
  const changed = await refreshBoard({ request_id: 'r3', snapshot: env.snapshot, force: true }, open(env.snapshot), deps(w));
  assert.equal(changed.board.facts.find((f) => f.id === 'f1')!.value, 10);
  assert.deepEqual(changed.update.affected.sort(), ['a1', 'a4']);
  assert.deepEqual(changed.update.recomputed.sort(), ['a1', 'a4']);
  assert.deepEqual(changed.update.reused.sort(), ['a2'], 'unrelated branch untouched');
  assert.match(changed.board.answers.find((a) => a.id === 'a1')!.text, /rewritten/);
  assert.equal(changed.board.answers.find((a) => a.id === 'a2')!.observedAt, env.board.answers.find((a) => a.id === 'a2')!.observedAt);
  assert.equal(changed.trace.model_calls, 2);
  assert.equal(changed.board.facts.find((f) => f.id === 'f1')!.quote.includes('10'), true);
  assert.ok(changed.board.sources[0]!.excerpt.includes(changed.board.facts.find((f) => f.id === 'f1')!.quote));
});

test('refresh: fetch failure makes dependents unknown (not recomputed, facts not falsified); recovery restores without a model call', async () => {
  const { w, env } = await baseline();
  w.pages[URL_A] = { fail: true };
  const failed = await refreshBoard({ request_id: 'r4', snapshot: env.snapshot, force: true }, open(env.snapshot), deps(w));
  assert.deepEqual(failed.update.recomputed, []);
  assert.deepEqual(failed.update.unknown.sort(), ['a1', 'a3', 'a4']);
  assert.deepEqual(failed.update.reused, ['a2']);
  assert.equal(failed.board.facts.find((f) => f.id === 'f1')!.value, 5, 'old value preserved');
  assert.equal(failed.board.sources[0]!.status, 'failed');
  assert.equal(failed.board.sources[0]!.contentHash, env.board.sources[0]!.contentHash, 'last good observation retained');
  assert.equal(failed.trace.model_calls, 0);

  w.pages[URL_A] = { text: TEXT_A };
  const back = await refreshBoard({ request_id: 'r5', snapshot: failed.snapshot, force: true }, open(failed.snapshot), deps(w));
  assert.equal(back.board.answers.find((a) => a.id === 'a1')!.status, 'fresh');
  assert.equal(back.trace.model_calls, 0);
});

test('refresh: requirement edit recomputes only requirement-dependent answers, never contacts Telem, and is not a source change', async () => {
  const { w, env } = await baseline();
  w.calls.length = 0;
  const r = await refreshBoard({ request_id: 'r6', snapshot: env.snapshot, requirements: 'batch of 3', force: false }, open(env.snapshot), deps(w));
  assert.equal(w.calls.filter((c) => c.host === 'hack.telem.ai').length, 0);
  assert.equal(r.board.requirements, 'batch of 3');
  assert.deepEqual(r.update.recomputed.sort(), ['a1', 'a4']);
  assert.deepEqual(r.update.reused, ['a2']);
  assert.equal(r.board.revisions[1]!.kind, 'requirements_edit');
  assert.match(r.board.revisions[1]!.summary, /no external change was observed/);
  assert.equal(r.trace.retrieval.length, 0);
});

test('refresh: model failure leaves affected answers stale, never fresh', async () => {
  const { w, env } = await baseline();
  w.modelStatus = [500, 500];
  const r = await refreshBoard({ request_id: 'r7', snapshot: env.snapshot, requirements: 'new', force: false }, open(env.snapshot), deps(w));
  assert.deepEqual(r.update.recomputed, []);
  assert.equal(r.board.answers.find((a) => a.id === 'a1')!.status, 'stale');
  assert.equal(r.board.answers.find((a) => a.id === 'a4')!.status, 'stale', 'dependents of stale are stale');
  assert.equal(r.board.answers.find((a) => a.id === 'a2')!.status, 'fresh');
  // a later pass recomputes the stale ones even with no new change
  const again = await refreshBoard({ request_id: 'r8', snapshot: r.snapshot, force: true }, open(r.snapshot), deps(w));
  assert.deepEqual(again.update.recomputed.sort(), ['a1', 'a4']);
});

test('refresh: changed page whose facts can no longer be extracted leaves facts unknown and retries next time', async () => {
  const { w, env } = await baseline();
  w.pages[URL_A] = { text: 'The page was rewritten entirely.' };
  w.refreshFacts = { facts: [] };
  const r = await refreshBoard({ request_id: 'r9', snapshot: env.snapshot, force: true }, open(env.snapshot), deps(w));
  assert.deepEqual(r.board.facts.filter((f) => f.source_id === 's1').map((f) => f.status), ['unknown', 'unknown']);
  assert.deepEqual(r.update.unknown.sort(), ['a1', 'a3', 'a4']);
  assert.deepEqual(r.update.recomputed, []);
});

test('snapshots: tamper, wrong deployment key, expiry and later policy change are refused before any paid call', () => {
  const snap = (async () => (await baseline()).env.snapshot);
  return snap().then((s) => {
    const rev = (fn: () => unknown, code: string) => assert.throws(fn, (e: unknown) => e instanceof ApiError && e.code === code);
    rev(() => openSnapshot(`${s}x`, SECRET, HOSTS), 'REVALIDATION_REQUIRED');
    rev(() => openSnapshot(s, 'b'.repeat(40), HOSTS), 'REVALIDATION_REQUIRED');
    const [body, sig] = s.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, 'base64url').toString()), data: { kind: 'ripple-board-state' } })).toString('base64url');
    rev(() => openSnapshot(`${forged}.${sig}`, SECRET, HOSTS), 'REVALIDATION_REQUIRED');
    rev(() => openSnapshot(s, SECRET, HOSTS, Math.floor(Date.now() / 1000) + 8 * 86400), 'REVALIDATION_REQUIRED');
    rev(() => openSnapshot(signSnapshot({ kind: 'nope' }, SECRET), SECRET, HOSTS), 'REVALIDATION_REQUIRED');
    rev(() => openSnapshot(s, SECRET, ['docs.telem.ai']), 'SOURCE_NOT_ALLOWED');
  });
});

test('adapter never reads evaluation oracle data and never fetches user URLs natively', () => {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
  const files = walk('src').filter((f) => /\.(ts|tsx|mjs)$/.test(f));
  for (const f of files) assert.ok(!/oracle/i.test(readFileSync(f, 'utf8')) || f.endsWith('fixtures.ts'), `${f} mentions oracle`);
  // Outbound network clients are confined to the three adapters + quota (fixed hosts only);
  // client/api.ts is the browser's same-origin call into our own /api routes.
  const withFetch = files.filter((f) => /\bfetch\(|fetchImpl/.test(readFileSync(f, 'utf8'))).map((f) => f.replace(/^src\/lib\//, ''));
  assert.deepEqual(withFetch.sort(), ['client/api.ts', 'model/client.ts', 'search/acquire.ts', 'search/tavily-extract.mjs', 'search/telem.ts', 'server/guarded.ts', 'server/guards-core.mjs', 'server/operations.ts', 'server/quota.ts', 'server/research.ts']);
});

void ENV;
