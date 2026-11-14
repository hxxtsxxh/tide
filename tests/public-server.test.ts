// End-to-end through the single guarded entrypoint with fake Telem/model transports and a fake quota store.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BoardEnvelope, DiscoverResponse } from '../src/lib/contracts/board.ts';
import { LegacyResponse } from '../src/lib/contracts/legacy.ts';
import { runGuarded, type GuardSpec } from '../src/lib/server/guarded.ts';
import { createBoardSpec, discoverSpec, legacyRefreshSpec, refreshBoardSpec } from '../src/lib/server/operations.ts';
import type { QuotaStore } from '../src/lib/server/quota.ts';
import { ENV, fakeFetch, newWorld, URL_A, URL_B, type World } from './retrieval-fakes.ts';

const ORIGIN = 'https://ripple.example.test';
const create = { request_id: 'pb1', title: 'Unique board', question: 'How should I batch fetches?', requirements: 'batch of 7', urls: [URL_A, URL_B] };

function req(path: string, body: unknown, { origin = ORIGIN as string | null, cookie }: { origin?: string | null; cookie?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (origin) headers.origin = origin;
  if (cookie) headers.cookie = cookie;
  return new Request(new URL(path, ORIGIN), { method: 'POST', headers, body: JSON.stringify(body) });
}
function quota(allowed = true) {
  const calls: string[] = [];
  const store: QuotaStore = { async reserve(v) { calls.push(v); return { allowed, retryAfter: 30 }; } };
  return { calls, store };
}
const run = <T,>(spec: GuardSpec<T>, path: string, body: unknown, w: World, q = quota(), env: Record<string, string | undefined> = ENV, opts = {}) =>
  runGuarded(req(path, body, opts), spec, { env, quota: q.store, fetchImpl: fakeFetch(w) });

test('POST /api/boards: one atomic admission, only Telem+model hosts contacted, schema-valid signed board, cookie persists', async () => {
  const w = newWorld();
  const q = quota();
  const r = await run(createBoardSpec, '/api/boards', create, w, q);
  assert.equal(r.status, 201);
  const env = BoardEnvelope.parse(await r.json());
  assert.equal(q.calls.length, 1);
  assert.deepEqual([...new Set(w.calls.map((c) => c.host))].sort(), ['api.anthropic.com', 'router.telem.ai']);
  assert.equal(env.board.title, 'Unique board');
  assert.ok(env.board.facts.some((f) => f.status === 'supported'));
  assert.ok(env.trace.retrieval.every((t) => t.mode === 'live'));
  assert.ok(!JSON.stringify(env).includes('anthropic-test-key') && !JSON.stringify(env).includes('telem-test-key'));
  const set = r.headers.get('set-cookie')!;
  assert.match(set, /ripple_visitor=/);

  // native agent shape: same origin header + the persisted cookie, same quota/limits, no new cookie
  const q2 = quota();
  const r2 = await run(discoverSpec, '/api/discover', { request_id: 'pb2', query: 'abort fetch' }, newWorld(), q2, ENV, { cookie: set.split(';')[0] });
  assert.equal(r2.status, 200);
  DiscoverResponse.parse(await r2.json());
  assert.equal(r2.headers.get('set-cookie'), null);
  assert.equal(q2.calls.length, 1);
});

test('nothing upstream runs on rejection: quota denial/outage, kill switch, bad origin, unsafe source, unknown fields', async () => {
  const cases: [string, () => Promise<Response>, number][] = [];
  const w = newWorld();
  cases.push(['quota denied', () => run(createBoardSpec, '/api/boards', create, w, quota(false)), 429]);
  cases.push(['redis outage', () => runGuarded(req('/api/boards', create), createBoardSpec, { env: ENV, quota: { async reserve() { throw new Error('redis down'); } }, fetchImpl: fakeFetch(w) }), 503]);
  cases.push(['kill switch', () => run(createBoardSpec, '/api/boards', create, w, quota(), { ...ENV, RIPPLE_PUBLIC_BETA: 'false' }), 503]);
  cases.push(['origin', () => run(createBoardSpec, '/api/boards', create, w, quota(), ENV, { origin: 'https://evil.example' }), 403]);
  cases.push(['no origin', () => run(createBoardSpec, '/api/boards', create, w, quota(), ENV, { origin: null }), 403]);
  cases.push(['unsafe url', () => run(createBoardSpec, '/api/boards', { ...create, urls: ['https://docs.telem.ai@evil.example/'] }, w), 422]);
  cases.push(['override fields', () => run(createBoardSpec, '/api/boards', { ...create, limits: { max_pages: 99 }, model: 'x' }, w), 400]);
  cases.push(['too many urls', () => run(createBoardSpec, '/api/boards', { ...create, urls: Array(6).fill(URL_A) }, w), 400]);
  cases.push(['discover empty query', () => run(discoverSpec, '/api/discover', { request_id: 'x', query: '   ' }, w), 400]);
  for (const [name, fn, status] of cases) assert.equal((await fn()).status, status, name);
  assert.equal(w.calls.length, 0, 'zero Telem/model calls across all rejected requests');
});

test('upstream failures surface as coded errors without provider detail or secrets, after admission', async () => {
  for (const [world, code] of [
    [newWorld({ telemStatus: [401] }), 'UPSTREAM_UNAVAILABLE'],
    [newWorld({ modelStatus: [401] }), 'UPSTREAM_UNAVAILABLE'],
    [newWorld({ pages: {} }), 'SOURCE_UNAVAILABLE'],
  ] as const) {
    const q = quota();
    const r = await run(createBoardSpec, '/api/boards', create, world, q);
    const text = await r.text();
    assert.equal(JSON.parse(text).error.code, code);
    assert.equal(JSON.parse(text).request_id, 'pb1');
    assert.ok(!/test-key|PROVIDER-SECRET|boom/.test(text));
    assert.equal(q.calls.length, 1, 'failed attempts still count against the shared quota');
  }
});

test('POST /api/boards/refresh: forged/expired snapshots spend nothing; valid snapshot refreshes; no-op edit rejected pre-quota', async () => {
  const w = newWorld();
  const created = BoardEnvelope.parse(await (await run(createBoardSpec, '/api/boards', create, w)).json());
  const before = w.calls.length;
  const q = quota();
  // The unused low bits in SHA-256's final base64url character must be zero.
  // Node decodes these aliases identically; reject changed token spellings as well.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const forged = created.snapshot.slice(0, -1) + alphabet[alphabet.indexOf(created.snapshot.at(-1)!) ^ 1];
  assert.notEqual(forged, created.snapshot);
  assert.deepEqual(Buffer.from(forged.split('.')[1]!, 'base64url'), Buffer.from(created.snapshot.split('.')[1]!, 'base64url'));
  const bad = await run(refreshBoardSpec, '/api/boards/refresh', { request_id: 'r1', snapshot: forged, force: true }, w, q);
  assert.equal(bad.status, 409);
  assert.equal((await bad.json()).error.code, 'REVALIDATION_REQUIRED');
  const noop = await run(refreshBoardSpec, '/api/boards/refresh', { request_id: 'r1', snapshot: created.snapshot, force: false }, w, q);
  assert.equal(noop.status, 400);
  const same = await run(refreshBoardSpec, '/api/boards/refresh', { request_id: 'r1', snapshot: created.snapshot, force: false, requirements: 'batch of 7' }, w, q);
  assert.equal(same.status, 400);
  assert.equal(q.calls.length, 0);
  assert.equal(w.calls.length, before);

  const ok = await run(refreshBoardSpec, '/api/boards/refresh', { request_id: 'r2', snapshot: created.snapshot, force: true }, w, q);
  assert.equal(ok.status, 200);
  const env = BoardEnvelope.parse(await ok.json());
  assert.equal(env.board.revisions.length, 2);
  assert.equal(q.calls.length, 1);
  assert.equal(env.board.id, created.board.id);
});

// ---------------- legacy /api/refresh ----------------

const LOCAL = 'http://127.0.0.1:4317';
const LIMITS = { max_queries: 3, max_pages: 5, max_model_calls: 3, timeout_ms: 20000 };
async function legacy(input: Record<string, unknown>, strategy: 'treatment' | 'baseline' = 'treatment', extra: Record<string, unknown> = {}, env: Record<string, string | undefined> = { ...ENV, ALLOW_FIXTURE_MODE: 'true' }) {
  const body = { request_id: 'e1', mode: 'fixture', strategy, query: 'q', input, fixture_id: 'r-main', limits: LIMITS, ...extra };
  const throwing = (() => { throw new Error('fixture mode must not touch the network'); }) as unknown as typeof fetch;
  const r = await runGuarded(new Request(`${LOCAL}/api/refresh`, { method: 'POST', headers: { origin: LOCAL }, body: JSON.stringify(body) }), legacyRefreshSpec, { env, quota: quota().store, fetchImpl: throwing });
  return { status: r.status, json: (await r.json()) as any };
}
const ev = (event: unknown, rest: Record<string, unknown> = {}) => ({ event, ...rest });

test('legacy fixture: finite authored world; default event invalidates exactly the dependent closure; baseline refreshes all', async () => {
  const t = await legacy({});
  assert.equal(t.status, 200);
  LegacyResponse.parse(t.json);
  assert.deepEqual(t.json.result.affected_answer_ids.sort(), ['a-keynote', 'a-workshop']);
  assert.deepEqual(t.json.result.recomputed_answer_ids.sort(), ['a-keynote', 'a-workshop']);
  assert.deepEqual(t.json.result.reused_answer_ids, ['a-doors']);
  assert.equal(t.json.mode, 'fixture');
  assert.equal(t.json.trace.cache_mode, 'fixture');
  assert.equal(t.json.trace.model_calls, 0);
  assert.match(t.json.limitations.join(' '), /SYNTHETIC FIXTURE/);
  const b = await legacy({}, 'baseline');
  assert.deepEqual(b.json.result.affected_answer_ids.sort(), ['a-keynote', 'a-workshop']);
  assert.deepEqual(b.json.result.recomputed_answer_ids.sort(), ['a-doors', 'a-keynote', 'a-workshop']);
  assert.deepEqual(b.json.result.reused_answer_ids, []);
  assert.deepEqual(b.json.result.decisions.map((d: any) => [d.id, d.state]).sort(), t.json.result.decisions.map((d: any) => [d.id, d.state]).sort());
  // evidence is literal text of the world file, hash computed not hard-coded
  const world = JSON.parse(readFileSync('.searchhack/context/fixtures/worlds.json', 'utf8')).worlds[0];
  for (const e of t.json.evidence) {
    const s = world.sources.find((x: any) => x.id === e.source_id);
    assert.ok(s.text.includes(e.passage));
    assert.equal(e.content_sha256, createHash('sha256').update(s.text).digest('hex'));
    assert.equal(e.origin, 'fixture');
  }
});

test('legacy identity: input_sha256 follows IDENTITY.md key-sorted compact JSON', async () => {
  const t = await legacy({});
  const literal = '{"fixture_id":"r-main","input":{},"limits":{"max_model_calls":3,"max_pages":5,"max_queries":3,"timeout_ms":20000},"mode":"fixture","query":"q"}';
  assert.equal(t.json.input_sha256, createHash('sha256').update(literal).digest('hex'));
  assert.equal(t.json.request_id, 'e1');
});

test('legacy fixture semantics: no-op, cosmetic, failed fetch, alternative support, deleted evidence, requirement, unused fact, exhausted budget, cycle', async () => {
  const same = await legacy(ev({ kind: 'fact_changed', fact_id: 'f-cap', new_value: 120 }));
  assert.deepEqual([same.json.result.affected_answer_ids, same.json.result.recomputed_answer_ids], [[], []]);
  assert.equal(same.json.result.reused_answer_ids.length, 3);

  const cosmetic = await legacy(ev({ kind: 'source_text_changed', source_id: 's-cap', new_text: 'x', semantic_value: 120 }));
  assert.deepEqual(cosmetic.json.result.affected_answer_ids, []);
  const real = await legacy(ev({ kind: 'source_text_changed', source_id: 's-cap', new_text: 'x', semantic_value: 80 }));
  assert.deepEqual(real.json.result.affected_answer_ids.sort(), ['a-keynote', 'a-workshop']);

  const failed = await legacy(ev({ kind: 'source_fetch_failed', source_id: 's-cap' }));
  assert.deepEqual(failed.json.result.unknown_answer_ids.sort(), ['a-keynote', 'a-workshop']);
  assert.deepEqual(failed.json.result.recomputed_answer_ids, [], 'unknown freshness is not a recomputation');
  assert.equal(failed.json.status, 'partial');
  assert.ok(failed.json.result.decisions.filter((d: any) => d.state === 'unknown').every((d: any) => d.evidence_ids.length === 0));
  assert.equal(failed.json.trace.fetches.find((f: any) => f.source_id === 's-cap').status, 'failed');

  const alt = { facts: [{ id: 'f-cap', value: 120, support_sets: [['s-cap'], ['s-backup']] }, { id: 'f-time', value: '10:00', support_sets: [['s-time']] }] };
  const survives = await legacy(ev({ kind: 'source_deleted', source_id: 's-cap' }, alt));
  assert.deepEqual(survives.json.result.unknown_answer_ids, []);
  assert.deepEqual(survives.json.result.affected_answer_ids, []);
  const gone = await legacy(ev({ kind: 'source_deleted', source_id: 's-cap' }));
  assert.deepEqual(gone.json.result.unknown_answer_ids.sort(), ['a-keynote', 'a-workshop']);

  const req = await legacy(ev({ kind: 'requirement_changed', answer_id: 'a-workshop', new_value: 100 }));
  assert.deepEqual(req.json.result.affected_answer_ids, ['a-workshop']);
  assert.deepEqual(req.json.result.reused_answer_ids.sort(), ['a-doors', 'a-keynote']);
  assert.match(req.json.trace.notes.join(' '), /not a source change/);

  const unused = await legacy(ev({ kind: 'fact_changed', fact_id: 'f-unused', new_value: 'new' }, { facts: [...alt.facts.map((f) => ({ ...f, support_sets: [f.support_sets[0]] })), { id: 'f-unused', value: 'old', support_sets: [['s-backup']] }] }));
  assert.deepEqual(unused.json.result.affected_answer_ids, []);

  const exhausted = await legacy({ max_answer_recomputes: 0 });
  assert.deepEqual(exhausted.json.result.recomputed_answer_ids, []);
  assert.deepEqual(exhausted.json.result.unknown_answer_ids.sort(), ['a-keynote', 'a-workshop']);
  assert.ok(exhausted.json.result.decisions.every((d: any) => d.state !== 'fresh'));

  const cyc = await legacy({ answers: [{ id: 'a-workshop', depends_on: ['a-keynote'] }, { id: 'a-keynote', depends_on: ['a-workshop'] }] });
  assert.equal(cyc.status, 400);
  assert.equal(cyc.json.error.code, 'INVALID_INPUT');
});

test('legacy fixture transport is explicit and local: off by default, never for non-local hosts, unknown ids rejected', async () => {
  assert.equal((await legacy({}, 'treatment', {}, ENV)).status, 403);
  assert.equal((await legacy({}, 'treatment', { fixture_id: 'nope' })).status, 400);
  const remote = await runGuarded(req('/api/refresh', { request_id: 'e', mode: 'fixture', strategy: 'treatment', query: 'q', input: {}, fixture_id: 'r-main', limits: LIMITS }), legacyRefreshSpec, { env: { ...ENV, ALLOW_FIXTURE_MODE: 'true' }, quota: quota().store });
  assert.equal(remote.status, 403);
  const onVercel = await legacy({}, 'treatment', {}, { ...ENV, ALLOW_FIXTURE_MODE: 'true', VERCEL: '1' });
  assert.equal(onVercel.status, 403);
});

test('legacy live: same Telem+model pipeline under the declared (lower) limits; evidence is real fetched text', async () => {
  const w = newWorld();
  const q = quota();
  const body = { request_id: 'l1', mode: 'live', strategy: 'treatment', query: 'How should I batch fetches?', input: { action: 'build', source_urls: [URL_A], requested_batch_size: 7 }, limits: { ...LIMITS, max_model_calls: 2 } };
  const r = await runGuarded(req('/api/refresh', body), legacyRefreshSpec, { env: ENV, quota: q.store, fetchImpl: fakeFetch(w) });
  assert.equal(r.status, 200);
  const j = LegacyResponse.parse(await r.json());
  assert.equal(q.calls.length, 1);
  assert.equal(j.mode, 'live');
  assert.ok(j.trace.queries[0]!.providers.length > 0 && j.trace.queries[0]!.request_id === 'int-1');
  assert.ok(j.evidence.length > 0 && j.evidence.every((e) => e.origin === 'telem_live' && w.pages[URL_A]!.text!.replace(/\s+/g, ' ').includes(e.passage)));
  assert.ok(j.trace.model_calls <= 2);
  assert.equal(j.trace.fetches.length, 1);
  assert.equal(w.calls.find((c) => c.path === '/v1/search')!.body.search.include_domains[0], 'docs.telem.ai');
  assert.equal(w.calls.filter((c) => c.path === '/v1/search').length, 1);

  // max_model_calls=0 -> the model is never contacted and nothing is fabricated
  const w0 = newWorld();
  const r0 = await runGuarded(req('/api/refresh', { ...body, limits: { ...LIMITS, max_model_calls: 0 } }), legacyRefreshSpec, { env: ENV, quota: quota().store, fetchImpl: fakeFetch(w0) });
  assert.equal(r0.status, 502);
  assert.equal(w0.calls.filter((c) => c.host === 'api.anthropic.com').length, 0);
});
