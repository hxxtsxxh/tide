import 'server-only';
import type { ZodType } from 'zod';
import type { ErrorCode } from '../contracts/board.ts';
import { PUBLIC_LIMITS } from '../contracts/board.ts';
import type { ApiErrorBody } from '../contracts/legacy.ts';
import { serverConfig, secrets, type ServerConfig } from './config.ts';
import { normalizeSourceUrl, RunBudget } from './guards.ts';
import { upstashQuotaStore, type QuotaStore } from './quota.ts';
import { mintVisitor, verifyVisitor } from './session.ts';

const STATUS: Record<ErrorCode, number> = {
  INVALID_INPUT: 400,
  PAYLOAD_TOO_LARGE: 413,
  ORIGIN_REJECTED: 403,
  SOURCE_NOT_ALLOWED: 422,
  SOURCE_UNAVAILABLE: 422,
  QUOTA_EXCEEDED: 429,
  QUOTA_UNAVAILABLE: 503,
  REVALIDATION_REQUIRED: 409,
  PUBLIC_ACCESS_DISABLED: 503,
  FIXTURE_MODE_DISABLED: 403,
  UPSTREAM_UNAVAILABLE: 502,
  TIMEOUT: 504,
  NOT_IMPLEMENTED: 501,
  INTERNAL: 500,
};
const RETRYABLE = new Set<ErrorCode>(['QUOTA_EXCEEDED', 'QUOTA_UNAVAILABLE', 'UPSTREAM_UNAVAILABLE', 'TIMEOUT']);

/** Throw from prepare/execute to return a coded error. `message` must be safe for the browser. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly retryAfter?: number;
  /** Safe upstream attempt counts for a failed paid operation (error.schema.json forbids body fields). */
  readonly attempts?: string;
  constructor(code: ErrorCode, message: string, retryAfter?: number, attempts?: string) {
    super(message);
    this.code = code;
    this.retryAfter = retryAfter;
    this.attempts = attempts;
  }
}

export function errorResponse(code: ErrorCode, message: string, requestId: string, extraHeaders: Record<string, string> = {}): Response {
  const body: ApiErrorBody = { project: 'ripple', request_id: requestId, error: { code, message, retryable: RETRYABLE.has(code) } };
  return Response.json(body, { status: STATUS[code], headers: { 'Cache-Control': 'no-store', ...extraHeaders } });
}

export type GuardContext = {
  requestId: string;
  url: URL;
  config: ServerConfig;
  secrets: ReturnType<typeof secrets>;
  /** Count EVERY upstream attempt (search, fetch, model, retries) with budget.take(). */
  budget: RunBudget;
  /** Aborts at the 45 s operation deadline; pass to every upstream fetch. */
  signal: AbortSignal;
  visitorId: string | null;
  /** Test seam only: injected by runGuarded deps, never by a request. */
  fetchImpl?: typeof fetch;
};

export type GuardSpec<T> = {
  schema: ZodType<T>;
  maxBytes: number;
  /** Cheap, network-free checks (source policy, fixture gating). Throw ApiError to reject. */
  prepare?: (body: T, ctx: { config: ServerConfig; url: URL; secrets: ReturnType<typeof secrets> }) => T;
  /** Paid work spends quota unless this returns false (only localhost fixture transport). */
  billable?: (body: T) => boolean;
  /** Undefined = endpoint not implemented yet: validated, then 501 without reserving quota. */
  execute?: (body: T, ctx: GuardContext) => Promise<{ status: 200 | 201; body: unknown }>;
};

export type GuardDeps = { env?: Record<string, string | undefined>; quota?: QuotaStore; now?: () => number; fetchImpl?: typeof fetch };

async function readBounded(req: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}

function safeRequestId(raw: unknown): string {
  const id = (raw as { request_id?: unknown } | null)?.request_id;
  return typeof id === 'string' && id.length > 0 && id.length <= 100 ? id : 'unknown';
}

/**
 * The single guarded server entrypoint for every billable route (/api/boards, /api/boards/refresh,
 * /api/discover, /api/refresh). Order: origin -> bounded body -> schema -> source policy ->
 * kill switch/config -> atomic shared quota -> execute. Nothing upstream runs before admission.
 */
/**
 * Public origin as the browser addressed it. Next rewrites req.url's host (127.0.0.1 -> localhost),
 * so use the Host header; Vercel sets Host and x-forwarded-proto itself.
 */
export function publicUrl(req: Request): URL {
  const raw = new URL(req.url);
  const host = req.headers.get('host') ?? raw.host;
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || raw.protocol.slice(0, -1);
  if (!/^https?$/.test(proto) || !/^[\w.\-[\]:]+$/.test(host)) return raw;
  return new URL(raw.pathname + raw.search, `${proto}://${host}`);
}

export async function runGuarded<T>(req: Request, spec: GuardSpec<T>, deps: GuardDeps = {}): Promise<Response> {
  const url = publicUrl(req);
  const env = deps.env ?? process.env;
  const origin = req.headers.get('origin');
  if (!origin || origin !== url.origin) return errorResponse('ORIGIN_REJECTED', 'Cross-origin or origin-less requests are refused.', 'unknown');

  let text: string | null;
  try {
    text = await readBounded(req, spec.maxBytes);
  } catch {
    return errorResponse('INVALID_INPUT', 'Request body could not be read as UTF-8.', 'unknown');
  }
  if (text === null) return errorResponse('PAYLOAD_TOO_LARGE', `Request body exceeds ${spec.maxBytes} bytes.`, 'unknown');

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return errorResponse('INVALID_INPUT', 'Request body must be JSON.', 'unknown');
  }
  const requestId = safeRequestId(raw);
  const parsed = spec.schema.safeParse(raw);
  if (!parsed.success) {
    const where = parsed.error.issues[0]?.path.join('.') || 'body';
    return errorResponse('INVALID_INPUT', `Invalid request field: ${where}.`, requestId);
  }

  const config = serverConfig(env);
  let body = parsed.data;
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  try {
    const s = secrets(env);
    if (spec.prepare) body = spec.prepare(body, { config, url, secrets: s });
    if (!spec.execute) return errorResponse('NOT_IMPLEMENTED', 'This operation is not implemented yet.', requestId);

    let visitorId: string | null = null;
    if (spec.billable?.(body) !== false) {
      if (!config.publicBetaEnabled) throw new ApiError('PUBLIC_ACCESS_DISABLED', 'Live research is temporarily disabled by the operator.');
      if (!config.configured.quota || !config.configured.signing) throw new ApiError('QUOTA_UNAVAILABLE', 'The shared usage limiter is not configured; nothing was spent.');
      if (!config.configured.telem || !config.configured.model) throw new ApiError('UPSTREAM_UNAVAILABLE', 'Research services are not configured on this deployment.');
      visitorId = verifyVisitor(req.headers.get('cookie'), s.stateSecret);
      if (!visitorId) {
        const minted = mintVisitor(s.stateSecret, url.protocol === 'https:');
        visitorId = minted.id;
        headers['Set-Cookie'] = minted.setCookie;
      }
      const quota = deps.quota ?? upstashQuotaStore(config, s);
      let decision;
      try {
        decision = await quota.reserve(visitorId);
      } catch {
        throw new ApiError('QUOTA_UNAVAILABLE', 'The shared usage limiter is unavailable; nothing was spent.');
      }
      if (!decision.allowed) throw new ApiError('QUOTA_EXCEEDED', 'Usage limit reached. Try again later.', decision.retryAfter);
    }

    const budget = new RunBudget({ maxCalls: PUBLIC_LIMITS.model_calls, timeoutMs: PUBLIC_LIMITS.timeout_ms }, deps.now);
    const signal = AbortSignal.timeout(PUBLIC_LIMITS.timeout_ms);
    const result = await spec.execute(body, { requestId, url, config, secrets: s, budget, signal, visitorId, fetchImpl: deps.fetchImpl });
    return Response.json(result.body, { status: result.status, headers });
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.retryAfter) headers['Retry-After'] = String(e.retryAfter);
      if (e.attempts) {
        headers['X-Ripple-Upstream-Attempts'] = e.attempts;
        console.error(JSON.stringify({ request_id: requestId, code: e.code, attempts: e.attempts }));
      }
      return errorResponse(e.code, e.message, requestId, headers);
    }
    const code: ErrorCode = e instanceof Error && e.message === 'RUN_TIMEOUT' ? 'TIMEOUT' : 'INTERNAL';
    // Coded log only: never raw questions, documents, provider bodies or secrets.
    console.error(JSON.stringify({ request_id: requestId, code }));
    return errorResponse(code, code === 'TIMEOUT' ? 'The operation deadline was reached.' : 'Unexpected server error.', requestId, headers);
  }
}

/** Source policy for user-supplied URLs (exact allowlist, https, no credentials/IPs/odd ports). */
export function normalizeUrlsOrThrow(urls: readonly string[], hosts: readonly string[]): string[] {
  const out = urls.map((u) => {
    try {
      return normalizeSourceUrl(u, hosts);
    } catch {
      throw new ApiError('SOURCE_NOT_ALLOWED', 'Only HTTPS pages on the listed documentation hosts are supported.');
    }
  });
  return [...new Set(out)];
}
