# ripple evaluation protocol
There are 10 authored fixture cases and three separate live probes. They are different evidence classes. A fixture pass is not a real-world performance result. Live probes check reported transport/evidence contracts; semantic validity still requires source review and project-specific unit/browser checks.

The standard-library HTTP runner is evaluation/run.py. It uses --base-url, --mode fixture|live, --output, --cases comma-separated IDs, --limit, and --strategy paired|treatment|baseline. Default strategy paired calls both strategies on identical input, budget and model configuration. Outcome labels are read only on the evaluator side. Filter before making any HTTP request. Unknown IDs are errors, not silently skipped. The output records every request outcome, failed request, quality mismatch and baseline result; it intentionally does not persist raw source documents or model responses.

The app must explicitly enable its finite authored Simulation Lab through src/lib/demo-policy.ts and return mode=fixture; no additional environment variable is required. Live mode must call Telem with actual evidence; replaying a fixture must fail provenance validation. Default --limit=3 selects the first three prepared cases in that mode. The controller has a 180-second outer evaluation timeout; keep each request within the declared 20-second budget. It is acceptable to select fewer supported LIVE cases in IMPLEMENTED-SCOPE.json. Never remove failures from the report to fit the time budget.

Wire npm evaluate to a small wrapper invoking the prepared runner with SEARCHHACK_BASE_URL. Forward --mode and --output. Respect IMPLEMENTED-SCOPE.json for reduced scope. The controller also invokes the prepared runner independently. Keep its oracle and source catalog unchanged.

Read SPEC.md for domain-specific targets. Success claims require actual runs. For quality failures in a valid baseline, report them without making the treatment fail; malformed baseline responses, fake provenance or an unavailable comparison are fatal comparison failures. Empty or blocked live output is never a successful live probe. Baseline cache state, model and limits must match treatment. Real provider request IDs are recorded only when returned; absence is not permission to invent one.

For the complete authored regression set (not only the default first three):

```bash
python3 evaluation/run.py --base-url http://127.0.0.1:4317 --mode fixture --limit 10 --output artifacts/fixture-evaluation.json
```


## Mandatory public-beta acceptance
The existing ten fixture cases and live comparisons remain. In addition use public-beta/evaluation/browser-gate.mjs for 15 mandatory browser/API checks on a custom board. Inputs contain a unique random title, not a fixture selector. The controller uses the verified HTTPS deployment, a fresh browser context, a commit identity and a fresh nonce; stale JSON reports cannot certify this run. Gate script/contract lives in immutable prepared context, outside editable product source.

Unit/integration tests must cover quota rejection before model calls, distributed-counter outages, secret handling, URL/domain rejection, forgery/expiry, browser save failure and concurrent edits, graph errors and missing provenance. Copy or adapt public-beta/tests/guards.test.mjs into the app's npm test. A fake Redis response is a unit test only; run the configuration probe against actual Redis and verify concurrency separately. A server claiming live mode is not by itself proof of a live integration: retain redacted actual provider/request observations.

The public browser gate deliberately uses MDN Fetch/AbortController documentation, not the
original three-answer Telem sample. Its title is unique per run, and its requirements differ from
the original demo. Do not special-case these URLs either; also execute an operator-supplied unseen
question. Out-of-sample checks reduce demo overfitting; finite tests cannot prove universal ability.


## Cumulative v2: agent workflow integration
Read AGENT-INTEGRATION.md and agents/BUILD-PLAN.md. The hosted web app remains mandatory.
Also ship the local stdio MCP kit, portable skills and native setup documentation as specified there.
Do not duplicate research logic, introduce shared anonymous cloud boards, bypass public quotas,
or assume browser-local boards are visible to agents. The additional controller gate records
mcp_ready only from a fresh deployed-API protocol run. Native Claude/Codex status is separate.
The same deadline remains in force; unfinished adapter work is explicitly unverified, not silently
removed from the final deliverable list. Preserve the web/video/slides/evaluation obligations.
