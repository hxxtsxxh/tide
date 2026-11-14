# Ripple — know which answers became stale

When one source changes, know which decisions to revisit.

Ripple is a browser research board for technical founders and developers whose integration decisions depend on changing documentation. Create a board from your own question, requirements and supported public URLs. Telem discovers and qualifies the selected pages; direct Tavily basic extraction supplies their text. The result is a source → fact → answer graph, with literal source passages and explicit unknown states.

Change a requirement to revisit its dependent answers without reading the web again. Refresh evidence to check the actual sources, preserve unrelated answers and keep an auditable history. Boards persist in this browser and can be exported, imported as unverified history, or deleted. A downloadable local stdio agent kit carries the same workflow into a separate local vault.

## What we built

Next.js/TypeScript web workflow; real Telem, direct Tavily Extract and configured model adapters; typed fact comparison and dependency invalidation; signed snapshots; IndexedDB persistence; source, body and time limits; shared atomic Redis quotas; privacy UI; a client-only synthetic teaching lab; and a local MCP adapter distribution. There is no separate research database, scheduled monitoring or cloud library.

The compact contribution is an inspectable, decision-facing workflow: alternative evidence support sets, and exact affected, recomputed and reused answer sets for each change. Temporal knowledge graphs and source monitors already exist; this project does not claim to have invented them, nor to discover every natural-language dependency.

## Evidence and boundaries

All figures below come from records in `demo/` and `handoffs/`, observed on 2026-11-14. Each record states its own scope.

- **Local test gates** (this worktree, `handoffs/L03.md`): typecheck, 125/125 unit tests, 22/22 Tavily tests, 23/23 MCP tests and the production build all passed.
- **Live evaluator** (`handoffs/L02.md`, `demo/L02-verification.json`): 3/3 selected live cases (LIVE01–03), each with actual Telem, Tavily and model calls against a local production build. Fixture evaluator: 10/10 treatment cases, run in a separate localhost fixture mode. Refresh-all produced six expected recomputation-set mismatches on fixture cases because it also recomputed unaffected answers. Cold-versus-warm cache differences mean latency is not comparable, and no saving is claimed.
- **Browser flow before direct Tavily** (`demo/L01-resume-verification.json`): create gave 8 quoted facts and 4 answers. Changing the requirement text from three to eight read no sources, recomputed 1 answer and reused 3. An unchanged source refresh read 2 pages, recomputed 0 and reused 4. This predates the Tavily path and is not the recording's result.
- **Two-provider local API flows** (`demo/TV01-verification.json`, `handoffs/TV02.md`): create, requirement-edit and refresh flows ran with actual Telem, Tavily, model and shared Redis calls. The local sponsor observer passed 6/6 with `live=false` and `sponsors_ready=false`. Telem made 3 HTTP attempts, direct Tavily made 2, and 1 credit was reported for create. Reported credits are returned usage, not a balance or a free-use promise.
- **Independent local gates**: the browser gate passed 15/15 on localhost only. The MCP gate passed 12/12 locally. Neither is a deployed HTTPS gate.

Limitations that apply to every figure above:

- Dependencies are model-proposed and need your review. Direct edge editing is not implemented. A correction goes into the requirements and the board is rebuilt.
- Quotes establish that text was fetched. They do not establish that it is true. Telem and Tavily reading one URL are one source.
- Failed or partial evidence keeps dependent answers unknown. A truncated page (12,000 characters) is partial.
- Tavily cache age and provider-side redirect chains are not independently established. The observation time is the extraction attempt, not the page's publication time.
- Some failed-request error responses do not expose a provider-work ledger. Absence of a count there is unmeasured, not zero.
- Custom-board refresh-all counts in revision summaries are planned counts. Only the legacy evaluation adapter measures a paired baseline.
- No refresh savings and no total provider-work savings are measured.
- No background monitoring, cloud sync or native Claude Code/Codex invocation is verified.

## Release status

Deployment URL: not recorded in this document; the controller performs deployment.

Public readiness: `public_ready=false`. It stays false until the independent browser gate passes on the HTTPS deployment. MCP deployed readiness and native Claude/Codex invocation are unverified until their own checks run. Sponsor readiness for the deployed commit is likewise unverified. The video, presentation render and submission are controller-owned; this document does not claim they exist.

See `README.md`, `ARCHITECTURE.md`, `PUBLIC-READINESS.md`, `IMPLEMENTED-SCOPE.json` and `ATTRIBUTION.md` for operation, scope and preparation disclosure.

## Sponsor integration

Telem remains the discovery and routing service. It qualifies the selected source pages for titles, status and destination policy. Direct Tavily `POST /extract` basic supplies the text used for source-bound facts, literal quotes, content hashes and refresh observations. The same path serves the web app, the legacy evaluation route and the MCP API.

The evidence view shows each source's URL, extractor, provider request ID, status, partial or error evidence and batch credits. Failed direct extraction can fall back to Telem text, but that fallback is labeled degraded and does not count as successful Tavily.
