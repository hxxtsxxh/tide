// One explicit live operation on the compatibility API; no exemption or automatic retry.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
const base = (process.env.SEARCHHACK_BASE_URL || 'http://127.0.0.1:4507').replace(/\/$/, '');
const request = { request_id: randomUUID(), mode: 'live', strategy: 'treatment', query: 'Which HTTP status codes count as a successful browser Response according to the ok property?', input: { source_urls: ['https://developer.mozilla.org/en-US/docs/Web/API/Response/ok'] }, limits: { max_queries: 0, max_pages: 1, max_model_calls: 2, timeout_ms: 20000 } };
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const expectedHash = createHash('sha256').update(JSON.stringify(canonical(Object.fromEntries(['mode','query','input','limits'].map(k=>[k,request[k]]))))).digest('hex');
const report = { schemaVersion: 1, project: 'ripple', base_url: base, local_test: new URL(base).protocol !== 'https:', executedAt: new Date().toISOString(), passed: false };
try {
  const response = await fetch(base + '/api/refresh', { method:'POST', headers:{Origin:base,'Content-Type':'application/json'}, body:JSON.stringify(request), signal:AbortSignal.timeout(25000) });
  const body = await response.json();
  assert.ok(response.ok, `HTTP ${response.status}: ${body.error?.code}`);
  assert.equal(body.input_sha256, expectedHash);
  assert.ok(body.evidence.length > 0);
  assert.ok(body.evidence.every(e => request.input.source_urls.includes(e.url) && e.origin === 'telem_live' && /^[a-f0-9]{64}$/.test(e.content_sha256)));
  assert.equal(body.trace.fetches.length, 1);
  assert.equal(body.trace.queries.length, 0);
  assert.ok(body.trace.model_calls > 0 && body.trace.model_calls <= request.limits.max_model_calls);
  Object.assign(report, {passed:true,input_sha256:body.input_sha256,evidenceCount:body.evidence.length,trace:body.trace,decisionCount:body.result.decisions.length});
} catch (e) { report.error=e.message; process.exitCode=1; }
await mkdir('artifacts',{recursive:true});
await writeFile('artifacts/T05-request-identity.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,error:report.error,input_sha256:report.input_sha256,evidenceCount:report.evidenceCount}));
