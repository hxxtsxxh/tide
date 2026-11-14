/** Server-only reference implementation. No API keys belong in browser bundles.
 * Copy/adapt into src/lib/server/ and import 'server-only' in the app wrapper.
 * These primitives are not a complete endpoint or a production security audit.
 */
import {createHmac, timingSafeEqual} from 'node:crypto';
import {isIP} from 'node:net';

export function normalizeSourceUrl(input, allowedHosts) {
 if(typeof input!=='string'||input.length>2048||/[\u0000-\u0020\\]/u.test(input)) throw new Error('INVALID_SOURCE_URL');
 let u;try{u=new URL(input);}catch{throw new Error('INVALID_SOURCE_URL');}
 const hosts=new Set(allowedHosts.map(x=>x.toLowerCase()));
 const host=u.hostname.toLowerCase();
 // IP literals and local/reserved names are never permitted, even after a bad operator edit.
 if(isIP(host.replace(/^\[|\]$/g,''))||host==='localhost'||/\.(?:localhost|local|internal|lan)$/.test(host)) throw new Error('SOURCE_NOT_ALLOWED');
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.hostname.endsWith('.')||!hosts.has(u.hostname.toLowerCase())) throw new Error('SOURCE_NOT_ALLOWED');
 for(const name of u.searchParams.keys()) if(/token|secret|password|credential|signature|api.?key|authorization|^code$|^key$/i.test(name)) throw new Error('PRIVATE_URL_NOT_ALLOWED');
 u.hash='';return u.href;
}
function key(secret){
 if(typeof secret!=='string'||secret.length<32) throw new Error('STATE_SECRET_REQUIRED');
 return secret;
}
function mac(body,secret){return createHmac('sha256',key(secret)).update('ripple-snapshot-v1\0'+body).digest();}
export function signSnapshot(data,secret,now=Math.floor(Date.now()/1000),ttl=86400){
 if(!Number.isSafeInteger(now)||!Number.isInteger(ttl)||ttl<1||ttl>604800)throw new Error('INVALID_EXPIRY');
 const raw=JSON.stringify({v:1,issued:now,expires:now+ttl,data});
 if(Buffer.byteLength(raw)>400000)throw new Error('SNAPSHOT_TOO_LARGE');
 const body=Buffer.from(raw).toString('base64url');
 return body+'.'+mac(body,secret).toString('base64url');
}
export function verifySnapshot(token,secret,now=Math.floor(Date.now()/1000)){
 if(typeof token!=='string'||token.length>550000||!/^[\w-]+\.[\w-]+$/.test(token))throw new Error('INVALID_SNAPSHOT');
 const [body,signature]=token.split('.');const expected=mac(body,secret),got=Buffer.from(signature,'base64url');
 if(got.length!==expected.length||!timingSafeEqual(got,expected))throw new Error('INVALID_SNAPSHOT');
 let obj;try{obj=JSON.parse(Buffer.from(body,'base64url').toString());}catch{throw new Error('INVALID_SNAPSHOT');}
 if(obj.v!==1||!Number.isSafeInteger(obj.issued)||!Number.isSafeInteger(obj.expires)||obj.issued>now+30||obj.expires<=now||obj.expires<obj.issued||obj.expires-obj.issued>604800)throw new Error('EXPIRED_OR_INVALID_SNAPSHOT');
 return obj.data;
}
export class RunBudget{
 constructor({maxCalls=6,timeoutMs=45000}={},clock=Date.now){
  if(!Number.isInteger(maxCalls)||maxCalls<1||maxCalls>12||!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>90000)throw new Error('INVALID_BUDGET');
  this.maxCalls=maxCalls;this.timeoutMs=timeoutMs;this.clock=clock;this.started=clock();this.attempts=0;
 }
 assertTime(){if(this.clock()-this.started>=this.timeoutMs)throw new Error('RUN_TIMEOUT');}
 take(){this.assertTime();if(this.attempts>=this.maxCalls)throw new Error('RUN_CALL_LIMIT');this.attempts++;}
}
// All three counters checked and incremented in ONE Redis script. No check-then-INCR race.
// Deliberately do not refund failed requests: retries must not bypass the global spend bound.
export const QUOTA_LUA = `
local counts = {}
for i=1,3 do counts[i] = tonumber(redis.call('GET', KEYS[i]) or '0') end
for i=1,3 do
  if counts[i] >= tonumber(ARGV[i]) then
    local ttl = redis.call('TTL', KEYS[i])
    return {0, counts[1], counts[2], counts[3], math.max(1,ttl)}
  end
end
for i=1,3 do
  counts[i] = redis.call('INCR', KEYS[i])
  if counts[i] == 1 then redis.call('EXPIRE', KEYS[i], tonumber(ARGV[i+3])) end
end
return {1,counts[1],counts[2],counts[3],60}
`;
export async function reserveBudget({url,token,secret,visitor,globalDaily=100,visitorDaily=12,visitorMinute=3,now=Date.now(),fetchImpl=fetch}){
 let u;try{u=new URL(url);}catch{throw new Error('QUOTA_NOT_CONFIGURED');}
 if(u.protocol!=='https:'||!u.hostname.endsWith('.upstash.io')||u.port||u.username||u.password||u.search||u.hash||u.pathname!=='/'||!token||typeof visitor!=='string'||visitor.length>512)throw new Error('QUOTA_NOT_CONFIGURED');
 for(const n of [globalDaily,visitorDaily,visitorMinute])if(!Number.isInteger(n)||n<1||n>100000)throw new Error('INVALID_QUOTA');
 const day=Math.floor(now/86400000),minute=Math.floor(now/60000);
 const id=createHmac('sha256',key(secret)).update('ripple-visitor\0'+visitor).digest('hex').slice(0,32);
 const keys=[`tide:v1:global:${day}`,`tide:v1:visitor:${id}:${day}`,`tide:v1:minute:${id}:${minute}`];
 let response,data;
 try{
  response=await fetchImpl(u.href,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(['EVAL',QUOTA_LUA,3,...keys,globalDaily,visitorDaily,visitorMinute,172800,172800,120]),signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error();
  const text=await response.text();if(text.length>10000)throw new Error();data=JSON.parse(text);
 }catch{throw new Error('QUOTA_UNAVAILABLE');}
 const r=data.result;
 if(data.error||!Array.isArray(r)||r.length!==5||![0,1].includes(r[0])||r.some(x=>!Number.isSafeInteger(x)||x<0))throw new Error('QUOTA_UNAVAILABLE');
 return {allowed:r[0]===1,globalUsed:r[1],visitorUsed:r[2],minuteUsed:r[3],retryAfter:r[4]};
}
