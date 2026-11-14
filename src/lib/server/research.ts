import 'server-only';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Board, BoardEnvelope, CreateBoardRequest, DiscoverRequest, DiscoverResponse, RefreshBoardRequest, RetrievalTrace, SignedBoardState, SourceRecord } from '../contracts/board.ts';
import { Board as BoardSchema, PUBLIC_LIMITS } from '../contracts/board.ts';
import { completeStructured, ModelFailure, type CallBudget, type ModelDeps } from '../model/client.ts';
import { buildPrompt, Extraction, factsOnlyPrompt, Rewrite, rewritePrompt, type PromptSource } from '../model/extract.ts';
import { affectedClosure, topoOrder, validateGraph, type GraphNode } from '../search/dag.ts';
import { TelemClient, TelemFailure, type FetchedPage, type TelemLimits } from '../search/telem.ts';
import { buildExcerpt, canonicalJson, locateQuote, sha256, slug } from '../search/text.ts';
import type { ServerConfig, secrets as secretsFn } from './config.ts';
import { ApiError } from './guarded.ts';
import { normalizeSourceUrl, signSnapshot, verifySnapshot } from './guards.ts';

export const SNAPSHOT_TTL_S = 7 * 86400;
const STATE_KIND = 'ripple-board-state';

export type RunDeps = {
  requestId: string;
  config: ServerConfig;
  secrets: ReturnType<typeof secretsFn>;
  budget: CallBudget;
  signal: AbortSignal;
  /** Epoch ms after which no retry/new attempt starts. */
  deadlineAt: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  telemLimits?: Partial<TelemLimits>;
};

/** Server-side bookkeeping that rides inside the signed snapshot (the browser treats it as opaque). */
export type BoardMeta = { factKeys: Record<string, string>; usesReq: Record<string, boolean> };
export type State = SignedBoardState & { meta: BoardMeta };

const nowMs = (d: RunDeps): number => (d.now ?? Date.now)();
const nowIso = (d: RunDeps): string => new Date(nowMs(d)).toISOString();
const asIso = (v: string | null, fallback: string): string => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : fallback;
};

export function telemClient(d: RunDeps): TelemClient {
  const limits: TelemLimits = { maxQueries: PUBLIC_LIMITS.search_queries, maxPages: PUBLIC_LIMITS.sources, maxHttp: 6, ...d.telemLimits };
  return new TelemClient({ apiKey: d.secrets.telemApiKey, signal: d.signal, deadline: d.deadlineAt, limits, fetchImpl: d.fetchImpl, now: d.now });
}
function modelDeps(d: RunDeps): ModelDeps {
  return { provider: d.secrets.modelProvider, model: d.secrets.model, apiKey: d.secrets.modelApiKey, budget: d.budget, signal: d.signal, deadline: d.deadlineAt, fetchImpl: d.fetchImpl, now: d.now };
}

export function mapTelem(e: unknown): never {
  if (e instanceof TelemFailure) {
    if (e.kind === 'timeout') throw new ApiError('TIMEOUT', 'The operation deadline was reached while acquiring sources.');
    throw new ApiError('UPSTREAM_UNAVAILABLE', e.kind === 'auth' ? 'The source acquisition service rejected this deployment’s credentials.' : 'The source acquisition service is unavailable.');
  }
  throw e;
}
export function mapModel(e: unknown): never {
  if (e instanceof ModelFailure) {
    if (e.kind === 'timeout') throw new ApiError('TIMEOUT', 'The operation deadline was reached during analysis.');
    throw new ApiError('UPSTREAM_UNAVAILABLE', e.kind === 'auth' ? 'The analysis model rejected this deployment’s credentials.' : 'The analysis model did not return usable output.');
  }
  throw e;
}

const isDegradable = (e: unknown): boolean => e instanceof ModelFailure || (e instanceof Error && e.message === 'RUN_TIMEOUT');

// ---- Discover ----------------------------------------------------------------------------------

export async function discover(req: DiscoverRequest, d: RunDeps): Promise<DiscoverResponse> {
  const t0 = nowMs(d);
  const telem = telemClient(d);
  let out;
  try {
    out = await telem.search(req.query.slice(0, 400), d.config.sourceHosts, PUBLIC_LIMITS.discover_results);
  } catch (e) {
    mapTelem(e);
  }
  const retrieval: RetrievalTrace[] = out.providers.map((p) => ({ kind: 'search', provider: p.provider, mode: 'live', status: p.status === 'succeeded' ? 'succeeded' : `failed:${p.error}`, ...(out.requestId ? { requestId: out.requestId } : {}) }));
  if (!out.providers.some((p) => p.status === 'succeeded')) throw new ApiError('UPSTREAM_UNAVAILABLE', 'No search provider returned results.');
  const seen = new Set<string>();
  const results: { url: string; title: string }[] = [];
  let rejected = 0;
  for (const h of out.hits) {
    let url: string;
    try {
      url = normalizeSourceUrl(h.url, d.config.sourceHosts);
    } catch {
      rejected++;
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    results.push({ url, title: h.title || new URL(url).hostname });
    if (results.length >= PUBLIC_LIMITS.discover_results) break;
  }
  const limitations = ['Candidates come from search results; snippets are never used as evidence. Select pages and build a board to fetch and quote them.', 'Only the supported documentation hosts are offered; out-of-policy results are dropped.'];
  if (rejected) limitations.push(`${rejected} result(s) outside the supported hosts were dropped.`);
  if (!results.length) limitations.push('No supported-host candidates were found for this query.');
  return { mode: 'live', request_id: d.requestId, results, trace: { retrieval, model_calls: 0, elapsed_ms: nowMs(d) - t0, limitations } };
}

// ---- Shared core: fetch -> extract -> verify -> propose dependencies ------------------------------

type AcceptedFact = { ref: string; source: string; key: string; value: string | number | boolean; quote: string };

/** Keep only facts whose quote occurs literally in the cited source's fetched text. */
function acceptFacts(raw: Extraction['facts'], texts: Map<string, string>, existingKeys: Set<string> = new Set()): { accepted: AcceptedFact[]; unverified: AcceptedFact[] } {
  const accepted: AcceptedFact[] = [];
  const unverified: AcceptedFact[] = [];
  const seen = new Set(existingKeys);
  for (const f of raw) {
    const text = texts.get(f.source);
    if (text === undefined) continue;
    const key = slug(f.key);
    if (seen.has(`${f.source}|${key}`)) continue;
    seen.add(`${f.source}|${key}`);
    const q = locateQuote(text, f.quote);
    (q ? accepted : unverified).push({ ...f, key, quote: q ?? '' });
  }
  return { accepted, unverified };
}

function markConflicts(facts: Board['facts'], keys: Record<string, string>): void {
  const groups = new Map<string, Board['facts']>();
  for (const f of facts) {
    if (f.status === 'unknown') continue;
    const k = keys[f.id];
    if (k) groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  for (const g of groups.values()) {
    const differing = new Set(g.map((f) => canonicalJson(f.value))).size > 1 && new Set(g.map((f) => f.source_id)).size > 1;
    for (const f of g) f.status = differing ? 'conflicting' : 'supported';
  }
}

/** Answer IDs whose dependencies cannot be trusted as freshly observed (incomplete source, unknown/conflicting fact). */
function unknownAnswers(board: Board): Set<string> {
  const bad = new Set<string>();
  const srcIncomplete = new Set(board.sources.filter((s) => s.status !== 'succeeded').map((s) => s.id));
  const factBad = new Set(board.facts.filter((f) => f.status !== 'supported' || srcIncomplete.has(f.source_id)).map((f) => f.id));
  for (const id of topoOrder(board.answers)) {
    const a = board.answers.find((x) => x.id === id)!;
    if (!a.depends_on.length || a.depends_on.some((x) => factBad.has(x) || bad.has(x))) bad.add(id);
  }
  return bad;
}

function setStatuses(board: Board, stale: Set<string>): void {
  const unknown = unknownAnswers(board);
  const hot = new Set<string>();
  for (const id of topoOrder(board.answers)) {
    const a = board.answers.find((x) => x.id === id)!;
    if (unknown.has(id)) a.status = 'unknown';
    else if (stale.has(id) || a.depends_on.some((x) => hot.has(x))) {
      a.status = 'stale';
      hot.add(id);
    } else a.status = 'fresh';
  }
}

function sourceRecord(id: string, url: string, p: FetchedPage, now: string): SourceRecord {
  return p.status === 'succeeded'
    ? { id, url, title: p.title || new URL(url).hostname, status: p.truncated ? 'partial' : 'succeeded', observedAt: asIso(p.fetchedAt, now), contentHash: sha256(p.text), excerpt: '', ...(p.cacheState ? { cache_state: p.cacheState } : {}) }
    : { id, url, title: new URL(url).hostname, status: 'failed', observedAt: now, contentHash: '', excerpt: '', ...(p.cacheState ? { cache_state: p.cacheState } : {}) };
}

function fetchTrace(p: FetchedPage): RetrievalTrace {
  return { kind: 'fetch', provider: p.provider, mode: 'live', status: p.status === 'succeeded' ? (p.truncated ? 'succeeded:truncated' : 'succeeded') : `failed:${p.error}`, url: p.url, ...(p.requestId ? { requestId: p.requestId } : {}), ...(p.cached !== null ? { cached: p.cached } : {}) };
}

const sourceExcerpt = (text: string, quotes: string[]): { excerpt: string; kept: Set<string> } => {
  const r = buildExcerpt(text, quotes);
  return r.excerpt ? r : { excerpt: text.slice(0, 300), kept: r.kept };
};

export type Core = { board: Board; meta: BoardMeta; pages: FetchedPage[]; texts: Map<string, string>; retrieval: RetrievalTrace[]; limitations: string[]; unverified: number };

export async function buildBoard(input: { title: string; question: string; requirements: string; urls: string[] }, d: RunDeps, telem: TelemClient = telemClient(d)): Promise<Core> {
  const now = nowIso(d);
  let pages: FetchedPage[];
  try {
    pages = await telem.fetchPages(input.urls, d.config.sourceHosts);
  } catch (e) {
    mapTelem(e);
  }
  const sources = pages.map((p, i) => sourceRecord(`s${i + 1}`, p.url, p, now));
  const texts = new Map(sources.filter((s, i) => s.status !== 'failed' && pages[i]).map((s) => [s.id, pages[sources.indexOf(s)]!.text]));
  const retrieval = pages.map(fetchTrace);
  if (!texts.size) throw new ApiError('SOURCE_UNAVAILABLE', 'None of the selected pages could be read. Nothing was extracted; try other supported pages.');

  const promptSources: PromptSource[] = [...texts].map(([id, text]) => ({ id, url: sources.find((s) => s.id === id)!.url, title: sources.find((s) => s.id === id)!.title, text }));
  let ext: Extraction;
  try {
    const p = buildPrompt(input.question, input.requirements, promptSources, PUBLIC_LIMITS.facts);
    ext = await completeStructured(modelDeps(d), p.system, p.user, (r) => Extraction.parse(r));
  } catch (e) {
    mapModel(e);
  }

  const { accepted, unverified } = acceptFacts(ext.facts, texts);
  // Per-source excerpts: literal windows around quotes; quotes that do not fit are demoted to unknown.
  const keptQuotes = new Map<string, Set<string>>();
  for (const s of sources) {
    const qs = accepted.filter((f) => f.source === s.id).map((f) => f.quote);
    if (!texts.has(s.id)) continue;
    const { excerpt, kept } = sourceExcerpt(texts.get(s.id)!, qs);
    s.excerpt = excerpt;
    keptQuotes.set(s.id, kept);
  }
  const facts: Board['facts'] = [];
  const keys: Record<string, string> = {};
  const refToId = new Map<string, string>();
  for (const f of [...accepted, ...unverified].slice(0, PUBLIC_LIMITS.facts)) {
    const ok = f.quote !== '' && keptQuotes.get(f.source)?.has(f.quote) === true;
    const id = `f${facts.length + 1}`;
    facts.push({ id, value: f.value, status: ok ? 'supported' : 'unknown', source_id: f.source, quote: ok ? f.quote : '', support_sets: [[f.source]] });
    keys[id] = f.key;
    refToId.set(f.ref, id);
  }
  markConflicts(facts, keys);

  const answers: Board['answers'] = [];
  const usesReq: Record<string, boolean> = {};
  const aRef = new Map<string, string>();
  for (const a of ext.answers ?? []) {
    const deps = [...new Set(a.depends_on.map((r) => refToId.get(r) ?? aRef.get(r)).filter((x): x is string => Boolean(x)))];
    if (!deps.length) continue; // no source-backed dependency -> not a supportable answer
    const id = `a${answers.length + 1}`;
    answers.push({ id, text: a.text, depends_on: deps, status: 'unknown', dependency_review: 'proposed', observedAt: now });
    usesReq[id] = a.uses_requirements === true;
    aRef.set(a.ref, id);
  }
  validateGraph(facts.map((f) => f.id), answers, PUBLIC_LIMITS.nodes);
  const board: Board = { id: `b_${randomBytes(9).toString('base64url')}`, title: input.title, question: input.question, requirements: input.requirements, sources, facts, answers, revisions: [] };
  setStatuses(board, new Set());

  const limitations = baseLimitations(board);
  if (unverified.length || accepted.length > facts.length) limitations.push(`${unverified.length} proposed fact(s) were dropped or marked unknown because no verbatim quote was found in the fetched page.`);
  if (!answers.length) limitations.push('No answer could be supported by quoted facts; the board lists sources and facts only.');
  return { board, meta: { factKeys: keys, usesReq }, pages, texts, retrieval, limitations, unverified: unverified.length };
}

function baseLimitations(board: Board): string[] {
  const l = ['Facts are model-extracted and checked only for a literal quote in the fetched page; a quote shows presence, not truth.', 'Dependencies between facts and answers are model-proposed hypotheses; review them before relying on them.'];
  if (board.sources.some((s) => s.status === 'partial')) l.push('Some pages were truncated to fit limits; unseen text was not considered.');
  if (board.sources.some((s) => s.status === 'failed')) l.push('Some pages could not be read; facts from them are unavailable and freshness is unknown.');
  return l;
}

function sign(board: Board, meta: BoardMeta, d: RunDeps): string {
  const observations: Record<string, { contentHash: string; observedAt: string }> = {};
  for (const s of board.sources) if (s.contentHash) observations[s.id] = { contentHash: s.contentHash, observedAt: s.observedAt };
  const state: State = { kind: STATE_KIND, board, observations, meta };
  return signSnapshot(state, d.secrets.stateSecret, Math.floor(nowMs(d) / 1000), SNAPSHOT_TTL_S);
}

export async function createBoard(req: CreateBoardRequest, d: RunDeps): Promise<BoardEnvelope> {
  const t0 = nowMs(d);
  const core = await buildBoard(req, d);
  const now = nowIso(d);
  core.board.revisions = [{ id: 'r1', parent_id: null, createdAt: now, kind: 'created', summary: `Created from ${core.board.sources.filter((s) => s.status !== 'failed').length}/${core.board.sources.length} readable source(s): ${core.board.facts.length} fact(s), ${core.board.answers.length} proposed answer(s).` }];
  const ids = core.board.answers.map((a) => a.id);
  return {
    schemaVersion: 1,
    project: 'ripple',
    mode: 'live',
    request_id: d.requestId,
    board: core.board,
    snapshot: sign(core.board, core.meta, d),
    update: { affected: ids, recomputed: ids, reused: [], unknown: core.board.answers.filter((a) => a.status === 'unknown').map((a) => a.id) },
    trace: { retrieval: core.retrieval, model_calls: d.budget.attempts, elapsed_ms: nowMs(d) - t0, limitations: core.limitations },
  };
}

// ---- Refresh ---------------------------------------------------------------------------------------

const MetaSchema = z.object({ factKeys: z.record(z.string(), z.string()), usesReq: z.record(z.string(), z.boolean()) });
const StateSchema = z.object({ kind: z.literal(STATE_KIND), board: BoardSchema, observations: z.record(z.string(), z.object({ contentHash: z.string(), observedAt: z.string() })).optional(), meta: MetaSchema.optional() });

/** Verify HMAC/expiry, schema, graph and CURRENT source policy. Network-free; used before quota is spent. */
export function openSnapshot(token: string, secret: string, hosts: readonly string[], now?: number): State {
  let data: unknown;
  try {
    data = verifySnapshot(token, secret, now);
  } catch {
    throw new ApiError('REVALIDATION_REQUIRED', 'This snapshot could not be verified (expired, altered, or from another deployment). Rebuild the board from its question and URLs.');
  }
  const parsed = StateSchema.safeParse(data);
  if (!parsed.success) throw new ApiError('REVALIDATION_REQUIRED', 'This snapshot has an unsupported structure. Rebuild the board.');
  const { board, observations } = parsed.data;
  try {
    validateGraph(board.facts.map((f) => f.id), board.answers, PUBLIC_LIMITS.nodes);
    if (new Set([...board.sources.map((s) => s.id), ...board.facts.map((f) => f.id), ...board.answers.map((a) => a.id)]).size !== board.sources.length + board.facts.length + board.answers.length) throw new Error('DUPLICATE_ID');
  } catch {
    throw new ApiError('REVALIDATION_REQUIRED', 'This snapshot’s dependency graph is invalid. Rebuild the board.');
  }
  for (const s of board.sources) {
    try {
      normalizeSourceUrl(s.url, hosts);
    } catch {
      throw new ApiError('SOURCE_NOT_ALLOWED', 'A source in this board is no longer on a supported host.');
    }
  }
  return { kind: STATE_KIND, board, observations, meta: parsed.data.meta ?? { factKeys: {}, usesReq: {} } };
}

export async function refreshBoard(req: RefreshBoardRequest, state: State, d: RunDeps): Promise<BoardEnvelope> {
  const t0 = nowMs(d);
  const board: Board = structuredClone(state.board);
  const meta: BoardMeta = structuredClone(state.meta);
  const now = nowIso(d);
  const reqChanged = req.requirements !== undefined && req.requirements !== board.requirements;
  const newRequirements = req.requirements ?? board.requirements;
  const prevStatus = new Map(board.answers.map((a) => [a.id, a.status]));
  const retrieval: RetrievalTrace[] = [];
  const limitations = baseLimitations(board);
  const valueChanged = new Set<string>();
  const tally = { unchanged: 0, changed: 0, failed: 0 };
  let extractionFailed = false;

  if (req.force) {
    const telem = telemClient(d);
    let pages: FetchedPage[];
    try {
      pages = await telem.fetchPages(board.sources.map((s) => s.url), d.config.sourceHosts, { noCache: true });
    } catch (e) {
      mapTelem(e);
    }
    retrieval.push(...pages.map(fetchTrace));
    const changed: { src: SourceRecord; page: FetchedPage }[] = [];
    for (const src of board.sources) {
      const page = pages.find((p) => p.url === src.url);
      if (!page || page.status === 'failed') {
        // Keep the last successful hash/excerpt/observedAt; the failed attempt is recorded in trace + revision.
        src.status = 'failed';
        if (page?.cacheState) src.cache_state = page.cacheState;
        tally.failed++;
        continue;
      }
      if (page.cacheState) src.cache_state = page.cacheState;
      if (sha256(page.text) === src.contentHash) {
        src.status = page.truncated ? 'partial' : 'succeeded';
        src.observedAt = asIso(page.fetchedAt, now);
        tally.unchanged++;
      } else {
        changed.push({ src, page });
        tally.changed++;
      }
    }
    if (changed.length) {
      const texts = new Map(changed.map((c) => [c.src.id, c.page.text]));
      try {
        const p = factsOnlyPrompt(board.question, changed.map((c) => ({ id: c.src.id, url: c.src.url, title: c.src.title, text: c.page.text })), PUBLIC_LIMITS.facts);
        const ext = await completeStructured(modelDeps(d), p.system, p.user, (r) => Extraction.parse(r));
        const { accepted } = acceptFacts(ext.facts, texts);
        for (const { src, page } of changed) {
          const newByKey = new Map(accepted.filter((f) => f.source === src.id).map((f) => [f.key, f]));
          const mine = board.facts.filter((f) => f.source_id === src.id);
          for (const f of mine) {
            const n = newByKey.get(meta.factKeys[f.id] ?? '');
            newByKey.delete(meta.factKeys[f.id] ?? '');
            if (!n) {
              f.status = 'unknown'; // evidence no longer found: never silently keep the old claim fresh
              f.quote = '';
            } else {
              if (canonicalJson(n.value) !== canonicalJson(f.value)) valueChanged.add(f.id);
              f.value = n.value;
              f.quote = n.quote;
              f.status = 'supported';
            }
          }
          for (const n of newByKey.values()) {
            if (board.facts.length >= PUBLIC_LIMITS.facts) {
              limitations.push('Additional facts were found but the 10-fact board limit was reached.');
              break;
            }
            const id = `f${Math.max(0, ...board.facts.map((f) => Number(f.id.slice(1)) || 0)) + 1}`;
            board.facts.push({ id, value: n.value, status: 'supported', source_id: src.id, quote: n.quote, support_sets: [[src.id]] });
            meta.factKeys[id] = n.key;
          }
          const quotes = board.facts.filter((f) => f.source_id === src.id && f.status === 'supported' && f.quote).map((f) => f.quote);
          const { excerpt, kept } = sourceExcerpt(page.text, quotes);
          for (const f of board.facts) if (f.source_id === src.id && f.quote && !kept.has(f.quote)) { f.status = 'unknown'; f.quote = ''; }
          src.excerpt = excerpt;
          src.contentHash = sha256(page.text);
          src.observedAt = asIso(page.fetchedAt, now);
          src.status = page.truncated ? 'partial' : 'succeeded';
        }
      } catch (e) {
        if (!isDegradable(e)) throw e;
        extractionFailed = true;
        // Changed content could not be re-read into facts: its facts become unknown; hash is NOT advanced so the next refresh retries.
        for (const { src } of changed) {
          src.status = 'partial';
          for (const f of board.facts) if (f.source_id === src.id) { f.status = 'unknown'; f.quote = ''; }
        }
        limitations.push('A changed page could not be re-extracted this time; its facts are unknown until the next successful refresh.');
      }
    }
  }
  markConflicts(board.facts, meta.factKeys);

  // ---- dependency-directed recomputation ----
  const seeds = new Set<string>(valueChanged);
  if (reqChanged) for (const a of board.answers) if (meta.usesReq[a.id]) seeds.add(a.id);
  const affected = affectedClosure(board.answers, seeds);
  for (const a of board.answers) if (prevStatus.get(a.id) === 'stale') for (const x of affectedClosure(board.answers, [a.id])) affected.add(x);
  const unknownNow = unknownAnswers(board);
  const toCompute = board.answers.filter((a) => affected.has(a.id) && !unknownNow.has(a.id));
  const recomputed = new Set<string>();
  if (toCompute.length) {
    const order = topoOrder(board.answers);
    const todo = order.filter((id) => toCompute.some((a) => a.id === id));
    const needed = new Set(todo.flatMap((id) => board.answers.find((a) => a.id === id)!.depends_on));
    const facts = board.facts.filter((f) => needed.has(f.id)).map((f) => ({ id: f.id, key: meta.factKeys[f.id] ?? '', value: f.value, source_id: f.source_id, quote: f.quote }));
    try {
      const p = rewritePrompt(board.question, newRequirements, facts, todo.map((id) => { const a = board.answers.find((x) => x.id === id)!; return { id, previous: a.text, depends_on: a.depends_on }; }));
      const out = await completeStructured(modelDeps(d), p.system, p.user, (r) => Rewrite.parse(r));
      for (const r of out.answers) {
        const a = board.answers.find((x) => x.id === r.id);
        if (!a || !todo.includes(a.id) || recomputed.has(a.id)) continue;
        a.text = r.text;
        a.observedAt = now;
        recomputed.add(a.id);
      }
    } catch (e) {
      if (!isDegradable(e)) throw e;
      limitations.push('Affected answers could not be regenerated; they are marked stale rather than fresh.');
    }
  }
  const stale = new Set<string>([...affected].filter((id) => !recomputed.has(id)));
  setStatuses(board, stale);
  board.requirements = newRequirements;
  void extractionFailed;

  const unknown = board.answers.filter((a) => a.status === 'unknown').map((a) => a.id);
  const allAffected = new Set<string>([...affected, ...board.answers.filter((a) => a.status === 'unknown' && prevStatus.get(a.id) !== 'unknown').map((a) => a.id)]);
  const reused = board.answers.filter((a) => a.status === 'fresh' && !recomputed.has(a.id)).map((a) => a.id);
  const parts = [req.force ? `Checked ${board.sources.length} source(s): ${tally.unchanged} unchanged, ${tally.changed} changed, ${tally.failed} unreadable.` : 'Requirements edited by the user; sources were not re-checked and no external change was observed.', `${valueChanged.size} fact value(s) changed; ${recomputed.size} answer(s) recomputed, ${reused.length} reused, ${unknown.length} unknown.`];
  if (reqChanged && req.force) parts.push('Requirements were also edited by the user.');
  const last = board.revisions[board.revisions.length - 1];
  board.revisions.push({ id: `r${board.revisions.length + 1}`, parent_id: last?.id ?? null, createdAt: now, kind: req.force ? 'source_refresh' : 'requirements_edit', summary: parts.join(' ') });
  if (!req.force) limitations.push('Requirement edits do not re-check sources; evidence timestamps are unchanged.');
  if (req.force) limitations.push('Provider cache state is reported per source; content_hash equality is not proof the page is unchanged for unread parts.');

  return {
    schemaVersion: 1,
    project: 'ripple',
    mode: 'live',
    request_id: d.requestId,
    board,
    snapshot: sign(board, meta, d),
    update: { affected: [...allAffected], recomputed: [...recomputed], reused, unknown },
    trace: { retrieval, model_calls: d.budget.attempts, elapsed_ms: nowMs(d) - t0, limitations },
  };
}
