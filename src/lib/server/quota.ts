import 'server-only';
import { reserveBudget } from './guards.ts';
import type { ServerConfig } from './config.ts';

export type QuotaDecision = { allowed: boolean; retryAfter: number };

/** Global + per-visitor admission. Implementations must be atomic across instances; throw on outage. */
export interface QuotaStore {
  reserve(visitorId: string): Promise<QuotaDecision>;
}

/** Shared Upstash store (one atomic Lua EVAL per admission; no refunds, no process-local fallback). */
export function upstashQuotaStore(config: ServerConfig, s: { upstashUrl: string; upstashToken: string; stateSecret: string }, fetchImpl: typeof fetch = fetch): QuotaStore {
  return {
    async reserve(visitorId) {
      const r = await reserveBudget({
        url: s.upstashUrl,
        token: s.upstashToken,
        secret: s.stateSecret,
        visitor: visitorId,
        ...config.quota,
        fetchImpl,
      });
      return { allowed: r.allowed, retryAfter: r.retryAfter };
    },
  };
}
