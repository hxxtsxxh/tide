// ripple-tavily-v1: direct Tavily /extract supplies the evidence text in create, refresh and the legacy route,
// while Telem stays the router/qualifier in the same operation. Fake transports only; never contacts the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardEnvelope, type Board } from '../src/lib/contracts/board.ts';
import { HealthBody, LegacyResponse } from '../src/lib/contracts/legacy.ts';
import { runGuarded, type GuardSpec } from '../src/lib/server/guarded.ts';
import { createBoardSpec, refreshBoardSpec } from '../src/app/api/_lib/specs.ts';
import { legacyRefreshSpec } from '../src/lib/server/operations.ts';
import { healthBody } from '../src/lib/server/health.ts';
import { ENV, TEXT_A, URL_A, URL_B, fakeFetch, newWorld, type World } from './retrieval-fakes.ts';

const ORIGIN = 'https://ripple.example.test';
const create = { request_id: 'c1', title: 'Fetch plan', question: 'How should I batch fetches?', requirements: 'batch of 7', urls: [URL_A, URL_B] };
const allow = { async reserve() { return { allowed: true, retryAfter: 0 }; } };
const post = (path: string, body: unknown) => new Request(new URL(path, ORIGIN), { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify(body) });
const run = async <T,>(spec: GuardSpec<T>, path: string, body: unknown, w: World, env: Record<string, string | undefined> = ENV) => {
  const r = await runGuarded(post(path, body), spec, { env, quota: allow, fetchImpl: fakeFetch(w) });
  assert.ok(r.status < 300, `HTTP ${r.status}`);
  return BoardEnvelope.parse(await r.json());
};
const src = (b: Board, url: string) => b.sources.find((s) => s.url === url)!;
const factQuoting = (b: Board, part: string) => b.facts.find((f) => f.quote.includes(part));
const tavilyCalls = (w: World) => w.calls.filter((c) => c.host === 'api.tavily.com');
// Telem's copy of page A differs from Tavily's: only Tavily's text contains the model's quotes.
const TELEM_ONLY_A = 'Navigation menu. This Telem copy of the page lacks the batching sentence entirely.';

test('create: Tavily raw_content is the quoted evidence; Telem still qualifies the same URLs', async () => {
  const w = newWorld();
  w.pages[URL_A] = { text: TELEM_ONLY_A, tavily: { text: TEXT_A } };
  const env = await run(createBoardSpec, '/api/boards', create, w);
  const f = factQuoting(env.board, 'at most 5 URLs');
  assert.ok(f && f.status === 'supported', 'a fact quoted only in Tavily text is supported');
  const s = src(env.board, URL_A);
  assert.ok(s.excerpt.includes(f.quote) && !TELEM_ONLY_A.includes(f.quote));
  assert.equal(s.extractor, 'tavily');
  assert.match(s.provider_request_id!, /^tav-req-\d+$/);
  assert.equal(s.extraction_status, 'succeeded');
  assert.equal(s.cache_state, 'unknown', 'no invented cache freshness for direct extraction');
  // one batched Tavily call (basic, no query), plus Telem fetch for the same URLs, all in one operation
  assert.equal(tavilyCalls(w).length, 1);
  assert.deepEqual(tavilyCalls(w)[0]!.body.urls, [URL_A, URL_B]);
  assert.equal(tavilyCalls(w)[0]!.body.extract_depth, 'basic');
  assert.equal(tavilyCalls(w)[0]!.body.query, undefined);
  assert.ok(w.calls.some((c) => c.host === 'hack.telem.ai' && c.path === '/api/v1/fetch'));
  const tav = env.trace.retrieval.filter((r) => r.service === 'tavily');
  assert.equal(env.trace.retrieval.reduce((n, r) => n + (r.http_attempts ?? 0), 0), 2, 'one Telem batch plus one direct Tavily batch');
  assert.equal(tav.length, 1, 'credits are accounted once per batch, not per URL');
  assert.deepEqual({ provider: tav[0]!.provider, transport: tav[0]!.transport, endpoint: tav[0]!.endpoint, status: tav[0]!.status, credits: tav[0]!.usage?.credits, cache: tav[0]!.cache_state }, { provider: 'tavily', transport: 'direct', endpoint: 'extract', status: 'succeeded', credits: 1, cache: 'unknown' });
  assert.equal(tav[0]!.requestId, s.provider_request_id);
  assert.notEqual(tav[0]!.callId, tav[0]!.requestId, 'a local call ID is not a provider request ID');
  assert.ok(env.trace.retrieval.filter((r) => r.service === 'telem').every((r) => r.transport === 'telem' && r.provider === 'exa'), 'Telem keeps its real underlying provider');
  assert.ok(env.trace.limitations.some((l) => /not independent sources/.test(l)));
  assert.ok(!JSON.stringify(env).includes(ENV.TAVILY_API_KEY));
});

test('quotes are verified against the Tavily text, not the Telem copy', async () => {
  const w = newWorld();
  w.pages[URL_A] = { text: TEXT_A, tavily: { text: TELEM_ONLY_A } };
  const env = await run(createBoardSpec, '/api/boards', create, w);
  assert.equal(factQuoting(env.board, 'at most 5 URLs'), undefined, 'a quote present only in Telem text is not evidence');
  assert.equal(src(env.board, URL_A).extractor, 'tavily');
});

test('Tavily auth failure: Telem text is a labeled degraded fallback, never counted as Tavily success', async () => {
  const w = newWorld({ tavilyStatus: [401] });
  const env = await run(createBoardSpec, '/api/boards', create, w);
  const s = src(env.board, URL_A);
  assert.deepEqual([s.extractor, s.extraction_status, s.extraction_error, s.provider_request_id], ['telem', 'degraded_fallback', 'TAVILY_AUTH_FAILED', null]);
  const tav = env.trace.retrieval.find((r) => r.service === 'tavily')!;
  assert.equal(tav.status, 'failed');
  assert.equal(tav.error, 'TAVILY_AUTH_FAILED');
  assert.equal(tav.requestId, null);
  assert.ok(env.trace.limitations.some((l) => /degraded fallback/.test(l) && /not Tavily extractions/.test(l)));
});

test('Tavily not configured: no Tavily request; sources labeled degraded; health reports it key-free', async () => {
  const w = newWorld();
  const { TAVILY_API_KEY: _omit, ...noTavily } = ENV;
  const env = await run(createBoardSpec, '/api/boards', create, w, noTavily);
  assert.equal(tavilyCalls(w).length, 0);
  assert.ok(env.board.sources.filter((s) => s.status !== 'failed').every((s) => s.extractor === 'telem' && s.extraction_error === 'TAVILY_NOT_CONFIGURED'));
  const h = healthBody(noTavily);
  assert.equal(HealthBody.safeParse(h).success, true);
  assert.equal(h.sponsors!.tavily.configured, false);
  const h2 = healthBody(ENV);
  assert.deepEqual([h2.sponsors!.telem.configured, h2.sponsors!.tavily.configured], [true, true]);
  assert.ok(!JSON.stringify(h2).includes(ENV.TAVILY_API_KEY) && !JSON.stringify(h2).includes(ENV.TELEM_API_KEY));
});

test('per-URL failed_results and unrequested result URLs are explicit, not success', async () => {
  const w = newWorld();
  w.pages[URL_A] = { text: TEXT_A, tavily: { fail: true } };
  w.pages[URL_B] = { ...w.pages[URL_B]!, tavily: { url: 'https://developer.mozilla.org/en-US/docs/Other' } };
  const env = await run(createBoardSpec, '/api/boards', create, w);
  assert.equal(env.trace.retrieval.find((r) => r.service === 'tavily')!.status, 'failed');
  for (const url of [URL_A, URL_B]) assert.equal(src(env.board, url).extraction_status, 'degraded_fallback');
});

test('Telem destination policy rejection wins over Tavily content', async () => {
  const w = newWorld();
  w.pages[URL_A] = { text: TEXT_A, canonical: 'https://evil.example/' };
  const env = await run(createBoardSpec, '/api/boards', create, w);
  const s = src(env.board, URL_A);
  assert.equal(s.status, 'failed');
  assert.equal(s.extraction_error, 'rejected:destination_out_of_policy');
  assert.equal(factQuoting(env.board, 'at most 5 URLs'), undefined);
});

test('refresh: a change seen only in Tavily text re-extracts and changes the fact; Telem re-reads too', async () => {
  const w = newWorld();
  const env = await run(createBoardSpec, '/api/boards', create, w);
  const before = factQuoting(env.board, 'at most 5 URLs')!;
  const changed = TEXT_A.replace('at most 5 URLs', 'at most 7 URLs');
  w.pages[URL_A] = { text: TEXT_A, tavily: { text: changed } }; // Telem copy unchanged
  const sid = src(env.board, URL_A).id;
  w.refreshFacts = { facts: [{ ref: 'F0', source: sid, key: 'max_urls_per_fetch', value: 7, quote: 'Telem fetch accepts at most 7 URLs per request.' }, { ref: 'F1', source: sid, key: 'per_page_errors', value: true, quote: 'Failed pages return a per-page error even when HTTP status is 200.' }] };
  const telemFetches = w.calls.filter((c) => c.path === '/api/v1/fetch').length;
  const r = await run(refreshBoardSpec, '/api/boards/refresh', { request_id: 'r', snapshot: env.snapshot, force: true }, w);
  const after = r.board.facts.find((f) => f.id === before.id)!;
  assert.equal(after.value, 7);
  assert.equal(after.status, 'supported');
  assert.ok(src(r.board, URL_A).excerpt.includes(after.quote));
  assert.ok(r.update.recomputed.length > 0);
  assert.equal(w.calls.filter((c) => c.path === '/api/v1/fetch').length, telemFetches + 1);
  assert.equal(tavilyCalls(w).length, 2);
  assert.equal(src(r.board, URL_A).provider_request_id, r.trace.retrieval.find((t) => t.service === 'tavily')!.requestId, 'provenance names the refresh extraction');
});

test('legacy live route (MCP compatibility) uses the same Tavily evidence and reports the extractor', async () => {
  const w = newWorld();
  w.pages[URL_A] = { text: TELEM_ONLY_A, tavily: { text: TEXT_A } };
  const body = { request_id: 'l1', mode: 'live', strategy: 'treatment', query: 'How should I batch fetches?', input: { action: 'build', source_urls: [URL_A] }, limits: { max_queries: 1, max_pages: 5, max_model_calls: 2, timeout_ms: 20000 } };
  const r = await runGuarded(post('/api/refresh', body), legacyRefreshSpec, { env: ENV, quota: allow, fetchImpl: fakeFetch(w) });
  assert.equal(r.status, 200);
  const j = LegacyResponse.parse(await r.json());
  assert.ok(j.evidence.length > 0 && j.evidence.every((e) => TEXT_A.replace(/\s+/g, ' ').includes(e.passage)));
  assert.ok(j.trace.notes.some((n) => /extractor=tavily status=succeeded provider_request_id=tav-req-/.test(n)));
  assert.ok(j.trace.notes.some((n) => /tavily direct extract: status=succeeded/.test(n)));
  assert.equal(j.trace.queries.length, 1, 'Telem search still runs for the legacy route');
  assert.ok(j.trace.notes.some((n) => n.includes('Telem=2') && n.includes('direct Tavily=1')));
});


test('Telem retries and Tavily failure attempts are each counted once per batch', async () => {
  const w = newWorld({ telemStatus: [500], tavilyStatus: [429] });
  const env = await run(createBoardSpec, '/api/boards', create, w);
  assert.equal(env.trace.retrieval.filter((r) => r.service === 'telem').reduce((n, r) => n + (r.http_attempts ?? 0), 0), 2);
  assert.equal(env.trace.retrieval.find((r) => r.service === 'tavily')!.http_attempts, 1);
  assert.equal(env.trace.retrieval.find((r) => r.service === 'tavily')!.status, 'failed');
});


test('failed refresh preserves the extractor and quotations of retained historical text', async () => {
  const w = newWorld({ tavilyStatus: [401] });
  const created = await run(createBoardSpec, '/api/boards', create, w);
  const prior = src(created.board, URL_A);
  assert.equal(prior.extractor, 'telem');
  w.pages[URL_A] = { fail: true };
  const refreshed = await run(refreshBoardSpec, '/api/boards/refresh', { request_id: 'failure', snapshot: created.snapshot, force: true }, w);
  const after = src(refreshed.board, URL_A);
  assert.equal(after.status, 'failed');
  assert.equal(after.extractor, prior.extractor, 'failed attempt cannot relabel old text as Tavily evidence');
  assert.equal(after.provider_request_id, prior.provider_request_id);
  assert.equal(after.excerpt, prior.excerpt);
  assert.equal(after.observedAt, prior.observedAt);
  assert.equal(after.extraction_status, 'failed');
  assert.ok(refreshed.board.facts.filter((f) => f.source_id === after.id).every((f) => f.status !== 'supported'));
  assert.ok(refreshed.trace.retrieval.some((r) => r.service === 'tavily'));
});
