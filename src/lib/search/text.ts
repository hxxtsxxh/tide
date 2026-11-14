import { createHash } from 'node:crypto';

export const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/** The only documented normalization: collapse whitespace runs (incl. NBSP) to one space and trim. */
export const normalizeWs = (s: string): string => s.replace(/[\s ]+/g, ' ').trim();

/** Recursive key-sorted compact JSON (contracts/IDENTITY.md). Rejects undefined/NaN/Infinity. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('NON_FINITE_NUMBER');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== undefined) {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
  }
  throw new Error('UNSERIALIZABLE_VALUE');
}

/** Returns the whitespace-normalized quote iff it occurs literally in already-normalized `text`. */
export function locateQuote(normalizedText: string, quote: string): string | null {
  const q = normalizeWs(quote);
  return q.length >= 6 && q.length <= 400 && normalizedText.includes(q) ? q : null;
}

/**
 * Evidence excerpt: literal windows of the page around the verified quotes (never the whole page).
 * Every quote in `kept` is a literal substring of the returned excerpt.
 */
export function buildExcerpt(normalizedText: string, quotes: string[], maxChars = 3000, margin = 120): { excerpt: string; kept: Set<string> } {
  const spans: { s: number; e: number; q: string }[] = [];
  for (const q of quotes) {
    const i = normalizedText.indexOf(q);
    if (i >= 0) spans.push({ s: Math.max(0, i - margin), e: Math.min(normalizedText.length, i + q.length + margin), q });
  }
  spans.sort((a, b) => a.s - b.s);
  const merged: { s: number; e: number; qs: string[] }[] = [];
  for (const sp of spans) {
    const last = merged[merged.length - 1];
    if (last && sp.s <= last.e) {
      last.e = Math.max(last.e, sp.e);
      last.qs.push(sp.q);
    } else merged.push({ s: sp.s, e: sp.e, qs: [sp.q] });
  }
  const parts: string[] = [];
  const kept = new Set<string>();
  let used = 0;
  for (const m of merged) {
    const piece = normalizedText.slice(m.s, m.e);
    if (used + piece.length > maxChars) continue;
    parts.push(piece);
    used += piece.length + 3;
    m.qs.forEach((q) => kept.add(q));
  }
  return { excerpt: parts.join(' … '), kept };
}

export const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'fact';
