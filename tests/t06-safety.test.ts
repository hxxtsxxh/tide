// Synthetic upstreams only; these invariants do not establish live-provider readiness.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardEnvelope } from '../src/lib/contracts/board.ts';
import { runGuarded, type GuardSpec } from '../src/lib/server/guarded.ts';
import { createBoardSpec, refreshBoardSpec } from '../src/app/api/_lib/specs.ts';
import { discoverSpec, legacyRefreshSpec } from '../src/lib/server/operations.ts';
import { openState, signState, SNAPSHOT_TTL_S } from '../src/lib/server/snapshots.ts';
import { ENV, SECRET, URL_A, URL_B, newWorld, fakeFetch } from './retrieval-fakes.ts';

const origin = 'https://ripple.example.test';
const create = { request_id: 't06-create', title: 'Safety regression', question: 'What constraints are supported?', requirements: 'batch 7', urls: [URL_A, URL_B] };
const admit = { async reserve() { return { allowed: true, retryAfter: 0 }; } };
const post = (path: string, body: unknown, headers: Record<string, string> = {}) => new Request(origin + path, {
  method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});
async function seed() {
  const world = newWorld();
  const response = await runGuarded(post('/api/boards', create), createBoardSpec, { env: ENV, quota: admit, fetchImpl: fakeFetch(world) });
  assert.equal(response.status, 201);
  return BoardEnvelope.parse(await response.json());
}

test('T06: every real guarded route enforces origin, streamed body, quota, outage and kill switch', async () => {
  const board = await seed();
  const routes: [string, GuardSpec<any>, unknown][] = [
    ['/api/boards', createBoardSpec, create],
    ['/api/boards/refresh', refreshBoardSpec, { request_id: 't06-refresh', snapshot: board.snapshot, force: true }],
    ['/api/discover', discoverSpec, { request_id: 't06-discover', query: 'fetch cancellation' }],
    ['/api/refresh', legacyRefreshSpec, { request_id: 't06-legacy', mode: 'live', strategy: 'treatment', query: 'fetch limits', input: { source_urls: [URL_A] }, limits: { max_queries: 1, max_pages: 2, max_model_calls: 2, timeout_ms: 20000 } }],
  ];
  for (const [path, spec, body] of routes) {
    let reservations = 0;
    const world = newWorld();
    for (const badOrigin of ['', 'https://evil.invalid']) {
      const response = await runGuarded(post(path, body, { origin: badOrigin }), spec, { env: ENV, quota: admit, fetchImpl: fakeFetch(world) });
      assert.equal(response.status, 403, path);
    }
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(spec.maxBytes + 1)); controller.close(); } });
    const oversized = new Request(origin + path, { method: 'POST', headers: { origin }, body: stream, duplex: 'half' } as RequestInit);
    assert.equal((await runGuarded(oversized, spec, { env: ENV, quota: admit, fetchImpl: fakeFetch(world) })).status, 413, path);
    for (const outage of [false, true]) {
      const response = await runGuarded(post(path, body), spec, { env: ENV, fetchImpl: fakeFetch(world), quota: { async reserve() {
        reservations++;
        if (outage) throw Error('private Redis error');
        return { allowed: false, retryAfter: 11 };
      } } });
      assert.equal(response.status, outage ? 503 : 429, path);
      if (!outage) assert.equal(response.headers.get('retry-after'), '11');
      assert.ok(!(await response.text()).includes('private Redis'));
    }
    assert.equal(reservations, 2, path);
    const disabled = await runGuarded(post(path, body), spec, { env: { ...ENV, RIPPLE_PUBLIC_BETA: 'false' }, quota: { async reserve() { assert.fail('disabled route reserved quota'); } }, fetchImpl: fakeFetch(world) });
    assert.equal(disabled.status, 503, path);
    assert.equal(world.calls.length, 0, `${path}: no service calls on rejected operations`);
  }
});

test('T06: truly expired, wrong-key and forged domain snapshots fail before admission', async () => {
  const board = await seed();
  const state = openState(board.snapshot, SECRET, ['docs.telem.ai', 'developer.mozilla.org']);
  const expired = signState(state, SECRET, Date.now() - (SNAPSHOT_TTL_S + 2) * 1000);
  const foreign = signState(state, 'different-deployment-key'.repeat(3), Date.now());
  const world = newWorld();
  for (const snapshot of [expired, foreign, board.snapshot + 'x']) {
    const response = await runGuarded(post('/api/boards/refresh', { request_id: 't06-expiry', snapshot, force: true }), refreshBoardSpec, {
      env: ENV, quota: { async reserve() { assert.fail('invalid snapshot reserved quota'); } }, fetchImpl: fakeFetch(world),
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'REVALIDATION_REQUIRED');
  }
  assert.equal(world.calls.length, 0);
});

test('T06: duplicate/concurrent stateless refreshes each require admission and preserve the parent', async () => {
  const board = await seed();
  const parent = JSON.stringify(board.board.revisions);
  let reservations = 0;
  const worlds = [newWorld(), newWorld()];
  const responses = await Promise.all(worlds.map(world => runGuarded(post('/api/boards/refresh', {
    request_id: 'same-correlation-id', snapshot: board.snapshot, force: true,
  }), refreshBoardSpec, { env: ENV, fetchImpl: fakeFetch(world), quota: { async reserve() { reservations++; return { allowed: true, retryAfter: 0 }; } } })));
  assert.equal(reservations, 2, 'request_id is not an unmetered idempotency bypass');
  for (const response of responses) {
    assert.equal(response.status, 200);
    const refreshed = BoardEnvelope.parse(await response.json());
    assert.equal(refreshed.board.id, board.board.id);
    assert.equal(refreshed.board.revisions.length, 2);
    assert.deepEqual(refreshed.board.revisions[0], board.board.revisions[0]);
    assert.equal(refreshed.trace.model_calls, 0);
    assert.deepEqual(refreshed.update.recomputed, []);
    assert.ok(refreshed.update.reused.every(id => !refreshed.update.unknown.includes(id)));
  }
  assert.equal(JSON.stringify(board.board.revisions), parent);
  assert.ok(worlds.every(world => world.calls.some(call => call.host === 'api.tavily.com')));
});

test('T06: rejected Telem canonical and Tavily returned hosts cannot support a fact', async () => {
  const world = newWorld();
  world.pages[URL_A]!.canonical = 'https://docs.telem.ai.evil.invalid/stolen';
  world.pages[URL_A]!.tavily = { url: 'https://169.254.169.254/credentials' };
  const response = await runGuarded(post('/api/boards', create), createBoardSpec, { env: ENV, quota: admit, fetchImpl: fakeFetch(world) });
  assert.equal(response.status, 201);
  const board = BoardEnvelope.parse(await response.json()).board;
  const unsafe = board.sources.find(source => source.url === URL_A)!;
  assert.notEqual(unsafe.status, 'succeeded');
  assert.ok(board.facts.filter(fact => fact.source_id === unsafe.id).every(fact => fact.status !== 'supported'));
  assert.ok(world.calls.every(call => ['hack.telem.ai', 'api.tavily.com', 'api.anthropic.com'].includes(call.host)));
});
