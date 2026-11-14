# Ripple

Ripple tracks which research answers go stale. You build a board from an original question, your requirements and up to five allowlisted public pages. Telem discovers and qualifies the selected pages; direct Tavily Extract supplies their page text on the server. Ripple extracts typed facts (each backed by a literal quote from that text) and links them to short decision answers. When you edit a requirement or refresh evidence, Ripple recomputes only the answers whose facts changed and reuses the rest. Failed or partial reads stay **unknown**; they are never shown as fresh.

Scope: **compact** (see `IMPLEMENTED-SCOPE.json`). `public_ready=false`: the public-beta browser gate passed on https://searchhack-ripple-08a1a865.vercel.app (commit 3eb7c5c), and a targeted deployed MCP recheck passed 12/12 against that same deployment (`demo/R01-mcp-gate.json`). Final controller release gates and HTTPS media remain pending, so this is a prototype with real live integrations, not a public release (see `PUBLIC-READINESS.md`).

## Run

Requires Node >= 22.18 and npm.

```bash
npm ci
npm run dev                                   # development server
npm run check && npm test && npm run build    # typecheck, 125 unit tests, production build
npm run test:tavily                           # direct Tavily path (22 tests)
npm run test:mcp                              # local stdio MCP adapter (23 tests)
npm run start -- --hostname 127.0.0.1 --port 4611
SEARCHHACK_BASE_URL=http://127.0.0.1:4611 npm run evaluate -- --mode live --output artifacts/evaluation.json
```

`npm run package:integrations` also needs `python3`; the hosting build does not.

### Environment (names only; set values outside the repository)

| Variable | Role |
| --- | --- |
| `TELEM_API_KEY` | Telem discovery and source qualification (server only) |
| `TAVILY_API_KEY` | Direct Tavily Extract basic (server only) |
| `APP_MODEL_PROVIDER`, `APP_MODEL` | `anthropic` or `openai`, and the model ID |
| `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` | Model provider key matching `APP_MODEL_PROVIDER` |
| `RIPPLE_STATE_SECRET` | HMAC key for signed snapshots and visitor cookies |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Shared quota counters only; missing quota configuration fails closed |
| `RIPPLE_PUBLIC_BETA` | Kill switch: paid operations are disabled when set to `false` |
| `RIPPLE_SOURCE_HOSTS` | Optional comma list that replaces the default source-host allowlist |
| `RIPPLE_VISITOR_RUNS_PER_DAY`, `RIPPLE_VISITOR_RUNS_PER_MINUTE`, `RIPPLE_GLOBAL_RUNS_PER_DAY` | Quota overrides (defaults 40, 12, 100) |
| `ALLOW_FIXTURE_MODE` | `true` enables the localhost-only fixture transport for offline evaluation; ignored on Vercel |

Keep `.env.local` out of Git. Provider keys are never sent to the browser.

## What is real

- Live Telem discovery and source qualification, direct Tavily basic extraction, and model fact extraction. Each supported fact must quote text that was actually returned.
- Boards and revisions live in your browser's IndexedDB. Export and import are available; an imported board is labeled unverified until it is rebuilt from live evidence.
- The Simulation Lab is client-only, authored data, and labeled `SYNTHETIC FIXTURE`. It does not contact a server or a live website.

## Limits

- Dependencies are model-proposed and need your review. Direct edge editing is not implemented; a correction goes into the requirements and the board is rebuilt.
- Each page is cut to 12,000 characters; a truncated read is partial and its dependents stay unknown.
- Refresh runs only when you trigger it. There is no background monitor and no cloud board sync.
- Quote presence shows the text was fetched, not that it is true. Two reads of one URL are one source, not corroboration.
- Tavily cache age and provider-side redirect chains are not independently established. The observation time is the extraction attempt, not the page's publication time.
- Some failed-request error responses do not expose a provider-work ledger. A missing count there means unmeasured, not zero.
- Measured savings are not claimed. Live baseline comparisons use cold versus warm caches, so their latency is not comparable.

## Evidence

Verified locally on 2026-11-14 from this worktree (see `handoffs/L03.md`):

- `npm run check`, `npm test` (125/125), `npm run test:tavily` (22/22), `npm run test:mcp` (23/23) and `npm run build` all passed.
- `handoffs/L02.md` and `demo/L02-verification.json`: live evaluator 3/3 (LIVE01–03) and fixture evaluator 10/10 treatment, both against a production build. The local browser gate passed 15/15 on localhost only; it is not an HTTPS deployment gate.
- `handoffs/TV02.md`: the local sponsor observer passed 6/6 against the real local API, with `live=false` and `sponsors_ready=false` as the gate records them.
- `demo/L01-resume-verification.json`: the earlier browser flow (before direct Tavily was added) created 8 quoted facts and 4 answers. Changing the requirement text from three to eight read no sources, recomputed 1 answer and reused 3. An unchanged source refresh read 2 pages, recomputed 0 and reused 4.

## Direct Tavily extraction

Create, source refresh and the legacy `/api/refresh` route share the server-only acquisition adapter in `src/lib/search/acquire.ts`. Telem fetch qualifies the same selected URLs and supplies titles, status and canonical-policy checks. Tavily `POST /extract` basic supplies `raw_content` for quote checks, source hashes and changed-fact extraction. Discovery is a real Telem search.

Sources carry `extractor`, `provider_request_id`, `extraction_status` and `extraction_error`. Trace rows are split into `service:telem, transport:telem` and `service:tavily, transport:direct`. Tavily credits are recorded once per batch as returned; a missing request ID or usage value stays null. `http_attempts` counts actual attempts, including failures and Telem retries. A Telem-text fallback is labeled degraded and does not count as Tavily evidence.

Tavily makes one basic attempt, with at most five URLs, a 15-second provider timeout, a 20-second HTTP timeout and a 1.5 MB response cap, inside the 45-second operation. The adapter keeps at most 30,000 raw characters per source, and the app's 12,000-character model-input cap applies after that. Telem's `no_cache` applies only to Telem.

`demo/TV01-verification.json` records the TV01 local two-domain flows; those include request IDs and usage. This document does not claim post-integration deployed sponsor, browser or MCP readiness. Those gates belong to the controller.

## Agent kit

The local stdio bridge is in `packages/ripple-mcp`. Its nine tools call the same guarded API, with a signed visitor cookie and the same shared quotas. The kit has no provider credentials and no quota exemption. Its local file vault is separate from browser IndexedDB; boards move between them by explicit JSON export and import. Two portable skills and a project-scoped setup helper are included. Native Claude Code and Codex invocation has not been verified; see `/integrations`.

## Documents

- [ARCHITECTURE.md](ARCHITECTURE.md): data flow, dependency engine, guards, persistence and evaluation boundary.
- [SUBMISSION.md](SUBMISSION.md): submission text and the observed evidence, with the same boundaries as above.
- [ATTRIBUTION.md](ATTRIBUTION.md): what came from the preparation package and what was built here.
- [PUBLIC-READINESS.md](PUBLIC-READINESS.md) and [INTEGRATION.md](INTEGRATION.md): the release gate and the operator details for both providers.
- `demo/`: shot list, narration and slides for the recording, plus the observed verification records.

Deployment, the recorded video and the presentation render belong to the controller and are not produced by this document.
