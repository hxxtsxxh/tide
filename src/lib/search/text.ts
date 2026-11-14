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
// Long pages (Tide non-technical modes) get a larger excerpt so every verified quote can be kept; short pages are unchanged.
export function buildExcerpt(normalizedText: string, quotes: string[], maxChars = normalizedText.length > 12_000 ? 8000 : 3000, margin = 120): { excerpt: string; kept: Set<string> } {
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

const STOP = new Set('a an and are as at be by can do does for from has have how i in is it its of on or should that the this to was what when which why will with within you your'.split(' '));
const terms = (s: string): string[] => (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 2 && !STOP.has(t)).map((t) => t.replace(/(ies|es|s)$/, ''));

/**
 * Long-page passage selection for the model prompt. Returns the text unchanged when it fits; otherwise the
 * most question-relevant ~700-char windows (literal substrings, kept in page order) up to `maxChars`.
 * Quotes are still verified against the FULL fetched text, never against this selection.
 */
export function selectPassages(text: string, question: string, maxChars = 12_000, windowChars = 700): string {
  if (text.length <= maxChars) return text;
  const q = new Set(terms(question));
  const windows: { start: number; end: number; score: number }[] = [];
  for (let start = 0; start < text.length; ) {
    let end = Math.min(text.length, start + windowChars);
    const stop = text.lastIndexOf('. ', end);
    if (end < text.length && stop > start + windowChars / 2) end = stop + 1; // end on a sentence boundary
    const words = terms(text.slice(start, end));
    const hits = words.filter((w) => q.has(w));
    const score = hits.length + 2 * new Set(hits).size; // distinct question terms matter most
    windows.push({ start, end, score });
    start = end;
  }
  const chosen: typeof windows = [];
  let used = 0;
  for (const w of [...windows].sort((a, b) => b.score - a.score || a.start - b.start)) {
    if (used + (w.end - w.start) + 3 > maxChars) continue;
    chosen.push(w);
    used += w.end - w.start + 3;
  }
  return chosen
    .sort((a, b) => a.start - b.start)
    .map((w) => text.slice(w.start, w.end).trim())
    .join(' … ');
}

/** Deterministic backstop for the extraction prompt: disclaimers, navigation and cookie/subscription text are never evidence. */
const BOILERPLATE = [
  /past performance (is|does) not (necessarily )?(indicative|a guarantee|guarantee|indicate)/i,
  /(does|do) not (guarantee|ensure|assure) (any )?(investment )?(returns?|profits?|results?)/i,
  /eliminate (the )?risk of loss/i,
  /\bnot (intended as |to be construed as |)(financial|investment|legal|medical|tax) advice\b/i,
  /for (general )?informational purposes only/i,
  /consult (with )?(your|a) (doctor|physician|financial (advisor|adviser)|professional)/i,
  /all rights reserved/i,
  /\b(accept|manage|use of) (all )?cookies\b|\bthis (site|website) uses cookies\b/i,
  /\b(privacy policy|terms of (use|service))\b/i,
  /\b(subscribe to|sign up for) (our|the) newsletter\b/i,
  /\b(skip|jump) to (main )?content\b/i,
];
export const isBoilerplate = (quote: string): boolean => BOILERPLATE.some((re) => re.test(quote));
