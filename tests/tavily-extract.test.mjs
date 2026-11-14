import test from 'node:test';
import assert from 'node:assert/strict';
import {extractTavily} from '../src/lib/search/tavily-extract.mjs';
const URL1='https://docs.telem.ai/api/', URL2='https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API';
const key='tvly-test-not-a-real-api-key';
const options=(fn,extra={})=>({apiKey:key,allowedHosts:['docs.telem.ai','developer.mozilla.org'],fetchImpl:fn,...extra});
const response=body=>new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
const body=()=>({request_id:'provider-request-1',results:[{url:URL1,raw_content:'A real source passage '.repeat(8)}],failed_results:[],usage:{credits:0}});
test('calls real endpoint shape and preserves exact observed usage and request ID',async()=>{
 let req;
 const r=await extractTavily([URL1],options(async(url,init)=>{req={url,init};return response(body());}));
 assert.equal(req?.url,'https://api.tavily.com/extract');assert.equal(req.init.redirect,'error');
 assert.equal(req.init.headers.Authorization,'Bearer '+key);
 const sent=JSON.parse(req.init.body);assert.equal(sent.extract_depth,'basic');assert.equal(sent.include_usage,true);assert.equal(sent.query,undefined);
 assert.equal(r.sources[0].extractor,'tavily');assert.equal(r.trace.service,'tavily');assert.equal(r.trace.transport,'direct');assert.equal(r.trace.requestId,'provider-request-1');assert.equal(r.trace.usage.credits,0);assert.equal(r.sources[0].cache_state,'unknown');
 assert.ok(!JSON.stringify(r).includes(key));
});
test('partial HTTP 200 retains explicit failure for each requested URL',async()=>{
 const b=body();b.failed_results=[{url:URL2,error:'raw error '+key}];
 const r=await extractTavily([URL1,URL2],options(async()=>response(b)));
 assert.equal(r.trace.status,'partial');assert.equal(r.sources.length,2);assert.equal(r.sources[1].status,'failed');assert.equal(r.sources[1].provider_request_id,'provider-request-1');assert.ok(!JSON.stringify(r).includes(key));
});
test('empty HTTP 200 is failed evidence, never success',async()=>{
 const r=await extractTavily([URL1],options(async()=>response({results:[],failed_results:[]})));
 assert.equal(r.trace.status,'failed');assert.equal(r.sources[0].status,'failed');
});
test('forbidden URLs rejected before the network',async()=>{
 for(const url of ['http://docs.telem.ai','https://127.0.0.1/a','https://user:pw@docs.telem.ai/','https://docs.telem.ai.evil.test/','https://docs.telem.ai:444/','https://docs.telem.ai/?api_key=hidden']){
 let calls=0;await assert.rejects(()=>extractTavily([url],options(async()=>{calls++;return response(body())})));assert.equal(calls,0);
 }
});
test('oversized batches and missing keys never call provider',async()=>{
 let calls=0;const fn=async()=>{calls++;return response(body())};
 await assert.rejects(()=>extractTavily(Array.from({length:6},(_,i)=>URL1+i),options(fn)));
 await assert.rejects(()=>extractTavily([URL1],options(fn,{apiKey:''})));assert.equal(calls,0);
});
test('unexpected result URL cannot become evidence',async()=>{
 const b=body();b.results[0].url='https://evil.test/';
 const r=await extractTavily([URL1],options(async()=>response(b)));assert.equal(r.sources[0].status,'failed');
});
test('duplicate source rows are ambiguous and fail closed',async()=>{
 const b=body();b.results.push({...b.results[0],raw_content:'conflict'});
 const r=await extractTavily([URL1],options(async()=>response(b)));assert.equal(r.sources[0].status,'failed');
});
test('429 not retried and raw provider error never exposed',async()=>{
 let calls=0;const r=await extractTavily([URL1],options(async()=>{calls++;return new Response('secret '+key,{status:429,headers:{'retry-after':'60'}})}));
 assert.equal(calls,1);assert.equal(r.trace.http_attempts,1);assert.equal(r.trace.status,'failed');assert.equal(r.error.code,'TAVILY_RATE_LIMITED');assert.equal(r.error.retryAfterSeconds,60);assert.ok(!JSON.stringify(r).includes(key));
});
test('content is bounded and truncation is labeled',async()=>{
 const b=body();b.results[0].raw_content='x'.repeat(50000);
 const r=await extractTavily([URL1],options(async()=>response(b)));assert.equal(r.sources[0].content.length,30000);assert.equal(r.sources[0].truncated,true);assert.equal(r.sources[0].status,'partial');
});
test('large wire response fails without unlimited buffering',async()=>{
 const r=await extractTavily([URL1],options(async()=>new Response('x'.repeat(1600000))));assert.equal(r.trace.status,'failed');assert.equal(r.error.code,'TAVILY_RESPONSE_TOO_LARGE');
});
test('no fabricated usage or request identifier when absent',async()=>{
 const b=body();delete b.usage;delete b.request_id;
 const r=await extractTavily([URL1],options(async()=>response(b)));assert.equal(r.trace.requestId,null);assert.equal(r.trace.usage,null);
});
test('abort yields one bounded failure without retries',async()=>{
 let calls=0;const controller=new AbortController();controller.abort();
 const r=await extractTavily([URL1],options(async()=>{calls++;throw new Error('network '+key)},{signal:controller.signal}));
 assert.equal(r.trace.status,'failed');assert.equal(calls,0);assert.equal(r.trace.http_attempts,0);assert.ok(!JSON.stringify(r).includes(key));
});
