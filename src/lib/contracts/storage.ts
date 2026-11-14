// FROZEN (T01): IndexedDB layout for the browser board library (implemented by T03 in src/lib/client).
import type { Board, BoardEnvelope } from './board.ts';

export const DB_NAME = 'ripple';
export const DB_VERSION = 1;
export const STORES = { boards: 'boards', revisions: 'revisions', meta: 'meta' } as const;
/** meta store key holding the active board ID restored on reload. */
export const ACTIVE_BOARD_KEY = 'activeBoardId';

/**
 * 'observed' = last envelope came from this deployment's server with a valid snapshot.
 * 'archived-unverified' = imported/expired; must be rebuilt or refreshed live before showing fresh.
 */
export type BoardTrust = 'observed' | 'archived-unverified';

/** boards store, keyPath 'id'. */
export type BoardRecord = {
  id: string;
  title: string;
  trust: BoardTrust;
  /** Increments on each local write; writers pass the expected value to detect concurrent tabs. */
  localRevision: number;
  board: Board;
  /** Opaque signed snapshot; null for unverified imports. */
  snapshot: string | null;
  lastUpdate: BoardEnvelope['update'] | null;
  lastTrace: BoardEnvelope['trace'] | null;
  updatedAt: string;
};

/** revisions store, keyPath ['boardId','revisionId'], index 'byBoard' on boardId. Immutable once written. */
export type RevisionRecord = {
  boardId: string;
  revisionId: string;
  createdAt: string;
  board: Board;
};
