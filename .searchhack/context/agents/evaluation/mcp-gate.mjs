/** Independent JSON-RPC client against the built MCP executable and actual deployed web API. */
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
const required=['protocol','catalog','real_custom_board','structured_evidence','local_reload','requirements_update','source_refresh','portable_archive','local_delete','source_rejection','revision_conflict','no_secret_summary'];
function assert(ok,msg){if(!ok)throw Error(msg);}
class Rpc {
 constructor(script,base,state,local=false){
  this.seq=0;this.buf='';this.pending=new Map();this.error='';
  const env={PATH:process.env.PATH,HOME:process.env.HOME??tmpdir(),RIPPLE_API_BASE_URL:base,RIPPLE_STATE_DIR:state,RIPPLE_SESSION_MAX_OPERATIONS:'8',RIPPLE_TOOL_TIMEOUT_MS:'55000',RIPPLE_ALLOW_LOCAL_HTTP:local?'true':'false'};
  this.p=spawn(process.execPath,[script],{env,stdio:['pipe','pipe','pipe']});
  this.p.stderr.on('data',d=>{this.error=(this.error+d).slice(-2000);});
  this.p.stdout.on('data',d=>{this.buf+=d;if(this.buf.length>2*1024*1024){this.rejectAll(Error('MCP output exceeds budget'));this.p.kill();return;}let n;while((n=this.buf.indexOf('\n'))>=0){const line=this.buf.slice(0,n);this.buf=this.buf.slice(n+1);let m;try{m=JSON.parse(line);}catch{this.rejectAll(Error('Non-JSON stdout'));continue;}const x=this.pending.get(m.id);if(x){clearTimeout(x.timer);this.pending.delete(m.id);m.error?x.reject(Error('MCP protocol error')):x.resolve(m.result);}}});
  this.p.on('error',()=>this.rejectAll(Error('MCP process failed to start')));
  this.p.on('exit',()=>this.rejectAll(Error('MCP exited before response')));
 }
 rejectAll(e){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(e);}this.pending.clear();}
 request(method,params={}){const id=++this.seq;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('MCP request timeout'));},70000);this.pending.set(id,{resolve,reject,timer});this.p.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});}
 async init(){const r=await this.request('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'ripple-independent-release-gate',version:'1'}});assert(r.protocolVersion==='2025-11-25'&&r.capabilities?.tools,'MCP initialization failed');this.p.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');return r;}
 async call(name,args={},wantError=false){const r=await this.request('tools/call',{name,arguments:args});assert(r?.content?.[0]?.type==='text'&&r.structuredContent,'No structured tool result');assert(JSON.stringify(JSON.parse(r.content[0].text))===JSON.stringify(r.structuredContent),'Text/structured result mismatch');if(!wantError)assert(!r.isError,'Tool failed: '+(r.structuredContent.error?.code??'unknown'));return r;}
 async close(){if(this.p.exitCode!==null)return;const ended=new Promise(r=>this.p.once('close',r));this.p.kill('SIGTERM');const timer=setTimeout(()=>this.p.kill('SIGKILL'),2000);await ended;clearTimeout(timer);}
}
export async function runGate(cfg){
 const report={schemaVersion:1,project:'ripple',gate:'agent-mcp-v1',base_url:cfg.base_url.replace(/\/$/,''),commit:cfg.commit,nonce:cfg.nonce,
  live:false,executed:false,passed:false,errors:[],checks:{},native_clients:{claude:'not-verified-by-this-gate',codex:'not-verified-by-this-gate'}};
 let rpc,state;
 const pass=name=>{report.checks[name]={passed:true,skipped:false};};
 try{
  const u=new URL(report.base_url);assert(u.pathname==='/'&&!u.search&&!u.hash&&!u.username&&!u.password,'Invalid origin');
  assert(u.protocol==='https:'||(cfg.local_test===true&&u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname)),'Deployed HTTPS origin required');
  report.live=u.protocol==='https:'&&cfg.local_test!==true;
  report.server_sha256=createHash('sha256').update(await readFile(cfg.server)).digest('hex');
  state=await mkdtemp(tmpdir()+'/ripple-mcp-gate-');
  rpc=new Rpc(resolve(cfg.server),report.base_url,state,cfg.local_test===true);report.executed=true;
  await rpc.init();pass('protocol');
  const catalog=await rpc.request('tools/list');
  for(const n of ['ripple_status','ripple_discover_sources','ripple_create_board','ripple_list_boards','ripple_get_board','ripple_refresh_board','ripple_export_board','ripple_import_board','ripple_delete_board'])assert(catalog.tools?.some(t=>t.name===n&&t.inputSchema&&t.annotations),'Missing tool '+n);
  pass('catalog');
  const health=(await rpc.call('ripple_status')).structuredContent.service;
  assert(health.status==='ok'&&health.project==='ripple'&&health.mode==='live'&&health.public_beta===true,'API is not the public live beta');
  assert((await rpc.call('ripple_list_boards')).structuredContent.boards.length===0,'Fresh vault is not empty');
  const title='Agent research '+cfg.nonce.slice(0,8);
  const created=(await rpc.call('ripple_create_board',{title,question:'What is the difference between network failures and HTTP errors when using fetch?',requirements:'Identify what must be checked explicitly.',urls:['https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch']})).structuredContent;
  assert(created.trust==='observed'&&created.board.title===title&&created.board_id&&created.board.question.includes('network failures'),'Custom live board failed');pass('real_custom_board');
  assert(created.board.sources.some(s=>s.url.includes('developer.mozilla.org')&&s.observedAt&&s.excerpt)&&created.board.facts.length&&created.board.answers.length&&created.trace?.retrieval?.some(r=>r.mode==='live'),'Missing live evidence');pass('structured_evidence');
  assert(!Object.hasOwn(created,'snapshot')&&!Object.hasOwn(created,'cookie')&&!JSON.stringify(created).includes('UPSTASH_REDIS_REST_TOKEN'),'Secrets in normal summary');pass('no_secret_summary');
  const id=created.board_id;
  await rpc.close();rpc=new Rpc(resolve(cfg.server),report.base_url,state,cfg.local_test===true);await rpc.init();
  const restored=(await rpc.call('ripple_get_board',{board_id:id})).structuredContent;assert(restored.board.title===title&&restored.local_revision===created.local_revision,'Local persistence failed');pass('local_reload');
  const conflict=await rpc.call('ripple_refresh_board',{board_id:id,expected_revision:9999},true);assert(conflict.isError&&conflict.structuredContent.error?.code==='REVISION_CONFLICT','Missing revision check');pass('revision_conflict');
  const requirement='Also explain how callers distinguish a failed HTTP status from a rejected request.';
  const edited=(await rpc.call('ripple_refresh_board',{board_id:id,expected_revision:restored.local_revision,requirements:requirement})).structuredContent;
  assert(edited.local_revision>restored.local_revision&&edited.board.requirements===requirement,'Requirements update missing');pass('requirements_update');
  const refreshed=(await rpc.call('ripple_refresh_board',{board_id:id,expected_revision:edited.local_revision})).structuredContent;
  assert(refreshed.local_revision>edited.local_revision&&refreshed.trace?.retrieval?.some(r=>r.mode==='live')&&refreshed.update,'Source refresh not observed');pass('source_refresh');
  const archive=(await rpc.call('ripple_export_board',{board_id:id})).structuredContent.archive;
  const imported=(await rpc.call('ripple_import_board',{archive})).structuredContent;
  assert(archive.format==='ripple-board-v1'&&imported.trust==='archived-unverified'&&imported.board.answers.every(a=>a.status==='unknown'),'Import incorrectly trusted');pass('portable_archive');
  await rpc.call('ripple_delete_board',{board_id:imported.board_id,expected_revision:imported.local_revision,confirm_title:title});
  assert(!(await rpc.call('ripple_list_boards')).structuredContent.boards.some(b=>b.board_id===imported.board_id),'Delete failed');pass('local_delete');
  const rejected=await rpc.call('ripple_create_board',{title:'Blocked',question:'Should not fetch',urls:['http://127.0.0.1/private']},true);
  assert(rejected.isError===true,'Private source accepted');pass('source_rejection');
  assert(required.every(n=>report.checks[n]?.passed),'Incomplete checks');report.passed=true;
 }catch(e){report.errors.push(String(e.message??e).slice(0,500));}
 finally{if(rpc)await rpc.close();if(state)await rm(state,{recursive:true,force:true});}
 return report;
}
async function main(){
 const i=process.argv.indexOf('--config');assert(i>=0&&process.argv[i+1],'Usage: node mcp-gate.mjs --config FILE');
 const cfg=JSON.parse(await readFile(process.argv[i+1],'utf8'));const r=await runGate(cfg);
 await mkdir(dirname(cfg.output),{recursive:true});await writeFile(cfg.output,JSON.stringify(r,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({gate:r.gate,passed:r.passed,live:r.live,checks:Object.keys(r.checks).length,errors:r.errors}));
 process.exitCode=r.passed?0:1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Agent gate configuration failed');process.exitCode=1;});
