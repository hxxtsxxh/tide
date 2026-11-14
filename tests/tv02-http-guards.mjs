// Actual localhost HTTP guards; no provider calls are needed for these rejected requests.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const base = process.env.SEARCHHACK_BASE_URL ?? 'http://127.0.0.1:4782';
const results = [];
const create = { request_id: 'tv02-http', title: 'Rejected QA', question: 'No paid work expected', requirements: '', urls: ['https://developer.mozilla.org/en-US/docs/Web/API/AbortController'] };
for (const [name, path, body, origin, expected] of [
  ['cross_origin', '/api/boards', create, 'https://attacker.invalid', 403],
  ['unsupported_host', '/api/boards', { ...create, urls: ['https://developer.mozilla.org.attacker.invalid/source'] }, base, 422],
  ['tampered_snapshot', '/api/boards/refresh', { request_id: 'tv02-tampered', snapshot: 'eyJib2FyZCI6ImZvcmdlZCJ9.invalidsignature', force: true }, base, 409],
  ['fixture_in_live_route', '/api/boards', { ...create, fixture_id: 'r-main' }, base, 400],
]) {
  const r = await fetch(base + path, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  const j = await r.json();
  results.push({ name, status: r.status, code: j.error?.code, passed: r.status === expected });
  assert.equal(r.status, expected, name);
}
await writeFile('artifacts/tavily/http-guards.json', JSON.stringify({ passed: true, base_url: base, checks: results, limitations: ['Rejections observed through HTTP; provider zero-call assertions are separately covered with instrumented transports.'] }, null, 2) + '\n');
console.log(JSON.stringify(results));
