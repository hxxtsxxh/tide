import {
  BoardEnvelope,
  DiscoverResponse,
  CreateBoardRequest,
  RefreshBoardRequest,
  DiscoverRequest,
} from "../contracts/board.ts";
import type { z } from "zod";

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
export const createBoard = (body: CreateBoardRequest) =>
  post("/api/boards", CreateBoardRequest.parse(body), BoardEnvelope);
export const refreshBoard = (body: RefreshBoardRequest) =>
  post("/api/boards/refresh", RefreshBoardRequest.parse(body), BoardEnvelope);
export const discoverSources = (body: DiscoverRequest) =>
  post("/api/discover", DiscoverRequest.parse(body), DiscoverResponse);
