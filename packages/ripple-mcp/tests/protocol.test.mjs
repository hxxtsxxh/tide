import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
const file=fileURLToPath(new URL('../src/server.mjs',import.meta.url));
test('stdio server implemented',()=>assert.ok(existsSync(file)));
async function run(fn){
 const dir=await mkdtemp(join(tmpdir(),'ripple-wire-'));
 const p=spawn(process.execPath,[file],{env:{...process.env,RIPPLE_API_BASE_URL:'https://ripple.example.com',RIPPLE_STATE_DIR:dir,RIPPLE_NETWORK_ENABLED:'false'},stdio:['pipe','pipe','pipe']});
 let buf='',stderr='';const waiting=new Map();p.stdout.on('data',d=>{buf+=d;let n;while((n=buf.indexOf('\n'))>=0){const line=buf.slice(0,n);buf=buf.slice(n+1);let r;try{r=JSON.parse(line);}catch{assert.fail('non-JSON stdout: '+line);}const task=waiting.get(r.id);if(task){clearTimeout(task.timer);waiting.delete(r.id);task.resolve(r);}}});p.stderr.on('data',d=>stderr+=d);
 const send=(msg)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('request timeout '+JSON.stringify(msg)+' '+stderr)),2000);waiting.set(msg.id??null,{resolve,reject,timer});p.stdin.write(typeof msg==='string'?msg+'\n':JSON.stringify(msg)+'\n');});
 const notify=msg=>p.stdin.write(JSON.stringify(msg)+'\n');
 try{await fn({send,notify,p,dir});}finally{for(const x of waiting.values())clearTimeout(x.timer);p.kill('SIGTERM');await new Promise(r=>p.once('close',r));await rm(dir,{recursive:true,force:true});}
}
const wire=(name,fn)=>test(name,{skip:!existsSync(file)},()=>run(fn));
wire('negotiation, tool discovery and local calls use valid JSON-RPC',async({send,notify})=>{
 const init=await send({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'independent-test',version:'1'}}});
 assert.equal(init.result.protocolVersion,'2025-11-25');assert.ok(init.result.capabilities.tools);
 notify({jsonrpc:'2.0',method:'notifications/initialized'});
 const list=await send({jsonrpc:'2.0',id:2,method:'tools/list',params:{}});
 assert.equal(list.result.tools.length,9);assert.ok(list.result.tools.every(t=>t.inputSchema&&t.annotations));
 const r=await send({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'ripple_list_boards',arguments:{}}});
 assert.deepEqual(r.result.structuredContent.boards,[]);assert.equal(r.result.content[0].type,'text');
 const disabled=await send({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'ripple_status',arguments:{}}});
 assert.equal(disabled.result.isError,true);assert.equal(disabled.result.structuredContent.error.code,'NETWORK_DISABLED');
});
wire('pre-initialization tools fail and old supported version negotiates',async({send,notify})=>{
 assert.equal((await send({jsonrpc:'2.0',id:1,method:'tools/list'})).error.code,-32002);
 const r=await send({jsonrpc:'2.0',id:2,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}}});assert.equal(r.result.protocolVersion,'2025-06-18');
 notify({jsonrpc:'2.0',method:'notifications/initialized'});
 assert.deepEqual((await send({jsonrpc:'2.0',id:3,method:'ping'})).result,{});
 assert.equal((await send({jsonrpc:'2.0',id:4,method:'no-such-method'})).error.code,-32601);
});
wire('malformed message does not crash the server or reveal environment',async({send})=>{
 const r=await send('{broken');assert.equal(r.error.code,-32700);
 assert.equal((await send({jsonrpc:'2.0',id:2,method:'initialize',params:{}})).error.code,-32602);
 assert.deepEqual((await send({jsonrpc:'2.0',id:3,method:'ping'})).result,{});
});
