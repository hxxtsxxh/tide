// Explicit bounded real-HTTP QA. No fixture substitution, quota exemption or retry.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
const base = process.env.SEARCHHACK_BASE_URL ?? 'http://127.0.0.1:4792';
const output = process.argv[2] ?? 'artifacts/L02/live-supplement.json';
const report = { schemaVersion: 1, project: 'ripple', mode: 'live', local_test: ['127.0.0.1', 'localhost'].includes(new URL(base).hostname),
  executedAt: new Date().toISOString(), public_ready: false, baselineStatus: 'not_measured', cases: [],
  limitations: ['Custom-board checks are not paired baseline measurements.', 'Unavailable mandatory services fail checks; no retry or fixture fallback.', 'Missing error traces mean unknown provider work, never zero work.'] };
let cookie = '';
const body = { title: 'L02 unseen HTTP and timeout policy', question: 'How do Response.ok and AbortSignal.timeout distinguish HTTP success from a timed out browser request?', requirements: 'Use an explicit HTTP success check and a five-second cancellation deadline.',
  urls: ['https://developer.mozilla.org/en-US/docs/Web/API/Response/ok', 'https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static'] };
for (const [id, category, input] of [
  ['L02-SUCCESS', 'success', body],
  ['L02-NEGATIVE', 'negative', { ...body, urls: ['https://developer.mozilla.org.attacker.invalid/no-source'] }],
  ['L02-MISSING', 'missing_evidence', { ...body, urls: ['https://developer.mozilla.org/en-US/docs/Web/API/RippleL02NonexistentEvidence_20261114'] }],
]) {
  const row = { id, category, passed: false };
  try {
    const r = await fetch(base + '/api/boards', { method: 'POST', headers: { origin: base, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ request_id: randomUUID(), ...input }), signal: AbortSignal.timeout(55000) });
    if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    const j = await r.json();
    row.http_status = r.status;
    row.error_code = j.error?.code ?? null;
    row.mode = j.mode ?? null;
    row.provider_work = j.trace?.retrieval ?? null;
    row.model_calls = j.trace?.model_calls ?? null;
    if (category === 'negative') {
      assert.equal(r.status, 422);
      assert.equal(j.error?.code, 'SOURCE_NOT_ALLOWED');
    } else if (category === 'missing_evidence') {
      if (r.status === 422) assert.equal(j.error?.code, 'SOURCE_UNAVAILABLE');
      else {
        assert.ok(r.ok, `mandatory upstream unavailable: HTTP ${r.status}`);
        assert.equal(j.mode, 'live');
        assert.ok(j.board.sources.every(s => s.status !== 'succeeded'));
        assert.ok(j.board.facts.every(f => f.status !== 'supported'));
        assert.ok(j.board.answers.every(a => a.status !== 'fresh'));
      }
    } else {
      assert.equal(r.status, 201, `HTTP ${r.status} ${j.error?.code ?? ''}`);
      assert.equal(j.mode, 'live');
      assert.equal(j.board.question, input.question);
      assert.ok(j.trace.retrieval.some(t => t.service === 'telem' && t.status === 'succeeded'));
      assert.ok(j.trace.retrieval.some(t => t.service === 'tavily' && t.status === 'succeeded' && t.transport === 'direct'));
      const supported = j.board.facts.filter(f => f.status === 'supported');
      row.citation_chains = supported.map(f => {
        const s = j.board.sources.find(s => s.id === f.source_id);
        return { fact_id: f.id, source_id: f.source_id, source_url: s?.url, extractor: s?.extractor, quote_in_excerpt: !!f.quote && !!s?.excerpt.includes(f.quote), source_succeeded: s?.status === 'succeeded', depended_on: j.board.answers.some(a => a.depends_on.includes(f.id)) };
      });
      assert.ok(new Set(row.citation_chains.filter(c => c.quote_in_excerpt && c.source_succeeded && c.extractor === 'tavily' && c.depended_on).map(c => c.source_id)).size >= 2, 'two complete direct-extraction citation chains required');
      assert.ok(j.board.answers.some(a => a.status === 'fresh'));
    }
    row.passed = true;
  } catch (error) {
    // Assertions contain only codes/counts, never complete responses or request credentials.
    row.failure = String(error.message).slice(0, 300);
  }
  report.cases.push(row);
}
report.passed = report.cases.filter(c => c.passed).length;
report.failed = report.cases.length - report.passed;
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed: report.passed, failed: report.failed, cases: report.cases.map(({ id, passed, http_status, error_code, failure }) => ({ id, passed, http_status, error_code, failure })) }));
process.exitCode = report.failed ? 1 : 0;
