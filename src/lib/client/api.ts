import {
  BoardEnvelope,
  DiscoverResponse,
  CreateBoardRequest,
  RefreshBoardRequest,
  DiscoverRequest,
} from "../contracts/board.ts";
import type { z } from "zod";
import { SHOWCASE_MODE } from "../demo-policy.ts";

export class RequestError extends Error {
  code: string;
  requestId: string;
  retryAt: number | null;
  constructor(
    code: string,
    message: string,
    requestId = "",
    retryAt: number | null = null,
  ) {
    super(message);
    this.code = code;
    this.requestId = requestId;
    this.retryAt = retryAt;
  }
}
export const newRequestId = () => crypto.randomUUID();

// All browser research traffic crosses this same-origin, bounded boundary. No automatic retries.
async function post<T>(
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 52_000);
  try {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new RequestError(
        "UPSTREAM_UNAVAILABLE",
        "The service returned an unreadable response. Your previous board is preserved.",
      );
    }
    if (!response.ok) {
      const retry = response.headers.get("Retry-After");
      const retryAt = retry
        ? /^\d+$/.test(retry)
          ? Date.now() + Number(retry) * 1000
          : Date.parse(retry)
        : null;
      throw new RequestError(
        data?.error?.code ?? "UPSTREAM_UNAVAILABLE",
        data?.error?.message ?? "The operation could not complete.",
        data?.request_id ?? "",
        Number.isFinite(retryAt) ? retryAt : null,
      );
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success)
      throw new RequestError(
        "INVALID_RESPONSE",
        "The service response did not match the board contract. No result was saved.",
      );
    return parsed.data;
  } catch (e) {
    if (e instanceof RequestError) throw e;
    throw new RequestError(
      controller.signal.aborted ? "TIMEOUT" : "NETWORK_ERROR",
      controller.signal.aborted
        ? "The request timed out. It may have used allowance; retry only when ready."
        : "The service could not be reached. Check your connection and try again.",
    );
  } finally {
    clearTimeout(timer);
  }
}
type Showcase = {
  boards: { mode: string; question: string; envelope: unknown }[];
  discoveries: { mode: string; query: string; result: unknown }[];
};
export const SHOWCASE_MESSAGE =
  "Tide is in showcase mode, so live research is switched off. Pick one of the example questions to open a board recorded from a real live run.";
let showcase: Promise<Showcase> | null = null;
const loadShowcase = () =>
  (showcase ??= fetch("/showcase.json")
    .then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<Showcase>;
    })
    .catch(() => {
      showcase = null;
      throw new RequestError(
        "NETWORK_ERROR",
        "The saved example boards could not be loaded. Check your connection and try again.",
      );
    }));
const same = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();
// Same mode first, then any mode with the same question.
function pick<T extends { mode: string }>(
  items: T[],
  mode: string | undefined,
  match: (x: T) => boolean,
): T | undefined {
  return items.find((x) => match(x) && x.mode === (mode ?? "technical")) ?? items.find(match);
}
async function replay<T>(hit: unknown, schema: z.ZodType<T>): Promise<T> {
  if (!hit) throw new RequestError("SHOWCASE_MODE", SHOWCASE_MESSAGE);
  await new Promise((r) => setTimeout(r, 700)); // a short beat so the loading state reads as a run
  return schema.parse(hit);
}

/** The real research API, used whenever showcase mode is off. */
export const live = {
  createBoard: (body: CreateBoardRequest) =>
    post("/api/boards", CreateBoardRequest.parse(body), BoardEnvelope),
  refreshBoard: (body: RefreshBoardRequest) =>
    post("/api/boards/refresh", RefreshBoardRequest.parse(body), BoardEnvelope),
  discoverSources: (body: DiscoverRequest) =>
    post("/api/discover", DiscoverRequest.parse(body), DiscoverResponse),
};

export const createBoard = async (body: CreateBoardRequest) => {
  if (!SHOWCASE_MODE) return live.createBoard(body);
  const s = await loadShowcase();
  const hit = pick(s.boards, body.mode, (b) => same(b.question, body.question));
  const envelope = await replay(hit?.envelope, BoardEnvelope);
  // Fresh id so opening the same example twice is a second board, not a local-storage conflict.
  envelope.board.id = `b_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  envelope.board.title = body.title;
  return envelope;
};
export const refreshBoard = async (body: RefreshBoardRequest) => {
  if (!SHOWCASE_MODE) return live.refreshBoard(body);
  throw new RequestError(
    "SHOWCASE_MODE",
    "Requirement edits and evidence refresh need live research, which is switched off in showcase mode. Everything else on this board (the map, Evidence, Perspectives and the execution trace) works.",
  );
};
export const discoverSources = async (body: DiscoverRequest) => {
  if (!SHOWCASE_MODE) return live.discoverSources(body);
  const s = await loadShowcase();
  return replay(pick(s.discoveries, body.mode, (d) => same(d.query, body.query))?.result, DiscoverResponse);
};
