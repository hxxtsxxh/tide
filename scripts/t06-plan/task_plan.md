# Task Plan: T06 QA and honest comparison

## Goal
Run immutable fixture/live/browser/MCP checks against this integrated app; add missing safety regressions and preserve failures and limitations.

## Next Step
Deliver the QA result and preserve controller follow-ups.

## Current Phase
Phase 5

## Phases

### Phase 1: Requirements & Discovery
- [x] Read local contracts, prior task handoffs and sponsor integration instructions.
**Status:** complete

### Phase 2: Baseline verification
- [x] Install dependencies, build, typecheck and run both test suites.
**Status:** complete

### Phase 3: Safety regressions
- [x] Cover all guarded routes, true expiry and duplicate/concurrent refresh.
**Status:** complete

### Phase 4: Independent checks
- [x] Execute fixture/live, browser, MCP and native client checks separately.
**Status:** complete

### Phase 5: Delivery
- [x] Write scope, QA evidence, handoff and result record with honest limitations.
**Status:** complete

## Decisions Made
| Decision | Rationale |
|---|---|
| Local gates use local_test:true | A local pass never establishes HTTPS release readiness. |
| Preserve both acquisition services | Direct Tavily and Telem are mandatory. |

## Errors Encountered
| Error | Resolution |
|---|---|
| Root public-beta/contracts paths absent | Prepared references located under .searchhack/context. |
