import 'server-only';
import type { Board, BoardEnvelope, CreateBoardRequest, RefreshBoardRequest, RetrievalTrace, SourceRecord } from '../contracts/board.ts';
import { PUBLIC_LIMITS } from '../contracts/board.ts';
import { answerHashFor, boardNodes, constructBoard, supportedFactIds, type LegacyMeta } from '../domain/construct.ts';
import { semanticHash, stableId, valueType } from '../domain/hash.ts';
import { answerStatuses, planRefresh, type Plan, type Strategy } from '../domain/plan.ts';
import { appendHistory, type DomainState } from '../domain/state.ts';
import { boardFactStatus, evaluateSupport } from '../domain/support.ts';
import { completeStructured, ModelFailure, type ModelDeps } from '../model/client.ts';
import { Extraction, factsOnlyPrompt, Rewrite, rewritePrompt } from '../model/extract.ts';
import { buildBoard, mapTelem, telemClient, type RunDeps } from '../server/research.ts';
import { signState, type State } from '../server/snapshots.ts';
import { acquirePages, sourceProvenance, type AcquiredPage } from './acquire.ts';
import { buildExcerpt, locateQuote, sha256, slug } from './text.ts';

const nowMs = (d: RunDeps): number => (d.now ?? Date.now)();
const asIso = (v: string | null, fallback: string): string => (v && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : fallback);
// The spread carries the injected transport/clock seams of RunDeps through unchanged.
const modelDeps = (d: RunDeps): ModelDeps => ({ ...d, provider: d.secrets.modelProvider, model: d.secrets.model, apiKey: d.secrets.modelApiKey, deadline: d.deadlineAt });
const degradable = (e: unknown): boolean => e instanceof ModelFailure || (e instanceof Error && e.message === 'RUN_TIMEOUT');

const baseLimitations = (board: Board): string[] => {
  const l = ['Facts are model-extracted and checked only for a literal quote in the fetched page; a quote shows presence, not truth.', 'Dependencies between facts and answers are model-proposed hypotheses until reviewed.', 'Freshness covers only the sources checked here, not the rest of the web.'];
  if (board.sources.some((s) => s.status === 'partial')) l.push('Some pages were truncated or could not be fully analyzed; their dependent answers have unknown freshness.');
  if (board.sources.some((s) => s.status === 'failed')) l.push('Some pages could not be read; their facts have unknown freshness (not false).');
  return l;
};

const stateOf = (board: Board, domain: DomainState, meta: LegacyMeta): State => ({
  kind: 'ripple-board-state',
  board,
  observations: Object.fromEntries(board.sources.filter((s) => s.contentHash).map((s) => [s.id, { contentHash: s.contentHash, observedAt: s.observedAt }])),
  meta: { factKeys: meta.factKeys, usesReq: meta.usesReq, domain },
});

function envelope(d: RunDeps, t0: number, board: Board, domain: DomainState, meta: LegacyMeta, update: BoardEnvelope['update'], retrieval: RetrievalTrace[], limitations: string[]): BoardEnvelope {
  return { schemaVersion: 1, project: 'ripple', mode: 'live', request_id: d.requestId, board, snapshot: signState(stateOf(board, domain, meta), d.secrets.stateSecret, nowMs(d)), update, trace: { retrieval, model_calls: d.budget.attempts, elapsed_ms: nowMs(d) - t0, limitations: retrieval.some((r) => r.status === 'succeeded:truncated') ? [...limitations, 'Some pages were truncated at 12,000 characters; quotations from the read part are retained, unseen text was not considered, and partial-source freshness remains unknown.'] : limitations } };
}

/** Create: real acquisition + literal-quote verification (research.ts), then typed domain construction with stable IDs and DNF facts. */
export async function createBoardDomain(req: CreateBoardRequest, d: RunDeps): Promise<BoardEnvelope> {
  const t0 = nowMs(d);
  const core = await buildBoard(req, d);
  const { board, domain } = constructBoard(core.board, core.meta, true);
  const at = new Date(nowMs(d)).toISOString();
  const readable = board.sources.filter((s) => s.status !== 'failed').length;
  board.revisions = [{ id: 'r1', parent_id: null, createdAt: at, kind: 'created', summary: `Created from ${readable}/${board.sources.length} readable source(s): ${board.facts.length} fact(s), ${board.answers.length} proposed answer(s).` }];
  const ids = board.answers.map((a) => a.id);
  const meta = { factKeys: core.meta.factKeys, usesReq: core.meta.usesReq };
  return envelope(d, t0, board, appendHistory(domain, { revisionId: 'r1', kind: 'created', at }), meta, { affected: ids, recomputed: ids, reused: [], unknown: board.answers.filter((a) => a.status === 'unknown').map((a) => a.id) }, core.retrieval, [...baseLimitations(board), ...core.limitations.filter((l) => /dropped|marked unknown|No answer/.test(l)), ...core.acquisitionLimitations]);
}

type Changed = { src: SourceRecord; page: AcquiredPage };

/**
 * Refresh from the signed prior observation. `treatment` regenerates only the dirty closure; `baseline` regenerates every
 * computable answer from the SAME observations/model/limits. The public routes always run treatment (API forbids overrides).
 */
export async function refreshBoardDomain(req: RefreshBoardRequest, state: State, d: RunDeps, strategy: Strategy = 'treatment'): Promise<BoardEnvelope> {
  const t0 = nowMs(d);
  const at = new Date(t0).toISOString();
  const board: Board = structuredClone(state.board);
  const dom: DomainState = structuredClone(state.meta.domain);
  const meta = state.meta;
  const reqChanged = req.requirements !== undefined && req.requirements !== board.requirements;
  const newRequirements = req.requirements ?? board.requirements;
  const retrieval: RetrievalTrace[] = [];
  const limitations = baseLimitations(board);
  const tally = { checked: 0, unchanged: 0, changed: 0, failed: 0, deleted: 0, extractions: 0 };
  const changedSources: Changed[] = [];

  // ---- 1. observe: one batch re-read of the checked sources (no_cache); failures never falsify anything ----
  if (req.force) {
    let acq: Awaited<ReturnType<typeof acquirePages>>;
    try {
      acq = await acquirePages(telemClient(d), board.sources.map((s) => s.url), d, { noCache: true });
    } catch (e) {
      mapTelem(e);
    }
    const { pages } = acq;
    retrieval.push(...acq.retrieval);
    limitations.push(...acq.limitations);
    tally.checked = board.sources.length;
    for (const src of board.sources) {
      const page = pages.find((p) => p.url === src.url);
      const ds = dom.sources[src.id]!;
      if (page?.cacheState) src.cache_state = page.cacheState;
      if (!page || page.status === 'failed') {
        ds.state = /^http_(404|410)$/.test(page?.error ?? '') ? 'deleted' : 'failed';
        src.extraction_status = 'failed';
        src.extraction_error = page?.extractionError ?? page?.error ?? 'SOURCE_UNAVAILABLE';
        src.status = 'failed'; // last good hash/excerpt/observedAt are kept: only the check failed
        tally[ds.state === 'deleted' ? 'deleted' : 'failed']++;
      } else if (sha256(page.text) === ds.contentHash) {
        ds.state = page.truncated ? 'partial' : 'ok';
        Object.assign(src, sourceProvenance(page));
        src.status = page.truncated ? 'partial' : 'succeeded';
        src.observedAt = asIso(page.fetchedAt, at);
        tally.unchanged++;
      } else {
        changedSources.push({ src, page });
        tally.changed++;
      }
    }
  }

  // ---- 2. re-extract ONLY changed pages (one model call); body edits that keep every fact add no work downstream ----
  if (changedSources.length) {
    tally.extractions++;
    try {
      const p = factsOnlyPrompt(board.question, changedSources.map((c) => ({ id: c.src.id, url: c.src.url, title: c.src.title, text: c.page.text })), PUBLIC_LIMITS.facts);
      const ext = await completeStructured(modelDeps(d), p.system, p.user, (r) => Extraction.parse(r));
      for (const { src, page } of changedSources) applySource(board, dom, meta, src, page, ext.facts.filter((f) => f.source === src.id), at, limitations);
    } catch (e) {
      if (!degradable(e)) throw e;
      // Hash is NOT advanced, so the next refresh retries; the page is unread, hence its facts are unknown.
      for (const { src } of changedSources) {
        dom.sources[src.id]!.state = 'partial';
        src.status = 'partial';
        src.extraction_status = 'historical_unrevalidated';
        src.extraction_error = 'FACT_EXTRACTION_UNAVAILABLE';
      }
      limitations.push('A changed page could not be re-extracted this time; its facts have unknown freshness until the next successful refresh.');
    }
  }

  // ---- 3. evaluate every fact from DNF support; typed semantic hash decides "changed" ----
  const changedFacts: string[] = [];
  const degradedFacts: string[] = [];
  const noteChanged: string[] = [];
  for (const bf of board.facts) {
    const f = dom.facts[bf.id]!;
    const prev = f.state;
    const res = evaluateSupport(f.supportSets, (sid) => (dom.sources[sid] ? { state: dom.sources[sid]!.state, claim: f.claims[sid] } : undefined));
    f.state = res.state;
    if (res.state === 'supported') {
      const c = res.claim!;
      if (c.hash !== f.verifiedHash) {
        if (f.verifiedHash !== null) noteChanged.push(bf.id);
        changedFacts.push(bf.id);
        f.semanticVersion++;
        f.verifiedHash = c.hash;
      }
      f.semanticHash = c.hash;
      f.type = valueType(c.value);
      bf.value = c.value as never;
      bf.quote = c.quote;
      bf.source_id = res.set![0]!;
    } else {
      if (prev === 'supported') degradedFacts.push(bf.id);
      if (res.state === 'missing') bf.quote = ''; // evidence no longer found: never keep the old claim as live evidence
    }
    bf.status = boardFactStatus(res.state);
    bf.support_sets = f.supportSets;
  }

  // ---- 4. plan: reverse dirty closure; baseline plan computed from the same observations for the cost comparison ----
  const nodes = boardNodes(board, dom);
  const planInput = {
    nodes,
    changedFacts,
    degradedFacts,
    supportedFacts: supportedFactIds(dom),
    dirtyAnswers: board.answers.filter((a) => dom.answers[a.id]!.dirty).map((a) => a.id),
    requirementUse: Object.fromEntries(board.answers.map((a) => [a.id, dom.answers[a.id]!.usesReq])),
    requirementsChanged: reqChanged,
  };
  const plan = planRefresh({ ...planInput, strategy });
  const baselinePlan: Plan = strategy === 'baseline' ? plan : planRefresh({ ...planInput, strategy: 'baseline' });

  // ---- 5. regenerate exactly plan.recompute (one batched call, dependency order) ----
  const recomputed = new Set<string>();
  if (plan.recompute.length) {
    const needed = new Set(plan.recompute.flatMap((id) => board.answers.find((a) => a.id === id)!.depends_on));
    const facts = board.facts.filter((f) => needed.has(f.id)).map((f) => ({ id: f.id, key: dom.facts[f.id]!.key, value: f.value, source_id: f.source_id, quote: f.quote }));
    try {
      const p = rewritePrompt(board.question, newRequirements, facts, plan.recompute.map((id) => { const a = board.answers.find((x) => x.id === id)!; return { id, previous: a.text, depends_on: a.depends_on }; }));
      const out = await completeStructured(modelDeps(d), p.system, p.user, (r) => Rewrite.parse(r));
      for (const r of out.answers) {
        const a = board.answers.find((x) => x.id === r.id);
        if (!a || !plan.recompute.includes(a.id) || recomputed.has(a.id)) continue;
        a.text = r.text;
        a.observedAt = at;
        recomputed.add(a.id);
      }
    } catch (e) {
      if (!degradable(e)) throw e;
      limitations.push('Affected answers could not be regenerated; they are marked stale rather than fresh.');
    }
  }

  // ---- 6. statuses: never fresh when evidence is unknown or a needed recomputation did not happen ----
  const dirty = new Set(plan.needsRecompute.filter((id) => !recomputed.has(id)));
  if (reqChanged) dom.reqVersion++;
  const status = answerStatuses(nodes, supportedFactIds(dom), dirty);
  for (const id of plan.order) {
    const a = board.answers.find((x) => x.id === id);
    if (!a) continue;
    a.status = status.get(id)!;
    const da = dom.answers[id]!;
    da.dirty = dirty.has(id);
    if (recomputed.has(id)) {
      da.version++;
      da.answerHash = answerHashFor(board, dom, id);
    }
  }
  board.requirements = newRequirements;
  const unknown = board.answers.filter((a) => a.status === 'unknown').map((a) => a.id);
  const reused = plan.reused.filter((id) => status.get(id) === 'fresh');

  // ---- 7. immutable revision (append-only list + hash-chained digest) with the cost of the check separated from recomputation ----
  const checks = req.force ? `Checked ${tally.checked} source(s): ${tally.unchanged} unchanged, ${tally.changed} changed, ${tally.failed + tally.deleted} unreadable${tally.deleted ? ` (${tally.deleted} gone)` : ''}.` : 'Requirements edited by the user; sources were not re-checked and no external change was observed.';
  const summary = `${checks} ${noteChanged.length} verified fact value(s) changed; ${recomputed.size} answer(s) recomputed, ${reused.length} reused, ${unknown.length} unknown. Cost: ${tally.checked} source check(s), ${tally.extractions} extraction call(s), ${recomputed.size} recomputation(s); refresh-all over the same observations would attempt ${baselinePlan.recompute.length}. Provider work: ${retrieval.filter((r) => r.service === 'telem').reduce((n, r) => n + (r.http_attempts ?? 0), 0)} Telem HTTP attempt(s), ${retrieval.filter((r) => r.service === 'tavily').reduce((n, r) => n + (r.http_attempts ?? 0), 0)} direct Tavily HTTP attempt(s). Extraction calls above mean model fact-extraction calls.${reqChanged && req.force ? ' Requirements were also edited by the user.' : ''}`;
  const last = state.board.revisions.at(-1);
  const rev = { id: `r${state.board.revisions.length + 1}`, parent_id: last?.id ?? null, createdAt: at, kind: req.force ? 'source_refresh' : 'requirements_edit', summary };
  board.revisions = [...state.board.revisions, rev];
  if (!req.force) limitations.push('Requirement edits do not re-check sources; evidence timestamps are unchanged.');
  else limitations.push('Provider cache state is reported per source; an equal content hash is not proof that unread parts of a page are unchanged.');
  if (strategy === 'baseline') limitations.push('BASELINE strategy: every computable answer was regenerated from the same observations.');

  return envelope(d, t0, board, appendHistory(dom, { revisionId: rev.id, kind: rev.kind, at }), meta, { affected: plan.affected, recomputed: plan.recompute.filter((id) => recomputed.has(id)), reused, unknown }, retrieval, limitations);
}

/** Apply one re-read page: update claims for existing facts, merge new keys as alternatives or new facts, rebuild the evidence excerpt. */
function applySource(board: Board, dom: DomainState, meta: LegacyMeta, src: SourceRecord, page: AcquiredPage, raw: Extraction['facts'], at: string, limitations: string[]): void {
  const mine = new Map<string, { value: string | number | boolean; quote: string; stance?: Board['facts'][number]['stance'] }>();
  for (const f of raw) {
    const quote = locateQuote(page.text, f.quote);
    const key = slug(f.key);
    if (quote && !mine.has(key)) mine.set(key, { value: f.value, quote, stance: f.stance });
  }
  const claimOf = (key: string, c: { value: unknown; quote: string }) => ({ hash: semanticHash(key, c.value), value: c.value as never, quote: c.quote });
  for (const f of Object.values(dom.facts)) {
    if (!f.supportSets.some((s) => s.includes(src.id))) continue;
    const c = mine.get(f.key);
    if (c) f.claims[src.id] = claimOf(f.key, c);
    else delete f.claims[src.id]; // the page no longer states it: missing, not deleted knowledge
    mine.delete(f.key);
  }
  for (const [key, c] of mine) {
    const existing = Object.entries(dom.facts).find(([, f]) => f.key === key);
    if (existing) {
      existing[1].supportSets.push([src.id]); // another source now speaks to the same fact: an OR alternative
      existing[1].claims[src.id] = claimOf(key, c);
    } else if (board.facts.length >= PUBLIC_LIMITS.facts) {
      limitations.push('Additional facts were found but the 10-fact board limit was reached.');
    } else {
      const id = stableId('f', key);
      if (dom.facts[id]) continue;
      dom.facts[id] = { key, type: valueType(c.value), semanticHash: semanticHash(key, c.value), verifiedHash: null, semanticVersion: 0, state: 'unknown', supportSets: [[src.id]], claims: { [src.id]: claimOf(key, c) } };
      board.facts.push({ id, value: c.value, status: 'unknown', source_id: src.id, quote: c.quote, support_sets: [[src.id]], ...(c.stance ? { stance: c.stance } : {}) });
      meta.factKeys[id] = key;
    }
  }
  const quotes = Object.values(dom.facts).flatMap((f) => (f.claims[src.id] ? [f.claims[src.id]!.quote] : []));
  const { excerpt, kept } = buildExcerpt(page.text, quotes);
  for (const f of Object.values(dom.facts)) if (f.claims[src.id] && !kept.has(f.claims[src.id]!.quote)) delete f.claims[src.id]; // evidence that does not fit the preserved excerpt is not evidence
  const ds = dom.sources[src.id]!;
  ds.contentHash = sha256(page.text);
  ds.contentVersion++;
  ds.state = page.truncated ? 'partial' : 'ok';
  Object.assign(src, sourceProvenance(page));
  src.excerpt = excerpt || page.text.slice(0, 300);
  src.contentHash = ds.contentHash;
  src.observedAt = asIso(page.fetchedAt, at);
  src.status = page.truncated ? 'partial' : 'succeeded';
}
