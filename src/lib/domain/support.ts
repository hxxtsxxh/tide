/** Per-source state of ONE observation of a fact. */
export type SourceState = 'ok' | 'partial' | 'failed' | 'deleted';
export type Claim = { hash: string; value: unknown; quote: string };
export type SourceObservation = { state: SourceState; /** What this source says about the fact, when it was read and the quote verified. */ claim?: Claim };

export type FactState = 'supported' | 'conflicting' | 'unknown' | 'missing' | 'deleted';
export type SupportResult = { state: FactState; /** Winning claim and the support set that carries it (supported only). */ claim?: Claim; set?: string[] };

/**
 * DNF support: `sets` are alternatives (OR); sources inside a set are ALL required (AND).
 * - supported: some complete set (every source ok and verified) agrees on one value and no ok source in any set disagrees.
 * - conflicting: ok sources assert different values — no definitive support, even if a set is complete.
 * - unknown: no complete set, but a failed/partial read could still complete one (freshness unknown, the fact is NOT false).
 * - deleted: every alternative is blocked by a source that is gone.
 * - missing: sources were read fine but no longer carry the fact.
 */
export function evaluateSupport(sets: string[][], obs: (sourceId: string) => SourceObservation | undefined): SupportResult {
  const alive = sets.filter((s) => s.length > 0);
  if (!alive.length) return { state: 'missing' };
  const get = (id: string): SourceObservation => obs(id) ?? { state: 'failed' };
  const claims = new Map<string, Claim>();
  for (const id of new Set(alive.flat())) {
    const o = get(id);
    if (o.state === 'ok' && o.claim) claims.set(o.claim.hash, o.claim);
  }
  if (claims.size > 1) return { state: 'conflicting' };
  const complete = alive.find((s) => s.every((id) => get(id).state === 'ok' && get(id).claim));
  if (complete) return { state: 'supported', claim: get(complete[0]!).claim!, set: complete };
  // A set can still be completed by a recheck only if none of its sources is gone or read-but-silent.
  const rescuable = alive.some((s) => s.every((id) => get(id).state !== 'deleted' && !(get(id).state === 'ok' && !get(id).claim)) && s.some((id) => ['failed', 'partial'].includes(get(id).state)));
  if (rescuable) return { state: 'unknown' };
  return alive.every((s) => s.some((id) => get(id).state === 'deleted')) ? { state: 'deleted' } : { state: 'missing' };
}

/** Board contract only has supported|conflicting|unknown; missing/deleted are explicit inside the signed domain state. */
export const boardFactStatus = (s: FactState): 'supported' | 'conflicting' | 'unknown' => (s === 'supported' || s === 'conflicting' ? s : 'unknown');
