import {
  ACTIVE_BOARD_KEY,
  DB_NAME,
  DB_VERSION,
  STORES,
  type BoardRecord,
  type RevisionRecord,
} from "../contracts/storage.ts";
import {
  ARCHIVE_FORMAT,
  ARCHIVE_MAX_BYTES,
  ARCHIVE_MAX_REVISIONS,
  type BoardArchive,
  type BoardEnvelope,
} from "../contracts/board.ts";

export type ReviewNote = {
  state: "reviewed" | "disputed";
  note: string;
  revisionId: string;
};
export type ReviewNotes = Record<string, ReviewNote>;
export class StorageConflict extends Error {
  constructor() {
    super(
      "Another tab changed this board. Reload the saved board before continuing. Your current view has not overwritten it.",
    );
  }
}
export function storageMessage(error: unknown) {
  if (error instanceof StorageConflict) return error.message;
  if (error instanceof Error && /quota/i.test(error.name))
    return "Browser storage is full. Export your current board, then remove old boards or free space. Your previous saved revision is preserved.";
  return error instanceof Error
    ? error.message
    : "Browser storage is unavailable. Export your board before closing this page.";
}

let dbPromise: Promise<IDBDatabase> | undefined;
function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(
        new Error(
          "Browser storage is unavailable. Boards will not survive closing this page; export a copy.",
        ),
      );
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Additive v1 migration: do not delete older stores or erase a user's backup.
      if (!db.objectStoreNames.contains(STORES.boards))
        db.createObjectStore(STORES.boards, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORES.revisions)) {
        const s = db.createObjectStore(STORES.revisions, {
          keyPath: ["boardId", "revisionId"],
        });
        s.createIndex("byBoard", "boardId");
      }
      if (!db.objectStoreNames.contains(STORES.meta))
        db.createObjectStore(STORES.meta);
    };
    req.onerror = () =>
      reject(
        new Error(
          "Could not open browser storage. Export a copy before leaving.",
        ),
      );
    req.onblocked = () =>
      reject(
        new Error(
          "Storage upgrade is blocked by another tab. Close older Ripple tabs and reload.",
        ),
      );
    req.onsuccess = () => {
      req.result.onversionchange = () => {
        req.result.close();
        dbPromise = undefined;
      };
      resolve(req.result);
    };
  }).catch((e) => {
    dbPromise = undefined;
    throw e;
  });
  return dbPromise;
}
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function complete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(tx.error ?? new Error("Storage transaction was cancelled."));
    tx.onerror = () => {
      /* abort handles failure */
    };
  });
}
const TAB_ID = Math.random().toString(36).slice(2);
function announce() {
  if (typeof BroadcastChannel !== "undefined") {
    const c = new BroadcastChannel("ripple-library");
    c.postMessage({ sender: TAB_ID });
    c.close();
  }
}
export function watchLibrary(onChange: () => void) {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel("ripple-library");
  channel.onmessage = (event) => {
    if (event.data?.sender !== TAB_ID) onChange();
  };
  return () => channel.close();
}

export async function loadLibrary() {
  const db = await openDB();
  const tx = db.transaction([STORES.boards, STORES.meta], "readonly");
  const done = complete(tx);
  const [boards, activeId] = await Promise.all([
    request(tx.objectStore(STORES.boards).getAll()) as Promise<BoardRecord[]>,
    request(tx.objectStore(STORES.meta).get(ACTIVE_BOARD_KEY)) as Promise<
      string | undefined
    >,
  ]);
  await done;
  return {
    boards: boards.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    activeId,
  };
}
export async function setActiveBoard(id: string | null) {
  const db = await openDB();
  const tx = db.transaction(STORES.meta, "readwrite");
  const done = complete(tx);
  if (id) tx.objectStore(STORES.meta).put(id, ACTIVE_BOARD_KEY);
  else tx.objectStore(STORES.meta).delete(ACTIVE_BOARD_KEY);
  await done;
}
export async function getRevisions(id: string): Promise<RevisionRecord[]> {
  const db = await openDB();
  const tx = db.transaction(STORES.revisions, "readonly");
  const done = complete(tx);
  const records = (await request(
    tx.objectStore(STORES.revisions).index("byBoard").getAll(id),
  )) as RevisionRecord[];
  await done;
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function getReviews(id: string): Promise<ReviewNotes> {
  const db = await openDB();
  const tx = db.transaction(STORES.meta, "readonly");
  const done = complete(tx);
  const notes = await request(tx.objectStore(STORES.meta).get("reviews:" + id));
  await done;
  return notes ?? {};
}

export function fromEnvelope(envelope: BoardEnvelope): BoardRecord {
  return {
    id: envelope.board.id,
    title: envelope.board.title,
    trust: "observed",
    localRevision: 0,
    board: envelope.board,
    snapshot: envelope.snapshot,
    lastUpdate: envelope.update,
    lastTrace: envelope.trace,
    updatedAt: new Date().toISOString(),
  };
}

/** One readwrite transaction owns revision compare, immutable history and active pointer. */
export async function saveBoard(
  record: BoardRecord,
  expectedRevision: number | null,
  importedRevisions: BoardArchive["revisions"] = [],
): Promise<BoardRecord> {
  const db = await openDB();
  const tx = db.transaction(
    [STORES.boards, STORES.revisions, STORES.meta],
    "readwrite",
  );
  let failure: Error | null = null;
  const done = complete(tx).catch((e) => {
    throw failure ?? e;
  });
  const boards = tx.objectStore(STORES.boards),
    history = tx.objectStore(STORES.revisions);
  let saved: BoardRecord = record;
  const read = boards.get(record.id);
  read.onsuccess = () => {
    const current = read.result as BoardRecord | undefined;
    if ((current?.localRevision ?? null) !== expectedRevision) {
      failure = new StorageConflict();
      tx.abort();
      return;
    }
    saved = { ...record, localRevision: (current?.localRevision ?? 0) + 1 };
    boards.put(saved);
    tx.objectStore(STORES.meta).put(record.id, ACTIVE_BOARD_KEY);
    const latest = record.board.revisions.at(-1);
    const entries: RevisionRecord[] = (importedRevisions ?? []).map((r) => ({
      boardId: record.id,
      ...r,
    }));
    if (latest && !entries.some((e) => e.revisionId === latest.id))
      entries.push({
        boardId: record.id,
        revisionId: latest.id,
        createdAt: latest.createdAt,
        board: record.board,
      });
    for (const entry of entries) {
      const previous = history.get([entry.boardId, entry.revisionId]);
      previous.onsuccess = () => {
        if (previous.result) {
          if (
            JSON.stringify(previous.result.board) !==
            JSON.stringify(entry.board)
          ) {
            failure = new Error(
              "Revision identity conflict. Export the current board before rebuilding.",
            );
            tx.abort();
          }
        } else history.add(entry);
      };
    }
  };
  await done;
  announce();
  return saved;
}

export async function saveReview(
  record: BoardRecord,
  answerId: string,
  review: ReviewNote,
): Promise<BoardRecord> {
  const db = await openDB();
  const tx = db.transaction([STORES.boards, STORES.meta], "readwrite");
  let conflict = false;
  const done = complete(tx).catch((e) => {
    throw conflict ? new StorageConflict() : e;
  });
  let saved = record;
  const read = tx.objectStore(STORES.boards).get(record.id);
  read.onsuccess = () => {
    const current = read.result as BoardRecord | undefined;
    if (!current || current.localRevision !== record.localRevision) {
      conflict = true;
      tx.abort();
      return;
    }
    saved = { ...current, localRevision: current.localRevision + 1 };
    tx.objectStore(STORES.boards).put(saved);
    const notes = tx.objectStore(STORES.meta).get("reviews:" + record.id);
    notes.onsuccess = () =>
      tx
        .objectStore(STORES.meta)
        .put({ ...notes.result, [answerId]: review }, "reviews:" + record.id);
  };
  await done;
  announce();
  return saved;
}

export async function deleteBoard(record: BoardRecord) {
  const db = await openDB();
  const tx = db.transaction(
    [STORES.boards, STORES.revisions, STORES.meta],
    "readwrite",
  );
  let conflict = false;
  const done = complete(tx).catch((e) => {
    throw conflict ? new StorageConflict() : e;
  });
  const read = tx.objectStore(STORES.boards).get(record.id);
  read.onsuccess = () => {
    if (read.result?.localRevision !== record.localRevision) {
      conflict = true;
      tx.abort();
      return;
    }
    tx.objectStore(STORES.boards).delete(record.id);
    tx.objectStore(STORES.meta).delete("reviews:" + record.id);
    const active = tx.objectStore(STORES.meta).get(ACTIVE_BOARD_KEY);
    active.onsuccess = () => {
      if (active.result === record.id)
        tx.objectStore(STORES.meta).delete(ACTIVE_BOARD_KEY);
    };
    const cursor = tx
      .objectStore(STORES.revisions)
      .index("byBoard")
      .openCursor(IDBKeyRange.only(record.id));
    cursor.onsuccess = () => {
      if (cursor.result) {
        cursor.result.delete();
        cursor.result.continue();
      }
    };
  };
  await done;
  announce();
}
export async function exportArchive(
  record: BoardRecord,
): Promise<BoardArchive> {
  const revisions = await getRevisions(record.id);
  const archive: BoardArchive = {
    schemaVersion: 1,
    format: ARCHIVE_FORMAT,
    board: record.board,
    snapshot: record.snapshot,
    exportedAt: new Date().toISOString(),
    revisions: revisions
      .slice(0, ARCHIVE_MAX_REVISIONS)
      .map(({ revisionId, createdAt, board }) => ({
        revisionId,
        createdAt,
        board,
      })),
  };
  if (
    new TextEncoder().encode(JSON.stringify(archive)).length > ARCHIVE_MAX_BYTES
  )
    throw new Error(
      "This archive exceeds the 1 MiB import limit. Export a current-only copy using the recovery download.",
    );
  return archive;
}
