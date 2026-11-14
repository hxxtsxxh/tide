// FROZEN (T01): legacy /api/refresh contract used by the independent evaluator.
// Mirrors .searchhack/context/contracts/{request,response,error,health}.schema.json exactly;
// tests/contracts.test.ts checks the key sets against those files.
import { z } from 'zod';

const id = z.string().min(1);
const isoDateTime = z.iso.datetime({ offset: true });
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const LegacyLimits = z.strictObject({
  max_queries: z.int().min(0).max(6),
  max_pages: z.int().min(0).max(10),
  max_model_calls: z.int().min(0).max(6),
  timeout_ms: z.int().min(100).max(45000),
});

export const LegacyRequest = z
  .strictObject({
    request_id: z.string().min(1).max(100),
    mode: z.enum(['live', 'fixture']),
    strategy: z.enum(['baseline', 'treatment']),
    query: z.string().min(1).max(2000),
    input: z.record(z.string(), z.unknown()).refine((o) => Object.keys(o).length <= 30, 'too many properties'),
    limits: LegacyLimits,
    fixture_id: z.string().min(1).optional(),
  })
  .refine((r) => r.mode !== 'fixture' || r.fixture_id !== undefined, { message: 'fixture_id required', path: ['fixture_id'] });
export type LegacyRequest = z.infer<typeof LegacyRequest>;

export const LegacyDecision = z.strictObject({
  id: z.string(),
  state: z.enum(['fresh', 'stale', 'unknown', 'unchanged']),
  value: z.string(),
  evidence_ids: z.array(id),
});

export const LegacyEvidence = z.strictObject({
  id: z.string(),
  source_id: z.string(),
  url: z.url({ protocol: /^https?$/ }),
  title: z.string(),
  passage: z.string().min(1).max(2000),
  origin: z.enum(['telem_live', 'fixture']),
  retrieved_at: isoDateTime,
  content_sha256: sha256,
});

export const LegacyResponse = z.strictObject({
  project: z.literal('ripple'),
  request_id: z.string(),
  input_sha256: sha256,
  mode: z.enum(['live', 'fixture']),
  strategy: z.enum(['baseline', 'treatment']),
  status: z.enum(['complete', 'partial', 'blocked']),
  result: z.strictObject({
    affected_answer_ids: z.array(id),
    recomputed_answer_ids: z.array(id),
    reused_answer_ids: z.array(id),
    unknown_answer_ids: z.array(id),
    decisions: z.array(LegacyDecision),
    history_preserved: z.boolean(),
    cycle_rejected: z.boolean(),
  }),
  evidence: z.array(LegacyEvidence),
  trace: z.strictObject({
    queries: z.array(
      z.strictObject({
        query: z.string(),
        providers: z.array(z.string()),
        status: z.enum(['succeeded', 'failed']),
        request_id: z.string().nullable(),
      }),
    ),
    fetches: z.array(
      z.strictObject({
        source_id: z.string(),
        url: z.string(),
        status: z.enum(['succeeded', 'failed']),
        origin: z.enum(['telem_live', 'fixture']),
        request_id: z.string().nullable(),
      }),
    ),
    model_calls: z.int().min(0),
    elapsed_ms: z.int().min(0),
    cache_mode: z.enum(['cold', 'warm', 'fixture']),
    notes: z.array(z.string()),
  }),
  unknowns: z.array(z.string()),
  limitations: z.array(z.string()),
});
export type LegacyResponse = z.infer<typeof LegacyResponse>;

/** One error shape for every route: satisfies contracts/error.schema.json and public-beta/API.md. */
export const ApiErrorBody = z.strictObject({
  project: z.literal('ripple'),
  request_id: z.string(),
  error: z.strictObject({ code: z.string(), message: z.string(), retryable: z.boolean() }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

/** Health: legacy required fields plus the public-beta additions from public-beta/API.md. */
export const HealthBody = z.strictObject({
  status: z.literal('ok'),
  project: z.literal('ripple'),
  mode: z.enum(['live', 'fixture']),
  configured: z.strictObject({ telem: z.boolean(), model: z.boolean() }),
  /** Key-free sponsor configuration: booleans only, never values. */
  sponsors: z.strictObject({ telem: z.strictObject({ configured: z.boolean(), role: z.string() }), tavily: z.strictObject({ configured: z.boolean(), role: z.string() }) }).optional(),
  public_beta: z.boolean(),
  safety: z.strictObject({ durable_quota: z.boolean(), signed_snapshots: z.boolean(), bounded_sources: z.boolean() }),
  limits: z.strictObject({ sources: z.int(), facts: z.int(), answers: z.int(), model_calls: z.int(), search_queries: z.int(), timeout_ms: z.int() }),
  source_hosts: z.array(z.string()),
  simulation_lab: z.boolean(),
});
export type HealthBody = z.infer<typeof HealthBody>;
