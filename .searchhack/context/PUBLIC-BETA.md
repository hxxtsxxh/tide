# Ripple — usable public-beta release contract
**Binding upgrade. Prepared build package, not an already-built application.**

## What a real person must be able to do
1. Open the hosted web app without developer tooling or account creation.
2. Create a uniquely named board with their own question and requirements. Paste one to five
   permitted public documentation URLs, or discover source candidates with real Telem search.
3. Review extracted source-backed facts and the proposed dependency map. Clearly label model-
   inferred dependencies; allow correction. A quotation proves presence, not truth.
4. Read answers with source excerpts, observation times, dependency IDs and unknown/conflict states.
5. Change their requirements and see the affected answers update. Never call a requirement edit
   an external source change.
6. Save locally, reload/close/reopen this browser, select a board from the library and refresh
   its actual sources. Distinguish unchanged content, changed facts, failed/partial reads and
   conflicting sources. Unchecked facts are not freshly checked just because one page succeeded.
7. Inspect revision history, export/import a versioned JSON archive, and delete their boards.
   Import never asserts externally supplied evidence is verified: mark historical/unverified and
   rehydrate with a live run before calling anything fresh.
8. Encounter honest quota/error states, privacy information and source limitations instead of
   silent mock outputs, infinite spinners or lost work.

Example: a developer researches a page-ingestion workflow with Telem/GitHub documentation,
then changes the desired workload. Another user researches Python/MDN behavior with their own
question. The same mechanisms must work; source IDs cannot choose canned answers.

## Scope and public-launch boundary
This is a limited public beta for technical/product research from supported public text pages.
The default exact-host list is visible in the UI and controlled by RIPPLE_SOURCE_HOSTS. It includes
Telem, MDN, Python, GitHub, Node, React, Next.js, Vercel, Netlify, Cloudflare, PostgreSQL, Redis,
Supabase and Upstash documentation hosts. A user chooses actual URLs and questions; it is not
restricted to the demo's three predetermined decisions. The operator can expand the domain list
after checking access/redirect behavior. Unsupported hosts get an explanatory rejection.

No private documents, passwords, account connections, paywall bypass, arbitrary PDF/video upload,
medical/legal/financial advice, collaborative accounts, payments, cloud-synced research or scheduled
monitoring are part of this beta. Do not imply otherwise. Refresh is on demand while the app is used.
Do not silently crawl outbound links; discovery offers candidates rather than granting new domains.

## Stack and data flow
Retain Next.js App Router, React, TypeScript, Node, Vercel, Telem and the configured application
model. No separate Python product backend. Validate installed dependency versions from the package
and registry rather than inventing versions. The prepared Python is orchestration/evaluation only.

Browser form -> validated server route -> atomic shared quota reservation -> Telem search/fetch ->
bounded structured model extraction -> literal-quote checks -> proposed dependency DAG -> answer
synthesis -> signed observed snapshot -> IndexedDB. Refresh verifies the prior snapshot, checks real
sources, compares typed facts and follows reverse dependencies. Reused answers retain their original
observation time. Budget/deadline exhaustion leaves affected answers unknown/stale.

Use at most five sources, ten facts, six answers and forty total nodes per board. Immutable
revisions must preserve prior content and timestamps, subject to explicit local archive retention
and export. Prune only after displaying the retention limit; never silently lose the only original.
Board/source/fact IDs are server-generated. Keep exact user question and requirements as inputs,
never as external facts. All user/source text is rendered as text or sanitized Markdown, never HTML.

## Storage, privacy and evidence integrity
Use IndexedDB for the board library, versioned schema and transactional saves. Handle unavailable
storage/quota exceeded visibly; do not promise persistence without successful writes. Concurrent tabs
use expected-revision checks to prevent silent overwrites. A separate browser/device has no data.
Offer export before destructive actions and explain that clearing site data removes local boards.
No cloud backup, user account or cross-device synchronization is implied.

The server signs compact observed snapshots with HMAC SHA-256 and RIPPLE_STATE_SECRET. Never
trust a plain client hash, client quote, signed-data flag or client source status. Reuse signed
observations only within their scope/expiry; expired/imported state needs revalidation. A signature
proves server origin/integrity, not source truth or completeness of discovered dependencies. Treat
accepted facts/edges as hypotheses to inspect, not omniscient knowledge. Unknown edge mapping
requires conservative review/recomputation rather than a false green.

Research lives in this browser, but questions, URLs and necessary excerpts are sent to Telem and
the selected model provider for processing. Explain this before submission and on /privacy. Do not
claim that all data stays on-device. Do not log raw questions, documents, tokens or provider errors.
Redis stores only expiring pseudonymous quota counters, not boards or source content. Logs contain
request IDs, error codes and bounded timings. No analytics/marketing tracking is added by default.

## Resource controls — required, not a stretch feature
Production uses shared Upstash Redis atomic quotas across instances, not process memory or a
browser flag. The included server-only reference module supplies a three-counter Lua reservation.
Every billable route, including the legacy evaluator endpoint, goes through the same wrapper.
Validate origin, schema, size and allowed source before paid calls. Missing/unavailable quota store
must return 503 and spend nothing; exceeding quota returns 429 with Retry-After and clear UI.

Defaults: 100 admitted research operations/day globally, 40/day per signed anonymous visitor,
12/minute per visitor. Client-created visitor IDs are never accepted. Bind to a signed HttpOnly,
Secure, SameSite cookie; optionally use an HMAC of platform-verified IP metadata as an additional
counter. Clearing cookies can evade a visitor limit but not the global cap. Never trust arbitrary
forwarded headers for identity. No exemption for requests claiming to be tests, judges or bots.

An admitted operation has hard server limits: at most two search queries with a bounded provider
pool (maximum two selected providers), five fetched pages, six model attempts including retries,
45 seconds overall, and bounded model input/output (60,000 source characters total and 2,048
output tokens per call by default). Lower user limits can tighten but never raise them. Count failed
attempts. Concurrent requests reserve allowance atomically. Comparison is separately admitted;
source checking, extraction and failed attempts count in any claimed efficiency savings.

These are operation bounds, NOT a dollar billing guarantee. Set provider-side budget controls/alerts
and hosting/Redis spending controls, and inspect usage after opening access. Public endpoints can
still receive abusive traffic, even when expensive model calls are blocked. A durable quota store is
one extra owner service account; avoid a time-limited scratch Redis database for a public launch.

RIPPLE_PUBLIC_BETA=false is a server-side kill switch: billable live operations return 503 without
upstream calls. The public-ready health flag is false unless required configuration is present.
A failed bootstrap or service outage must not serve fabricated success to preserve the demonstration.

## Source fetch boundary
HTTPS only, exact allowlisted host, no userinfo, nonstandard ports, sensitive query parameters,
IP-literal hosts or ambiguous encoded hosts. All page acquisition goes through the Telem adapter,
never native server fetch to a user-provided URL. Revalidate returned canonical/redirect destinations
against the same policy and reject unobservable or out-of-policy destinations. Telem/provider network
controls remain their responsibility; this is not a blanket SSRF-proof claim. No user cookies, auth
headers or API keys are forwarded to sources. Do not follow untrusted page instructions.

Check each fetched page's status, HTTP status, warnings, content length and partial/truncated states.
A 200 aggregate response does not mean every page is usable. Failed reads mean unknown freshness,
not that the old statement became false. Preserve original and newly observed values separately.
Show last attempted / last successful observation and available cache-state information. Never
claim a fresh observation just by changing your own timestamp on a cached value.

## Interface and automated acceptance
Implement public-beta/API.md exactly plus the existing /api/refresh compatibility contract. The
immutable browser gate creates a unique custom board on the HTTPS deployment, checks source
provenance, edits requirements, reloads storage, refreshes, exports/imports/deletes, checks a fresh
browser for data isolation, rejects forged and disallowed inputs and inspects mobile/privacy UI.
It produces artifacts/public-beta-gate.json. Controller release.json includes public_ready only
when it passes on this run's deployment/commit; old reports, skipped checks and localhost do not pass.

The existing ten domain fixtures and actual baseline comparison remain mandatory. New server guard
unit tests do not replace the public gate, and the public gate is not a full security or model-quality
audit. Also perform an operator-led unseen-question check and review at least two complete citation
chains before broad promotion. No code path may read fixture oracle answers at runtime.

## Presentation and product modes
Live user board is the main application and the first part of the recording. The original live
sample remains an onboarding aid. The finite Simulation Lab is optional explanatory UI, fully
client-side, conspicuously SYNTHETIC, and does not submit arbitrary fixture documents to any public
server endpoint. The generic fixture API is localhost-only. Both modes must never share a fallback.

Keep README, architecture, API notes, privacy/limits, operational instructions, evaluation report,
real screenshots, narrated MP4, captions, HTML/PDF presentation and submission copy. Demo/story:
create a custom board -> inspect evidence -> edit a requirement -> preserve unrelated answers ->
reload and refresh -> show measured behavior -> state limitations.

## Deadline and honest fallback
The event clock is unchanged. Prioritize custom data + provenance + quotas + save/reload before
animated graph layout or a second example. Reuse the supplied reference primitives and already
prepared domain tests. A three-answer custom board can be useful public beta; a hardcoded-only demo
cannot satisfy the public contract. If work remains incomplete, retain the best useful prototype,
record blockers, and keep public_ready=false. Do not remove tests to convert a prototype into a beta.


## Cumulative v2: agent workflow integration
Read AGENT-INTEGRATION.md and agents/BUILD-PLAN.md. The hosted web app remains mandatory.
Also ship the local stdio MCP kit, portable skills and native setup documentation as specified there.
Do not duplicate research logic, introduce shared anonymous cloud boards, bypass public quotas,
or assume browser-local boards are visible to agents. The additional controller gate records
mcp_ready only from a fresh deployed-API protocol run. Native Claude/Codex status is separate.
The same deadline remains in force; unfinished adapter work is explicitly unverified, not silently
removed from the final deliverable list. Preserve the web/video/slides/evaluation obligations.
