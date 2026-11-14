async (page) => {
  const base='http://127.0.0.1:3103';
  const checks={};const check=(name,ok)=>{if(!ok)throw new Error(name);checks[name]=true;};
  await page.context().unroute('**/api/boards');await page.context().unroute('**/api/boards/refresh');
  await page.goto(base);
  await page.evaluate(async()=>{await new Promise((resolve,reject)=>{const r=indexedDB.open('ripple',1);r.onsuccess=()=>{const db=r.result;const t=db.transaction(['boards','revisions','meta'],'readwrite');for(const name of ['boards','revisions','meta'])t.objectStore(name).clear();t.oncomplete=()=>{db.close();resolve();};t.onerror=reject;};r.onerror=reject;});});await page.reload();
  await page.getByTestId('new-board-title').fill('UI TEST DATA — NOT LIVE EVIDENCE');
  await page.getByTestId('new-board-question').fill('How do I handle fetch failures?');
  await page.getByTestId('new-board-urls').fill('https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch');
  await page.getByTestId('new-board-requirements').fill('Handle HTTP errors.');
  const realResponse=page.waitForResponse(r=>r.url()===base+'/api/boards'&&r.request().method()==='POST');
  await page.getByTestId('create-board').click();const real=await realResponse;
  await page.getByRole('alert').filter({hasText:'NOT IMPLEMENTED'}).waitFor();
  check('actual_unimplemented_service_is_honest_error',real.status()===501);
  check('error_preserves_original_input',(await page.getByTestId('new-board-title').inputValue()).includes('UI TEST DATA'));
  let revision=0;let current;let deny=false;let malformed=false;
  const date='2026-11-14T18:00:00.000Z';
  const quote='Fetch rejects on network errors.';
  function envelope(requirements='Handle HTTP errors.',force=false) {
    revision++;
    const board={id:'ui-test-board',title:'UI TEST DATA — NOT LIVE EVIDENCE',question:'How do I handle fetch failures?',requirements,
      sources:[{id:'s-network',title:'UI test source',url:'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch',status:force?'failed':'succeeded',observedAt:date,contentHash:'ui-test-hash',excerpt:quote}],
      facts:[{id:'f-network',source_id:'s-network',value:'Network errors reject the promise',status:force?'unknown':'supported',quote,support_sets:[['s-network']]}],
      answers:[{id:'a-retry',text:'UI TEST DATA. Catch network errors.',depends_on:['f-network'],status:force?'unknown':'fresh',dependency_review:'proposed',observedAt:date},{id:'a-retry-policy',text:'UI TEST DATA. Review retry policy.',depends_on:['a-retry'],status:force?'unknown':'fresh',observedAt:date},{id:'a-independent',text:'UI TEST DATA. Independent decision.',depends_on:[],status:'unknown',observedAt:date}],
      revisions:[...(current?.board.revisions??[]),{id:'ui-r'+revision,parent_id:revision>1?'ui-r'+(revision-1):null,createdAt:new Date(Date.parse(date)+revision*1000).toISOString(),kind:revision===1?'created':force?'source_refresh':'requirements_edit',summary:'UI harness revision; not live evidence.'}]};
    current={schemaVersion:1,project:'ripple',mode:'live',request_id:'ui-test-'+revision,board,snapshot:'TEST-ONLY-NOT-A-SIGNED-SNAPSHOT-'+revision,update:{affected:revision===1?[]:['a-retry','a-retry-policy'],recomputed:force?[]:['a-retry','a-retry-policy'],reused:[],unknown:force?['a-retry','a-retry-policy']:['a-independent']},trace:{retrieval:[{kind:'fetch',provider:'UI TEST STUB',mode:'live',status:force?'failed':'succeeded',url:board.sources[0].url}],model_calls:force?0:1,elapsed_ms:200,limitations:['UI harness substituted API payload. No live result is being measured.']}};
    return current;
  }
  await page.context().route('**/api/boards',async route=>{
    if(deny)return route.fulfill({status:429,headers:{'Content-Type':'application/json','Retry-After':'60'},body:JSON.stringify({error:{code:'QUOTA_EXCEEDED',message:'UI test quota rejection'},request_id:'test-quota'})});
    await route.fulfill({status:201,json:malformed?{bad:true}:envelope()});
  });
  await page.context().route('**/api/boards/refresh',async route=>{
    const body=route.request().postDataJSON();await route.fulfill({status:200,json:envelope(body.requirements??current.board.requirements,body.force)});
  });
  deny=true;await page.getByTestId('create-board').click();await page.getByRole('alert').filter({hasText:'QUOTA EXCEEDED'}).waitFor();
  check('quota_and_retry_after_visible',(await page.locator('body').innerText()).includes('Retry after'));
  deny=false;malformed=true;await page.getByTestId('create-board').click();await page.getByRole('alert').filter({hasText:'INVALID RESPONSE'}).waitFor();
  check('malformed_success_is_not_saved',await page.getByTestId('board-result').count()===0);
  malformed=false;await page.getByTestId('create-board').click();await page.getByTestId('board-title-current').waitFor();
  await page.getByText('Local revision 1',{exact:false}).waitFor();
  check('contract_payload_saved',await page.getByTestId('primary-result').count()===1);
  await page.getByRole('button',{name:'Inspect',exact:false}).first().click();
  await page.getByLabel('Correction or review note').fill('UI test review note.');
  await page.getByRole('button',{name:'Confirm local review'}).click();
  await page.getByText('Reviewed locally',{exact:true}).waitFor();
  check('dependency_review_saved_locally',true);
  await page.getByTestId('evidence-tab').click();check('literal_passage_inspectable',(await page.locator('body').innerText()).includes(quote));
  await page.reload();await page.getByTestId('board-title-current').waitFor();
  check('active_board_restored_after_reload',(await page.getByTestId('board-title-current').innerText()).includes('UI TEST DATA'));
  const other=await page.context().newPage();await other.goto(base);await other.getByTestId('board-title-current').waitFor();
  await page.getByTestId('board-requirements').fill('Five second timeout.');await page.getByTestId('apply-requirements').click();await page.getByText('User requirement edit recorded.',{exact:false}).waitFor();
  check('requirement_edit_and_immutable_history',current.board.revisions.length===2);
  await other.getByTestId('board-requirements').fill('Stale second tab input.');await other.getByTestId('apply-requirements').click();
  await other.getByRole('alert').filter({hasText:'Another tab changed this board'}).waitFor();
  const storedAfterConflict=await page.evaluate(async()=>new Promise((resolve,reject)=>{const r=indexedDB.open('ripple',1);r.onsuccess=()=>{const db=r.result;const t=db.transaction('boards','readonly');const q=t.objectStore('boards').get('ui-test-board');q.onsuccess=()=>resolve({requirements:q.result.board.requirements,revision:q.result.localRevision});q.onerror=reject;t.oncomplete=()=>db.close();};r.onerror=reject;}));
  check('concurrent_tab_cannot_overwrite_saved_revision',storedAfterConflict.requirements==='Five second timeout.'&&storedAfterConflict.revision===3);
  await other.close();
  await page.getByTestId('refresh-board').click();await page.getByText('Source recheck recorded.',{exact:false}).waitFor();
  check('failed_source_retains_unknown_state',await page.locator('.answer-node .status-unknown').count()===3);
  await page.getByRole('button',{name:'Execution trace',exact:false}).click();check('trace_does_not_invent_baseline',(await page.locator('body').innerText()).includes('Not measured'));
  await page.getByRole('button',{name:'History',exact:false}).click();await page.getByRole('button',{name:'View saved content',exact:false}).first().click();
  check('historical_content_inspectable',await page.getByRole('dialog').count()===1);await page.keyboard.press('Escape');
  const waiting=page.waitForEvent('download');await page.getByTestId('export-board').click();const downloaded=await waiting;const stream=await downloaded.createReadStream();let raw='';for await(const chunk of stream)raw+=chunk.toString();const archive=JSON.parse(raw);
  check('export_contains_bounded_revision_records',archive.format==='ripple-board-v1'&&archive.revisions.length>=3);
  await page.getByTestId('delete-board').click();await page.keyboard.press('Escape');check('escape_cancels_delete',await page.getByTestId('board-title-current').count()===1);
  await page.getByTestId('delete-board').click();await page.getByTestId('confirm-delete-board').click();await page.getByTestId('new-board-title').waitFor();await page.reload();await page.getByTestId('new-board-title').waitFor();
  check('delete_removes_board_after_reload',!(await page.locator('body').innerText()).includes('UI TEST DATA'));
  archive.snapshot=null;archive.board.title='UI TEST DATA <img src=x onerror=window.__rippleXSS=true>';await page.getByTestId('import-board-file').setInputFiles({name:'ui-test-archive.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(archive))});
  await page.getByTestId('import-revalidation-notice').waitFor();
  check('null_snapshot_import_is_unverified',await page.getByTestId('refresh-board').isDisabled());
  check('imported_html_is_inert',await page.locator('h1 img').count()===0&&await page.evaluate(()=>!window.__rippleXSS));
  await page.getByTestId('evidence-tab').click();check('imported_facts_not_labeled_fresh',await page.locator('.status-supported,.status-fresh').count()===0);
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'demo/T03-mobile-unverified.png',fullPage:true});
  check('mobile_board_no_horizontal_overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
  await page.getByTestId('delete-board').click();await page.getByTestId('confirm-delete-board').click();await page.getByTestId('new-board-title').waitFor();
  check('mobile_form_no_horizontal_overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
  await page.context().route('**/api/discover',async route=>route.fulfill({status:200,json:{mode:'live',request_id:'ui-discovery',results:[{title:'UI TEST CANDIDATE',url:'https://docs.python.org/3/'}],trace:{retrieval:[{kind:'search',provider:'UI TEST STUB',mode:'live',status:'succeeded'}],model_calls:0,elapsed_ms:1,limitations:[]}}}));
  await page.getByRole('button',{name:'Discover sources',exact:true}).click();
  await page.getByLabel('Search question').fill('UI TEST QUERY');await page.getByRole('button',{name:'Search sources',exact:false}).click();await page.getByText('UI TEST CANDIDATE',{exact:true}).waitFor();
  await page.getByRole('checkbox').check();check('discovery_chooser_uses_user_selected_candidate',await page.getByTestId('new-board-urls').inputValue()==='https://docs.python.org/3/');
  await page.context().unroute('**/api/discover');
  await page.getByTestId('simulation-tab').click();await page.getByTestId('run-simulation').click();await page.getByTestId('simulation-result').waitFor();
  check('simulation_visibly_synthetic',(await page.locator('main').innerText()).includes('SYNTHETIC'));
  await page.screenshot({path:'demo/T03-mobile-simulation.png',fullPage:true});
  await page.goto(base+'/privacy');const documentText=await page.locator('body').innerText();check('privacy_complete',['browser','Telem','model','Delete','limits'].every(s=>String(documentText).includes(s)));check('mobile_privacy_no_overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
  await page.goto(base+'/integrations');check('uncreated_kit_not_advertised',await page.locator('a[href="/downloads/ripple-agent-kit.zip"]').count()===0);
  await page.context().unroute('**/api/boards');await page.context().unroute('**/api/boards/refresh');
  const browser=page.context().browser();const isolated=await browser.newContext();
  const fresh=await isolated.newPage();await fresh.goto(base);await fresh.getByTestId('new-board-title').waitFor();check('independent_browser_starts_empty',!(await fresh.locator('body').innerText()).includes('UI TEST DATA'));await isolated.close();
  const blocked=await browser.newContext();await blocked.addInitScript(()=>Object.defineProperty(window,'indexedDB',{get(){throw new Error('Storage blocked by UI test');}}));
  const blockedPage=await blocked.newPage();await blockedPage.goto(base);await blockedPage.getByRole('alert').filter({hasText:'Local storage needs attention'}).waitFor();check('unavailable_storage_is_visible',true);await blocked.close();
  await page.goto(base);await page.keyboard.press('Tab');check('keyboard_skip_link_is_first',await page.evaluate(()=>document.activeElement?.classList.contains('skip-link')));await page.keyboard.press('Enter');check('skip_link_focuses_workspace',await page.evaluate(()=>document.activeElement?.id==='workspace'));
  await page.setViewportSize({width:1440,height:1000});
  return {kind:'LOCAL_UI_HARNESS_ONLY',api:'Actual unimplemented error, then explicitly substituted test API payloads',checks};
}
