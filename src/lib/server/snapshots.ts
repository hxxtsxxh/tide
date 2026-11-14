import 'server-only';
import { z } from 'zod';
import { Board as BoardSchema, PUBLIC_LIMITS, type SignedBoardState } from '../contracts/board.ts';
import { boardNodes, constructBoard, type LegacyMeta } from '../domain/construct.ts';
import { buildGraph } from '../domain/graph.ts';
import { DomainState } from '../domain/state.ts';
import { ApiError } from './guarded.ts';
import { normalizeSourceUrl, signSnapshot, verifySnapshot } from './guards.ts';

export const SNAPSHOT_TTL_S = 7 * 86400;
export const STATE_KIND = 'ripple-board-state';

/** The full signed server state: the board, the latest observations AND the typed domain history. */
export type State = SignedBoardState & { meta: LegacyMeta & { domain: DomainState } };

const StateSchema = z.object({
  kind: z.literal(STATE_KIND),
  board: BoardSchema,
  observations: z.record(z.string(), z.object({ contentHash: z.string(), observedAt: z.string() })).optional(),
  meta: z.object({ factKeys: z.record(z.string(), z.string()), usesReq: z.record(z.string(), z.boolean()), domain: DomainState.optional() }).optional(),
});

export function signState(state: State, secret: string, nowMs: number): string {
  return signSnapshot(state, secret, Math.floor(nowMs / 1000), SNAPSHOT_TTL_S);
}

const invalid = (why: string): never => {
  throw new ApiError('REVALIDATION_REQUIRED', `This snapshot ${why}. Rebuild the board from its question and URLs.`);
};

/**
 * Verify HMAC/expiry, schema, graph and domain consistency and the CURRENT source policy. Network-free; run before quota is spent.
 * Snapshots written before domain state existed are adopted (IDs preserved), never trusted for fields they never signed.
 */
export function openState(token: string, secret: string, hosts: readonly string[], now?: number): State {
  let data: unknown;
  try {
    data = verifySnapshot(token, secret, now);
  } catch {
    return invalid('could not be verified (expired, altered, or from another deployment)');
  }
  const parsed = StateSchema.safeParse(data);
  if (!parsed.success) return invalid('has an unsupported structure');
  let { board } = parsed.data;
  const meta = parsed.data.meta ?? { factKeys: {}, usesReq: {} };
  let domain = meta.domain;
  try {
    if (!domain) ({ board, domain } = constructBoard(board, meta, false));
    for (const id of [...board.facts.map((f) => f.id)]) if (!domain.facts[id]) throw new Error('FACT_STATE_MISSING');
    for (const id of board.answers.map((a) => a.id)) if (!domain.answers[id]) throw new Error('ANSWER_STATE_MISSING');
    for (const id of board.sources.map((s) => s.id)) if (!domain.sources[id]) throw new Error('SOURCE_STATE_MISSING');
    // buildGraph rejects duplicate/dangling/self/cyclic structure and >40 nodes, across sources, facts and answers.
    buildGraph(boardNodes(board, domain), PUBLIC_LIMITS.nodes);
  } catch {
    return invalid('has an invalid dependency graph or inconsistent evidence state');
  }
  for (const s of board.sources) {
    try {
      normalizeSourceUrl(s.url, hosts);
    } catch {
      throw new ApiError('SOURCE_NOT_ALLOWED', 'A source in this board is no longer on a supported host.');
    }
  }
  return { kind: STATE_KIND, board, observations: parsed.data.observations, meta: { factKeys: meta.factKeys, usesReq: meta.usesReq, domain: domain! } };
}
