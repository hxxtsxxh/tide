// Reproduce the fatal-operation accounting boundary without paid services.
import {runGuarded} from '../src/lib/server/guarded.ts';
import {createBoardSpec} from '../src/app/api/_lib/specs.ts';
import {ENV,newWorld,fakeFetch,URL_A} from './retrieval-fakes.ts';
import {writeFile} from 'node:fs/promises';
const world=newWorld({telemStatus:[401]});
const req=new Request('https://ripple.example.test/api/boards',{method:'POST',headers:{origin:'https://ripple.example.test','content-type':'application/json'},body:JSON.stringify({request_id:'tv02-accounting-fatal',title:'Accounting boundary',question:'What is the fetch limit?',requirements:'',urls:[URL_A]})});
const r=await runGuarded(req,createBoardSpec,{env:ENV,quota:{async reserve(){return {allowed:true,retryAfter:0}}},fetchImpl:fakeFetch(world)});
const j=await r.json();
const report={mode:'synthetic-transport',status:r.status,error:j.error?.code,observed_attempts:{telem:world.calls.filter(c=>c.host==='hack.telem.ai').length,tavily:world.calls.filter(c=>c.host==='api.tavily.com').length},public_error_has_retrieval_ledger:!!j.trace?.retrieval,limitation:'When mandatory Telem acquisition fails at operation level, the public error omits the already-attempted parallel Tavily work and any reported credits. Do not infer zero work from missing trace or claim complete failure-cost measurement.'};
await writeFile('artifacts/tavily/fatal-error-accounting.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
