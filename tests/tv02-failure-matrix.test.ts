// Independent QA checks. Synthetic transports here never establish live sponsor readiness.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardEnvelope } from '../src/lib/contracts/board.ts';
import { runGuarded, type GuardSpec } from '../src/lib/server/guarded.ts';
import { createBoardSpec, refreshBoardSpec } from '../src/app/api/_lib/specs.ts';
import { discoverSpec, legacyRefreshSpec } from '../src/lib/server/operations.ts';
import { extractTavily } from '../src/lib/search/tavily-extract.mjs';
import { ENV, URL_A, URL_B, TEXT_A, newWorld, fakeFetch } from './retrieval-fakes.ts';

const origin = 'https://ripple.example.test';
const create = { request_id: 'tv02', title: 'Independent QA', question: 'Which constraints are evidenced?', requirements: 'batch 7', urls: [URL_A, URL_B] };
const post = (path: string, body: unknown) => new Request(origin + path, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const admit = { async reserve() { return { allowed: true, retryAfter: 0 }; } };

test('TV02: both services start only after one common admission, including degraded extraction', async () => {
  for (const tavilyStatus of [[], [401], [429]]) {
    const world = newWorld({ tavilyStatus });
    const fetchImpl = fakeFetch(world);
    let reservations = 0;
    const response = await runGuarded(post('/api/boards', create), createBoardSpec, {
      env: ENV, quota: { async reserve() { assert.equal(world.calls.length, 0); reservations++; return { allowed: true, retryAfter: 0 }; } },
      fetchImpl: (async (...args) => { assert.equal(reservations, 1); return fetchImpl(...args); }) as typeof fetch,
    });
    assert.equal(response.status, 201);
    const envelope = BoardEnvelope.parse(await response.json());
    for (const service of ['telem', 'tavily']) {
      const actual = world.calls.filter(c => c.host === (service === 'telem' ? 'hack.telem.ai' : 'api.tavily.com')).length;
      assert.equal(envelope.trace.retrieval.filter(t => t.service === service).reduce((n, t) => n + (t.http_attempts ?? 0), 0), actual);
    }
    assert.equal(reservations, 1);
  }
});

test('TV02: quota denial/outage closes all paid routes before Telem/Tavily/model calls', async () => {
  const routes: [GuardSpec<any>, string, unknown][] = [
    [createBoardSpec, '/api/boards', create],
    [refreshBoardSpec, '/api/boards/refresh', { request_id: 'x', snapshot: 'invalid.signature', force: true }],
    [discoverSpec, '/api/discover', { request_id: 'x', query: 'cancellation' }],
    [legacyRefreshSpec, '/api/refresh', { request_id: 'x', mode: 'live', strategy: 'treatment', query: 'Q', input: { action: 'build', source_urls: [URL_A] }, limits: { max_queries: 1, max_pages: 5, max_model_calls: 2, timeout_ms: 20000 } }],
  ];
  for (const [spec, path, body] of routes) {
    for (const outage of [false, true]) {
      const world = newWorld();
      const response = await runGuarded(post(path, body), spec, { env: ENV, fetchImpl: fakeFetch(world), quota: { async reserve() { if (outage) throw Error('private redis failure'); return { allowed: false, retryAfter: 17 }; } } });
      if (path.endsWith('/refresh') && path.includes('/boards')) assert.equal(response.status, 409, 'invalid snapshot fails even before quota');
      else { assert.equal(response.status, outage ? 503 : 429); if (!outage) assert.equal(response.headers.get('retry-after'), '17'); }
      assert.equal(world.calls.length, 0);
      assert.ok(!(await response.text()).includes('private redis failure'));
    }
  }
});

test('TV02: HTTP 200 failed_results keeps success/failure and credits separate', async () => {
  const world = newWorld();
  world.pages[URL_B]!.tavily = { fail: true };
  const response = await runGuarded(post('/api/boards', create), createBoardSpec, { env: ENV, quota: admit, fetchImpl: fakeFetch(world) });
  const e = BoardEnvelope.parse(await response.json());
  const trace = e.trace.retrieval.find(t => t.service === 'tavily')!;
  assert.equal(trace.status, 'partial');
  assert.equal(trace.http_attempts, 1);
  assert.deepEqual(trace.usage, { credits: 1 });
  assert.equal(e.board.sources.find(s => s.url === URL_A)!.extractor, 'tavily');
  assert.equal(e.board.sources.find(s => s.url === URL_B)!.extraction_status, 'degraded_fallback');
});

test('TV02: real signed domain snapshot tampering is refused pre-quota; valid refresh still requires quota', async () => {
  const world = newWorld();
  const e = BoardEnvelope.parse(await (await runGuarded(post('/api/boards', create), createBoardSpec, { env: ENV, quota: admit, fetchImpl: fakeFetch(world) })).json());
  world.calls.length = 0;
  let reservations = 0;
  const deny = { async reserve() { reservations++; return { allowed: false, retryAfter: 23 }; } };
  const tampered = (e.snapshot[0] === 'a' ? 'b' : 'a') + e.snapshot.slice(1);
  const bad = await runGuarded(post('/api/boards/refresh', { request_id: 'tamper', snapshot: tampered, force: true }), refreshBoardSpec, { env: ENV, quota: deny, fetchImpl: fakeFetch(world) });
  assert.equal(bad.status, 409);
  assert.equal(reservations, 0);
  const good = await runGuarded(post('/api/boards/refresh', { request_id: 'denied', snapshot: e.snapshot, force: true }), refreshBoardSpec, { env: ENV, quota: deny, fetchImpl: fakeFetch(world) });
  assert.equal(good.status, 429);
  assert.equal(good.headers.get('retry-after'), '23');
  assert.equal(reservations, 1);
  assert.equal(world.calls.length, 0);
});

test('TV02: malformed key fails before Tavily network and never appears in public output', async () => {
  const world = newWorld();
  const invalidKey = 'malformed key with spaces';
  const response = await runGuarded(post('/api/boards', create), createBoardSpec, { env: { ...ENV, TAVILY_API_KEY: invalidKey }, quota: admit, fetchImpl: fakeFetch(world) });
  const e = BoardEnvelope.parse(await response.json());
  assert.equal(world.calls.filter(c => c.host === 'api.tavily.com').length, 0);
  assert.ok(e.board.sources.every(s => s.extraction_error === 'TAVILY_KEY_MISSING' && s.extraction_status === 'degraded_fallback'));
  assert.ok(!JSON.stringify(e).includes(invalidKey));
});

test('TV02: actual timeout signal yields one failed attempt, no retry or invented usage', async (t) => {
  const realTimeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, 'timeout', (ms: number) => { assert.equal(ms, 20000); return realTimeout(5); });
  let calls = 0;
  // Keep event loop alive because AbortSignal.timeout uses an unref timer.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const result = await extractTavily([URL_A], { apiKey: ENV.TAVILY_API_KEY, allowedHosts: ['docs.telem.ai'], fetchImpl: async (_url, init) => {
      calls++;
      assert.equal(JSON.parse(String(init!.body)).timeout, 15);
      return await new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }));
    } });
    assert.equal(result.error!.code, 'TAVILY_TIMEOUT');
    assert.equal(result.trace.http_attempts, 1);
    assert.equal(calls, 1);
    assert.equal(result.trace.usage, null);
    assert.equal(result.trace.requestId, null);
    assert.equal(result.sources[0]!.status, 'failed');
  } finally { clearTimeout(keepAlive); }
});

test('TV02: unavailable refresh preserves old text while dependent facts/answers become unknown', async () => {
  const world = newWorld();
  const created = BoardEnvelope.parse(await (await runGuarded(post('/api/boards', create), createBoardSpec, { env: ENV, quota: admit, fetchImpl: fakeFetch(world) })).json());
  world.pages[URL_A] = { fail: true };
  const response = await runGuarded(post('/api/boards/refresh', { request_id: 'refresh', snapshot: created.snapshot, force: true }), refreshBoardSpec, { env: ENV, quota: admit, fetchImpl: fakeFetch(world) });
  const e = BoardEnvelope.parse(await response.json());
  const source = e.board.sources.find(s => s.url === URL_A)!;
  assert.equal(source.status, 'failed');
  assert.equal(source.excerpt, created.board.sources.find(s => s.url === URL_A)!.excerpt);
  assert.ok(e.board.facts.filter(f => f.source_id === source.id).every(f => f.status !== 'supported'));
  assert.ok(e.update.unknown.length > 0);
  assert.ok(e.board.answers.filter(a => e.update.unknown.includes(a.id)).every(a => a.status === 'unknown'));
});

test('TV02: Telem-only quotations cannot become Tavily-supported facts', async () => {
  const world = newWorld();
  world.pages[URL_A] = { text: TEXT_A, tavily: { text: 'This source discusses another subject and makes no statement about batch size or page errors.' } };
  const response = await runGuarded(post('/api/boards', create), createBoardSpec, { env: ENV, quota: admit, fetchImpl: fakeFetch(world) });
  const e = BoardEnvelope.parse(await response.json());
  assert.ok(!e.board.facts.some(f => f.quote.includes('at most 5 URLs')));
  for (const f of e.board.facts.filter(f => f.status === 'supported')) assert.ok(e.board.sources.find(s => s.id === f.source_id)!.excerpt.includes(f.quote));
});
