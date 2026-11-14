import 'server-only';
import { normalizeSourceUrl } from '../server/guards.ts';
import { normalizeWs } from './text.ts';

export const TELEM_BASE = 'https://hack.telem.ai/api'; // hackathon Telem server
const MAX_RESPONSE_BYTES = 3_000_000;
const RETRY_MIN_REMAINING_MS = 5_000;

export type TelemFailureKind = 'auth' | 'transient' | 'timeout' | 'bad_response' | 'limit';
export class TelemFailure extends Error {
  readonly kind: TelemFailureKind;
  /** Safe attempt counts already spent by this operation (set by acquirePages), surfaced on the public error. */
  attempts?: string;
  constructor(kind: TelemFailureKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

/** Hard caps for one operation; `attempts` counts every HTTP attempt including the one retry. */
/** Telem /v1/search accepts at most this many include_domains per request. */
export const MAX_INCLUDE_DOMAINS = 20;
export type TelemLimits = { maxQueries: number; maxPages: number; maxHttp: number };
export type TelemDeps = { apiKey: string; signal: AbortSignal; deadline: number; limits: TelemLimits; fetchImpl?: typeof fetch; now?: () => number };

export type SearchProviderRun = { provider: string; status: 'succeeded' | 'failed'; error: string | null; results: number };
export type SearchHit = { url: string; title: string; provider: string };
export type SearchOutcome = { providers: SearchProviderRun[]; hits: SearchHit[]; requestId: string | null; sessionId: string | null };

export type FetchedPage = {
  url: string;
  status: 'succeeded' | 'failed';
  /** Whitespace-normalized text, '' on failure. Untrusted data. */
  text: string;
  truncated: boolean;
  title: string;
  error: string | null;
  provider: string | null;
  requestId: string | null;
  /** Telem's boolean `cached` is authoritative (cache_state is not: it reads 'cached' even for no_cache reads). */
  cached: boolean | null;
  cacheState: string | null;
  fetchedAt: string | null;
  httpStatus: number | null;
};

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new TelemFailure('bad_response', 'Telem response too large');
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const errType = (e: unknown): string => str(obj(e).type) ?? str(obj(e).code) ?? (e ? 'error' : '');

export class TelemClient {
  readonly d: TelemDeps;
  /** Observable counters (surface in trace / tests). */
  queries = 0;
  pages = 0;
  http = 0;
  sessionId: string | null = null;

  constructor(d: TelemDeps) {
    this.d = d;
  }

  private now(): number {
    return (this.d.now ?? Date.now)();
  }

  /** POST with at most one retry on transient failure inside the remaining deadline. Never retries 401/402/403. */
  private async post(path: string, payload: unknown): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (this.http >= this.d.limits.maxHttp) throw new TelemFailure('limit', 'Telem request budget exhausted');
      if (this.d.signal.aborted || this.now() >= this.d.deadline) throw new TelemFailure('timeout', 'Operation deadline reached');
      this.http++;
      let failure: TelemFailure | null = null;
      try {
        const res = await (this.d.fetchImpl ?? fetch)(TELEM_BASE + path, {
          method: 'POST',
          redirect: 'error',
          headers: { Authorization: `Bearer ${this.d.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload),
          signal: this.d.signal,
        });
        if (res.status === 401 || res.status === 402 || res.status === 403) {
          await res.body?.cancel().catch(() => {});
          throw new TelemFailure('auth', `Telem rejected the request (HTTP ${res.status})`);
        }
        if (res.ok) {
          let json: unknown;
          try {
            json = JSON.parse(await readCapped(res));
          } catch (e) {
            if (e instanceof TelemFailure) throw e;
            throw new TelemFailure('bad_response', 'Telem returned unparseable JSON');
          }
          return obj(json);
        }
        await res.body?.cancel().catch(() => {});
        failure = new TelemFailure(res.status === 408 || res.status === 425 || res.status === 429 || res.status >= 500 ? 'transient' : 'bad_response', `Telem HTTP ${res.status}`);
      } catch (e) {
        if (e instanceof TelemFailure) {
          if (e.kind !== 'transient') throw e;
          failure = e;
        } else if (this.d.signal.aborted) throw new TelemFailure('timeout', 'Operation deadline reached');
        else failure = new TelemFailure('transient', 'Telem network error');
      }
      if (attempt === 1 || this.d.deadline - this.now() < RETRY_MIN_REMAINING_MS) throw failure;
    }
    throw new TelemFailure('transient', 'Telem unavailable');
  }

  /** One query across <=2 providers. Domain limits go to search.include_domains; results are filtered again by the caller. */
  async search(query: string, includeDomains: readonly string[], numResults = 8): Promise<SearchOutcome> {
    // Telem rejects include_domains with more than 20 entries (HTTP 422); callers must chunk.
    if (includeDomains.length > MAX_INCLUDE_DOMAINS) throw new TelemFailure('limit', `include_domains exceeds ${MAX_INCLUDE_DOMAINS}`);
    if (this.queries >= this.d.limits.maxQueries) throw new TelemFailure('limit', 'Search query budget exhausted');
    this.queries++;
    const j = await this.post('/v1/search', {
      user_input: { query },
      search: { auto_routing: 'accuracy', num_results: numResults, tier: 'default', providers: { include: ['brave', 'tavily'] }, include_domains: [...includeDomains] },
      ...(this.sessionId ? { session_id: this.sessionId } : {}),
    });
    this.sessionId = str(j.session_id) ?? this.sessionId;
    const providers: SearchProviderRun[] = [];
    const hits: SearchHit[] = [];
    const runs = Array.isArray(j.preprocessor_runs) ? j.preprocessor_runs : [];
    for (const r of runs) {
      const run = obj(r);
      const provider = str(run.preprocessor_name) ?? 'unknown';
      const results = Array.isArray(obj(run.output_payload).results) ? (obj(run.output_payload).results as unknown[]) : [];
      const ok = run.status === 'succeeded' && !run.error;
      providers.push({ provider, status: ok ? 'succeeded' : 'failed', error: ok ? null : errType(run.error) || String(run.status ?? 'failed'), results: ok ? results.length : 0 });
      if (!ok) continue;
      for (const item of results) {
        const it = obj(item);
        const url = str(it.url);
        if (url) hits.push({ url, title: normalizeWs(str(it.title) ?? '').slice(0, 200), provider });
      }
    }
    return { providers, hits, requestId: str(j.interaction_id), sessionId: this.sessionId };
  }

  /**
   * Fetch up to maxPages distinct URLs in ONE batch. Each result is judged individually: aggregate HTTP 200
   * proves nothing. Returned/canonical destinations are re-checked against the source policy.
   */
  async fetchPages(urls: readonly string[], allowedHosts: readonly string[], opts: { noCache?: boolean; perPageChars?: number } = {}): Promise<FetchedPage[]> {
    const distinct = [...new Set(urls)];
    if (this.pages + distinct.length > this.d.limits.maxPages) throw new TelemFailure('limit', 'Page fetch budget exhausted');
    this.pages += distinct.length;
    const perPage = opts.perPageChars ?? 12_000;
    const j = await this.post('/v1/fetch', {
      urls: distinct,
      options: { content_format: 'text', inline_content: true, inline_max_chars: 20_000, ...(opts.noCache ? { no_cache: true } : {}) },
      ...(this.sessionId ? { session_id: this.sessionId } : {}),
    });
    this.sessionId = str(j.session_id) ?? this.sessionId;
    const raw: Record<string, unknown>[] = [];
    for (const r of Array.isArray(j.preprocessor_runs) ? j.preprocessor_runs : []) {
      const out = obj(obj(r).output_payload);
      if (Array.isArray(out.fetched_results)) for (const x of out.fetched_results) raw.push(obj(x));
    }
    const fail = (url: string, error: string, extra: Partial<FetchedPage> = {}): FetchedPage => ({ url, status: 'failed', text: '', truncated: false, title: '', error, provider: null, requestId: null, cached: null, cacheState: null, fetchedAt: null, httpStatus: null, ...extra });
    const policyOk = (u: unknown): boolean => {
      try {
        normalizeSourceUrl(String(u), allowedHosts);
        return true;
      } catch {
        return false;
      }
    };
    return distinct.map((url) => {
      const r = raw.find((x) => x.url === url) ?? raw.find((x) => x.canonical_url === url);
      if (!r) return fail(url, 'missing_result');
      const meta = { provider: str(r.provider), requestId: str(r.request_id), cached: typeof r.cached === 'boolean' ? r.cached : null, cacheState: typeof r.cached === 'boolean' ? (r.cached ? 'cached' : 'live') : str(r.cache_state), fetchedAt: str(r.fetched_at), httpStatus: typeof r.http_status === 'number' ? r.http_status : null };
      if (r.status !== 'succeeded') return fail(url, errType(r.error) || 'fetch_failed', meta);
      // Redirect/canonical destinations must satisfy the same policy as the requested URL.
      if (!policyOk(r.url) || (r.canonical_url != null && !policyOk(r.canonical_url))) return fail(url, 'destination_out_of_policy', meta);
      if (meta.httpStatus !== null && (meta.httpStatus < 200 || meta.httpStatus >= 300)) return fail(url, `http_${meta.httpStatus}`, meta);
      const content = typeof r.content === 'string' ? r.content : '';
      if (!content.trim()) return fail(url, 'empty_or_not_inline', meta);
      const text = normalizeWs(content);
      const cut = text.length > perPage;
      return { url, status: 'succeeded', text: cut ? text.slice(0, perPage) : text, truncated: cut || r.content_truncated === true, title: normalizeWs(str(r.title) ?? '').slice(0, 200), error: null, ...meta };
    });
  }
}
