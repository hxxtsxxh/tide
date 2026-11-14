import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSourceUrl, signSnapshot, verifySnapshot, reserveBudget, RunBudget} from '../reference/guards.mjs';
const secret='a'.repeat(64), hosts=['docs.telem.ai','developer.mozilla.org'];

test('exact https host allowlist and canonical fragment removal',()=>{
 assert.equal(normalizeSourceUrl('https://docs.telem.ai/api/#section',hosts),'https://docs.telem.ai/api/');
});
for(const url of ['http://docs.telem.ai/api/','https://docs.telem.ai.evil.org/', 'https://user:pass@docs.telem.ai/', 'https://127.0.0.1/', 'https://[::1]/', 'https://2130706433/', 'https://docs.telem.ai:8443/','https://docs.telem.ai/?token=secret','https://docs.telem.ai/?X-Amz-Signature=abc','https://docs.telem.ai./']) {
 test('reject source '+url,()=>assert.throws(()=>normalizeSourceUrl(url,hosts)));
}
test('signed snapshot survives serialization, expires and rejects client edits',()=>{
 const token=signSnapshot({board_id:'b1',revision:1,facts:[{value:5}]},secret,1000,60);
 assert.equal(verifySnapshot(token,secret,1030).board_id,'b1');
 assert.throws(()=>verifySnapshot(token,secret,1061));
 assert.throws(()=>verifySnapshot(token+'x',secret,1030));
 const [body,mac]=token.split('.');const obj=JSON.parse(Buffer.from(body,'base64url'));obj.data.facts[0].value=500;
 assert.throws(()=>verifySnapshot(Buffer.from(JSON.stringify(obj)).toString('base64url')+'.'+mac,secret,1030));
 assert.throws(()=>verifySnapshot(token,'b'.repeat(64),1030));
});
test('short secrets and oversized snapshots fail',()=>{
 assert.throws(()=>signSnapshot({},'weak',1000));
 assert.throws(()=>signSnapshot({text:'x'.repeat(600000)},secret,1000));
 assert.throws(()=>verifySnapshot('x'.repeat(800000),secret,1000));
});
test('local operation budget counts attempts and enforces timeout',()=>{
 let now=0;const b=new RunBudget({maxCalls:2,timeoutMs:100},()=>now);
 b.take();b.take();assert.throws(()=>b.take());
 now=101;assert.throws(()=>b.assertTime());
});
test('quota issues one atomic EVAL with global and visitor limits, no secret in URL',async()=>{
 const seen=[];
 const f=async(url,options)=>{seen.push([url,options]);return new Response(JSON.stringify({result:[1,1,1,1,60]}));};
 const r=await reserveBudget({url:'https://example.upstash.io',token:'test-token',secret,visitor:'visitor-A',now:1700000000000,fetchImpl:f});
 assert.equal(r.allowed,true);assert.equal(seen.length,1);
 const command=JSON.parse(seen[0][1].body);assert.equal(command[0],'EVAL');assert.equal(command[2],3);
 assert.ok(!seen[0][0].includes('test-token'));assert.ok(!seen[0][1].body.includes('visitor-A'));
});
test('quota unavailable fails closed and limits cannot be bypassed',async()=>{
 await assert.rejects(reserveBudget({url:'https://evil.test',token:'t',secret,visitor:'v'}));
 await assert.rejects(reserveBudget({url:'https://example.upstash.io',token:'t',secret,visitor:'v',fetchImpl:async()=>{throw new Error('secret-response');}}));
 const r=await reserveBudget({url:'https://example.upstash.io',token:'t',secret,visitor:'v',fetchImpl:async()=>new Response(JSON.stringify({result:[0,200,20,4,60]}))});
 assert.equal(r.allowed,false);assert.equal(r.retryAfter,60);
});
test('invalid Redis replies do not authorize a run',async()=>{
 for(const result of [[],['1'],null,{},[1], [2,0,0,0,0]]){
  await assert.rejects(reserveBudget({url:'https://example.upstash.io',token:'t',secret,visitor:'v',fetchImpl:async()=>new Response(JSON.stringify({result}))}));
 }
});

test('private literal and local names rejected even when mistakenly allowlisted',()=>{
 for(const host of ['127.0.0.1','[::1]','localhost','metadata.internal'])
  assert.throws(()=>normalizeSourceUrl('https://'+host+'/',[host]));
});
