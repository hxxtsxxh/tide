export function normalizeSourceUrl(input: string, allowedHosts: readonly string[]): string;
export function signSnapshot(data: unknown, secret: string, now?: number, ttl?: number): string;
export function verifySnapshot(token: string, secret: string, now?: number): unknown;
export class RunBudget {
  constructor(opts?: { maxCalls?: number; timeoutMs?: number }, clock?: () => number);
  maxCalls: number;
  timeoutMs: number;
  started: number;
  attempts: number;
  assertTime(): void;
  take(): void;
}
export const QUOTA_LUA: string;
export function reserveBudget(opts: {
  url: string;
  token: string;
  secret: string;
  visitor: string;
  globalDaily?: number;
  visitorDaily?: number;
  visitorMinute?: number;
  now?: number;
  fetchImpl?: typeof fetch;
}): Promise<{ allowed: boolean; globalUsed: number; visitorUsed: number; minuteUsed: number; retryAfter: number }>;
