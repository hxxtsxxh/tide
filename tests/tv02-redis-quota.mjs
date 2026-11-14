// Explicit real Redis probe. All counters live in a disposable namespace, never the public allowance.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { reserveBudget } from '../src/lib/server/guards-core.mjs';
const prefix = `ripple:integration:${randomUUID()}:`;
const keys = new Set();
const transport = async (url, init) => {
  const payload = JSON.parse(init.body);
  for (let i = 3; i < 6; i++) { payload[i] = prefix + payload[i]; keys.add(payload[i]); }
  return fetch(url, { ...init, body: JSON.stringify(payload) });
};
const options = { url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN, secret: process.env.RIPPLE_STATE_SECRET, visitor: 'integration-only', globalDaily: 3, visitorDaily: 3, visitorMinute: 3 };
const report = { schemaVersion: 1, project: 'ripple', executedAt: new Date().toISOString(), passed: false, realRedis: true, isolatedNamespace: true };
try {
  // Independent callers, same Redis counters and script; concurrent admissions must stop at three.
  const results = await Promise.all(Array.from({ length: 8 }, () => reserveBudget({ ...options, fetchImpl: (url, init) => transport(url, init) })));
  const allowed = results.filter(r => r.allowed).length;
  assert.equal(allowed, 3);
  assert.ok(results.every(r => r.globalUsed <= 3 && r.visitorUsed <= 3 && r.minuteUsed <= 3));
  assert.ok(results.filter(r => !r.allowed).every(r => r.retryAfter > 0));
  Object.assign(report, { passed: true, attempts: 8, allowed, denied: 8 - allowed, maximumCounter: Math.max(...results.map(r => r.globalUsed)) });
} catch (error) { report.error = error.message; process.exitCode = 1; }
finally {
  if (keys.size) {
    const response = await fetch(options.url, { method: 'POST', headers: { Authorization: `Bearer ${options.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(['DEL', ...keys]), signal: AbortSignal.timeout(5000) });
    report.cleanup = response.ok && Number((await response.json()).result) === keys.size;
  }
  await mkdir('artifacts/tavily', { recursive: true });
  await writeFile('artifacts/tavily/redis-quota.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
