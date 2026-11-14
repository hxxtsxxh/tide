# Public-beta threat model and release checks

## Boundaries
Untrusted: question/title/requirement text, page content, imported JSON, cookies before signature
verification, unsigned browser graphs, every model output, provider partial/error responses.
Trusted: deployment's source policy, server-held secrets, code-enforced operation budget and
schema, successful atomic quota reservation. A signed snapshot certifies origin, NOT truth.

No shell/code execution, file writes to user-selected locations, email sending, purchase,
account changes, local-network fetches, or source writes exist in this product. Model extraction
has no tools. External content is evidence, never permission to alter system prompts or limits.

## Mandatory tests agents must implement
- All paid routes, including /api/refresh and /api/discover, call the same quota wrapper.
- Parallel admissions near a limit cannot exceed it; repeat with independent wrapper instances
  sharing the same Redis backend. Test a temporary namespace, never burn the real public allowance.
- Redis timeouts/bad replies and disabled public access perform zero Telem/model calls.
- Missing/forged visitor cookies cannot bypass global caps; source input cannot choose limits.
- Exact host allowlist rejects suffix lookalikes, credentials, numeric/private IPs, nonstandard
  ports, sensitive/signed URLs and out-of-policy canonical destinations. Never perform native
  fetch to source URLs. No redirect may carry model/search credentials to a source.
- Max body size enforced while reading; URL/source/token/output/attempt/time caps enforced.
- HMAC tampering/expiry/wrong deployment key fails before reusing purported evidence.
- User titles/imported excerpts including HTML, scripts and Markdown links cannot execute script.
- No keys, connection strings or raw provider errors in browser bundles, logs or API JSON.
- Source missing/failed/partial is not a fresh fact, and a quote match is not proof of truth.
- Draft/proposed dependencies do not silently become proven or complete.
- Browser write errors and concurrent tab updates preserve the last good revision.
- JSON import bounds, cycle/ID/schema validation and __proto__/constructor/prototype rejection.
- Logs contain request IDs and coded errors only; no raw research questions/documents by default.

## Residual risk
A small test suite is not an audit. Prompt injection can contaminate prose even without tool
access. Page providers can cache stale content. Dependencies may be incomplete or wrong. URLs may
become inaccessible. Shared limits bound admitted operations, not every hosting/Redis charge.
Cookie rotation/Sybil use can defeat a visitor quota; global budget and provider-side limits remain
necessary. Rate limiting does not provide enterprise DDoS protection.

## Reused code disclosure
Reference primitives and tests in this add-on were prepared before product implementation. Disclose
that preparation separately from event-built integration/UI and fresh measured results. Do not
rewrite original source dates or present a simulated source change as a real website update.
