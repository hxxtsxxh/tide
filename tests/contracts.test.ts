// Contract freeze checks: zod schemas vs. the prepared JSON schemas, examples, and public-beta shapes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LegacyRequest, LegacyResponse, ApiErrorBody, HealthBody } from '../src/lib/contracts/legacy.ts';
import { BoardEnvelope, BoardArchive, CreateBoardRequest, RefreshBoardRequest, DiscoverRequest, parseArchive, PUBLIC_LIMITS } from '../src/lib/contracts/board.ts';
import { TEST_IDS } from '../src/lib/contracts/testids.ts';
import { SIMULATION_LAB_ENABLED, DEFAULT_PRODUCT_MODE } from '../src/lib/demo-policy.ts';
import { healthBody } from '../src/lib/server/health.ts';

const ctx = (p: string) => JSON.parse(readFileSync(new URL('../.searchhack/context/' + p, import.meta.url), 'utf8'));
type Json = { properties?: Record<string, Json>; required?: string[]; items?: Json };
type ZShape = { shape?: Record<string, unknown> };

// Compare object property names recursively between a JSON schema and a zod object.
function shapeOf(z: unknown): Record<string, unknown> | undefined {
  let cur = z as { def?: { type?: string; innerType?: unknown; element?: unknown; schema?: unknown; in?: unknown } } & ZShape;
  for (let i = 0; i < 10 && cur; i++) {
    if (cur.shape) return cur.shape;
    const d = cur.def;
    cur = (d?.innerType ?? d?.schema ?? d?.in) as typeof cur;
  }
  return undefined;
}
function assertSameKeys(json: Json, z: unknown, path: string) {
  if (!json.properties) return;
  const shape = shapeOf(z);
  assert.ok(shape, `${path}: zod object expected`);
  assert.deepEqual(Object.keys(shape).sort(), Object.keys(json.properties).sort(), `${path}: property names`);
  for (const [k, sub] of Object.entries(json.properties)) {
    const zs = shape[k] as { def?: { type?: string; element?: unknown; innerType?: unknown } };
    const target = sub.items ? (zs.def?.element ?? (zs.def?.innerType as { def?: { element?: unknown } })?.def?.element) : zs;
    assertSameKeys(sub.items ?? sub, target, `${path}.${k}`);
  }
}

test('legacy request/response/error zod schemas match prepared JSON schema property names', () => {
  assertSameKeys(ctx('contracts/request.schema.json'), LegacyRequest, 'request');
  assertSameKeys(ctx('contracts/response.schema.json'), LegacyResponse, 'response');
  assertSameKeys(ctx('contracts/error.schema.json'), ApiErrorBody, 'error');
});

test('prepared request example validates; schema violations are rejected', () => {
  const example = ctx('contracts/request.example.json');
  assert.equal(LegacyRequest.safeParse(example).success, true);
  assert.equal(LegacyRequest.safeParse({ ...example, fixture_id: undefined }).success, false, 'fixture mode requires fixture_id');
  assert.equal(LegacyRequest.safeParse({ ...example, extra: 1 }).success, false);
  assert.equal(LegacyRequest.safeParse({ ...example, limits: { ...example.limits, max_model_calls: 7 } }).success, false);
  assert.equal(LegacyRequest.safeParse({ ...example, query: 'x'.repeat(2001) }).success, false);
});

test('every prepared live and oracle case produces a valid legacy request', () => {
  const limits = { max_queries: 3, max_pages: 5, max_model_calls: 3, timeout_ms: 20000 };
  for (const c of ctx('evaluation/live-cases.json').cases)
    assert.equal(LegacyRequest.safeParse({ request_id: 'r', mode: 'live', strategy: 'treatment', query: c.query, input: c.input, limits }).success, true, c.id);
  for (const c of ctx('evaluation/oracle.json').cases)
    assert.equal(LegacyRequest.safeParse({ request_id: 'r', mode: 'fixture', strategy: 'baseline', query: c.query, input: c.input ?? {}, limits: c.limits ?? limits, fixture_id: c.fixture_id }).success, true, c.id);
});

const sha = 'a'.repeat(64);
const legacyResponse = {
  project: 'ripple', request_id: 'r1', input_sha256: sha, mode: 'fixture', strategy: 'treatment', status: 'complete',
  result: { affected_answer_ids: ['a1'], recomputed_answer_ids: ['a1'], reused_answer_ids: ['a2'], unknown_answer_ids: [], decisions: [{ id: 'a1', state: 'fresh', value: 'x', evidence_ids: ['e1'] }], history_preserved: true, cycle_rejected: false },
  evidence: [{ id: 'e1', source_id: 's1', url: 'https://fixtures.example.invalid/a', title: 't', passage: 'p', origin: 'fixture', retrieved_at: '2026-11-14T12:00:00Z', content_sha256: sha }],
  trace: { queries: [], fetches: [{ source_id: 's1', url: 'https://fixtures.example.invalid/a', status: 'succeeded', origin: 'fixture', request_id: null }], model_calls: 0, elapsed_ms: 3, cache_mode: 'fixture', notes: [] },
  unknowns: [], limitations: [],
};
test('legacy response accepts a contract-shaped body and rejects drift', () => {
  assert.equal(LegacyResponse.safeParse(legacyResponse).success, true);
  assert.equal(LegacyResponse.safeParse({ ...legacyResponse, extra: true }).success, false);
  assert.equal(LegacyResponse.safeParse({ ...legacyResponse, input_sha256: 'ABC' }).success, false);
  assert.equal(LegacyResponse.safeParse({ ...legacyResponse, evidence: [{ ...legacyResponse.evidence[0], retrieved_at: '2026-11-14T12:00:00' }] }).success, false, 'timezone required');
});

const board = {
  id: 'b1', title: 'T', question: 'Q', requirements: 'R',
  sources: [{ id: 's1', url: 'https://developer.mozilla.org/x', title: 'X', status: 'succeeded', observedAt: '2026-11-14T12:00:00.000Z', contentHash: sha, excerpt: 'fetch() rejects on network errors' }],
  facts: [{ id: 'f1', value: { rejects: 'network' }, status: 'supported', source_id: 's1', quote: 'rejects on network errors', support_sets: [['s1']] }],
  answers: [{ id: 'a1', text: 'Check response.ok', depends_on: ['f1'], status: 'fresh', dependency_review: 'proposed' }],
  revisions: [{ id: 'r1', parent_id: null, createdAt: '2026-11-14T12:00:00.000Z', kind: 'created', summary: 'Created' }],
};
const envelope = {
  schemaVersion: 1, project: 'ripple', mode: 'live', request_id: 'q1', board, snapshot: 'body.mac',
  update: { affected: [], recomputed: ['a1'], reused: [], unknown: [] },
  trace: { retrieval: [{ kind: 'fetch', provider: 'telem', mode: 'live', status: 'succeeded', url: 'https://developer.mozilla.org/x' }], model_calls: 2, elapsed_ms: 1200, limitations: [] },
};
test('BoardEnvelope matches public-beta/API.md and rejects fixture provenance', () => {
  assert.equal(BoardEnvelope.safeParse(envelope).success, true);
  assert.equal(BoardEnvelope.safeParse({ ...envelope, mode: 'fixture' }).success, false);
  assert.equal(BoardEnvelope.safeParse({ ...envelope, trace: { ...envelope.trace, retrieval: [{ ...envelope.trace.retrieval[0], mode: 'fixture' }] } }).success, false);
  assert.equal(BoardEnvelope.safeParse({ ...envelope, board: { ...board, answers: Array(7).fill(board.answers[0]) } }).success, false, 'answer cap');
});

test('public requests are strict and bounded', () => {
  const create = { request_id: 'q', title: 'T', question: 'Q', requirements: '', urls: ['https://developer.mozilla.org/x'] };
  assert.equal(CreateBoardRequest.safeParse(create).success, true);
  for (const extra of [{ fixture_id: 'r-main' }, { strategy: 'baseline' }, { model: 'x' }, { limits: {} }])
    assert.equal(CreateBoardRequest.safeParse({ ...create, ...extra }).success, false, JSON.stringify(extra));
  assert.equal(CreateBoardRequest.safeParse({ ...create, urls: Array(6).fill(create.urls[0]) }).success, false);
  assert.equal(CreateBoardRequest.safeParse({ ...create, urls: [] }).success, false);
  assert.equal(CreateBoardRequest.safeParse({ ...create, title: 'x'.repeat(121) }).success, false);
  assert.equal(RefreshBoardRequest.safeParse({ request_id: 'q', snapshot: 's', force: true }).success, true);
  assert.equal(RefreshBoardRequest.safeParse({ request_id: 'q', snapshot: 's' }).success, false);
  assert.equal(DiscoverRequest.safeParse({ request_id: 'q', query: '' }).success, false);
});

test('archive parse: valid, null snapshot, prototype pollution, size and duplicate IDs', () => {
  const archive = { schemaVersion: 1, format: 'ripple-board-v1', board, snapshot: null, exportedAt: '2026-11-14T12:00:00Z' };
  assert.equal(parseArchive(JSON.stringify(archive)).board.id, 'b1');
  assert.equal(BoardArchive.safeParse({ ...archive, format: 'other' }).success, false);
  assert.throws(() => parseArchive(JSON.stringify(archive).replace('"schemaVersion"', '"__proto__":{"x":1},"schemaVersion"')), /FORBIDDEN/);
  assert.throws(() => parseArchive(JSON.stringify({ ...archive, board: { ...board, constructor: 1 } })), /FORBIDDEN/);
  assert.throws(() => parseArchive(' '.repeat(1024 * 1024 + 1)), /TOO_LARGE/);
  assert.throws(() => parseArchive(JSON.stringify({ ...archive, board: { ...board, facts: [{ ...board.facts[0], id: 's1' }] } })), /DUPLICATE/);
});

test('health: exact project, live mode, public-beta fields, no secret values', () => {
  const env = { TELEM_API_KEY: 'telem-secret-1', APP_MODEL_PROVIDER: 'anthropic', APP_MODEL: 'm', ANTHROPIC_API_KEY: 'model-secret-2', UPSTASH_REDIS_REST_URL: 'https://x-secret-3.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'redis-secret-4', RIPPLE_STATE_SECRET: 's'.repeat(40) };
  const h = healthBody(env);
  assert.equal(HealthBody.safeParse(h).success, true);
  assert.equal(h.project, 'ripple');
  assert.equal(h.mode, 'live');
  assert.equal(h.public_beta, true);
  assert.ok(h.limits.sources <= PUBLIC_LIMITS.sources && h.limits.model_calls <= 6);
  const text = JSON.stringify(h);
  for (const v of Object.values(env)) if (v.length > 2) assert.ok(!text.includes(v), 'secret leaked');
  assert.equal(healthBody({ ...env, RIPPLE_PUBLIC_BETA: 'false' }).public_beta, false);
  assert.equal(healthBody({}).public_beta, false);
  assert.equal(healthBody({}).safety.durable_quota, false);
  for (const k of ctx('contracts/health.schema.json').required) assert.ok(k in h, k);
});

test('frozen selectors and demo policy', () => {
  const values = Object.values(TEST_IDS);
  assert.equal(new Set(values).size, values.length);
  const api = readFileSync(new URL('../.searchhack/context/public-beta/API.md', import.meta.url), 'utf8');
  for (const v of values) assert.ok(api.includes(v), `${v} not in API.md`);
  assert.equal(SIMULATION_LAB_ENABLED, true);
  assert.equal(DEFAULT_PRODUCT_MODE, 'live');
});
