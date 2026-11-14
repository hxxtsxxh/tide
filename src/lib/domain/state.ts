import { z } from 'zod';
import { canonicalJson, sha256 } from '../search/text.ts';

const Id = z.string().min(1).max(64);
const SourceState = z.enum(['ok', 'partial', 'failed', 'deleted']);

/**
 * Server-side domain bookkeeping that rides INSIDE the HMAC-signed snapshot (browser treats it as opaque).
 * Facts: `semanticHash` = last known typed value, `verifiedHash` = value at last complete support; `semanticVersion` counts
 * verified value changes. Sources: `contentVersion` counts body changes (a body edit is not a fact change).
 */
export const DomainState = z.object({
  v: z.literal(1),
  /** Separate input version: user requirement edits bump this, never a source/fact version. */
  reqVersion: z.int().min(0),
  sources: z.record(Id, z.object({ contentHash: z.string(), contentVersion: z.int().min(0), state: SourceState })),
  facts: z.record(
    Id,
    z.object({
      key: z.string(),
      type: z.enum(['string', 'number', 'boolean', 'null', 'json']),
      semanticHash: z.string(),
      verifiedHash: z.string().nullable(),
      semanticVersion: z.int().min(0),
      state: z.enum(['supported', 'conflicting', 'unknown', 'missing', 'deleted']),
      supportSets: z.array(z.array(Id)),
      claims: z.record(Id, z.object({ hash: z.string(), value: z.json(), quote: z.string() })),
    }),
  ),
  answers: z.record(Id, z.object({ answerHash: z.string(), version: z.int().min(1), usesReq: z.boolean().nullable(), dirty: z.boolean() })),
  /** Append-only, hash-chained digest of every revision (bounded to the last 20). */
  history: z.array(z.object({ revisionId: z.string(), kind: z.string(), at: z.string(), digest: z.string(), parent: z.string().nullable(), sources: z.record(Id, z.string()), facts: z.record(Id, z.string()), answers: z.record(Id, z.string()) })).max(20),
});
export type DomainState = z.infer<typeof DomainState>;

const short = (h: string): string => h.slice(0, 16);

/** Returns a NEW state with one history entry chained to the previous digest; never mutates existing entries. */
export function appendHistory(d: DomainState, e: { revisionId: string; kind: string; at: string }): DomainState {
  const parent = d.history.at(-1)?.digest ?? null;
  const sources = Object.fromEntries(Object.entries(d.sources).map(([k, v]) => [k, short(v.contentHash)]));
  const facts = Object.fromEntries(Object.entries(d.facts).map(([k, v]) => [k, `${short(v.semanticHash)}:${v.state}:v${v.semanticVersion}`]));
  const answers = Object.fromEntries(Object.entries(d.answers).map(([k, v]) => [k, `${short(v.answerHash)}:v${v.version}`]));
  const digest = sha256(canonicalJson({ parent, ...e, reqVersion: d.reqVersion, sources, facts, answers }));
  return { ...d, history: [...d.history, { ...e, digest, parent, sources, facts, answers }].slice(-20) };
}

/** True iff the chain links verify: every entry's parent is the previous entry's digest. */
export const historyLinked = (d: DomainState): boolean => d.history.every((h, i) => h.parent === (d.history[i - 1]?.digest ?? (i === 0 ? h.parent : null)));
