# Ripple — know which answers became stale

When one source changes, know which decisions to revisit.

Ripple is a browser research board for technical founders and developers whose integration decisions depend on changing documentation. Create a board from your own question, requirements and supported public URLs. Real Telem discovery and source qualification, followed by direct Tavily basic page extraction, feed a source → fact → answer graph, with literal source passages and explicit unknown states.

Change a requirement to revisit its dependent answers without reading the web again. Refresh evidence to check actual sources, preserve unrelated answers and keep an auditable history. Boards persist in this browser and can be exported, imported as unverified history, or deleted. A downloadable local stdio agent kit carries the same workflow into a separate local vault.

## What we built

Next.js/TypeScript web workflow; real Telem, direct Tavily Extract and configured model adapters; typed fact comparison and dependency invalidation; signed snapshots; IndexedDB persistence; source/body/time limits; shared atomic Redis quotas; privacy UI; client-only synthetic teaching lab; local MCP adapter distribution. No separate research database, scheduled monitoring or cloud library.

The compact contribution is an inspectable decision-facing workflow with alternative evidence support and exact affected/recomputed/reused sets. Temporal graphs and source monitors already exist; no claim of inventing them or discovering every natural-language dependency is made.

## Evidence and boundaries

The earlier L01 local paired evaluation recorded 10/10 treatment fixture cases and 3/3 selected live cases (LIVE01–03). Refresh-all produced six expected fixture recomputation-set mismatches because it also recomputed unaffected answers. Live initial-build comparisons used real search/fetch/model calls, with no demonstrated monetary or latency saving. Current rerun results and any failures are recorded separately in `demo/L01-resume-verification.json` and `handoffs/L01.md`.

The earlier real Telem documentation browser run created two sources, nine quoted facts and five fresh answers. Changing the requirement from three to eight URLs read no sources, recomputed one answer and reused four. An unchanged source refresh read two pages and reused all five answers. These are observed local examples, not a general benchmark or a promise about a future recording.

Dependencies are model-proposed. Direct signed edge editing is not implemented; local review notes must be carried into requirements and a rebuild. Unsupported, failed and partial evidence remains unknown; exhausted regeneration can remain stale. Custom-board refresh-all numbers are planned counts. No native-client compatibility certification is claimed.

## Release status

Deployment URL: not measured in this task; controller-owned.

Public readiness: false until the independent HTTPS deployment gate passes. MCP deployed readiness and native Claude/Codex invocation: unverified until their respective checks run. Final video, presentation render and submission: controller-owned, not produced or submitted by this task.

See `README.md`, `ARCHITECTURE.md`, `PUBLIC-READINESS.md`, `IMPLEMENTED-SCOPE.json` and `ATTRIBUTION.md` for operation, scope and preparation disclosure.

## Sponsor integration update (TV01)

Telem remains the real discovery/router and qualifies selected source pages. Direct Tavily `POST /extract` basic supplies the text used for source-bound facts, literal quotes, content hashes and refresh observations across web, legacy evaluation and the same MCP API. The evidence drawer reports extractor, observed request ID, status, partial/error evidence and batch credits. Two services reading one URL do not create two independent sources.

The current local two-domain API create/requirement-edit/refresh flow passed with actual Telem, Tavily, model and shared Redis. Observed details are in `demo/TV01-verification.json`; the earlier L01 figures above predate this addition. The first flow reported zero credits in each Tavily batch; the final API rerun reported one credit for create and zero for refresh. These are returned usage values, not a balance or future free-use guarantee. Post-integration deployed sponsor/browser/MCP readiness and total-work savings remain unmeasured here. Failed direct extraction may use an explicit degraded Telem fallback and does not count as successful Tavily. Cache freshness and provider-side redirect chains are not independently established.
