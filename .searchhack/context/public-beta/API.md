# Public-beta interfaces and exact browser acceptance selectors

These interfaces are new. Keep the existing /api/refresh request/response contract for the original
fixture/live evaluator, behind the SAME origin/input/quota/source guard as the new routes. The updated
Python evaluator sends an Origin header and retains cookies; it has no privileged bypass.

## Routes
GET /api/session: mint a signed anonymous visitor cookie if missing; HttpOnly, SameSite=Strict,
Secure in production, Path=/. Return {ok:true}, never the signature key. Billable routes may also
mint this cookie on the first same-origin request so HTTP clients do not require a separate login.
No auth/account creation is involved. Quotas are enforced per signed identity plus a GLOBAL cap.

GET /api/health: retain {status:'ok',project:'ripple',mode:'live'} and add public_beta:true only with
all production dependencies configured; safety:{durable_quota:true,signed_snapshots:true,
bounded_sources:true}; limits:{sources:5,model_calls:6}; source_hosts:[allowed exact hosts].
Do not expose tokens/connection URLs. Health does not certify a product or spend live API credits.

POST /api/discover:
{request_id: string, query: string (1..2000)} -> {mode:'live',results:[{url,title}],trace}.
Validate request, reserve quota, search using Telem and a bounded provider pool, filter result URLs
through the operator policy, return up to eight candidates. No snippets alone become supported facts.
No results is an honest empty state; no invented URLs or silent out-of-policy domain fallback.

POST /api/boards:
{request_id:string,title:string (1..120),question:string (1..2000),requirements:string (0..2000),
 urls:string[] (1..5)} -> BoardEnvelope below.
If discovery is chosen, the UI calls discover, the user selects results, then calls boards.
Reject extra properties and fixture/strategy/model/limits/credential overrides. No code keyed to
sample request strings. Count source acquisition and actual model calls, including failed attempts.
Request body is bounded to 16 KiB before parsing. Return 201 or 200 only for a recorded operation.
No usable sources -> 422 SOURCE_UNAVAILABLE or a clearly unresolved board, never fabricated facts.

POST /api/boards/refresh:
{request_id:string,snapshot:string,requirements?:string,force:boolean} -> BoardEnvelope.
Bound body to 600 KiB and verify HMAC/expiry/board structure. Snapshot data is the prior signed
observation, not proof it is still true. Requirements changes use force=false; the UI labels them as
user edits. Refresh uses force=true and checks real sources through Telem with documented cache
controls; retain provider cache-state and uncertainty. No-change refresh still records an observation
revision and reuses unchanged answer versions. Preserve history and show unknown freshness on failure.
Changed requirements trigger dependency recalculation, NOT a fabricated remote page update.
Stale signature/secret rotation -> 409 REVALIDATION_REQUIRED; UI offers a new live rebuild from
question/URLs while preserving the archived board. Tampering -> 400/401/409/422, no paid calls.

## BoardEnvelope (JSON)
{
 schemaVersion:1, project:'ripple', mode:'live', request_id:string,
 board:{
   id:string,title:string,question:string,requirements:string,
   sources:[{id:string,url:string,title:string,status:'succeeded'|'failed'|'partial',
             observedAt:ISO8601,contentHash:string,excerpt:string,cache_state?:string}],
   facts:[{id:string,value:JSON,status:'supported'|'conflicting'|'unknown',
           source_id:string,quote:string,support_sets?:string[][]}],
   answers:[{id:string,text:string,depends_on:string[],status:'fresh'|'stale'|'unknown'}],
   revisions:[{id:string,parent_id:string|null,createdAt:ISO8601,kind:string,summary:string}]
 },
 snapshot:string,
 update:{affected:string[],recomputed:string[],reused:string[],unknown:string[]},
 trace:{retrieval:[{kind:'search'|'fetch',provider:string|null,mode:'live',status:string,
                    url?:string,requestId?:string,cached?:boolean}],model_calls:integer,
        elapsed_ms:number,limitations:string[]}
}

A supported fact requires a real returned source and a quote occurring exactly in its preserved
excerpt; verify the quote against actual fetched content before signing. Keep excerpts limited to
relevant evidence, not entire copyrighted documents. Multiple citations may be additional fields.
Sources must carry at least one returned requested/canonical URL consistent with source policy.
Provider/request metadata is copied from actual responses; absent fields are null, never invented.
A client-provided hash does not establish provenance. The UI exposes proposed vs user-reviewed edges.
History content can be stored in versioned IndexedDB revision records referenced by the summary list.

Export JSON: {schemaVersion:1,format:'ripple-board-v1',board,snapshot,exportedAt} plus bounded revision
records. Import validates size/schema/IDs/cycles, rejects prototype-pollution keys and unsafe text/URLs,
shows archived/unverified state and only reuses it as live evidence after server verification/refresh.
Schema migration preserves backups. Use IndexedDB transactions and expected current revision IDs.

## Error contract
{error:{code:string,message:string},request_id:string}. Codes include INVALID_INPUT,
SOURCE_NOT_ALLOWED, SOURCE_UNAVAILABLE, QUOTA_EXCEEDED, QUOTA_UNAVAILABLE, REVALIDATION_REQUIRED,
PUBLIC_ACCESS_DISABLED, UPSTREAM_UNAVAILABLE, TIMEOUT. No raw provider responses or secrets.
429 carries Retry-After. Return 403 for a nonmatching Origin on POST; missing Origin on deployed
browser-facing POST is also rejected. localhost tests send their actual local origin. Reject
oversized streaming bodies, not just Content-Length. No unsafe permissive CORS.

## Required selectors
- new-board-title: text input; new-board-question: textarea; new-board-urls: newline URL textarea.
- new-board-requirements: textarea; create-board: real request submit button.
- board-title-current: heading for active board; board-result: completed board container.
- board-requirements: editable textarea; apply-requirements: submit user change.
- refresh-board: source refresh button; export-board: JSON download button.
- delete-board: opens confirmation; confirm-delete-board: actually removes all local board records.
- import-board-file: input[type=file], accepts bounded JSON archives.
- import-revalidation-notice: visible for imported historical/unverified evidence.
- library-board-list, evidence-tab, primary-result: actual UI controls/output.
- sample-button/run-request and simulation-tab/run-simulation/simulation-result: retain original
  selectors only if those modes exist. They are not substitutes for the new custom-board controls.

On reload, restore the most recent board or show a library that automatically opens the active board;
the gate expects the prior active title without additional clicks. A fresh separate browser is empty.
/ privacy is a real page at /privacy describing browser-only persistence, clearing/export/delete,
what goes to Telem/model providers, supported public sources and usage limits.
