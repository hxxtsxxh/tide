#!/usr/bin/env node
/** Executes the implemented website. Never generates app screenshots or fake live responses.
 * Run by common/ripple_public.py after deployment; command line --config path only.
 * Report contains verdicts/counts/IDs, not response bodies, cookies, or customer data.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const args=process.argv.slice(2), configPath=args[args.indexOf('--config')+1];
let browser;
let report;
const checks={};
const ensure=(ok,message)=>{if(!ok)throw new Error(message);};
const isoValid=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
async function main(){
 const c=JSON.parse(await fs.readFile(configPath,'utf8'));
 const base=c.base_url.replace(/\/$/,'');const u=new URL(base);
 ensure(u.protocol==='https:'|| (c.local_test===true&&['127.0.0.1','localhost'].includes(u.hostname)),'Public beta needs an HTTPS deployment');
 report={schemaVersion:1,project:'ripple',gate:'public-beta-v1',base_url:base,commit:c.commit,nonce:c.nonce,live:true,executed:true,passed:false,checks,errors:[],startedAt:new Date().toISOString()};
 async function check(name,fn){try{const detail=await fn();checks[name]={passed:true,...detail};}catch(e){checks[name]={passed:false};report.errors.push(name+': '+String(e.message||e).slice(0,160));}}
 const req=createRequire(path.join(c.tools_dir,'package.json'));const {chromium}=req('playwright');
 browser=await chromium.launch({headless:true,...(c.local_test===true&&c.browser_executable?{executablePath:c.browser_executable}:{})});
 const context=await browser.newContext({viewport:{width:1365,height:900},acceptDownloads:true});
 const page=await context.newPage();page.setDefaultTimeout(Math.min(15000,c.action_timeout_ms||15000));
 const origin={'Origin':base,'Content-Type':'application/json'};
 const post=(endpoint,data,headers=origin)=>context.request.post(base+endpoint,{data,headers,timeout:60000});
 const uniq='Public gate '+c.nonce;let created,edited,refreshed;
 const urls=c.urls||['https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch','https://developer.mozilla.org/en-US/docs/Web/API/AbortController'];
 await check('public_home',async()=>{const r=await page.goto(base,{waitUntil:'domcontentloaded'});ensure(r?.ok(),'Home not accessible');ensure(!/vercel.com\/login/.test(page.url()),'Login protection');await page.getByTestId('new-board-title').waitFor();ensure((await context.request.get(base+'/api/session')).ok(),'Anonymous session failed');});
 await check('server_safety_contract',async()=>{
  const r=await context.request.get(base+'/api/health');ensure(r.ok(),'Health failed');const d=await r.json();
  ensure(d.project==='ripple'&&d.mode==='live'&&d.public_beta===true,'Public-beta live health absent');
  ensure(d.safety?.durable_quota===true&&d.safety?.signed_snapshots===true&&d.safety?.bounded_sources===true,'Safety contract absent');
  ensure(Number.isInteger(d.limits?.sources)&&d.limits.sources>=1&&d.limits.sources<=5,'Source cap absent');
  ensure(Number.isInteger(d.limits?.model_calls)&&d.limits.model_calls<=6,'Model cap absent');
  return {note:'Configuration assertions; actual behavior is separately tested. Not a security audit.'};
 });
 await check('source_rejection',async()=>{
  for(const url of ['https://127.0.0.1/','http://169.254.169.254/','https://docs.telem.ai.evil.invalid/']){
   const r=await post('/api/boards',{request_id:randomUUID(),title:'Invalid',question:'Read this',requirements:'',urls:[url]});
   ensure([400,403,422].includes(r.status()),'Unsafe source was not rejected');const d=await r.json();ensure(d.error?.code,'Structured source rejection absent');
  }
 });
 await check('cross_origin_rejection',async()=>{
  const r=await post('/api/boards',{request_id:randomUUID(),title:'Cross-origin',question:'Test',requirements:'',urls},{Origin:'https://untrusted.invalid','Content-Type':'application/json'});
  ensure(r.status()===403,'Cross-origin mutation not refused');
 });
 await check('real_custom_board',async()=>{
  await page.getByTestId('new-board-title').fill(uniq);
  await page.getByTestId('new-board-question').fill(c.question||'How can browser fetch requests support cancellation and handle HTTP error responses?' );
  await page.getByTestId('new-board-urls').fill(urls.join('\n'));
  await page.getByTestId('new-board-requirements').fill('Requests may run until completion, but HTTP failures must be shown.');
  const waiting=page.waitForResponse(r=>r.url().split('?')[0]===base+'/api/boards'&&r.request().method()==='POST',{timeout:90000});
  const [r]=await Promise.all([waiting,page.getByTestId('create-board').click()]);ensure(r.ok(),'Custom create failed');created=await r.json();
  ensure(created.mode==='live'&&created.board?.title===uniq&&created.board?.id&&created.snapshot,'Custom data not preserved');
  ensure(created.board.facts?.length>0&&created.board.answers?.some(a=>a.text&&a.status!=='unknown'),'No usable live result');
  await page.getByTestId('board-title-current').waitFor();ensure((await page.getByTestId('board-title-current').textContent()).includes(uniq),'Custom board not displayed');
 });
 await check('observed_provenance',async()=>{
  ensure(created,'No created board');
  const sources=created.board.sources;ensure(Array.isArray(sources)&&sources.length>0,'No sources');
  ensure(sources.some(s=>urls.includes(s.url)),'Selected source ignored');
  for(const f of created.board.facts.filter(f=>f.status==='supported')){
   const s=sources.find(s=>s.id===f.source_id);ensure(s?.status==='succeeded'&&isoValid(s.observedAt),'No successful source');
   ensure(f.quote&&typeof s.excerpt==='string'&&s.excerpt.includes(f.quote),'Quote not in supplied source passage');
  }
  ensure(created.board.facts.some(f=>f.status==='supported'),'No supported facts');
  ensure(created.trace?.retrieval?.some(r=>r.kind==='fetch'&&r.status==='succeeded'&&r.provider&&r.mode==='live'),'No observed Telem fetch');
  ensure(!created.trace.retrieval.some(r=>r.mode==='fixture'),'Fixture provenance in live board');
 });
 await check('persistent_reload',async()=>{ensure(created,'Missing board');await page.reload({waitUntil:'domcontentloaded'});await page.getByTestId('board-title-current').waitFor();ensure((await page.getByTestId('board-title-current').textContent()).includes(uniq),'Reload lost saved board');});
 await check('independent_browser',async()=>{
  const other=await browser.newContext();try{const p=await other.newPage();await p.goto(base,{waitUntil:'domcontentloaded'});await p.getByTestId('new-board-title').waitFor();ensure(!(await p.locator('body').textContent()).includes(uniq),'Research leaked to separate browser');}finally{await other.close();}
 });
 await check('requirement_edit',async()=>{
  ensure(created,'Missing board');await page.getByTestId('board-requirements').fill('Requests must be cancelled after five seconds, and HTTP failures must be shown.');
  const waiting=page.waitForResponse(r=>r.url().split('?')[0]===base+'/api/boards/refresh'&&r.request().method()==='POST',{timeout:90000});
  const [r]=await Promise.all([waiting,page.getByTestId('apply-requirements').click()]);ensure(r.ok(),'Requirement edit failed');edited=await r.json();
  ensure(edited.board?.id===created.board.id&&edited.board.requirements.includes('five seconds'),'Edit ignored');
  ensure(edited.board.revisions.length>created.board.revisions.length,'Prior revision not preserved');
  ensure(edited.board.answers?.some(a=>a.text)&&edited.snapshot,'No edited result');
 });
 await check('live_refresh',async()=>{
  ensure(edited,'No edited board');const waiting=page.waitForResponse(r=>r.url().split('?')[0]===base+'/api/boards/refresh'&&r.request().method()==='POST',{timeout:90000});
  const [r]=await Promise.all([waiting,page.getByTestId('refresh-board').click()]);ensure(r.ok(),'Refresh failed');refreshed=await r.json();
  ensure(refreshed.mode==='live'&&refreshed.board?.id===created.board.id,'Wrong refreshed board');
  ensure(refreshed.trace?.retrieval?.some(x=>x.kind==='fetch'&&x.mode==='live'),'No source recheck observed');
  ensure(refreshed.board.revisions.length>edited.board.revisions.length,'Refresh did not preserve history');
  const sets=refreshed.update;ensure(sets&&Array.isArray(sets.affected)&&Array.isArray(sets.reused)&&Array.isArray(sets.recomputed),'No update accounting');
  ensure(!sets.recomputed.some(x=>sets.reused.includes(x)),'Recomputed/reused overlap');
 });
 await check('tamper_rejection',async()=>{
  ensure(created,'Missing snapshot');const r=await post('/api/boards/refresh',{request_id:randomUUID(),snapshot:created.snapshot+'x',requirements:'forged',force:true});
  ensure([400,401,409,422].includes(r.status()),'Forged snapshot accepted');
 });
 await check('export_import_delete',async()=>{
  ensure(created,'Missing board');const waiting=page.waitForEvent('download');const [download]=await Promise.all([waiting,page.getByTestId('export-board').click()]);
  const tmp=path.join(c.artifacts_dir,'public-gate-export.json');await download.saveAs(tmp);const raw=await fs.readFile(tmp,'utf8');
  const exported=JSON.parse(raw);ensure(exported.board?.id===created.board.id,'Export missing board');
  await page.getByTestId('delete-board').click();await page.getByTestId('confirm-delete-board').click();
  await page.reload({waitUntil:'domcontentloaded'});await page.getByTestId('new-board-title').waitFor();ensure(!(await page.locator('body').textContent()).includes(uniq),'Deleted board remains');
  await page.getByTestId('import-board-file').setInputFiles(tmp);await page.getByTestId('board-title-current').waitFor();ensure((await page.getByTestId('board-title-current').textContent()).includes(uniq),'Import failed');
  await page.getByTestId('import-revalidation-notice').waitFor();
  await page.getByTestId('delete-board').click();await page.getByTestId('confirm-delete-board').click();await fs.unlink(tmp);
 });
 await check('search_discovery',async()=>{
  const r=await post('/api/discover',{request_id:randomUUID(),query:'Telem fetch batching and page failure behavior'});ensure(r.ok(),'Discovery failed');const d=await r.json();
  ensure(d.mode==='live'&&d.results?.some(x=>x.url&&x.title),'No discovery candidates');
  ensure(d.trace?.retrieval?.some(x=>x.kind==='search'&&x.provider&&x.mode==='live'),'No actual search trace');
 });
 await check('privacy_and_limits',async()=>{await page.goto(base+'/privacy',{waitUntil:'domcontentloaded'});const text=(await page.locator('body').textContent()).toLowerCase();for(const s of ['browser','telem','model','delete','public','limit'])ensure(text.includes(s),'Privacy/limits text incomplete');});
 await check('mobile_layout',async()=>{await page.setViewportSize({width:390,height:844});await page.goto(base,{waitUntil:'domcontentloaded'});await page.getByTestId('new-board-title').waitFor();ensure(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2),'Mobile page overflows');});
 report.passed=report.errors.length===0&&Object.keys(checks).length===15;report.completedAt=new Date().toISOString();
 await fs.mkdir(c.artifacts_dir,{recursive:true});await fs.writeFile(c.output,JSON.stringify(report,null,2));
 console.log(JSON.stringify({passed:report.passed,checks:Object.keys(checks).length,errors:report.errors}));
 await browser.close();browser=null;process.exitCode=report.passed?0:1;
}
const timer=setTimeout(()=>{if(browser)browser.close().catch(()=>{});process.exitCode=1;},330000);timer.unref();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{browser?.close().finally(()=>process.exit(1));});
main().catch(async e=>{
 if(report){report.errors.push('Gate execution failed: '+String(e.message||e).slice(0,160));report.passed=false;try{const c=JSON.parse(await fs.readFile(configPath,'utf8'));await fs.writeFile(c.output,JSON.stringify(report,null,2));}catch{}}
 console.error('Public gate could not complete. Check browser installation and actual application.');process.exitCode=1;
}).finally(async()=>{clearTimeout(timer);if(browser)await browser.close().catch(()=>{});});
