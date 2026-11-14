# Tide: submission draft

**Tagline:** Know what your decision rests on, and how well it holds up.

**Problem.** Technical decisions such as adopting an API, picking a vendor or designing a fetch pipeline rest on public evidence that both disagrees and changes over time. Most research tools give you one answer. They don't show which quotes it rests on, whether it still holds after a doc page changes, or whether it would flip if you trusted different sources.

**What Tide does.**
1. Paste a question and up to five public docs URLs. Telem qualifies the pages, Tavily Extract supplies the text, and the model extracts quote-verified facts. Each fact gets a **stance** toward your question, extracted in the same call. Tide then drafts answers with explicit `depends_on` edges.
2. The **Dependency map** shows source → fact → answer. Edit a requirement or refresh a source, and only the affected answers are recomputed. Failed reads stay unknown, never fresh.
3. The **Perspectives** tab lets you set how much Authority, Agreement and Time consistency count. The evidence reranks instantly and the verdict pill updates (Leans yes / Leans no / Contested / Insufficient). A sensitivity sweep says whether the verdict is stable across 26 lenses or which weight flips it.

**How it was built.** Tide is Ripple (Next.js 16, React 19, zod, Upstash quotas, signed snapshots, IndexedDB boards, MCP kit) plus a pure-TypeScript port of PerspectiveSearch's scoring and ranking. The port's tests mirror the original Python test cases.

**Sponsors used.** Telem (page discovery and qualification), Tavily Extract (evidence text), Anthropic (extraction and stance).

**Honest limits.** Authority uses publisher tiers, not a per-document rubric. Time consistency needs two or more saved revisions. Stance is a model judgement on a verbatim quote. Tide is local-only for now. See README "Honest limits".

**Demo flow (90 s).** Click Sample, then Create board → Dependency map (stance chips) → Perspectives → drag Agreement to 100 and Authority to 0, watch the ranking reorder and the verdict share move → read the sensitivity line → edit a requirement and show that only dependent answers recompute.
