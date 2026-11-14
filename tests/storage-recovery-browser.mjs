// Historical test data only. Run with Playwright MCP on a newly built local server.
async (page) => {
  const base='http://127.0.0.1:4508';
  const ensure=(ok,message)=>{if(!ok)throw new Error(message);};
  const board={id:'T05-storage-recovery',title:'T05 historical storage regression',question:'Test archive, no live observation',requirements:'',sources:[],facts:[],answers:[],revisions:[{id:'r1',parent_id:null,createdAt:'2026-11-14T19:00:00.000Z',kind:'test',summary:'Historical test'}]};
  const raw=Buffer.from(JSON.stringify({schemaVersion:1,format:'ripple-board-v1',board,snapshot:null,exportedAt:'2026-11-14T19:00:00.000Z'}));
  await page.goto(base);await page.getByTestId('new-board-title').waitFor();
  await page.evaluate(()=>{window.__T05transaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){if(args[1]==='readwrite')throw new DOMException('Test write failure','QuotaExceededError');return window.__T05transaction.apply(this,args);};});
  await page.getByTestId('import-board-file').setInputFiles({name:'historical.json',mimeType:'application/json',buffer:raw});
  await page.getByText('This result is not saved.',{exact:true}).waitFor();
  ensure((await page.locator('.board-storage-bar').innerText()).includes('Unsaved result'),'Write failure claimed a save');
  ensure(await page.getByRole('button',{name:'Download current-only recovery archive'}).count()===1,'Recovery export absent');
  await page.evaluate(()=>{IDBDatabase.prototype.transaction=window.__T05transaction;delete window.__T05transaction;});
  await page.getByRole('button',{name:'Save locally',exact:true}).click();await page.getByText('Saved in this browser',{exact:true}).waitFor();
  // A deletion intent from revision 1 must not remove a newer revision written by another tab.
  await page.evaluate(async(id)=>{localStorage.setItem('ripple:delete:v1:'+id,JSON.stringify({id,localRevision:1}));await new Promise((resolve,reject)=>{const r=indexedDB.open('ripple',1);r.onsuccess=()=>{const db=r.result;const tx=db.transaction('boards','readwrite');const q=tx.objectStore('boards').get(id);q.onsuccess=()=>tx.objectStore('boards').put({...q.result,localRevision:2});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};});},board.id);
  await page.reload();await page.getByRole('alert').filter({hasText:'Another tab changed this board'}).waitFor();
  const stored=await page.evaluate(async(id)=>new Promise((resolve,reject)=>{const r=indexedDB.open('ripple',1);r.onsuccess=()=>{const db=r.result;const tx=db.transaction('boards','readonly');const q=tx.objectStore('boards').get(id);q.onsuccess=()=>resolve(q.result?.localRevision);tx.oncomplete=()=>db.close();tx.onerror=reject;};}),board.id);
  ensure(stored===2,'Recovery deleted newer revision');
  await page.reload();await page.getByTestId('board-title-current').waitFor();
  await page.evaluate(()=>{window.__T05setItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('ripple:delete:'))throw new DOMException('Test journal unavailable','QuotaExceededError');return window.__T05setItem.call(this,key,value);};});
  await page.getByTestId('delete-board').click();await page.getByTestId('confirm-delete-board').click();
  await page.getByRole('alert').filter({hasText:'Deletion could not be recorded'}).waitFor();
  ensure(await page.getByTestId('board-title-current').count()===1,'Failed deletion hid saved board');
  await page.evaluate(()=>{Storage.prototype.setItem=window.__T05setItem;delete window.__T05setItem;});
  await page.getByTestId('confirm-delete-board').click();await page.getByTestId('new-board-title').waitFor();
  return {passed:true,local_test:true,paidCalls:0,writeFailureVisible:true,recoveryExport:true,retrySave:true,newerRevisionPreserved:true,journalFailurePreservesBoard:true};
}
