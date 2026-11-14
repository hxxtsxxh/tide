// Explicit, bounded real-service integration probe. No quota exemptions or retries.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
const base = (process.env.SEARCHHACK_BASE_URL || 'http://127.0.0.1:4506').replace(/\/$/, '');
const output = process.argv[2] || 'artifacts/T05-native-api.json';
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const report = { schemaVersion: 1, project: 'ripple', local_test: new URL(base).protocol !== 'https:', base_url: base, executedAt: new Date().toISOString(), passed: false, checks: {}, operations: [], limitations: ['Native HTTP check only; independent deployed browser gate still required.', 'No paired refresh-all execution in this probe; baselineStatus=not_measured.'] };
let cookie = '';
async function call(path, body) {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Origin: base, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000) });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const data = await response.json();
  assert.ok(response.ok, `${path} HTTP ${response.status}: ${data.error?.code || 'unknown'}`);
  return data;
}
function summarize(stage, envelope) {
  const board = envelope.board;
  return { stage, request_id: envelope.request_id, board_id: board.id, requirements_sha256: hash(board.requirements), answers_sha256: hash(board.answers.map(a => a.text)), sources: board.sources.map(s => ({ id: s.id, url: s.url, status: s.status, contentHash: s.contentHash, observedAt: s.observedAt, cache_state: s.cache_state })), citations: board.facts.map(f => ({ fact_id: f.id, source_id: f.source_id, status: f.status, quote: f.quote, in_preserved_excerpt: board.sources.find(s => s.id === f.source_id)?.excerpt.includes(f.quote) === true })), answers: board.answers.map(a => ({ id: a.id, status: a.status, depends_on: a.depends_on, observedAt: a.observedAt })), update: envelope.update, trace: envelope.trace, revision: board.revisions.at(-1) };
}
try {
  const health = await call('/api/health');
  assert.equal(health.public_beta, true);
  assert.equal(health.safety.durable_quota, true);
  report.checks.configured = true;
  await call('/api/session');
  assert.ok(cookie);
  report.checks.signed_visitor_session = true;
  const input = { request_id: randomUUID(), title: 'Downloader HTTP failure policy ' + new Date().toISOString(), question: 'For a browser fetch and Python URL downloader, how do I distinguish a successful HTTP response from an HTTP error or a connection failure, and what should I record?', requirements: 'Treat HTTP 404 as an acceptable missing page. Treat HTTP 500 and connection errors as failures. Explain the acceptance check.', urls: ['https://developer.mozilla.org/en-US/docs/Web/API/Response/ok', 'https://docs.python.org/3/library/urllib.error.html'] };
  const created = await call('/api/boards', input);
  report.operations.push(summarize('create', created));
  assert.equal(created.mode, 'live');
  assert.equal(created.board.question, input.question);
  assert.ok(created.board.answers.some(a => a.status === 'fresh'));
  assert.equal(new Set(created.board.sources.filter(s => s.status === 'succeeded').map(s => new URL(s.url).hostname)).size, 2);
  for (const f of created.board.facts.filter(f => f.status === 'supported')) {
    const source = created.board.sources.find(s => s.id === f.source_id);
    assert.ok(source?.status === 'succeeded' && f.quote && source.excerpt.includes(f.quote));
  }
  report.checks.two_domain_source_backed_create = true;
  const edited = await call('/api/boards/refresh', { request_id: randomUUID(), snapshot: created.snapshot, force: false, requirements: 'Treat every non-2xx response, including HTTP 404 and HTTP 500, as a failure. Connection errors are failures too. Explain the changed acceptance check.' });
  report.operations.push(summarize('requirements_edit', edited));
  assert.equal(edited.board.id, created.board.id);
  assert.notEqual(hash(edited.board.answers.map(a => a.text)), hash(created.board.answers.map(a => a.text)));
  assert.ok(edited.update.recomputed.length > 0);
  assert.equal(edited.trace.retrieval.length, 0);
  assert.deepEqual(edited.board.sources, created.board.sources);
  assert.deepEqual(edited.board.revisions[0], created.board.revisions[0]);
  report.checks.meaningful_requirement_change_no_source_fetch = true;
  const refreshed = await call('/api/boards/refresh', { request_id: randomUUID(), snapshot: edited.snapshot, force: true });
  report.operations.push(summarize('source_refresh', refreshed));
  assert.equal(refreshed.trace.retrieval.filter(r => r.kind === 'fetch').length, input.urls.length);
  assert.equal(refreshed.board.revisions.length, 3);
  assert.ok(!refreshed.update.recomputed.some(id => refreshed.update.reused.includes(id)));
  assert.ok(!refreshed.board.answers.some(a => a.status !== 'fresh' && refreshed.update.reused.includes(a.id)));
  report.checks.refresh_trace_and_disjoint_sets = true;
  report.passed = true;
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks, error: report.error, output }));
}
