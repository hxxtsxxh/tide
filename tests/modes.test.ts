// Tide research modes: registry integrity, per-mode source policy, long-page handling and legacy compatibility.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MODES, MODE_IDS, HOST_TIERS, hostsForMode, modeOf, LEGACY_MODE, DEFAULT_UI_MODE } from '../src/lib/modes.ts';
import { Board, CreateBoardRequest, DEFAULT_SOURCE_HOSTS, DiscoverRequest, PUBLIC_LIMITS } from '../src/lib/contracts/board.ts';
import { normalizeSourceUrl } from '../src/lib/server/guards-core.mjs';
import { serverConfig, withMode, snapshotHosts } from '../src/lib/server/config.ts';
import { locateQuote, normalizeWs, selectPassages } from '../src/lib/search/text.ts';

test('registry: unique ids, exact lowercase hosts with tiers, examples on their own allowlist', () => {
  assert.deepEqual(MODES.map((m) => m.id).sort(), [...MODE_IDS].sort());
  assert.equal(DEFAULT_UI_MODE, 'general');
  for (const m of MODES) {
    const hosts = hostsForMode(m.id, DEFAULT_SOURCE_HOSTS);
    for (const h of hosts) assert.match(h, /^[a-z0-9.-]+\.[a-z]+$/, h);
    if (m.hosts) for (const h of m.hosts) assert.ok(HOST_TIERS[h], `${h} has an authority tier`);
    for (const ex of m.examples) for (const u of ex.urls) assert.equal(normalizeSourceUrl(u, hosts), u, `${m.id}: ${u}`);
  }
  // General is the union of every non-technical curated list.
  const general = new Set(hostsForMode('general', DEFAULT_SOURCE_HOSTS));
  for (const m of MODES) if (m.hosts && m.id !== 'general') for (const h of m.hosts) assert.ok(general.has(h), h);
});

test('mode source policy: technical keeps the docs allowlist; general rejects docs hosts and vice versa', () => {
  const cfg = serverConfig({});
  assert.deepEqual(withMode(cfg, undefined).sourceHosts, cfg.sourceHosts);
  assert.equal(withMode(cfg, undefined).pageChars, PUBLIC_LIMITS.source_chars_per_page);
  const gen = withMode(cfg, 'general');
  assert.equal(gen.pageChars, PUBLIC_LIMITS.long_page_chars);
  assert.throws(() => normalizeSourceUrl('https://docs.telem.ai/api/', gen.sourceHosts));
  assert.throws(() => normalizeSourceUrl('https://en.wikipedia.org/wiki/X', withMode(cfg, 'technical').sourceHosts));
  assert.throws(() => normalizeSourceUrl('https://wikipedia.org/wiki/X', gen.sourceHosts), 'exact host only');
  assert.throws(() => normalizeSourceUrl('http://en.wikipedia.org/wiki/X', gen.sourceHosts), 'https only');
  assert.deepEqual(withMode(serverConfig({ TIDE_GENERAL_HOSTS: 'Example.org, bad host' }), 'general').sourceHosts, ['example.org']);
  assert.ok(!withMode(cfg, 'finance').sourceHosts.includes('www.who.int'));
  assert.deepEqual(snapshotHosts(cfg)(undefined), cfg.sourceHosts, 'legacy snapshot -> technical policy');
});

test('backward compatibility: requests and boards without mode stay valid; unknown mode on a board -> technical', () => {
  const req = { request_id: 'r', title: 't', question: 'q', requirements: '', urls: ['https://docs.telem.ai/api/'] };
  assert.equal(CreateBoardRequest.parse(req).mode, undefined);
  assert.equal(CreateBoardRequest.parse({ ...req, mode: 'finance' }).mode, 'finance');
  assert.throws(() => CreateBoardRequest.parse({ ...req, mode: 'astrology' }));
  assert.equal(DiscoverRequest.parse({ request_id: 'r', query: 'x' }).mode, undefined);
  const board = { id: 'b', title: 't', question: 'q', requirements: '', sources: [], facts: [], answers: [], revisions: [] };
  assert.equal(Board.parse(board).mode, undefined);
  assert.equal(modeOf(Board.parse(board).mode).id, LEGACY_MODE);
  assert.equal(Board.parse({ ...board, mode: 'future-mode' }).mode, undefined);
  assert.equal(Board.parse({ ...board, mode: 'society' }).mode, 'society');
});

test('long pages: selected passages are literal, bounded, question-relevant; quotes verify against full text', () => {
  const filler = Array.from({ length: 400 }, (_, i) => `Unrelated sentence number ${i} about museum visits and site navigation.`).join(' ');
  const key = 'An inverted yield curve has preceded every U.S. recession since 1970, with lead times of six to twenty-four months.';
  const text = normalizeWs(`${filler} ${key} ${filler}`);
  assert.ok(text.length > 40_000);
  const sel = selectPassages(text, 'Does an inverted yield curve predict a U.S. recession?', 12_000);
  assert.ok(sel.length <= 12_000);
  assert.ok(sel.includes(key), 'the relevant passage is selected even deep in a long page');
  for (const part of sel.split(' … ')) assert.ok(text.includes(part), 'every passage is a literal substring');
  assert.equal(locateQuote(text, key), key, 'verification uses the full fetched text');
  assert.equal(locateQuote(text, 'An inverted yield curve always causes recessions.'), null, 'no weakening of literal-quote checks');
  assert.equal(selectPassages('short page', 'q'), 'short page');
});

test('extraction: one malformed item is dropped, not the whole model output; long pages get a larger excerpt', async () => {
  const { Extraction } = await import('../src/lib/model/extract.ts');
  const { buildExcerpt } = await import('../src/lib/search/text.ts');
  const ok = { ref: 'F1', source: 's1', key: 'k', value: 1, quote: 'q' };
  const parsed = Extraction.parse({ facts: [ok, { ...ok, ref: 'F2', value: 'x'.repeat(500) }], answers: [{ ref: 'A1', text: 't', depends_on: ['F1'] }, { ref: 'A2' }] });
  assert.deepEqual(parsed.facts.map((f) => f.ref), ['F1']);
  assert.deepEqual(parsed.answers!.map((a) => a.ref), ['A1']);
  assert.throws(() => Extraction.parse({ answers: [] }), 'facts array is still required');
  const quotes = Array.from({ length: 16 }, (_, i) => `Distinct verified quote number ${i} with enough words to be realistic here.`);
  const long = quotes.map((q) => `${'filler text '.repeat(250)} ${q}`).join(' ');
  assert.equal(buildExcerpt(long, quotes).kept.size, 16, "all quotes fit the long-page excerpt");
  assert.ok(buildExcerpt(long, quotes, 3000).kept.size < 16, 'the old 3,000-char budget would have dropped some');
});

test('discover: General (31 hosts) never sends more than 20 include_domains; chunks are merged and post-filtered', async () => {
  const { discover, domainChunks } = await import('../src/lib/server/research.ts');
  const { newWorld, deps } = await import('./retrieval-fakes.ts');
  const { TelemClient } = await import('../src/lib/search/telem.ts');
  const general = withMode(serverConfig({}), 'general').sourceHosts;
  assert.ok(general.length > 20);
  const chunks = domainChunks(general);
  assert.ok(chunks.every((c) => c.length <= 20));
  assert.deepEqual([...chunks.flat()].sort(), [...general].sort(), 'every host is searched exactly once');
  assert.equal(chunks[0]![0], 'www.federalreserve.gov', 'highest-authority hosts first');
  const w = newWorld({ search: [{ provider: 'brave', results: [{ url: 'https://en.wikipedia.org/wiki/Gold', title: 'Gold' }, { url: 'https://docs.telem.ai/api/', title: 'off-mode' }] }] });
  const base = deps(w);
  const r = await discover({ request_id: 'g', query: 'gold safe haven', mode: 'general' }, { ...base, config: withMode(base.config, 'general') });
  const searches = w.calls.filter((c) => c.path === '/api/v1/search');
  assert.equal(searches.length, 2);
  for (const c of searches) assert.ok(c.body.search.include_domains.length <= 20, 'Telem 422s above 20');
  assert.deepEqual(r.results.map((x) => x.url), ['https://en.wikipedia.org/wiki/Gold'], 'merged, deduped, off-mode host dropped');
  await assert.rejects(new TelemClient({ limits: { maxQueries: 2, maxPages: 5, maxHttp: 6 } } as never).search('q', general), /include_domains/);
});

test('boilerplate quotes never become facts; substantive quotes survive', async () => {
  const { Extraction } = await import('../src/lib/model/extract.ts');
  const { isBoilerplate } = await import('../src/lib/search/text.ts');
  for (const q of ['Past performance is not necessarily indicative of future results.', 'Diversification does not guarantee any investment returns and does not eliminate the risk of loss.', 'This website uses cookies to improve your experience.', 'This material is for informational purposes only.', 'Jump to content'])
    assert.ok(isBoilerplate(q), q);
  for (const q of ['Gold rose 25% in 2008 while equities fell.', 'An inverted yield curve preceded every U.S. recession since 1970.', 'Remote workers saved 72 minutes per day of commuting.'])
    assert.ok(!isBoilerplate(q), q);
  const f = (ref: string, quote: string) => ({ ref, source: 's1', key: ref, value: 1, quote });
  const parsed = Extraction.parse({ facts: [f('F1', 'Past performance is not necessarily indicative of future results.'), f('F2', 'Gold rose 25% in 2008 while equities fell.')] });
  assert.deepEqual(parsed.facts.map((x) => x.ref), ['F2']);
});
