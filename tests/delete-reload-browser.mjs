// Run as a function through Playwright MCP after a production build.
// Historical import only: no paid APIs or fabricated live evidence.
async (page) => {
  const base = 'http://127.0.0.1:4508';
  const checks = [];
  const ensure = (ok, message) => { if (!ok) throw new Error(message); };
  const board = { id:'T05-delete-reload',title:'T05 deletion regression archive',question:'Historical test, not live evidence',requirements:'',sources:[],facts:[],answers:[],revisions:[{id:'r1',parent_id:null,createdAt:'2026-11-14T19:00:00.000Z',kind:'created',summary:'Historical test'}] };
  const raw = Buffer.from(JSON.stringify({schemaVersion:1,format:'ripple-board-v1',board,snapshot:null,exportedAt:'2026-11-14T19:00:00.000Z'}));
  await page.goto(base);
  await page.getByTestId('new-board-title').waitFor();
  for (let i=0;i<10;i++) {
    await page.getByTestId('import-board-file').setInputFiles({name:'historical-test.json',mimeType:'application/json',buffer:raw});
    await page.getByTestId('board-title-current').waitFor();
    await page.getByTestId('delete-board').click();
    await page.getByTestId('confirm-delete-board').click();
    await page.reload({waitUntil:'domcontentloaded'});
    await page.getByTestId('new-board-title').waitFor();
    // Wait for storage loading, then inspect actual records rather than trusting the screen alone.
    await page.getByTestId('create-board').waitFor({state:'visible'});
    const records = await page.evaluate(async()=>new Promise((resolve,reject)=>{const r=indexedDB.open('ripple',1);r.onsuccess=()=>{const db=r.result;const tx=db.transaction(['boards','revisions','meta'],'readonly');const all={};for(const name of ['boards','revisions','meta']){const q=tx.objectStore(name).getAll();q.onsuccess=()=>all[name]=q.result;}tx.oncomplete=()=>{db.close();resolve(all);};tx.onerror=()=>reject(tx.error);};r.onerror=()=>reject(r.error);}));
    ensure(records.boards.length===0 && records.revisions.length===0,'Reload interrupted deletion');
    ensure(!(await page.locator('body').innerText()).includes(board.title),'Deleted title remains');
    checks.push({iteration:i+1,boardAndRevisionsRemoved:true});
  }
  return {passed:true,local_test:true,paidCalls:0,checks};
}
