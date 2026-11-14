import 'server-only';
import { DEFAULT_SOURCE_HOSTS, PUBLIC_LIMITS } from '../contracts/board.ts';

export { DEFAULT_SOURCE_HOSTS };


type Env = Record<string, string | undefined>;

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : fallback;
}

/** Read lazily per request: importing this module performs no I/O and no network access. */
export function serverConfig(env: Env = process.env) {
  const hosts = (env.RIPPLE_SOURCE_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => /^[a-z0-9.-]+$/.test(h) && h.includes('.'));
  const provider = env.APP_MODEL_PROVIDER === 'openai' ? 'openai' : 'anthropic';
  const modelKey = provider === 'openai' ? env.OPENAI_API_KEY : env.ANTHROPIC_API_KEY;
  let quotaUrlOk = false;
  try {
    const u = new URL(env.UPSTASH_REDIS_REST_URL ?? '');
    quotaUrlOk = u.protocol === 'https:' && u.hostname.endsWith('.upstash.io');
  } catch {}
  const stateSecret = env.RIPPLE_STATE_SECRET ?? '';
  const configured = {
    telem: Boolean(env.TELEM_API_KEY),
    model: Boolean(modelKey && env.APP_MODEL),
    quota: quotaUrlOk && Boolean(env.UPSTASH_REDIS_REST_TOKEN),
    signing: stateSecret.length >= 32,
  };
  const enabled = env.RIPPLE_PUBLIC_BETA !== 'false';
  return {
    sourceHosts: hosts.length ? hosts : [...DEFAULT_SOURCE_HOSTS],
    configured,
    publicBetaEnabled: enabled,
    publicBetaReady: enabled && configured.telem && configured.model && configured.quota && configured.signing,
    quota: {
      globalDaily: positiveInt(env.RIPPLE_GLOBAL_RUNS_PER_DAY, 100),
      visitorDaily: positiveInt(env.RIPPLE_VISITOR_RUNS_PER_DAY, 40),
      visitorMinute: positiveInt(env.RIPPLE_VISITOR_RUNS_PER_MINUTE, 12),
    },
    /** Generic fixture transport: explicit opt-in, never on Vercel, localhost requests only. */
    fixtureTransportAllowed: env.ALLOW_FIXTURE_MODE === 'true' && !env.VERCEL,
    limits: PUBLIC_LIMITS,
  };
}
export type ServerConfig = ReturnType<typeof serverConfig>;

/** Secrets are only reachable through these accessors, never serialized into responses. */
export function secrets(env: Env = process.env) {
  return {
    stateSecret: env.RIPPLE_STATE_SECRET ?? '',
    upstashUrl: env.UPSTASH_REDIS_REST_URL ?? '',
    upstashToken: env.UPSTASH_REDIS_REST_TOKEN ?? '',
    telemApiKey: env.TELEM_API_KEY ?? '',
    modelProvider: env.APP_MODEL_PROVIDER === 'openai' ? ('openai' as const) : ('anthropic' as const),
    model: env.APP_MODEL ?? '',
    modelApiKey: (env.APP_MODEL_PROVIDER === 'openai' ? env.OPENAI_API_KEY : env.ANTHROPIC_API_KEY) ?? '',
  };
}
