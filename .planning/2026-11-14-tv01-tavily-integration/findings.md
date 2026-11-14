# TV01 findings

Previous attempt ended at maximum turns; substantial uncommitted adapter, wiring and tests are preserved. No TV01 handoff existed. L01 integrated web/MCP kit already present. prepare-env succeeded without printing secrets. Retain degraded Telem fallback, clearly labeled; it cannot count as successful Tavily. External sponsor gate remains controller/TV02 owned.

Current main and worktree HEAD are both f0620a5 (hack.telem.ai/api routing fix); no missing main commits. Direct Tavily and Telem traces distinctly observed in the actual final API response, including Tavily chosen internally by Telem. Preserve old excerpt extractor/request attribution on failed refresh; regression added. Final two-domain run: 7 supported facts, 4 answers, edit 4 recomputed/0 reused, unchanged refresh 4 reused/0 model calls. Reported direct usage 1 create / 0 refresh credits. Earlier run was 9 facts/5 answers with 0/0 reported credits. Neither is a paired baseline.
