# Ripple

Ripple tracks which research answers go stale. You build a board from an original question, your requirements and up to five allowlisted public pages. Telem discovers and qualifies selected pages; direct Tavily Extract supplies their page text on the server. Ripple extracts typed facts (each backed by a literal quote), and links them to short decision answers. When you edit a requirement or refresh evidence, Ripple recomputes only the answers whose facts changed and reuses the rest. Failed or partial reads stay **unknown**; they are never shown as fresh.

Scope: **compact** (see `IMPLEMENTED-SCOPE.json`). `public_ready=false` until the independent gate passes on the HTTPS deployment (see `PUBLIC-READINESS.md`).

## Run
```bash
npm ci
npm run check && npm test && npm run build
npm run test:mcp
npm run test:tavily
npm run start -- --hostname 127.0.0.1 --port 4611
SEARCHHACK_BASE_URL=http://127.0.0.1:4611 npm run evaluate -- --mode live --output artifacts/evaluation.json
```
Server-only environment: `TELEM_API_KEY`, `TAVILY_API_KEY`, `APP_MODEL_PROVIDER`, `APP_MODEL`, the provider API key, `UPSTASH_REDIS_REST_URL`/`_TOKEN` (quota counters only), `RIPPLE_STATE_SECRET`, `RIPPLE_PUBLIC_BETA=true`. Fixture evaluation also needs `ALLOW_FIXTURE_MODE=true` and runs on localhost only.

## What is real
- Live Telem discovery/source qualification, direct Tavily basic extraction and model fact extraction. Every supported fact quotes its fetched page.
- Boards and revisions live in your browser's IndexedDB. Export/import is available; imported boards are labeled unverified until rebuilt.
- The Simulation Lab is client-only authored data and is labeled `SYNTHETIC FIXTURE`.
- Observed local results: `demo/L01-evaluation.json`. Fixture evaluator 10/10 treatment; live LIVE01–03 3/3 with paired baseline. Treatment recomputes fewer fixture answers than refresh-all for the same source checks. Savings percentage: not measured.

## Limits
Dependencies are model-proposed and need your review. Pages are cut to 12,000 characters. Refresh runs only when you trigger it; there is no background monitor. Quotas: per visitor per minute/day, plus a global daily cap.

## Agent kit

The local stdio bridge is in `packages/ripple-mcp`. Its nine tools call the same guarded API, with a persistent signed visitor cookie and the same shared quotas. Browser IndexedDB and the local agent vault are separate; transfer boards through explicit JSON export/import. No provider credentials are needed by consumers.

`npm run test:mcp` runs adapter and subprocess protocol tests. `npm run package:integrations` creates `public/downloads/ripple-agent-kit.zip` and its SHA-256 checksum before deployment; Python is not required by the hosting build. The kit includes two portable skills and a dry-run-first project connection helper. See its README and `/integrations`; no global installation or native-client verification was performed by this task.

See [ARCHITECTURE.md](ARCHITECTURE.md), [SUBMISSION.md](SUBMISSION.md), [ATTRIBUTION.md](ATTRIBUTION.md) and [handoffs/L01.md](handoffs/L01.md). Current resumed verification is recorded separately in `demo/L01-resume-verification.json`. Deployment and release media remain controller-owned.

Prepared specification, fixtures and evaluator by the SearchHack preparation package (`.searchhack/context`); sources in `.searchhack/context/SOURCES.md`.

## Direct Tavily extraction

Create, source refresh and legacy `/api/refresh` share the server-only acquisition adapter in `src/lib/search/acquire.ts`. Telem fetch qualifies the same selected URLs and supplies titles/status/canonical-policy checks; Tavily `POST /extract` basic supplies `raw_content` for quote checks, source hashes and changed-fact extraction. Discovery remains a real Telem search. Two reads of one URL are one source, not independent corroboration.

Sources add `extractor`, `provider_request_id`, `extraction_status` and `extraction_error`. Trace rows distinguish `service:telem, transport:telem` from `service:tavily, transport:direct`. Tavily credits are copied from the response once per batch; absent usage/request IDs remain null. `http_attempts` counts actual attempts once per batch, including failures and Telem retries. The evidence view shows extraction status, batch usage and provenance. A Telem-only fallback is explicitly degraded and cannot establish Tavily readiness.

Tavily has one basic attempt, at most five URLs, a 15-second provider timeout, 20-second HTTP timeout and 1.5 MB response limit, within the existing 45-second operation. It preserves at most 30,000 raw characters per source before the app's 12,000-character model-input cap. Truncation is partial and dependent freshness stays unknown. Tavily cache age and upstream redirect chains cannot be independently audited; observation time is the attempt time, not publication time. Telem's `no_cache` applies only to its own read.

TV01 observed two real local two-domain create → requirement edit → source refresh flows with both services. See `demo/TV01-verification.json` for current measurements; earlier L01 evaluations predate direct Tavily. No post-integration deployed sponsor/browser/MCP readiness is claimed. Controller-owned independent gates remain required. See [INTEGRATION.md](INTEGRATION.md) for operator and API details.
