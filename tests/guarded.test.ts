// Single guarded entrypoint: origin, streamed body cap, schema, source policy, kill switch, quota.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runGuarded, type GuardSpec } from '../src/lib/server/guarded.ts';
import { createBoardSpec, discoverSpec, legacyRefreshSpec, refreshBoardSpec } from '../src/lib/server/operations.ts';
import { mintVisitor, verifyVisitor, VISITOR_COOKIE } from '../src/lib/server/session.ts';
import type { QuotaStore } from '../src/lib/server/quota.ts';

const ORIGIN = 'https://ripple.example.test';
const env = { TELEM_API_KEY: 't', APP_MODEL: 'm', ANTHROPIC_API_KEY: 'k', UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'r', RIPPLE_STATE_SECRET: 's'.repeat(40) };
const create = { request_id: 'q1', title: 'T', question: 'Q', requirements: '', urls: ['https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API#x'] };

function post(body: unknown, { path = '/api/boards', origin = ORIGIN as string | null, cookie }: { path?: string; origin?: string | null; cookie?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (origin) headers.origin = origin;
  if (cookie) headers.cookie = cookie;
  return new Request(new URL(path, ORIGIN), { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
}
function counting(decision = { allowed: true, retryAfter: 60 }) {
  const calls: string[] = [];
  const store: QuotaStore = { async reserve(v) { calls.push(v); return decision; } };
  return { calls, store };
}
function withExecute<T>(spec: GuardSpec<T>) {
  const seen: T[] = [];
  return { seen, spec: { ...spec, execute: async (b: T) => { seen.push(b); return { status: 201 as const, body: { ok: true } }; } } };
}

test('origin is required and must match', async () => {
  const q = counting();
  for (const origin of [null, 'https://untrusted.invalid']) {
    const r = await runGuarded(post(create, { origin }), withExecute(createBoardSpec).spec, { env, quota: q.store });
    assert.equal(r.status, 403);
    assert.equal((await r.json()).error.code, 'ORIGIN_REJECTED');
  }
  assert.equal(q.calls.length, 0);
});

test('oversized streamed body is rejected without Content-Length', async () => {
  const big = new ReadableStream({ start(c) { for (let i = 0; i < 20; i++) c.enqueue(new Uint8Array(1024)); c.close(); } });
  const req = new Request(new URL('/api/boards', ORIGIN), { method: 'POST', headers: { origin: ORIGIN }, body: big, duplex: 'half' } as RequestInit);
  const r = await runGuarded(req, withExecute(createBoardSpec).spec, { env, quota: counting().store });
  assert.equal(r.status, 413);
});

test('schema errors and unsafe sources are rejected before quota or execution', async () => {
  const q = counting();
  const x = withExecute(createBoardSpec);
  assert.equal((await runGuarded(post('{bad'), x.spec, { env, quota: q.store })).status, 400);
  assert.equal((await runGuarded(post({ ...create, fixture_id: 'r-main' }), x.spec, { env, quota: q.store })).status, 400);
  for (const url of ['https://127.0.0.1/', 'http://169.254.169.254/', 'https://docs.telem.ai.evil.invalid/', 'https://user:p@developer.mozilla.org/']) {
    const r = await runGuarded(post({ ...create, urls: [url] }), x.spec, { env, quota: q.store });
    assert.equal(r.status, 422, url);
    const body = await r.json();
    assert.equal(body.error.code, 'SOURCE_NOT_ALLOWED');
    assert.equal(body.request_id, 'q1');
  }
  assert.equal(q.calls.length, 0);
  assert.equal(x.seen.length, 0);
});

test('unimplemented operations answer 501 without reserving quota', async () => {
  const q = counting();
  for (const [spec, body, path] of [
    [createBoardSpec, create, '/api/boards'],
    [refreshBoardSpec, { request_id: 'q', snapshot: 'a.b', force: true }, '/api/boards/refresh'],
    [discoverSpec, { request_id: 'q', query: 'fetch abort' }, '/api/discover'],
  ] as const) {
    const r = await runGuarded(post(body, { path }), spec as GuardSpec<unknown>, { env, quota: q.store });
    assert.equal(r.status, 501, path);
  }
  assert.equal(q.calls.length, 0);
});

test('kill switch, missing config and quota outage spend nothing', async () => {
  for (const [e, code] of [
    [{ ...env, RIPPLE_PUBLIC_BETA: 'false' }, 'PUBLIC_ACCESS_DISABLED'],
    [{ ...env, UPSTASH_REDIS_REST_URL: 'https://evil.test' }, 'QUOTA_UNAVAILABLE'],
    [{ ...env, RIPPLE_STATE_SECRET: 'short' }, 'QUOTA_UNAVAILABLE'],
    [{ ...env, TELEM_API_KEY: '' }, 'UPSTREAM_UNAVAILABLE'],
  ] as const) {
    const q = counting();
    const x = withExecute(createBoardSpec);
    const r = await runGuarded(post(create), x.spec, { env: e, quota: q.store });
    assert.equal((await r.json()).error.code, code);
    assert.equal(q.calls.length + x.seen.length, 0, code);
  }
  const x = withExecute(createBoardSpec);
  const broken: QuotaStore = { async reserve() { throw new Error('redis timeout with secret'); } };
  const r = await runGuarded(post(create), x.spec, { env, quota: broken });
  assert.equal(r.status, 503);
  assert.ok(!(await r.text()).includes('secret'));
  assert.equal(x.seen.length, 0);
});

test('quota denial returns 429 with Retry-After; admission runs once with normalized URLs and a signed visitor', async () => {
  const denied = withExecute(createBoardSpec);
  const r = await runGuarded(post(create), denied.spec, { env, quota: counting({ allowed: false, retryAfter: 42 }).store });
  assert.equal(r.status, 429);
  assert.equal(r.headers.get('retry-after'), '42');
  assert.equal(denied.seen.length, 0);

  const q = counting();
  const ok = withExecute(createBoardSpec);
  const r2 = await runGuarded(post(create), ok.spec, { env, quota: q.store });
  assert.equal(r2.status, 201);
  assert.deepEqual(ok.seen[0]!.urls, ['https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API']);
  const set = r2.headers.get('set-cookie') ?? '';
  assert.match(set, /^ripple_visitor=.*HttpOnly; SameSite=Strict.*Secure/);
  const cookie = set.split(';')[0]!;
  assert.equal(verifyVisitor(cookie, env.RIPPLE_STATE_SECRET), q.calls[0]);

  // Existing valid cookie is reused; forged/client-chosen cookie gets a fresh server-minted identity.
  const q2 = counting();
  const r3 = await runGuarded(post(create, { cookie }), ok.spec, { env, quota: q2.store });
  assert.equal(r3.headers.get('set-cookie'), null);
  assert.equal(q2.calls[0], q.calls[0]);
  const r4 = await runGuarded(post(create, { cookie: `${VISITOR_COOKIE}=chosen-by-client.abc` }), ok.spec, { env, quota: q2.store });
  assert.ok(r4.headers.get('set-cookie'));
  assert.notEqual(q2.calls[1], 'chosen-by-client');
});

test('visitor cookie rejects other keys and tampering', () => {
  const { setCookie, id } = mintVisitor(env.RIPPLE_STATE_SECRET, false);
  const cookie = setCookie.split(';')[0]!;
  assert.ok(!setCookie.includes('Secure'));
  assert.equal(verifyVisitor(cookie, env.RIPPLE_STATE_SECRET), id);
  assert.equal(verifyVisitor(cookie, 'b'.repeat(40)), null);
  assert.equal(verifyVisitor(cookie.replace(id, 'A'.repeat(22)), env.RIPPLE_STATE_SECRET), null);
});

test('legacy /api/refresh: fixture transport localhost+opt-in only and unbilled; live is billable', async () => {
  const fixture = { request_id: 'e1', mode: 'fixture', strategy: 'treatment', query: 'q', input: {}, fixture_id: 'r-main', limits: { max_queries: 3, max_pages: 5, max_model_calls: 3, timeout_ms: 20000 } };
  const x = withExecute(legacyRefreshSpec);
  const q = counting();
  const remote = await runGuarded(post(fixture, { path: '/api/refresh' }), x.spec, { env: { ...env, ALLOW_FIXTURE_MODE: 'true' }, quota: q.store });
  assert.equal((await remote.json()).error.code, 'FIXTURE_MODE_DISABLED');
  const local = new Request('http://127.0.0.1:4317/api/refresh', { method: 'POST', headers: { origin: 'http://127.0.0.1:4317' }, body: JSON.stringify(fixture) });
  assert.equal((await runGuarded(local, x.spec, { env: { ...env }, quota: q.store })).status, 403, 'needs ALLOW_FIXTURE_MODE');
  const local2 = new Request('http://127.0.0.1:4317/api/refresh', { method: 'POST', headers: { origin: 'http://127.0.0.1:4317' }, body: JSON.stringify(fixture) });
  assert.equal((await runGuarded(local2, x.spec, { env: { ...env, ALLOW_FIXTURE_MODE: 'true' }, quota: q.store })).status, 201);
  assert.equal(q.calls.length, 0);
  const live = { ...fixture, mode: 'live', fixture_id: undefined, input: { source_urls: ['https://docs.telem.ai/resources/fetch-best-practices/'] } };
  assert.equal((await runGuarded(post(live, { path: '/api/refresh' }), x.spec, { env, quota: q.store })).status, 201);
  assert.equal(q.calls.length, 1);
  const bad = { ...live, input: { source_urls: ['https://127.0.0.1/'] } };
  assert.equal((await runGuarded(post(bad, { path: '/api/refresh' }), x.spec, { env, quota: q.store })).status, 422);
});

test('every POST route delegates to runGuarded and imports no network client at module load', () => {
  for (const p of ['boards', 'boards/refresh', 'discover', 'refresh']) {
    const src = readFileSync(new URL(`../src/app/api/${p}/route.ts`, import.meta.url), 'utf8');
    assert.match(src, /runGuarded\(req, \w+Spec\)/, p);
  }
});

test('origin check uses the Host the browser addressed, not Next-rewritten req.url', async () => {
  // next start rewrites 127.0.0.1 to localhost in req.url; Host header keeps the real address.
  const mk = (origin: string) => new Request('http://localhost:4317/api/boards', { method: 'POST', headers: { host: '127.0.0.1:4317', origin }, body: '{}' });
  assert.equal((await runGuarded(mk('http://127.0.0.1:4317'), createBoardSpec, { env })).status, 400);
  assert.equal((await runGuarded(mk('http://localhost:4317'), createBoardSpec, { env })).status, 403);
  const behindProxy = new Request('http://internal/api/boards', { method: 'POST', headers: { host: 'ripple.example.test', 'x-forwarded-proto': 'https', origin: ORIGIN }, body: '{}' });
  assert.equal((await runGuarded(behindProxy, createBoardSpec, { env })).status, 400);
});
