import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, mkdir, symlink, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const mod = await import('../src/bridge.mjs').catch(()=>({}));
test('adapter implementation is present',()=>assert.equal(typeof mod.Bridge,'function'));
const when = (name, fn) => test(name, {skip:!mod.Bridge}, fn);
function envelope(req={}, title='User research') {
 return {schemaVersion:1, project:'ripple',mode:'live',request_id:req.request_id,
 board:{id:'remote-board',title,question:req.question??'How do requests fail?',requirements:req.requirements??'',
 sources:[{id:'s1',url:'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API',title:'Fetch',status:'succeeded',observedAt:new Date().toISOString(),contentHash:'hash',excerpt:'HTTP errors do not reject fetch.'}],
 facts:[{id:'f1',value:true,status:'supported',source_id:'s1',quote:'HTTP errors do not reject fetch.'}],
 answers:[{id:'a1',text:'Inspect the HTTP status.',depends_on:['f1'],status:'fresh'}],revisions:[{id:'r1',parent_id:null,createdAt:new Date().toISOString(),kind:'observed',summary:'Fetched'}]},
 snapshot:'PRIVATE_SIGNED_SNAPSHOT',update:{affected:['a1'],recomputed:['a1'],reused:[],unknown:[]},
 trace:{retrieval:[{kind:'fetch',provider:'test-provider',mode:'live',status:'succeeded'}],model_calls:1,elapsed_ms:5,limitations:[]}};
}
async function context(fn, overrides={}) {
 const dir=await mkdtemp(join(tmpdir(),'ripple-agent-')); const calls=[];
 const fetchImpl=async(url,opts={})=>{
  calls.push({url:String(url),opts}); const body=opts.body?JSON.parse(opts.body):{};
  if(String(url).endsWith('/api/health')) return Response.json({status:'ok',project:'ripple',mode:'live',public_beta:true});
  if(String(url).endsWith('/api/session')) return Response.json({ok:true},{headers:{'set-cookie':'ripple_visitor=SIGNED_TEST_COOKIE; Path=/; HttpOnly; Secure'}});
  if(String(url).endsWith('/api/discover')) return Response.json({mode:'live',results:[{url:'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API',title:'Fetch'}],trace:{retrieval:[]}});
  return Response.json(envelope(body,body.title));
 };
 const b=new mod.Bridge({baseUrl:'https://ripple.example.com',stateDir:dir,fetchImpl,...overrides});
 try{await fn(b,dir,calls,fetchImpl);}finally{await rm(dir,{recursive:true,force:true});}
}
const create={title:'User research',question:'How do requests fail?',requirements:'',urls:['https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API']};
when('base URL disallows credentials, paths, queries, insecure and private destinations',()=>{
 for(const s of ['http://example.com','https://u:p@example.com','https://example.com/api','https://example.com/?a=b','https://127.0.0.1','https://localhost','https://169.254.169.254'])assert.throws(()=>mod.validateBaseUrl(s));
 assert.equal(mod.validateBaseUrl('https://example.com/'),'https://example.com');
 assert.equal(mod.validateBaseUrl('http://127.0.0.1:3210',{allowLocal:true}),'http://127.0.0.1:3210');
});
when('create persists and ordinary outputs hide signatures and cookies',()=>context(async(b,dir,calls)=>{
 const result=await b.call('ripple_create_board',create);
 assert.ok(result.board_id);assert.equal(result.trust,'observed');
 assert.equal(result.board.title,create.title);assert.equal(result.local_revision,1);
 assert.ok(!JSON.stringify(result).includes('PRIVATE_SIGNED'));assert.ok(!JSON.stringify(result).includes('SIGNED_TEST_COOKIE'));
 const sent=calls.find(c=>c.url.endsWith('/api/boards')).opts;
 assert.equal(sent.headers.Origin,'https://ripple.example.com');assert.match(sent.headers.Cookie,/ripple_visitor=/);
 const again=await b.call('ripple_get_board',{board_id:result.board_id});assert.equal(again.board_id,result.board_id);
 assert.equal((await stat(b.store.root)).mode & 0o777,0o700);
}));
when('state survives a new bridge and is isolated by API origin',()=>context(async(b,dir,calls,f)=>{
 const result=await b.call('ripple_create_board',create);
 const second=new mod.Bridge({baseUrl:b.baseUrl,stateDir:dir,fetchImpl:f});
 assert.equal((await second.call('ripple_list_boards',{})).boards[0].board_id,result.board_id);
 const other=new mod.Bridge({baseUrl:'https://other.example.com',stateDir:dir,fetchImpl:f});
 assert.equal((await other.call('ripple_list_boards',{})).boards.length,0);
}));
when('refresh uses signed snapshot and rejects outdated local revision before paid calls',()=>context(async(b,dir,calls)=>{
 const r=await b.call('ripple_create_board',create);const n=calls.length;
 await assert.rejects(b.call('ripple_refresh_board',{board_id:r.board_id,expected_revision:99}),/REVISION_CONFLICT/);
 assert.equal(calls.length,n);
 const next=await b.call('ripple_refresh_board',{board_id:r.board_id,expected_revision:1,requirements:'Handle network failures'});
 assert.equal(next.local_revision,2);
 const req=JSON.parse(calls.at(-1).opts.body);assert.equal(req.snapshot,'PRIVATE_SIGNED_SNAPSHOT');assert.equal(req.force,false);
}));
when('export/import is explicit, archived and rebuilt not trusted',()=>context(async(b,dir,calls)=>{
 const original=await b.call('ripple_create_board',create);
 const exported=await b.call('ripple_export_board',{board_id:original.board_id});
 assert.equal(exported.archive.format,'ripple-board-v1');
 const imported=await b.call('ripple_import_board',{archive:exported.archive});
 assert.notEqual(imported.board_id,original.board_id);assert.equal(imported.trust,'archived-unverified');
 assert.equal(imported.board.answers[0].status,'unknown');
 const rebuilt=await b.call('ripple_refresh_board',{board_id:imported.board_id,expected_revision:1});
 assert.equal(rebuilt.trust,'observed');assert.ok(calls.at(-1).url.endsWith('/api/boards'));
 assert.ok(!('snapshot' in JSON.parse(calls.at(-1).opts.body)));
}));
when('delete requires exact title and revision, preserves other boards',()=>context(async(b)=>{
 const r=await b.call('ripple_create_board',create);
 await assert.rejects(b.call('ripple_delete_board',{board_id:r.board_id,expected_revision:1,confirm_title:'wrong'}),/CONFIRMATION_REQUIRED/);
 await assert.rejects(b.call('ripple_delete_board',{board_id:r.board_id,expected_revision:2,confirm_title:create.title}),/REVISION_CONFLICT/);
 assert.equal((await b.call('ripple_delete_board',{board_id:r.board_id,expected_revision:1,confirm_title:create.title})).deleted,true);
 assert.equal((await b.call('ripple_list_boards',{})).boards.length,0);
}));
when('untrusted input cannot change endpoint, choose path, inject keys or use private source URLs',()=>context(async(b,dir,calls)=>{
 for(const args of [{...create,baseUrl:'https://attacker.invalid'},{...create,urls:['http://127.0.0.1']},{...create,urls:['https://user:pass@example.com']},{...create,urls:['https://127.0.0.1']},{...create,question:'x'.repeat(2001)}])await assert.rejects(b.call('ripple_create_board',args));
 await assert.rejects(b.call('ripple_get_board',{board_id:'../../secret'}));
 await assert.rejects(b.call('ripple_import_board',{archive:JSON.parse('{"__proto__":{"x":true}}')}));
 assert.equal(calls.length,0);
}));
when('session budget bounds repeated paid operations, read-only remains available',()=>context(async(b)=>{
 await b.call('ripple_create_board',create);
 await assert.rejects(b.call('ripple_create_board',create),/SESSION_BUDGET_EXCEEDED/);
 assert.equal((await b.call('ripple_list_boards',{})).boards.length,1);
},{maxOperations:1}));
when('shared local lock refuses concurrency rather than losing state',()=>context(async(b,dir,calls)=>{
 await b.store.init();const lock=join(b.store.root,'.lock');await mkdir(lock,{mode:0o700});
 await assert.rejects(b.call('ripple_create_board',create),/VAULT_BUSY/);assert.equal(calls.length,0);
}));
when('symlink vault files cannot redirect writes',()=>context(async(b,dir)=>{
 await b.store.init();const target=join(dir,'outside');await mkdir(target);
 await symlink(target,join(b.store.root,'boards'));
 await assert.rejects(b.call('ripple_create_board',create),/UNSAFE_LOCAL_PATH/);
}));
when('upstream rate limit is structured and not automatically retried',()=>context(async(b,dir,calls)=>{
 let attempted=0;
 b.fetchImpl=async(url)=>{if(url.endsWith('/api/session'))return Response.json({ok:true},{headers:{'set-cookie':'ripple_visitor=SIGNED_TEST_COOKIE; Path=/; HttpOnly; Secure'}});attempted++;return Response.json({error:{code:'QUOTA_EXCEEDED',message:'PRIVATE_PROVIDER_DETAIL'}},{status:429,headers:{'retry-after':'60'}});};
 await assert.rejects(b.call('ripple_create_board',create),e=>e.code==='QUOTA_EXCEEDED'&&e.retryAfter===60&&!e.message.includes('PRIVATE_PROVIDER'));
 assert.equal(attempted,1);
}));
when('redirects and oversize upstream responses fail closed',()=>context(async(b)=>{
 b.fetchImpl=async(url)=>url.endsWith('/api/session')?Response.json({ok:true},{headers:{'set-cookie':'ripple_visitor=SIGNED_TEST_COOKIE; Path=/; HttpOnly; Secure'}}):new Response('',{status:302,headers:{location:'https://evil.example'}});
 await assert.rejects(b.call('ripple_create_board',create),/UPSTREAM_REDIRECT/);
 b.fetchImpl=async()=>new Response('x'.repeat(800000));
 await assert.rejects(b.call('ripple_status',{}),/RESPONSE_TOO_LARGE/);
}));
when('fixture and malformed envelopes cannot become observed boards',()=>context(async(b)=>{
 b.fetchImpl=async(url,opts)=>{if(url.endsWith('/api/session'))return Response.json({ok:true},{headers:{'set-cookie':'ripple_visitor=SIGNED_TEST_COOKIE; Path=/; HttpOnly; Secure'}});const e=envelope(JSON.parse(opts.body));e.mode='fixture';return Response.json(e);};
 await assert.rejects(b.call('ripple_create_board',create),/INVALID_LIVE_RESPONSE/);
}));
when('invalid supporting quote and dangling dependency rejected',()=>{
 const e=envelope();e.board.facts[0].quote='not present';assert.throws(()=>mod.validateEnvelope(e),/INVALID_LIVE_RESPONSE/);
 const e2=envelope();e2.board.answers[0].depends_on=['missing'];assert.throws(()=>mod.validateEnvelope(e2),/INVALID_LIVE_RESPONSE/);
});
when('a configured disabled integration cannot make network calls',()=>context(async(b,dir,calls)=>{
 b.enabled=false;await assert.rejects(b.call('ripple_create_board',create),/NETWORK_DISABLED/);assert.equal(calls.length,0);
 assert.equal((await b.call('ripple_list_boards',{})).boards.length,0);
}));
export {envelope};
when('requirement-only recomputation can reuse source observations without a fresh fetch',()=>context(async(b,dir,calls,f)=>{
 const r=await b.call('ripple_create_board',create);
 b.fetchImpl=async(url,opts)=>{const response=await f(url,opts);const e=await response.json();e.trace.retrieval=[];return Response.json(e);};
 const updated=await b.call('ripple_refresh_board',{board_id:r.board_id,expected_revision:1,requirements:'Review HTTP status explicitly'});
 assert.equal(updated.local_revision,2);
}));
when('cancellation before admission never starts a paid request',()=>context(async(b,dir,calls)=>{
 const c=new AbortController();c.abort();await assert.rejects(b.call('ripple_create_board',create,c.signal),/REQUEST_CANCELLED/);assert.equal(calls.length,0);
}));
when('missing anonymous cookie blocks paid dispatch instead of reminting identities',()=>context(async(b)=>{
 let requests=0;b.fetchImpl=async()=>{requests++;return Response.json({ok:true});};
 await assert.rejects(b.call('ripple_create_board',create),/SESSION_COOKIE_MISSING/);
 assert.equal(requests,1);
}));
