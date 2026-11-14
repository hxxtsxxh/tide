import 'server-only';

const RETRY_MIN_REMAINING_MS = 6_000;
export const MAX_OUTPUT_TOKENS = 6144; // 5 sources x stance-tagged quotes + answers overflowed 2048 and truncated the JSON

export type ModelFailureKind = 'auth' | 'transient' | 'timeout' | 'bad_output' | 'budget';
export class ModelFailure extends Error {
  readonly kind: ModelFailureKind;
  constructor(kind: ModelFailureKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

/** Counts EVERY attempted model call; structurally satisfied by RunBudget and capBudget(). */
export type CallBudget = { take(): void; readonly attempts: number };

/** A tighter view over a RunBudget (e.g. a lower legacy max_model_calls). The base still counts. */
export function capBudget(base: CallBudget, max: number): CallBudget {
  let used = 0;
  return {
    get attempts() {
      return used;
    },
    take() {
      if (used >= max) throw new Error('RUN_CALL_LIMIT');
      base.take();
      used++;
    },
  };
}

export type ModelDeps = {
  provider: 'anthropic' | 'openai';
  model: string;
  apiKey: string;
  budget: CallBudget;
  signal: AbortSignal;
  deadline: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

async function once(d: ModelDeps, system: string, user: string): Promise<{ text: string; stopped: boolean }> {
  const f = d.fetchImpl ?? fetch;
  const anthropic = d.provider === 'anthropic';
  const res = await f(anthropic ? 'https://api.anthropic.com/v1/messages' : 'https://api.openai.com/v1/responses', {
    method: 'POST',
    redirect: 'error',
    headers: anthropic
      ? { 'x-api-key': d.apiKey, 'anthropic-version': '2026-10-21', 'content-type': 'application/json' }
      : { Authorization: `Bearer ${d.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(
      anthropic
        ? { model: d.model, max_tokens: MAX_OUTPUT_TOKENS, system, messages: [{ role: 'user', content: user }] }
        : { model: d.model, max_output_tokens: MAX_OUTPUT_TOKENS, instructions: system, input: user, store: false },
    ),
    signal: d.signal,
  });
  if (res.status === 401 || res.status === 402 || res.status === 403) throw new ModelFailure('auth', `Model provider rejected the request (HTTP ${res.status})`);
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new ModelFailure(res.status === 408 || res.status === 429 || res.status >= 500 ? 'transient' : 'bad_output', `Model provider HTTP ${res.status}`);
  }
  const text = await res.text();
  if (text.length > 1_000_000) throw new ModelFailure('bad_output', 'Model response too large');
  const j = JSON.parse(text) as Record<string, unknown>;
  if (anthropic) {
    const blocks = Array.isArray(j.content) ? (j.content as { type?: string; text?: string }[]) : [];
    return { text: blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join(''), stopped: j.stop_reason !== 'max_tokens' };
  }
  const out = Array.isArray(j.output) ? (j.output as { content?: { type?: string; text?: string }[] }[]) : [];
  return { text: out.flatMap((o) => o.content ?? []).filter((c) => c.type === 'output_text').map((c) => c.text ?? '').join(''), stopped: j.status !== 'incomplete' };
}

/** Pull the first balanced top-level JSON object out of model text (the model has no tools, only text). */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) throw new ModelFailure('bad_output', 'No JSON object in model output');
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        throw new ModelFailure('bad_output', 'Model output was not valid JSON');
      }
    }
  }
  throw new ModelFailure('bad_output', 'Model output was truncated');
}

/**
 * One structured completion. Every attempt (including the single retry for a transient provider error
 * or malformed/truncated JSON) is counted via budget.take(); retries never run past the deadline.
 */
export async function completeStructured<T>(d: ModelDeps, system: string, user: string, parse: (raw: unknown) => T): Promise<T> {
  const now = d.now ?? Date.now;
  let last: ModelFailure = new ModelFailure('bad_output', 'Model produced no usable output');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      d.budget.take();
    } catch (e) {
      if (e instanceof Error && e.message === 'RUN_CALL_LIMIT') throw new ModelFailure('budget', 'Model call budget exhausted');
      throw e; // RUN_TIMEOUT is mapped by the guard
    }
    try {
      const { text, stopped } = await once(d, system, attempt === 0 ? user : `${user}\n\nReturn ONLY one compact JSON object; keep it short.`);
      if (!stopped) throw new ModelFailure('bad_output', 'Model output hit the token limit');
      return parse(extractJson(text));
    } catch (e) {
      if (e instanceof ModelFailure) last = e;
      else if (d.signal.aborted) throw new ModelFailure('timeout', 'Operation deadline reached');
      else last = new ModelFailure(e instanceof SyntaxError || (e as Error)?.name === 'ZodError' ? 'bad_output' : 'transient', 'Model call failed');
      if (last.kind === 'auth' || last.kind === 'timeout' || d.deadline - now() < RETRY_MIN_REMAINING_MS) throw last;
    }
  }
  throw last;
}
