import 'server-only';
import type { HealthBody } from '../contracts/legacy.ts';
import { SIMULATION_LAB_ENABLED } from '../demo-policy.ts';
import { serverConfig } from './config.ts';

export function healthBody(env: Record<string, string | undefined> = process.env): HealthBody {
  const c = serverConfig(env);
  return {
    status: 'ok',
    project: 'ripple',
    mode: 'live',
    configured: { telem: c.configured.telem, model: c.configured.model },
    sponsors: {
      telem: { configured: c.configured.telem, role: 'discovery, source routing and page qualification' },
      tavily: { configured: c.configured.tavily, role: 'direct POST /extract (basic) of selected pages; evidence text' },
    },
    public_beta: c.publicBetaReady,
    safety: { durable_quota: c.configured.quota, signed_snapshots: c.configured.signing, bounded_sources: true },
    limits: {
      sources: c.limits.sources,
      facts: c.limits.facts,
      answers: c.limits.answers,
      model_calls: c.limits.model_calls,
      search_queries: c.limits.search_queries,
      timeout_ms: c.limits.timeout_ms,
    },
    source_hosts: c.sourceHosts,
    simulation_lab: SIMULATION_LAB_ENABLED,
  };
}
