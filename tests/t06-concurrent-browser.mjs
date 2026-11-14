// Real local API create/refresh, with an explicit competing IndexedDB write.
// The intercepted refresh is continued unchanged; no API response is fabricated.
async (page) => {
  const base = new URL(page.url()).origin;
  const context = await page.context().browser().newContext();
  const checks = {};
  const check = (name, ok) => { if (!ok) throw Error(name); checks[name] = true; };
  try {
    const p = await context.newPage();
    await p.goto(base);
    await p.getByTestId('new-board-title').fill('T06 concurrent refresh browser');
    await p.getByTestId('new-board-question').fill('What HTTP response status range should our client count as success?');
    await p.getByTestId('new-board-urls').fill('https://developer.mozilla.org/en-US/docs/Web/API/Response/ok');
    await p.getByTestId('new-board-requirements').fill('Failures must remain visible.');
    const createdResponse = p.waitForResponse(r => r.url() === base + '/api/boards' && r.request().method() === 'POST');
    await p.getByTestId('create-board').click();
    const response = await createdResponse;
    check('real_create', response.ok());
    const created = await response.json();
    await p.getByTestId('board-result').waitFor();
    await p.getByText('Saved in this browser', { exact: true }).waitFor();
    let release;
    const hold = new Promise(resolve => { release = resolve; });
    let received;
    const arrived = new Promise(resolve => { received = resolve; });
    let requests = 0;
    await context.route('**/api/boards/refresh', async route => {
      requests++;
      received();
      await hold;
      await route.continue();
    });
    try {
      const refreshedResponse = p.waitForResponse(r => r.url() === base + '/api/boards/refresh' && r.request().method() === 'POST');
      await p.getByTestId('refresh-board').click();
      await arrived;
      check('refresh_disabled_while_pending', await p.getByTestId('refresh-board').isDisabled());
      check('requirements_disabled_while_pending', await p.getByTestId('apply-requirements').isDisabled());
      // A second DOM click on a disabled button cannot submit another operation.
      await p.getByTestId('refresh-board').evaluate(button => button.click());
      const newerRevision = await p.evaluate(async id => await new Promise((resolve, reject) => {
        const request = indexedDB.open('ripple', 1);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('boards', 'readwrite');
          const store = tx.objectStore('boards');
          const get = store.get(id);
          let revision;
          get.onsuccess = () => { revision = get.result.localRevision + 1; store.put({ ...get.result, localRevision: revision, updatedAt: new Date().toISOString() }); };
          tx.oncomplete = () => { db.close(); resolve(revision); };
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      }), created.board.id);
      release();
      const refreshed = await refreshedResponse;
      check('real_refresh', refreshed.ok());
      await p.getByRole('alert').filter({ hasText: 'Another tab changed this board' }).waitFor();
      check('conflict_is_visible', (await p.locator('.board-storage-bar').innerText()).includes('Unsaved result'));
      const storedRevision = await p.evaluate(async id => await new Promise((resolve, reject) => {
        const request = indexedDB.open('ripple', 1);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('boards', 'readonly');
          const get = tx.objectStore('boards').get(id);
          get.onsuccess = () => resolve(get.result.localRevision);
          tx.oncomplete = () => db.close();
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      }), created.board.id);
      check('newer_revision_not_overwritten', storedRevision === newerRevision);
      check('one_refresh_request', requests === 1);
      return { passed: true, local_test: true, mode: 'live-api-with-storage-race-injection', checks, paidOperations: 2, supportedFacts: created.board.facts.filter(f => f.status === 'supported').length };
    } finally { release(); }
  } finally { await context.close(); }
}
