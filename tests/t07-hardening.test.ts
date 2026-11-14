// T07: fatal Telem acquisition must not hide the parallel Tavily work already spent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiErrorBody } from '../src/lib/contracts/legacy.ts';
import { runGuarded } from '../src/lib/server/guarded.ts';
import { createBoardSpec } from '../src/app/api/_lib/specs.ts';
import { ENV, URL_A, newWorld, fakeFetch } from './retrieval-fakes.ts';

const origin = 'https://ripple.example.test';
const admit = { async reserve() { return { allowed: true, retryAfter: 0 }; } };

test('T07: fatal Telem failure reports observed Telem and Tavily attempts without breaking the error schema', async () => {
  const world = newWorld({ telemStatus: [401] });
  const req = new Request(origin + '/api/boards', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ request_id: 't07-fatal', title: 'Fatal', question: 'What is the fetch limit?', requirements: '', urls: [URL_A] }) });
  const r = await runGuarded(req, createBoardSpec, { env: ENV, quota: admit, fetchImpl: fakeFetch(world) });
  assert.equal(r.status, 502);
  ApiErrorBody.parse(await r.json());
  const telem = world.calls.filter((c) => c.host === 'hack.telem.ai').length;
  const tavily = world.calls.filter((c) => c.host === 'api.tavily.com').length;
  const header = r.headers.get('x-ripple-upstream-attempts') ?? '';
  assert.match(header, new RegExp(`^telem_http=${telem}; tavily_http=${tavily}; tavily_credits=`));
  assert.ok(telem >= 1 && tavily >= 1);
  assert.doesNotMatch(header, /key|secret|tvly-/i);
});
