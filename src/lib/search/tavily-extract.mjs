/** Server-only, bounded Tavily Extract adapter. Node >=22; no network work on import.
 * This is reusable reference code, not a second research engine. The caller MUST validate
 * its whole request and reserve shared public quotas before invoking this function.
 * Source text is untrusted data. Do not execute or follow instructions found inside it.
 */
import {createHash,randomUUID} from 'node:crypto';
const ENDPOINT='https://api.tavily.com/extract';
const MAX_BYTES=1_500_000, DEFAULT_MAX_CONTENT=30_000;
export function allowedSource(input,hosts){
 if(typeof input!=='string'||input.length>2048)throw new Error('SOURCE_NOT_ALLOWED');
 let u;try{u=new URL(input)}catch{throw new Error('SOURCE_NOT_ALLOWED')}
 if(u.protocol!=='https:'||u.username||u.password||u.port||!hosts.includes(u.hostname.toLowerCase())||u.hostname.endsWith('.'))throw new Error('SOURCE_NOT_ALLOWED');
 for(const k of u.searchParams.keys())if(/key|token|secret|authorization|password/i.test(k))throw new Error('SOURCE_NOT_ALLOWED');
 u.hash='';return u.href;
}
function failed(url,observedAt,code='TAVILY_SOURCE_UNAVAILABLE',requestId=null){
 return {url,status:'failed',extractor:'tavily',provider_request_id:requestId,content:'',contentHash:null,observedAt,cache_state:'unknown',truncated:false,error:code};
}
function cleanRequestId(x,key){return typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(x)&&!x.includes(key)&&!x.startsWith('tvly-')?x:null}
async function readBounded(response){
 if(Number(response.headers.get('content-length')||0)>MAX_BYTES)throw new Error('TAVILY_RESPONSE_TOO_LARGE');
 if(!response.body)throw new Error('TAVILY_INVALID_RESPONSE');
 const reader=response.body.getReader();let length=0;const parts=[];
 try{while(true){const r=await reader.read();if(r.done)break;length+=r.value.byteLength;if(length>MAX_BYTES)throw new Error('TAVILY_RESPONSE_TOO_LARGE');parts.push(Buffer.from(r.value));}}
 catch(e){await reader.cancel().catch(()=>{});throw e;}
 finally{reader.releaseLock();}
 try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new Error('TAVILY_INVALID_RESPONSE');}
}
export async function extractTavily(urls,options={}){
 if(typeof window!=='undefined')throw new Error('SERVER_ONLY');
 const key=options.apiKey??process.env.TAVILY_API_KEY;
 if(typeof key!=='string'||key.length<16||key.length>512||/\s/.test(key))throw new Error('TAVILY_KEY_MISSING');
 if(!Array.isArray(urls)||urls.length<1||urls.length>5)throw new Error('TAVILY_SOURCE_LIMIT');
 const hosts=options.allowedHosts;
 if(!Array.isArray(hosts)||!hosts.length||hosts.some(h=>typeof h!=='string'||!h||h.includes('*')))throw new Error('SOURCE_POLICY_REQUIRED');
 const requested=[...new Set(urls.map(u=>allowedSource(u,hosts)))];
 const MAX_CONTENT=Number.isInteger(options.maxContent)&&options.maxContent>0?Math.min(options.maxContent,300_000):DEFAULT_MAX_CONTENT;
 const observedAt=new Date().toISOString(),started=performance.now(),callId=randomUUID();
 const trace={kind:'fetch',provider:'tavily',service:'tavily',transport:'direct',endpoint:'extract',mode:'live',status:'failed',callId,requestId:null,usage:null,cache_state:'unknown',elapsed_ms:0,http_attempts:0,urls:requested};
 const makeFailure=(code,retryAfterSeconds=null)=>({sources:requested.map(u=>failed(u,observedAt,code)),trace:{...trace,elapsed_ms:Math.round(performance.now()-started)},error:{code,retryAfterSeconds},limitations:['A failed extraction does not prove a source fact is false.']});
 if(options.signal?.aborted)return makeFailure('CANCELLED');
 // Explicit timeouts, one attempt, no hidden retry loop or advanced-tier escalation.
 const timeout=AbortSignal.timeout(20_000);const signal=options.signal?AbortSignal.any([options.signal,timeout]):timeout;
 try{
  trace.http_attempts++;
  const response=await (options.fetchImpl||fetch)(ENDPOINT,{
   method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},redirect:'error',signal,
   body:JSON.stringify({urls:requested,extract_depth:'basic',format:'markdown',include_images:false,include_favicon:false,include_usage:true,timeout:15})
  });
  if(!response.ok){
   const retry=Number(response.headers.get('retry-after'));
   await response.body?.cancel().catch(()=>{});
   const code=response.status===429?'TAVILY_RATE_LIMITED':[401,403].includes(response.status)?'TAVILY_AUTH_FAILED':[402,432,433].includes(response.status)?'TAVILY_CREDIT_LIMIT':'TAVILY_HTTP_ERROR';
   return makeFailure(code,Number.isFinite(retry)&&retry>0?Math.min(retry,3600):null);
  }
  const data=await readBounded(response);
  if(!data||!Array.isArray(data.results)||('failed_results' in data&&!Array.isArray(data.failed_results)))return makeFailure('TAVILY_INVALID_RESPONSE');
  trace.requestId=cleanRequestId(data.request_id,key);
  if(data.usage&&typeof data.usage.credits==='number'&&Number.isFinite(data.usage.credits)&&data.usage.credits>=0)trace.usage={credits:data.usage.credits};
  const found=new Map();const failedURLs=new Set();let rejected=0;
  for(const r of data.failed_results||[]){try{const u=allowedSource(r.url,hosts);if(requested.includes(u))failedURLs.add(u);else rejected++;}catch{rejected++;}}
  for(const r of data.results){
   let u;try{u=allowedSource(r.url,hosts);}catch{rejected++;continue;}
   if(!requested.includes(u)){rejected++;continue;}
   if(found.has(u)){failedURLs.add(u);continue;}
   if(typeof r.raw_content!=='string'||r.raw_content.trim().length<40||r.raw_content.includes(key)){failedURLs.add(u);continue;}
   const truncated=r.raw_content.length>MAX_CONTENT;
   found.set(u,{url:u,status:truncated?'partial':'succeeded',extractor:'tavily',provider_request_id:trace.requestId,content:r.raw_content.slice(0,MAX_CONTENT),
       contentHash:createHash('sha256').update(r.raw_content).digest('hex'),observedAt,cache_state:'unknown',truncated,error:null});
  }
  const sources=requested.map(u=>failedURLs.has(u)?failed(u,observedAt,undefined,trace.requestId):found.get(u)||failed(u,observedAt,undefined,trace.requestId));
  const successes=sources.filter(s=>s.status==='succeeded').length,partial=sources.some(s=>s.status==='partial');
  trace.status=successes===sources.length?'succeeded':(successes>0||partial?'partial':'failed');trace.elapsed_ms=Math.round(performance.now()-started);
  const limitations=['Tavily extraction is an observation; upstream cache freshness and redirect chains are not independently established.'];
  if(rejected)limitations.push('Unrequested or out-of-policy provider results were rejected.');
  if(partial)limitations.push('Some source content was truncated; missing facts in omitted content remain unknown.');
  return {sources,trace,error:null,limitations};
 }catch(e){
  const code=options.signal?.aborted?'CANCELLED':timeout.aborted?'TAVILY_TIMEOUT':['TAVILY_RESPONSE_TOO_LARGE','TAVILY_INVALID_RESPONSE'].includes(e?.message)?e.message:'TAVILY_UNAVAILABLE';
  return makeFailure(code);
 }
}
