// One-off: record a real board + discovery for every mode/example pair into public/showcase.json (showcase mode replays these).
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { MODES } from '../src/lib/modes.ts';
const B = 'https://tide-search.vercel.app'; let cookie = '';
async function call(path, body) {
  const r = await fetch(B + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Origin: B, Referer: B + '/', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.getSetCookie?.() ?? []; if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
  const j = await r.json().catch(() => null); if (!r.ok) throw new Error(path + ' ' + r.status + ' ' + JSON.stringify(j).slice(0, 200)); return j;
}
async function retry(f) { try { return await f(); } catch (e) { console.log('  retry:', e.message); return f(); } }
await call('/api/session');
const out = { recordedAt: new Date().toISOString(), boards: [], discoveries: [] };
for (const m of MODES) for (const ex of m.examples) {
  console.log(m.id, '·', ex.label);
  const d = await retry(() => call('/api/discover', { request_id: randomUUID(), query: ex.question, mode: m.id }));
  out.discoveries.push({ mode: m.id, query: ex.question, result: d });
  const e = await retry(() => call('/api/boards', { request_id: randomUUID(), title: ex.title, question: ex.question, requirements: ex.requirements, urls: ex.urls, mode: m.id }));
  out.boards.push({ mode: m.id, question: ex.question, envelope: e });
  console.log('  ok:', d.candidates?.length ?? '?', 'candidates ·', e.board.facts.length, 'facts ·', e.board.answers.length, 'answers');
}
writeFileSync(new URL('../public/showcase.json', import.meta.url), JSON.stringify(out));
console.log('saved', out.boards.length, 'boards');
