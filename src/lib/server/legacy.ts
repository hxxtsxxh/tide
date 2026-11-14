import 'server-only';
import { PUBLIC_LIMITS } from '../contracts/board.ts';
import { LegacyResponse, type LegacyRequest } from '../contracts/legacy.ts';
import { capBudget } from '../model/client.ts';
import { loadWorld } from '../search/fixtures.ts';
import { affectedClosure, topoOrder, validateGraph } from '../search/dag.ts';
import { canonicalJson, sha256 } from '../search/text.ts';
import { ApiError } from './guarded.ts';
import { normalizeSourceUrl, RunBudget } from './guards.ts';
import { buildBoard, mapTelem, telemClient, type RunDeps } from './research.ts';
import type { ServerConfig } from './config.ts';

/** contracts/IDENTITY.md: SHA-256 over {mode, query, input, limits, fixture_id?}. Not an authentication signature. */
export function inputSha256(r: LegacyRequest): string {
  const fields: Record<string, unknown> = { mode: r.mode, query: r.query, input: r.input, limits: r.limits };
  if (r.fixture_id !== undefined) fields.fixture_id = r.fixture_id;
  return sha256(canonicalJson(fields));
}

/** Objects merge key-wise; every other value (including lists) replaces. */
export function deepMerge(base: unknown, over: unknown): unknown {
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out;
}

type Data = {
  facts: { id: string; value: unknown; support_sets: string[][] }[];
  answers: { id: string; depends_on: string[] }[];
  event: Record<string, unknown> | null;
  cap: number;
};

function parseData(raw: Record<string, unknown>): Data {
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const o = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const strs = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === 'string');
  const facts = arr(raw.facts).map((f) => ({ id: String(o(f).id ?? ''), value: o(f).value, support_sets: arr(o(f).support_sets).map(strs) }));
  const answers = arr(raw.answers).map((a) => ({ id: String(o(a).id ?? ''), depends_on: strs(o(a).depends_on) }));
  const cap = raw.max_answer_recomputes;
  return { facts, answers, event: raw.event && typeof raw.event === 'object' ? (raw.event as Record<string, unknown>) : null, cap: Number.isInteger(cap) && (cap as number) >= 0 ? Math.min(cap as number, 40) : 6 };
}

const firstSentence = (t: string): string => {
  const m = /^[\s\S]*?[.!?](?=\s|$)/.exec(t);
  return (m ? m[0] : t).slice(0, 2000);
};

/**
 * Finite authored Simulation transport (localhost + ALLOW_FIXTURE_MODE only). No network, no model,
 * not billable. Deterministic invalidation over fixtures/worlds.json merged with request.input.
 */
export async function runLegacyFixture(req: LegacyRequest, cfg: { config: ServerConfig; hostname: string; requestId: string }, now: () => number = Date.now): Promise<LegacyResponse> {
  const t0 = now();
  const allowed = cfg.config.fixtureTransportAllowed && ['127.0.0.1', 'localhost', '[::1]'].includes(cfg.hostname);
  let world;
  try {
    world = await loadWorld(req.fixture_id ?? '', allowed);
  } catch {
    throw new ApiError('FIXTURE_MODE_DISABLED', 'Fixture transport is unavailable.');
  }
  if (!world) throw new ApiError('INVALID_INPUT', 'Unknown fixture_id.');
  const data = parseData(deepMerge(world.input, req.input) as Record<string, unknown>);
  try {
    validateGraph(data.facts.map((f) => f.id), data.answers);
  } catch (e) {
    throw new ApiError('INVALID_INPUT', e instanceof Error && e.message === 'CYCLE' ? 'Answer dependencies contain a cycle.' : 'Invalid fact/answer graph.');
  }
  const sourceIds = new Set(world.sources.map((s) => s.id));
  if (data.facts.some((f) => f.support_sets.some((set) => set.some((s) => !sourceIds.has(s))))) throw new ApiError('INVALID_INPUT', 'A support set references an unknown source.');

  // ---- event -> seeds ----
  const ev = data.event ?? {};
  const factVal = new Map(data.facts.map((f) => [f.id, f.value]));
  const failed = new Set<string>();
  const valueChanged = new Set<string>();
  const reqSeeds = new Set<string>();
  const notes: string[] = [];
  const old = new Map(factVal);
  const sid = typeof ev.source_id === 'string' ? ev.source_id : '';
  switch (ev.kind) {
    case 'fact_changed': {
      const id = String(ev.fact_id ?? '');
      if (!factVal.has(id)) throw new ApiError('INVALID_INPUT', 'Event references an unknown fact.');
      if (canonicalJson(ev.new_value) !== canonicalJson(factVal.get(id))) {
        valueChanged.add(id);
        factVal.set(id, ev.new_value);
      } else notes.push(`${id}: refreshed value is identical; nothing to invalidate.`);
      break;
    }
    case 'source_text_changed': {
      // Source text changed; only a changed extracted (semantic) value invalidates dependents.
      const solo = data.facts.filter((f) => f.support_sets.some((s) => s.length === 1 && s[0] === sid));
      for (const f of solo) if ('semantic_value' in ev && canonicalJson(ev.semantic_value) !== canonicalJson(f.value)) { valueChanged.add(f.id); factVal.set(f.id, ev.semantic_value); }
      notes.push(valueChanged.size ? `${sid}: text changed and the extracted value changed.` : `${sid}: text changed but extracted facts are identical (cosmetic); no recomputation.`);
      break;
    }
    case 'source_fetch_failed':
    case 'source_deleted':
      failed.add(sid);
      notes.push(`${sid}: ${ev.kind === 'source_deleted' ? 'source deleted' : 'fetch failed'}; freshness of dependent facts is unknown unless another complete support set remains.`);
      break;
    case 'requirement_changed':
      reqSeeds.add(String(ev.answer_id ?? ''));
      notes.push('Requirement changed by the user (input version change, not a source change).');
      break;
    default:
      if (data.event) throw new ApiError('INVALID_INPUT', 'Unsupported event kind.');
  }
  if ([...reqSeeds].some((id) => !data.answers.some((a) => a.id === id))) throw new ApiError('INVALID_INPUT', 'Event references an unknown answer.');

  // ---- disjunctive support: a fact stays supported if some complete set has no failed/deleted source ----
  const unhealthy = new Set(data.facts.filter((f) => !f.support_sets.some((set) => set.length > 0 && set.every((s) => !failed.has(s)))).map((f) => f.id));
  const seeds = new Set([...valueChanged, ...reqSeeds, ...unhealthy]);
  const affected = affectedClosure(data.answers, seeds);
  const unknownSet = affectedClosure(data.answers, unhealthy);
  const order = topoOrder(data.answers);
  const attempt = req.strategy === 'treatment' ? order.filter((id) => affected.has(id) && !unknownSet.has(id)) : order.filter((id) => !unknownSet.has(id));
  const recomputed = new Set(attempt.slice(0, data.cap));
  const state = (id: string): 'fresh' | 'unknown' | 'unchanged' => (unknownSet.has(id) ? 'unknown' : affected.has(id) ? (recomputed.has(id) ? 'fresh' : 'unknown') : 'unchanged');
  const valueOf = (id: string, vals: Map<string, unknown>): string => {
    const a = data.answers.find((x) => x.id === id)!;
    return `${id}: ${a.depends_on.map((dep) => (vals.has(dep) ? `${dep}=${JSON.stringify(vals.get(dep))}` : dep)).join(', ')}${reqSeeds.has(id) && ev.new_value !== undefined ? `; requirement=${JSON.stringify(ev.new_value)}` : ''}`;
  };

  // ---- evidence from sources whose recheck succeeded, cited by decisions ----
  const iso = new Date(now()).toISOString();
  const factSources = (fid: string): string[] => [...new Set((data.facts.find((f) => f.id === fid)?.support_sets ?? []).flat())];
  const answerFacts = (aid: string): string[] => data.answers.find((a) => a.id === aid)!.depends_on.flatMap((x) => (data.answers.some((a) => a.id === x) ? answerFacts(x) : [x]));
  const checked = [...new Set(data.facts.flatMap((f) => factSources(f.id)))];
  const evidenceIds = new Map<string, string>();
  const decisions = data.answers.map((a) => {
    const st = state(a.id);
    const ids = st === 'unknown' ? [] : [...new Set(answerFacts(a.id).flatMap(factSources).filter((s) => !failed.has(s)))].map((s) => { evidenceIds.set(s, `ev-${s}`); return `ev-${s}`; });
    return { id: a.id, state: st, value: valueOf(a.id, st === 'fresh' ? factVal : old), evidence_ids: ids };
  });
  const evidence = world.sources.filter((s) => evidenceIds.has(s.id)).map((s) => ({ id: `ev-${s.id}`, source_id: s.id, url: s.url, title: s.title, passage: firstSentence(s.text), origin: 'fixture' as const, retrieved_at: iso, content_sha256: sha256(s.text) }));
  const unknownIds = decisions.filter((x) => x.state === 'unknown').map((x) => x.id);
  const res: LegacyResponse = {
    project: 'ripple',
    request_id: cfg.requestId,
    input_sha256: inputSha256(req),
    mode: 'fixture',
    strategy: req.strategy,
    status: unknownIds.length ? 'partial' : 'complete',
    result: {
      affected_answer_ids: [...affected],
      recomputed_answer_ids: [...recomputed],
      reused_answer_ids: data.answers.map((a) => a.id).filter((id) => !affected.has(id) && !recomputed.has(id)),
      unknown_answer_ids: unknownIds,
      decisions,
      history_preserved: true,
      cycle_rejected: false,
    },
    evidence,
    trace: {
      queries: [],
      fetches: checked.slice(0, req.limits.max_pages).map((s) => ({ source_id: s, url: world.sources.find((x) => x.id === s)!.url, status: failed.has(s) ? ('failed' as const) : ('succeeded' as const), origin: 'fixture' as const, request_id: null })),
      model_calls: 0,
      elapsed_ms: Math.max(0, Math.round(now() - t0)),
      cache_mode: 'fixture',
      notes: [...notes, 'SYNTHETIC FIXTURE: authored data from fixtures/worlds.json; no external call was made.', 'Previous decision values are retained in this response (history_preserved).'],
    },
    unknowns: unknownIds.map((id) => `${id}: freshness unknown (unavailable evidence or exhausted recomputation budget)`),
    limitations: ['SYNTHETIC FIXTURE: not a live result and not evidence of any external page change.', 'Authored regression example, not a representative benchmark.'],
  };
  return LegacyResponse.parse(res);
}

/** Live legacy adapter: the SAME Telem + model pipeline as /api/boards, reported in the legacy shape. */
export async function runLegacyLive(req: LegacyRequest, d: RunDeps, base: RunBudget): Promise<LegacyResponse> {
  const t0 = (d.now ?? Date.now)();
  const L = req.limits;
  const deadlineAt = Math.min(d.deadlineAt, t0 + L.timeout_ms);
  const signal = AbortSignal.any([d.signal, AbortSignal.timeout(L.timeout_ms)]);
  const dd: RunDeps = {
    ...d,
    signal,
    deadlineAt,
    budget: capBudget(base, Math.min(L.max_model_calls, PUBLIC_LIMITS.model_calls)),
    telemLimits: { maxQueries: Math.min(L.max_queries, PUBLIC_LIMITS.search_queries), maxPages: Math.min(L.max_pages, PUBLIC_LIMITS.sources), maxHttp: 6 },
  };
  const telem = telemClient(dd);
  const hosts = d.config.sourceHosts;
  const supplied = Array.isArray(req.input.source_urls) ? (req.input.source_urls as string[]).map((u) => normalizeSourceUrl(u, hosts)) : [];
  const queries: LegacyResponse['trace']['queries'] = [];
  let urls = [...new Set(supplied)];
  if (L.max_queries > 0) {
    try {
      const domains = urls.length ? [...new Set(urls.map((u) => new URL(u).hostname))] : hosts;
      const out = await telem.search(req.query.slice(0, 400), domains, 8);
      queries.push({ query: req.query, providers: out.providers.filter((p) => p.status === 'succeeded').map((p) => p.provider), status: out.providers.some((p) => p.status === 'succeeded') ? 'succeeded' : 'failed', request_id: out.requestId });
      if (!urls.length) {
        const found: string[] = [];
        for (const h of out.hits) { try { found.push(normalizeSourceUrl(h.url, hosts)); } catch {} }
        urls = [...new Set(found)];
      }
    } catch (e) {
      mapTelem(e);
    }
  }
  urls = urls.slice(0, dd.telemLimits!.maxPages);
  if (!urls.length) throw new ApiError('SOURCE_UNAVAILABLE', 'No supported source pages were supplied or discovered.');
  const rest = Object.fromEntries(Object.entries(req.input).filter(([k]) => k !== 'source_urls' && k !== 'action'));
  const requirements = Object.keys(rest).length ? JSON.stringify(rest).slice(0, 2000) : '';
  const core = await buildBoard({ title: 'legacy', question: req.query, requirements, urls }, dd, telem);
  const { board } = core;
  const factSrc = new Map(board.facts.map((f) => [f.id, f]));
  const factsOf = (aid: string): string[] => board.answers.find((a) => a.id === aid)!.depends_on.flatMap((x) => (factSrc.has(x) ? [x] : factsOf(x)));
  const evidence = board.facts.filter((f) => f.status === 'supported' && f.quote).map((f) => {
    const s = board.sources.find((x) => x.id === f.source_id)!;
    return { id: `ev-${f.id}`, source_id: s.id, url: s.url, title: s.title, passage: f.quote.slice(0, 2000), origin: 'telem_live' as const, retrieved_at: s.observedAt, content_sha256: s.contentHash };
  });
  const have = new Set(evidence.map((e) => e.id));
  const decisions = board.answers.map((a) => ({ id: a.id, state: a.status, value: a.text, evidence_ids: a.status === 'unknown' ? [] : [...new Set(factsOf(a.id))].map((f) => `ev-${f}`).filter((i) => have.has(i)) }));
  const ids = board.answers.map((a) => a.id);
  const unknown = board.answers.filter((a) => a.status === 'unknown').map((a) => a.id);
  const elapsed = Math.min(L.timeout_ms, Math.round((d.now ?? Date.now)() - t0));
  return LegacyResponse.parse({
    project: 'ripple',
    request_id: d.requestId,
    input_sha256: inputSha256(req),
    mode: 'live',
    strategy: req.strategy,
    status: !evidence.length ? 'blocked' : unknown.length || board.sources.some((s) => s.status !== 'succeeded') ? 'partial' : 'complete',
    result: { affected_answer_ids: ids, recomputed_answer_ids: ids, reused_answer_ids: [], unknown_answer_ids: unknown, decisions, history_preserved: true, cycle_rejected: false },
    evidence,
    trace: {
      queries,
      fetches: core.pages.map((p, i) => ({ source_id: board.sources[i]!.id, url: p.url, status: p.status, origin: 'telem_live' as const, request_id: p.requestId })),
      model_calls: dd.budget.attempts,
      elapsed_ms: elapsed,
      cache_mode: core.retrieval.some((r) => r.service === 'telem' && r.cached === true) ? 'warm' : 'cold',
      notes: [
        'From-scratch build: treatment and baseline perform identical source acquisition and extraction.',
        `Actual acquisition HTTP attempts: Telem=${telem.http} (search + fetch, including retries); direct Tavily=${core.retrieval.filter((r) => r.service === 'tavily').reduce((n, r) => n + (r.http_attempts ?? 0), 0)}. Legacy fetches counts source pages, not provider HTTP attempts.`,
        'Legacy cache_mode describes Telem observations only. Direct Tavily cache freshness is unknown; no cache-bypass or total-work savings claim is made.',
        // The legacy schema only knows origin 'telem_live'; the actual evidence extractor is reported here.
        ...board.sources.map((s) => `${s.id}: extractor=${s.extractor ?? 'telem'} status=${s.extraction_status ?? s.status} provider_request_id=${s.provider_request_id ?? 'null'}${s.extraction_error ? ` error=${s.extraction_error}` : ''}`),
        ...core.retrieval.filter((r) => r.service === 'tavily').map((r) => `tavily direct extract: status=${r.status} request_id=${r.requestId ?? 'null'} credits=${r.usage ? r.usage.credits : 'not reported'}`),
      ],
    },
    unknowns: unknown.map((id) => `${id}: no fully supported, freshly read dependency`),
    limitations: [...core.limitations],
  });
}
