import 'server-only';
import type { RetrievalTrace } from '../contracts/board.ts';
import { PUBLIC_LIMITS } from '../contracts/board.ts';
import type { RunDeps } from '../server/research.ts';
import { extractTavily, type TavilySource } from './tavily-extract.mjs';
import { TelemFailure, type FetchedPage, type TelemClient } from './telem.ts';
import { normalizeWs } from './text.ts';

/**
 * One acquisition step for create, refresh and the legacy route:
 * Telem (router/qualification: title, HTTP status, redirect/canonical policy) and direct Tavily
 * POST /extract (evidence text) read the same selected URLs in parallel under the SAME reserved
 * operation quota. Tavily raw_content is the evidence; Telem text is used only as a labeled degraded fallback.
 */
export type AcquiredPage = FetchedPage & { extractor: 'tavily' | 'telem'; providerRequestId: string | null; extractionStatus: string; extractionError: string | null };
export type Acquisition = { pages: AcquiredPage[]; retrieval: RetrievalTrace[]; limitations: string[] };

export const telemFetchTrace = (p: FetchedPage): RetrievalTrace => ({ kind: 'fetch', provider: p.provider, service: 'telem', transport: 'telem', endpoint: 'fetch', mode: 'live', status: p.status === 'succeeded' ? (p.truncated ? 'succeeded:truncated' : 'succeeded') : `failed:${p.error}`, url: p.url, requestId: p.requestId, ...(p.cached !== null ? { cached: p.cached } : {}) });

// Telem's qualification wins over Tavily content: a destination out of policy or an HTTP error is not this source.
const disqualified = (p: FetchedPage): boolean => p.status === 'failed' && /^(destination_out_of_policy|http_\d+)$/.test(p.error ?? '');

export async function acquirePages(telem: TelemClient, urls: string[], d: RunDeps, opts: { noCache?: boolean } = {}): Promise<Acquisition> {
  const perPage = d.config.pageChars ?? PUBLIC_LIMITS.source_chars_per_page;
  const key = d.secrets.tavilyApiKey;
  const telemHttpBefore = telem.http;
  const [tel, tav] = await Promise.all([
    telem.fetchPages(urls, d.config.sourceHosts, { noCache: opts.noCache, perPageChars: perPage }).then((pages) => ({ pages }), (error: unknown) => ({ error })),
    key ? extractTavily(urls, { apiKey: key, allowedHosts: d.config.sourceHosts, maxContent: perPage, fetchImpl: d.fetchImpl, signal: d.signal }).catch((e: unknown) => ({ error: e instanceof Error ? e.message : 'TAVILY_UNAVAILABLE' })) : null,
  ]);
  if ('error' in tel) {
    // Telem stays mandatory; keep the parallel Tavily work visible instead of implying zero cost.
    if (tel.error instanceof TelemFailure) {
      const t = tav && 'trace' in tav ? tav.trace : null;
      tel.error.attempts = `telem_http=${telem.http - telemHttpBefore}; tavily_http=${!key ? 0 : t ? t.http_attempts : 'unknown'}; tavily_credits=${!key ? 0 : t?.usage ? t.usage.credits : 'unknown'}`;
    }
    throw tel.error; // callers map TelemFailure to the public error.
  }
  const retrieval: RetrievalTrace[] = tel.pages.map(telemFetchTrace);
  if (retrieval[0]) retrieval[0].http_attempts = telem.http - telemHttpBefore;
  const limitations: string[] = [];
  let tavSources: TavilySource[] = [];
  let tavError: string | null = key ? null : 'TAVILY_NOT_CONFIGURED';
  if (tav && 'sources' in tav) {
    const t = tav.trace;
    retrieval.push({ kind: 'fetch', provider: 'tavily', service: 'tavily', transport: 'direct', endpoint: 'extract', mode: 'live', status: t.status, requestId: t.requestId, callId: t.callId, usage: t.usage, cache_state: 'unknown', elapsed_ms: t.elapsed_ms, http_attempts: t.http_attempts, urls: t.urls, error: tav.error?.code ?? null });
    tavSources = tav.sources;
    tavError = tav.error?.code ?? null;
    limitations.push(...tav.limitations, 'Direct Tavily extraction and the Telem read of the same URL are two reads of one page, not independent sources.');
  } else if (tav) tavError = tav.error;

  const fallback: string[] = [];
  const pages = tel.pages.map((tp): AcquiredPage => {
    const ts = tavSources.find((s) => s.url === tp.url);
    const err = ts?.error ?? tavError ?? 'TAVILY_SOURCE_UNAVAILABLE';
    if (disqualified(tp)) return { ...tp, extractor: 'tavily', providerRequestId: ts?.provider_request_id ?? null, extractionStatus: 'failed', extractionError: ts && ts.status !== 'failed' ? `rejected:${tp.error}` : err };
    if (ts && ts.status !== 'failed') {
      const text = normalizeWs(ts.content);
      const cut = text.length > perPage;
      return { url: tp.url, status: 'succeeded', text: cut ? text.slice(0, perPage) : text, truncated: cut || ts.truncated, title: tp.title, error: null, provider: 'tavily', requestId: ts.provider_request_id, cached: null, cacheState: 'unknown', fetchedAt: ts.observedAt, httpStatus: tp.httpStatus, extractor: 'tavily', providerRequestId: ts.provider_request_id, extractionStatus: cut ? 'partial' : ts.status, extractionError: null };
    }
    if (tp.status === 'succeeded') {
      fallback.push(err);
      return { ...tp, extractor: 'telem', providerRequestId: null, extractionStatus: 'degraded_fallback', extractionError: err };
    }
    return { ...tp, extractor: 'tavily', providerRequestId: ts?.provider_request_id ?? null, extractionStatus: 'failed', extractionError: err };
  });
  if (fallback.length) limitations.push(`${fallback.length} source(s) used Telem page text as a labeled degraded fallback because direct Tavily extraction failed (${[...new Set(fallback)].join(', ')}); these are not Tavily extractions.`);
  if (pages.some((p) => p.extractor === 'tavily' && p.truncated)) limitations.push(`Some Tavily-extracted pages were truncated at ${perPage.toLocaleString('en-US')} characters; facts in omitted content remain unknown.`);
  return { pages, retrieval, limitations };
}

/** Additive SourceRecord provenance fields for one acquired page. */
export const sourceProvenance = (p: AcquiredPage) => ({ extractor: p.extractor, provider_request_id: p.providerRequestId, extraction_status: p.extractionStatus, extraction_error: p.extractionError });
