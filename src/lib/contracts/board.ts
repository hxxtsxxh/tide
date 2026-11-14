// FROZEN (T01): public-beta API contract from .searchhack/context/public-beta/API.md.
// Shared by server routes (T02/T04), browser UI and IndexedDB (T03) and the MCP bridge (T05A).
// Change only through an integrator task; parallel workers depend on these exact shapes.
import { z } from 'zod';

/** Server-chosen operation maxima (PUBLIC-BETA.md). Clients can never raise these. */
export const PUBLIC_LIMITS = {
  sources: 5,
  facts: 10,
  answers: 6,
  nodes: 40,
  search_queries: 2,
  search_providers: 2,
  model_calls: 6,
  timeout_ms: 45_000,
  source_chars_total: 60_000,
  source_chars_per_page: 12_000,
  output_tokens_per_call: 2_048,
  discover_results: 8,
} as const;

/** Default exact-host source policy (PUBLIC-BETA.md); RIPPLE_SOURCE_HOSTS overrides on the server;
 * clients should display GET /api/health source_hosts (the effective list). */
export const DEFAULT_SOURCE_HOSTS = [
  'docs.telem.ai',
  'developer.mozilla.org',
  'docs.python.org',
  'docs.github.com',
  'nodejs.org',
  'react.dev',
  'nextjs.org',
  'vercel.com',
  'docs.netlify.com',
  'developers.cloudflare.com',
  'www.postgresql.org',
  'redis.io',
  'supabase.com',
  'upstash.com',
] as const;

/** Request body caps, enforced while streaming (bytes). */
export const BODY_LIMITS = {
  create: 16 * 1024,
  discover: 16 * 1024,
  refresh: 600 * 1024,
  legacy: 128 * 1024,
} as const;

export const ERROR_CODES = [
  'INVALID_INPUT',
  'PAYLOAD_TOO_LARGE',
  'ORIGIN_REJECTED',
  'SOURCE_NOT_ALLOWED',
  'SOURCE_UNAVAILABLE',
  'QUOTA_EXCEEDED',
  'QUOTA_UNAVAILABLE',
  'REVALIDATION_REQUIRED',
  'PUBLIC_ACCESS_DISABLED',
  'FIXTURE_MODE_DISABLED',
  'UPSTREAM_UNAVAILABLE',
  'TIMEOUT',
  'NOT_IMPLEMENTED',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

const requestId = z.string().min(1).max(100);
const isoDateTime = z.iso.datetime({ offset: true });

// ---- Requests (strict: extra properties such as fixture/strategy/model/limits are rejected) ----
export const CreateBoardRequest = z.strictObject({
  request_id: requestId,
  title: z.string().trim().min(1).max(120),
  question: z.string().trim().min(1).max(2000),
  requirements: z.string().max(2000),
  urls: z.array(z.string().min(1).max(2048)).min(1).max(PUBLIC_LIMITS.sources),
});
export type CreateBoardRequest = z.infer<typeof CreateBoardRequest>;

export const RefreshBoardRequest = z.strictObject({
  request_id: requestId,
  snapshot: z.string().min(1).max(BODY_LIMITS.refresh),
  requirements: z.string().max(2000).optional(),
  force: z.boolean(),
});
export type RefreshBoardRequest = z.infer<typeof RefreshBoardRequest>;

export const DiscoverRequest = z.strictObject({
  request_id: requestId,
  query: z.string().trim().min(1).max(2000),
});
export type DiscoverRequest = z.infer<typeof DiscoverRequest>;

// ---- Board ----
export const SourceRecord = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  title: z.string(),
  status: z.enum(['succeeded', 'failed', 'partial']),
  observedAt: isoDateTime,
  contentHash: z.string(),
  excerpt: z.string(),
  cache_state: z.string().optional(),
});
export type SourceRecord = z.infer<typeof SourceRecord>;

export const FactRecord = z.object({
  id: z.string().min(1),
  value: z.json(),
  status: z.enum(['supported', 'conflicting', 'unknown']),
  source_id: z.string(),
  quote: z.string(),
  /** DNF: OR over sets, AND within a set of source IDs. */
  support_sets: z.array(z.array(z.string().min(1))).optional(),
});
export type FactRecord = z.infer<typeof FactRecord>;

export const AnswerRecord = z.object({
  id: z.string().min(1),
  text: z.string(),
  /** Fact or answer IDs this answer rests on (AND). */
  depends_on: z.array(z.string().min(1)),
  status: z.enum(['fresh', 'stale', 'unknown']),
  /** 'proposed' = model-inferred edge, not proven; 'reviewed' = user-confirmed. */
  dependency_review: z.enum(['proposed', 'reviewed']).optional(),
  /** Time the evidence behind this answer version was observed; reused answers keep the original. */
  observedAt: isoDateTime.optional(),
});
export type AnswerRecord = z.infer<typeof AnswerRecord>;

export const RevisionSummary = z.object({
  id: z.string().min(1),
  parent_id: z.string().min(1).nullable(),
  createdAt: isoDateTime,
  /** e.g. 'created' | 'requirements_edit' | 'source_refresh' | 'imported' */
  kind: z.string().min(1),
  summary: z.string(),
});
export type RevisionSummary = z.infer<typeof RevisionSummary>;

export const Board = z.object({
  id: z.string().min(1),
  title: z.string(),
  question: z.string(),
  requirements: z.string(),
  sources: z.array(SourceRecord).max(PUBLIC_LIMITS.sources),
  facts: z.array(FactRecord).max(PUBLIC_LIMITS.facts),
  answers: z.array(AnswerRecord).max(PUBLIC_LIMITS.answers),
  revisions: z.array(RevisionSummary),
});
export type Board = z.infer<typeof Board>;

export const UpdateSets = z.object({
  affected: z.array(z.string()),
  recomputed: z.array(z.string()),
  reused: z.array(z.string()),
  unknown: z.array(z.string()),
});
export type UpdateSets = z.infer<typeof UpdateSets>;

export const RetrievalTrace = z.object({
  kind: z.enum(['search', 'fetch']),
  provider: z.string().nullable(),
  mode: z.literal('live'),
  status: z.string(),
  url: z.string().optional(),
  requestId: z.string().optional(),
  cached: z.boolean().optional(),
});
export type RetrievalTrace = z.infer<typeof RetrievalTrace>;

export const Trace = z.object({
  retrieval: z.array(RetrievalTrace),
  model_calls: z.int().min(0),
  elapsed_ms: z.number().min(0),
  limitations: z.array(z.string()),
});
export type Trace = z.infer<typeof Trace>;

export const BoardEnvelope = z.object({
  schemaVersion: z.literal(1),
  project: z.literal('ripple'),
  mode: z.literal('live'),
  request_id: z.string(),
  board: Board,
  snapshot: z.string().min(1),
  update: UpdateSets,
  trace: Trace,
});
export type BoardEnvelope = z.infer<typeof BoardEnvelope>;

export const DiscoverResponse = z.object({
  mode: z.literal('live'),
  request_id: z.string(),
  results: z.array(z.object({ url: z.string(), title: z.string() })).max(PUBLIC_LIMITS.discover_results),
  trace: Trace,
});
export type DiscoverResponse = z.infer<typeof DiscoverResponse>;

/**
 * Payload signed into BoardEnvelope.snapshot via signSnapshot(). Only the server reads it back
 * (verifySnapshot) — the browser treats `snapshot` as an opaque string.
 */
export type SignedBoardState = {
  kind: 'ripple-board-state';
  board: Board;
  /** Latest observed source text hashes per source ID, for change detection on refresh. */
  observations?: Record<string, { contentHash: string; observedAt: string }>;
};

// ---- Portable archive (browser export/import and MCP ripple_export_board) ----
export const ARCHIVE_FORMAT = 'ripple-board-v1';
export const ARCHIVE_MAX_BYTES = 1024 * 1024;
export const ARCHIVE_MAX_REVISIONS = 20;

export const ArchivedRevision = z.object({
  revisionId: z.string().min(1),
  createdAt: isoDateTime,
  board: Board,
});
export type ArchivedRevision = z.infer<typeof ArchivedRevision>;

export const BoardArchive = z.object({
  schemaVersion: z.literal(1),
  format: z.literal(ARCHIVE_FORMAT),
  board: Board,
  /** null for archives from the MCP bridge or after signature discard; always revalidate on import. */
  snapshot: z.string().min(1).nullable(),
  exportedAt: isoDateTime,
  revisions: z.array(ArchivedRevision).max(ARCHIVE_MAX_REVISIONS).optional(),
});
export type BoardArchive = z.infer<typeof BoardArchive>;

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Bounded, prototype-pollution-safe archive parse. Graph/cycle validation is the domain layer's job. */
export function parseArchive(text: string): BoardArchive {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > ARCHIVE_MAX_BYTES) throw new Error('ARCHIVE_TOO_LARGE');
  const raw: unknown = JSON.parse(text, (key, value) => {
    if (FORBIDDEN_KEYS.has(key)) throw new Error('ARCHIVE_FORBIDDEN_KEY');
    return value;
  });
  const archive = BoardArchive.parse(raw);
  const ids = [archive.board.id, ...archive.board.sources.map((s) => s.id), ...archive.board.facts.map((f) => f.id), ...archive.board.answers.map((a) => a.id)];
  if (new Set(ids).size !== ids.length) throw new Error('ARCHIVE_DUPLICATE_ID');
  return archive;
}
