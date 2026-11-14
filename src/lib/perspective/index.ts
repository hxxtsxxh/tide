// Perspective layer: pure TS port of PerspectiveSearch ps/scoring.py + ps/ranking.py over a Tide board.
// Scores are transparent heuristics, not probabilities of truth. No network, no model calls.
import type { Board, FactRecord } from '../contracts/board.ts';
import { HOST_TIERS, TIER_INFO } from '../modes.ts';

export type Stance = 'supports' | 'opposes' | 'neutral';
export type Weights = { authority: number; popularity: number; time: number };
export const DEFAULT_WEIGHTS: Weights = { authority: 70, popularity: 20, time: 60 }; // ps/models.py Weights defaults
export type Verdict = 'Leans yes' | 'Leans no' | 'Contested' | 'Insufficient evidence';
export type Metric = keyof Weights;

export const stanceOf = (f: Pick<FactRecord, 'stance'>): Stance => f.stance ?? 'neutral';

/**
 * Authority by domain tier. shortcut: PS scores authority with a per-document LLM rubric (ps/scoring.py
 * authority_score); Ripple boards carry no rubric, so Tide uses a fixed host tier until a rubric is extracted.
 */
const TIERS: [RegExp, number, string][] = [
  [/\.(gov|mil)(\.[a-z]{2})?$|\.gov\.[a-z]{2}$/, 95, 'Government'],
  [/\.edu$|\.ac\.[a-z]{2}$/, 90, 'Academic'],
  [/(^|\.)(w3\.org|ietf\.org|rfc-editor\.org|whatwg\.org|iso\.org)$/, 90, 'Standards body'],
  [/^(docs|developer|developers|learn|support|help)\.|(^|\.)(developer\.mozilla\.org|nodejs\.org|react\.dev|nextjs\.org|docs\.python\.org|postgresql\.org|redis\.io)$/, 85, 'Official documentation'],
  [/(^|\.)(github\.com|gitlab\.com|npmjs\.com|pypi\.org)$/, 70, 'Code host'],
  [/(^|\.)(medium\.com|dev\.to|substack\.com|reddit\.com|quora\.com|stackoverflow\.com|hashnode\.dev)$/, 40, 'Community / blog'],
];
export function authorityOf(url: string): { score: number; tier: string } {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return { score: 50, tier: 'Unknown host' };
  }
  const curated = HOST_TIERS[host]; // mode registry hint wins over generic host patterns
  if (curated) return { score: TIER_INFO[curated].score, tier: TIER_INFO[curated].label };
  for (const [re, score, tier] of TIERS) if (re.test(host)) return { score, tier };
  return { score: 60, tier: 'Vendor / general web' };
}

type Vote = Stance | 'mixed';
/** One vote per independent origin (source page); contradictory stances from one origin count once, as mixed. */
function originVotes(facts: FactRecord[]): Map<string, Vote> {
  const votes = new Map<string, Vote>();
  for (const f of facts) {
    const s = stanceOf(f);
    if (s === 'neutral' || f.status === 'unknown') continue;
    const prev = votes.get(f.source_id);
    votes.set(f.source_id, prev && prev !== s ? 'mixed' : s);
  }
  return votes;
}

/** ps/scoring.py claim_scores popularity: share of >=2 independent origins agreeing with this stance. */
export function popularityOf(target: Stance, facts: FactRecord[]): number | null {
  const votes = [...originVotes(facts).values()];
  if (votes.length < 2 || target === 'neutral') return null;
  return (100 * votes.filter((v) => v === target).length) / votes.length;
}

/**
 * ps/scoring.py time consistency: coverage-scaled weakest period, `100 * min(buckets/3, 1) * min(agreement)`.
 * Periods are the board's saved revisions (oldest->newest); needs >=2 periods and >=3 origin observations.
 */
export function timeOf(target: Stance, periods: FactRecord[][]): number | null {
  if (target === 'neutral') return null;
  const fractions: number[] = [];
  let observations = 0;
  for (const facts of periods) {
    const votes = [...originVotes(facts).values()];
    if (!votes.length) continue;
    observations += votes.length;
    fractions.push(votes.filter((v) => v === target).length / votes.length);
  }
  if (fractions.length < 2 || observations < 3) return null;
  return 100 * Math.min(fractions.length / 3, 1) * Math.min(...fractions);
}

/** ps/ranking.py effective_weights: all-zero weights restore the defaults. */
export const effectiveWeights = (w: Weights): Weights => (w.authority + w.popularity + w.time === 0 ? { ...DEFAULT_WEIGHTS } : { ...w });

/** ps/ranking.py score_document: weighted mean over available metrics, renormalized; coverage reported separately. */
export function weightedScore(metrics: Record<Metric, number | null>, weights: Weights): { score: number | null; coverage: number; contributing: Metric[] } {
  const w = effectiveWeights(weights);
  const keys: Metric[] = ['authority', 'popularity', 'time'];
  const active = keys.filter((k) => metrics[k] !== null && w[k] > 0);
  const available = active.reduce((s, k) => s + w[k], 0);
  const total = keys.reduce((s, k) => s + w[k], 0);
  return {
    score: available ? active.reduce((s, k) => s + w[k] * (metrics[k] as number), 0) / available : null,
    coverage: total ? available / total : 0,
    contributing: active,
  };
}

export type ScoredFact = { fact: FactRecord; stance: Stance; url: string; tier: string; metrics: Record<Metric, number | null>; basis: { popularity: string; time: string } };

/**
 * Tide agreement for EVERY fact once a board has >=2 readable sources (PS popularity needs >=2 stance-taking origins,
 * which most single-source claims never reach). Laplace-smoothed share of other origins that corroborate vs contest:
 * 100*(1+agree)/(2+agree+disagree). Corroboration = the same fact verified on another source (merged support sets)
 * or another origin taking the same stance; contest = the opposite stance from another origin, or a value conflict.
 * One uncorroborated, uncontested source -> 50.
 */
export function agreementOf(fact: FactRecord, board: Board): { score: number | null; basis: string } {
  const readable = new Set(board.sources.filter((s) => s.status !== 'failed').map((s) => s.id));
  if (readable.size < 2) return { score: null, basis: 'needs two or more sources' };
  const stance = stanceOf(fact);
  const own = new Set((fact.support_sets ?? [[fact.source_id]]).flat());
  let agree = Math.max(0, own.size - 1);
  let disagree = fact.status === 'conflicting' ? 1 : 0;
  let mixed = 0;
  if (stance !== 'neutral') {
    for (const [origin, vote] of originVotes(board.facts)) {
      if (own.has(origin)) continue;
      if (vote === stance) agree++;
      else if (vote === 'mixed') (agree += 0.5), (disagree += 0.5), mixed++;
      else disagree++;
    }
  }
  const score = (100 * (1 + agree)) / (2 + agree + disagree);
  const clear = (n: number) => n - mixed / 2;
  const parts = [clear(agree) ? `${clear(agree)} corroborating` : '', clear(disagree) ? `${clear(disagree)} contesting` : '', mixed ? `${mixed} mixed` : ''].filter(Boolean);
  const basis = parts.length ? `${parts.join(', ')} source${agree + disagree === 1 ? '' : 's'}` : 'uncorroborated, uncontested';
  return { score, basis };
}

/**
 * Time on a fresh board (one observation): a recency proxy from the newest year in the source URL, else the latest
 * year cited in the title/excerpt; 100 for the current year, -8 per year, floor 20. No year found -> 50, labelled.
 */
export function recencyOf(src: { url: string; title?: string; excerpt?: string } | undefined, nowYear = new Date().getUTCFullYear()): { score: number; basis: string } {
  if (!src) return { score: 50, basis: 'single observation' };
  const valid = (y: number) => y >= 1900 && y <= nowYear;
  const fromUrl = (src.url.match(/\/((?:19|20)\d{2})\//g) ?? []).map((m) => Number(m.slice(1, 5))).filter(valid);
  const fromText = (`${src.title ?? ''} ${src.excerpt ?? ''}`.match(/\b(?:19|20)\d{2}\b/g) ?? []).map(Number).filter(valid);
  const year = fromUrl.length ? Math.max(...fromUrl) : fromText.length ? Math.max(...fromText) : null;
  if (year === null) return { score: 50, basis: 'single observation, no date found' };
  return { score: Math.max(20, 100 - 8 * (nowYear - year)), basis: `recency proxy: ${fromUrl.length ? 'URL dated' : 'latest year cited'} ${year}` };
}

/**
 * Per-quote evidence adjustment on top of the publisher tier (a deterministic slice of PS's authority rubric):
 * +6 for traceable data (a number or statistic in the quote), -8 for hedged or second-hand attribution.
 */
export function quoteEvidence(quote: string): { delta: number; label: string } {
  const data = /\d/.test(quote.replace(/\b(?:19|20)\d{2}\b/g, ''));
  const hedged = /\b(some|critics|skeptics|proponents|reportedly|allegedly|may|might|could|believe[sd]?|claim(?:s|ed)?|argue[sd]?|say|says|said)\b/i.test(quote);
  const delta = (data ? 6 : 0) - (hedged ? 8 : 0);
  return { delta, label: [data ? '+data' : '', hedged ? '−hedged' : ''].filter(Boolean).join(' ') };
}

/** Latest plausible year cited in the quote itself (evidence recency), if any. */
export function quoteYear(quote: string, nowYear = new Date().getUTCFullYear()): number | null {
  const ys = (quote.match(/\b(?:19|20)\d{2}\b/g) ?? []).map(Number).filter((y) => y >= 1900 && y <= nowYear);
  return ys.length ? Math.max(...ys) : null;
}

/** Weight-independent scores, computed once per board (sliders only rerank). */
export function scoreBoard(board: Board, history: Board[] = [], nowYear?: number): ScoredFact[] {
  const periods = [...history, board].map((b) => b.facts);
  const uniquePeriods = periods.filter((p, i) => i === 0 || JSON.stringify(p) !== JSON.stringify(periods[i - 1]));
  return board.facts
    .filter((f) => f.status !== 'unknown')
    .map((fact) => {
      const stance = stanceOf(fact);
      const src = board.sources.find((s) => s.id === fact.source_id);
      const a = authorityOf(src?.url ?? '');
      const agreement = agreementOf(fact, board);
      // After rechecks, PS cross-revision time consistency; on a single observation, the labelled recency proxy.
      const consistency = timeOf(stance, uniquePeriods);
      const year = quoteYear(fact.quote, nowYear);
      const ny = nowYear ?? new Date().getUTCFullYear();
      const recency = year !== null ? { score: Math.max(20, 100 - 8 * (ny - year)), basis: `recency proxy: quote cites ${year}` } : recencyOf(src, nowYear);
      const ev = quoteEvidence(fact.quote);
      return {
        fact,
        stance,
        url: src?.url ?? '',
        tier: ev.label ? `${a.tier} ${ev.label}` : a.tier,
        metrics: { authority: Math.max(0, Math.min(100, a.score + ev.delta)), popularity: agreement.score, time: consistency ?? recency.score },
        basis: { popularity: agreement.basis, time: consistency !== null ? 'consistency across saved revisions' : recency.basis },
      };
    });
}

export type RankedFact = ScoredFact & { score: number | null; coverage: number; contributing: Metric[] };

/** Pure rerank: deterministic tie-break by fact id, unscorable facts last. */
export function rank(scored: ScoredFact[], weights: Weights): RankedFact[] {
  return scored
    .map((s) => ({ ...s, ...weightedScore(s.metrics, weights) }))
    .sort((x, y) => (y.score ?? -1) - (x.score ?? -1) || x.fact.id.localeCompare(y.fact.id, 'en', { numeric: true }));
}

export type VerdictResult = { verdict: Verdict; support: number; oppose: number; explanation: string };
/** Weighted supporting vs opposing evidence. Neutral facts never vote. */
export function verdictOf(ranked: RankedFact[]): VerdictResult {
  let support = 0,
    oppose = 0,
    nS = 0,
    nO = 0;
  for (const r of ranked) {
    if (r.score === null) continue;
    if (r.stance === 'supports') (support += r.score), nS++;
    if (r.stance === 'opposes') (oppose += r.score), nO++;
  }
  const total = support + oppose;
  const counts = `${nS} supporting, ${nO} opposing quote${nS + nO === 1 ? '' : 's'}`;
  if (nS + nO === 0 || total < 50) return { verdict: 'Insufficient evidence', support, oppose, explanation: `No weighted stance-bearing evidence yet (${counts}).` };
  const share = support / total;
  const pct = Math.round(share * 100);
  if (share >= 0.6) return { verdict: 'Leans yes', support, oppose, explanation: `${pct}% of weighted evidence supports a yes (${counts}).` };
  if (share <= 0.4) return { verdict: 'Leans no', support, oppose, explanation: `${100 - pct}% of weighted evidence opposes (${counts}).` };
  return { verdict: 'Contested', support, oppose, explanation: `Weighted evidence is split ${pct}/${100 - pct} (${counts}).` };
}

export const GRID = [0, 50, 100];
export type Sensitivity = { stable: boolean; holds: number; lenses: number; flippers: Metric[]; alternatives: Verdict[] };
/** Sweep every lens on a {0,50,100}^3 grid (all-zero skipped: it equals the defaults) and name the weights whose change alone flips the verdict. */
export function sensitivity(scored: ScoredFact[], weights: Weights): Sensitivity {
  const current = verdictOf(rank(scored, weights)).verdict;
  let holds = 0,
    lenses = 0;
  const alternatives = new Set<Verdict>();
  for (const authority of GRID)
    for (const popularity of GRID)
      for (const time of GRID) {
        if (authority + popularity + time === 0) continue;
        lenses++;
        const v = verdictOf(rank(scored, { authority, popularity, time })).verdict;
        if (v === current) holds++;
        else alternatives.add(v);
      }
  const flippers = (['authority', 'popularity', 'time'] as Metric[]).filter((k) => GRID.some((g) => verdictOf(rank(scored, { ...weights, [k]: g })).verdict !== current));
  return { stable: holds === lenses, holds, lenses, flippers, alternatives: [...alternatives] };
}
