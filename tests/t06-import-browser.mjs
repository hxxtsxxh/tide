// Run using Playwright MCP after navigating to the actual local app. No API substitution.
async (page) => {
  const base = new URL(page.url()).origin;
  const context = await page.context().browser().newContext();
  const checks = {};
  const check = (name, value) => { if (!value) throw Error(name); checks[name] = true; };
  try {
    const p = await context.newPage();
    await p.goto(base);
    await p.getByTestId('new-board-title').waitFor();
    let paid = 0;
    p.on('request', request => { if (request.method() === 'POST' && request.url().includes('/api/')) paid++; });
    const text = '<img src=x onerror="window.__T06_XSS=1"><script>window.__T06_XSS=2</script> [unsafe](javascript:window.__T06_XSS=3)';
    const board = {
      id: 't06-import-xss', title: text, question: text, requirements: text,
      sources: [{ id: 's1', url: 'https://developer.mozilla.org/en-US/docs/Web/API/Response/ok', title: text, status: 'succeeded', observedAt: '2026-11-14T20:00:00.000Z', contentHash: 'historical-test-only', excerpt: text }],
      facts: [{ id: 'f1', source_id: 's1', quote: text, value: text, status: 'supported', support_sets: [['s1']] }],
      answers: [{ id: 'a1', text, depends_on: ['f1'], status: 'fresh', dependency_review: 'proposed' }],
      revisions: [{ id: 'r1', parent_id: null, createdAt: '2026-11-14T20:00:00.000Z', kind: 'historical-test', summary: text }],
    };
    const archive = { schemaVersion: 1, format: 'ripple-board-v1', board, snapshot: null, exportedAt: '2026-11-14T20:00:00.000Z' };
    await p.getByTestId('import-board-file').setInputFiles({ name: 'historical-xss.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(archive)) });
    await p.getByTestId('board-title-current').waitFor();
    await p.getByTestId('import-revalidation-notice').waitFor();
    check('import_is_explicitly_unverified', (await p.getByTestId('board-title-current').innerText()).includes('<img'));
    await p.getByTestId('evidence-tab').click();
    check('no_executable_html_or_links', await p.locator('img[src="x"], a[href^="javascript:"], script:not([src]):has-text("window.__T06_XSS")').count() === 0);
    check('xss_not_executed', await p.evaluate(() => !window.__T06_XSS));
    await p.reload();
    await p.getByTestId('board-title-current').waitFor();
    await p.getByTestId('import-revalidation-notice').waitFor();
    check('unverified_survives_reload', await p.evaluate(() => !window.__T06_XSS));
    await p.getByTestId('delete-board').click();
    await p.getByTestId('confirm-delete-board').click();
    await p.reload();
    await p.getByTestId('new-board-title').waitFor();
    check('delete_survives_reload', await p.getByTestId('board-title-current').count() === 0);
    check('no_paid_requests', paid === 0);
    return { passed: true, local_test: true, mode: 'historical-import-test', checks, paidCalls: paid };
  } finally { await context.close(); }
}
