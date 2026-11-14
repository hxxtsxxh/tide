# TV01 progress

Resumed original worktree. Read AGENTS/context/spec, prior statuses, L01 handoff and read-only sponsor contract/reference. Initialized isolated plan; started current docs and check/test.

Initial check/test/build, 20 Tavily tests and 23 MCP tests passed. Actual two-domain API flow passed with both providers (9 quoted facts, 5 answers; edit recomputed 3/reused 2, refresh reused 5). Improved per-batch HTTP accounting, failed-URL request provenance, evidence usage display, docs and kit privacy. A new retry test initially used fake HTTP 200 with an empty body (422); fixed the fake status sequence to resume its normal success payload.

Final verification: check/build pass; 117 main, 22 Tavily, 23 MCP tests pass with no skips. Actual browser extractor/usage checks and 1440/390px layout pass; actual final API flow passed (7 facts/4 answers). Kit checksum + 12 manifest entries verified. Final client scan 14 files / 6 values / 0 matches. Handoff and source-only demo observations written. Controller deployment and independent HTTPS sponsor/browser/MCP gates remain pending; readiness flags stay false.
