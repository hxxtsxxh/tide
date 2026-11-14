import { canonicalJson, normalizeWs, sha256 } from '../search/text.ts';

export type ValueType = 'string' | 'number' | 'boolean' | 'null' | 'json';

export const valueType = (v: unknown): ValueType => (v === null ? 'null' : typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? (typeof v as ValueType) : 'json');

/** Meaning-preserving canonical form: only whitespace in strings is normalized (never case, units or digits); -0 is 0. */
function canon(v: unknown): unknown {
  if (typeof v === 'string') return normalizeWs(v);
  if (typeof v === 'number') return Object.is(v, -0) ? 0 : v;
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, canon(x)]));
  return v;
}

/** Typed semantic hash of a fact value: the number 7 and the string "7" are different facts; page cosmetics are not. */
export const semanticHash = (key: string, value: unknown): string => sha256(canonicalJson({ k: key, t: valueType(value), v: canon(value) }));

/** Content hash of a page body (documented whitespace normalization happens upstream). Never a semantic identity. */
export const contentHash = (text: string): string => sha256(text);

/** Answer version identity: its text plus the exact dependency versions it was generated from. */
export const answerHash = (text: string, deps: { id: string; hash: string }[]): string =>
  sha256(canonicalJson({ text: normalizeWs(text), deps: [...deps].sort((a, b) => a.id.localeCompare(b.id)) }));

/** Stable semantic IDs: derived from what a node *is*, never from list position. */
export const stableId = (prefix: 's' | 'f' | 'a', ...parts: string[]): string => `${prefix}_${sha256(parts.join('\u0000')).slice(0, 8)}`;
