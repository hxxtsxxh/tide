// Deterministic fake Telem + direct Tavily + model transports for tests. Never contacts the network.
import type { RunDeps } from '../src/lib/server/research.ts';
import { serverConfig, secrets } from '../src/lib/server/config.ts';
import { RunBudget } from '../src/lib/server/guards.ts';

export const SECRET = 's'.repeat(40);
export const ENV = { TELEM_API_KEY: 'telem-test-key', APP_MODEL: 'test-model', ANTHROPIC_API_KEY: 'anthropic-test-key', UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'r', RIPPLE_STATE_SECRET: SECRET, TAVILY_API_KEY: 'tavily-test-key-not-real-0001' };

export const URL_A = 'https://docs.telem.ai/resources/fetch-best-practices/';
export const URL_B = 'https://developer.mozilla.org/en-US/docs/Web/API/AbortController';
export const URL_C = 'https://docs.python.org/3/library/asyncio.html';

export const TEXT_A = 'Telem fetch accepts at most 5 URLs per request.\n\nFailed pages return a per-page error even when HTTP status is 200. Cached copies may be returned.';
export const TEXT_B = 'AbortController aborts fetch requests. The abort() method cancels an asynchronous operation.';

/** `tavily` overrides what direct Tavily /extract returns for the page (default: same text as Telem). */
export type Page = { text?: string; fail?: boolean; canonical?: string; truncated?: boolean; cache?: string; tavily?: { text?: string; fail?: boolean; url?: string } };
export type World = {
  pages: Record<string, Page>;
  /** Telem failures by call order (HTTP status), consumed first. */
  telemStatus: number[];
  /** Provider runs for search. */
  search: { provider: string; status?: string; error?: unknown; results?: { url: string; title: string }[] }[];
  /** Tavily HTTP failures by call order, consumed first. */
  tavilyStatus?: number[];
  modelStatus: number[];
  extraction: unknown;
  /** facts-only response for refresh re-extraction */
  refreshFacts: unknown;
  rewrite: (items: { id: string; previous: string }[]) => unknown;
  calls: { host: string; path: string; body: any; headers: Record<string, string> }[];
};

export const EXTRACTION = {
  facts: [
    { ref: 'F1', source: 's1', key: 'max_urls_per_fetch', value: 5, quote: 'Telem fetch accepts at most 5 URLs per request.' },
    { ref: 'F2', source: 's1', key: 'per_page_errors', value: true, quote: 'Failed pages return a per-page error even when HTTP status is 200.' },
    { ref: 'F3', source: 's2', key: 'abort_cancels_fetch', value: true, quote: 'AbortController aborts fetch requests.' },
    { ref: 'F4', source: 's2', key: 'invented', value: 1, quote: 'This sentence was invented by the model.' },
  ],
  answers: [
    { ref: 'A1', text: 'Send at most 5 URLs per fetch.', depends_on: ['F1', 'F2'], uses_requirements: true },
    { ref: 'A2', text: 'Cancel with AbortController.', depends_on: ['F3'], uses_requirements: false },
    { ref: 'A3', text: 'Rely on the invented rule.', depends_on: ['F4'], uses_requirements: false },
    { ref: 'A4', text: 'Plan the number of batches.', depends_on: ['A1'], uses_requirements: false },
  ],
};

export function newWorld(over: Partial<World> = {}): World {
  return {
    pages: { [URL_A]: { text: TEXT_A }, [URL_B]: { text: TEXT_B }, [URL_C]: { fail: true } },
    telemStatus: [],
    search: [{ provider: 'brave', results: [{ url: URL_A, title: 'Fetch best practices' }] }, { provider: 'tavily', results: [{ url: URL_B, title: 'AbortController' }] }],
    modelStatus: [],
    extraction: EXTRACTION,
    refreshFacts: { facts: [] },
    rewrite: (items) => ({ answers: items.map((i) => ({ id: i.id, text: `${i.previous} [rewritten]` })) }),
    calls: [],
    ...over,
  };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function fakeFetch(w: World): typeof fetch {
  let n = 0;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    w.calls.push({ host: u.host, path: u.pathname, body, headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)) });
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    if (u.host === 'hack.telem.ai') {
      const st = w.telemStatus.shift();
      if (st) return json(st, { error: 'x' });
      if (u.pathname === '/api/v1/search')
        return json(200, { session_id: 'sess-1', interaction_id: 'int-1', preprocessor_runs: w.search.map((p) => ({ preprocessor_name: p.provider, status: p.status ?? 'succeeded', error: p.error ?? null, output_payload: { results: p.results ?? [] }, request_payload: { headers: { 'X-Subscription-Token': 'PROVIDER-SECRET' } } })) });
      const results = (body.urls as string[]).map((url) => {
        const p = w.pages[url];
        if (!p || p.fail) return { url, status: 'failed', error: { type: 'HTTPStatusError', message: 'boom' } };
        return { url, status: 'succeeded', error: null, content: p.text, content_truncated: p.truncated ?? false, canonical_url: p.canonical ?? url, title: `Title ${++n}`, fetched_at: '2026-11-14T18:54:33.957159+00:00', provider: 'exa', cache_state: p.cache ?? 'cached', cached: !body.options.no_cache, request_id: `req-${n}`, http_status: null };
      });
      return json(200, { session_id: 'sess-1', preprocessor_runs: [{ preprocessor_name: 'web_fetch', status: 'succeeded', output_payload: { fetched_results: results } }] });
    }
    if (u.host === 'api.tavily.com') {
      const st = w.tavilyStatus?.shift();
      if (st) return json(st, { detail: 'x' });
      const results: unknown[] = [];
      const failed: unknown[] = [];
      for (const url of body.urls as string[]) {
        const p = w.pages[url];
        const t = p?.tavily ?? {};
        if (!p || p.fail || t.fail) failed.push({ url, error: 'Failed to fetch url' });
        // A partial Telem read is mirrored as an over-long Tavily page so the adapter's explicit truncation applies.
        else results.push({ url: t.url ?? url, raw_content: t.text ?? (p.truncated ? `${p.text} ${'x'.repeat(30_001)}` : p.text), images: [] });
      }
      return json(200, { results, failed_results: failed, response_time: 0.4, usage: { credits: 1 }, request_id: `tav-req-${++n}` });
    }
    if (u.host === 'api.anthropic.com') {
      const st = w.modelStatus.shift();
      if (st) return json(st, { error: { type: 'x' } });
      const prompt: string = body.messages[0].content;
      let out: unknown;
      if (prompt.includes('Return {"facts":[...],"answers":[...]}')) out = w.extraction;
      else if (prompt.includes('Return {"facts":[...]}')) out = w.refreshFacts;
      else out = w.rewrite(JSON.parse(/Answers to rewrite[^:]*: (\[.*\])/.exec(prompt)![1]!));
      return json(200, { content: [{ type: 'text', text: JSON.stringify(out) }], stop_reason: 'end_turn' });
    }
    throw new Error(`unexpected host ${u.host}`);
  }) as typeof fetch;
}

export function deps(w: World, over: Partial<RunDeps> = {}): RunDeps {
  const budget = new RunBudget({ maxCalls: 6, timeoutMs: 45_000 });
  return {
    requestId: 'req-test',
    config: serverConfig(ENV),
    secrets: secrets(ENV),
    budget,
    signal: AbortSignal.timeout(45_000),
    deadlineAt: Date.now() + 45_000,
    fetchImpl: fakeFetch(w),
    ...over,
  };
}
