# Ripple — submission draft
## Elevator pitch
Track which answers become stale when evidence changes; refresh only the affected branch.
## Problem and intended user
Use the specific user/problem in SPEC.md. Do not replace it with generic “everyone wastes time searching”.
## What we built
Populate only after implementation. State actual scope and whether fixture mode was used in any demonstration. Include real hosted URL and repository; do not invent them in this draft.
## Search intelligence / Telem
Explain answer-level dependency invalidation and selective revalidation. Show one real server-side Telem trace and the decision it affected.
## Original work and prior art
Describe the work completed during the event and disclose this prepared specification/harness. Acknowledge the nearest alternatives listed in SPEC.md; do not claim global novelty.
## Evaluation
Insert observed numerator/denominator, cases, baseline, cache conditions, model, query/page counts, latency and limitations. Until measured, say NOT MEASURED. The prepared oracle is not a benchmark result.
## Limits and next step
Wrong dependencies can make stale answers look fresh. State the specific scope and next validation step, not unsupported enterprise readiness.
## Demonstration
Use demo/DEMO.md, actual screenshots, captions and real recorded workflow. Final Devpost submission is manual.

## Public-beta release evidence (complete after actual execution)
State whether custom user boards, persistence, discovery, source refresh and quota enforcement
passed on the deployed HTTPS build. Attach/link public-beta-gate.json. Do not call a prototype
public-ready because it has a URL. Explain browser-only storage, supported public source scope,
manual refresh, model uncertainty and usage limits. Disclose pre-event reference code and tests.


## Cumulative v2: agent workflow integration
Read AGENT-INTEGRATION.md and agents/BUILD-PLAN.md. The hosted web app remains mandatory.
Also ship the local stdio MCP kit, portable skills and native setup documentation as specified there.
Do not duplicate research logic, introduce shared anonymous cloud boards, bypass public quotas,
or assume browser-local boards are visible to agents. The additional controller gate records
mcp_ready only from a fresh deployed-API protocol run. Native Claude/Codex status is separate.
The same deadline remains in force; unfinished adapter work is explicitly unverified, not silently
removed from the final deliverable list. Preserve the web/video/slides/evaluation obligations.
