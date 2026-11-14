# T06 findings

All prepared fixture and live cases pass treatment checks; baseline succeeded on all live cases and four fixture cases. Six fixture baseline mismatches concern recompute/reuse strategy assertions; decision states match. No live efficiency gain established: same provider/model counts, matched source hashes, Telem warm and Tavily cache unknown.

Immutable local browser/MCP gates pass; final deployed readiness remains controller-owned. Fatal-operation retrieval accounting omission is still present. Native Claude source operation passed, native Codex status/list passed but host approval refused create. All reports preserve these distinctions. See handoffs/T06.md and demo/T06-qa-evidence.json.
