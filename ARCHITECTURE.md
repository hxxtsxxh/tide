# Ripple architecture

Ripple is a Next.js App Router application with TypeScript domain logic. The browser owns its research library; the server processes one bounded operation at a time. No research database or background worker is required.

## Research and provenance

`POST /api/discover` searches through Telem and offers allowlisted candidates. `POST /api/boards` accepts an original title, question, requirements and one to five public URLs. The server acquires selected pages through Telem, checks each returned status and canonical URL, and asks the configured model for typed facts and proposed answer dependencies. Search snippets never substitute for fetched passages.

Each supported fact must quote its preserved source excerpt literally. Sources retain content hashes, provider metadata where returned, observation times and cache information. A quote establishes presence in the fetched text, not truth. Truncated pages remain partial; failures preserve prior observations with unknown freshness.

## Dependency refresh

`src/lib/domain` validates IDs and the acyclic graph, computes typed semantic hashes, evaluates alternative support sets and follows reverse dependencies. Alternative support sets are OR; members of a set are AND. A source formatting change can require extraction without changing a semantic fact or regenerating answers.

`POST /api/boards/refresh` verifies the signed prior snapshot before quota admission. A requirement edit (`force=false`) changes user input without source fetching. A source refresh (`force=true`) rechecks the selected pages with Telem cache controls, compares facts and regenerates affected answers in dependency order. Unknown mappings are handled conservatively. Affected, attempted recomputation, reused and unknown sets are reported separately. Budget-exhausted answers remain stale or unknown; they never become fresh merely because the request ended.

The browser displays proposed dependencies and accepts local review notes. Notes do not alter the signed graph. Carry a correction into requirements and rebuild when it must change computation. Direct dependency editing is outside this compact release.

## Guarded service boundary

Every billable route, including legacy `/api/refresh`, uses `runGuarded`: same-origin validation, streaming body cap, strict schema and source/snapshot validation, kill switch, configuration checks, signed visitor identity, atomic shared Redis quota reservation, then bounded execution. Redis contains expiring quota counters only. Missing quota infrastructure fails closed.

Default limits are five pages, ten facts, six answers, two search queries, six model attempts and 45 seconds per operation. Source text is bounded to 60,000 characters total; model output is bounded. The server keeps API credentials and the signing secret. Public source URLs are HTTPS with exact allowed hosts; returned destinations are revalidated. Source pages and model output are untrusted data.

Snapshots use expiring HMAC integrity protection and include domain versions and hash-linked history metadata. This proves server origin, not factual correctness. Old values and previous observations remain distinct from user edits.

## Local persistence and transfer

IndexedDB stores the browser's boards, immutable full revisions and active pointer. Transactional expected-revision checks reject stale writers. A small localStorage deletion journal completes a confirmed deletion interrupted by reload; it contains an opaque ID and expected revision, not research text. Storage failures are visible and offer recovery export.

Exports contain a versioned `ripple-board-v1` archive, with up to twenty recent full revisions within the archive size cap; older records remain in the local library. Imports validate bounds, IDs, dependencies and unsafe keys, discard trust and require a live rebuild. Clearing browser data removes that browser's library. Other browsers and the agent vault remain separate.

## Agent distribution

`packages/ripple-mcp` contains the supplied Node stdio bridge, nine tools, two portable skills, project-scoped setup helper and optional Claude plugin wrapper. It calls the same HTTP routes and retains a signed visitor cookie; it has no provider keys or quota exemption. Its private local file vault is separate from IndexedDB. Explicit JSON export/import transfers historical evidence between them.

`npm run package:integrations` creates the reviewed source archive and checksum under `public/downloads`. The archive includes an integrity manifest and excludes credentials, state and dependencies. Packaging runs before deployment; hosting builds require no Python. Native client invocation and deployed MCP readiness remain separate gates.

## Evaluation and release boundary

`npm test` covers guard, domain, retrieval and persistence/import contracts. `npm run test:mcp` exercises adapter and real subprocess JSON-RPC behavior. `npm run evaluate` invokes the unchanged prepared HTTP evaluator and writes the required report shape. It removes an old raw report before execution so failure cannot reuse previous measurements.

The paired legacy fixture baseline recomputes all computable answers over the same source observations; treatment follows affected closure. Its six expected recomputation-set mismatches are reported, not hidden. Live from-scratch paired cases measure source acquisition and evidence structure; they do not establish refresh savings. Custom-board refresh-all counts displayed in revision summaries are planned, not executed comparisons.

The finite Simulation Lab is client-only and labeled synthetic. General fixture transport is explicitly enabled, localhost-only and disabled on hosted environments. Neither is a live fallback. Public readiness remains false until the independent browser gate passes on the actual HTTPS deployment and integrated commit; MCP readiness requires its independent deployed protocol gate as well.
