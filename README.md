# Tide

**Know what your decision rests on, and how well it holds up.**

Tide combines two hackathon projects by the same author into one local app:

- **Ripple** answers *"Is this conclusion still true now?"* A board links public sources to quote-verified facts, and facts to answers, through an explicit dependency graph. When you edit a requirement or refresh a source, only the dependent closure is recomputed. Boards also get signed snapshots, browser-local revisions, export/import, an MCP kit and shared quotas.
- **PerspectiveSearch** answers *"Is this conclusion robust to which evidence I trust?"* It tags each exact quote with a stance and scores it for Authority, Popularity (cross-source agreement) and Time consistency. Weight sliders rerank the evidence without running any new search.

Tide is Ripple (Next.js 16 / React 19, same Apple-style UI) with a **Perspective layer**:

1. **Stance in the same model call.** Each extracted fact can carry `stance: supports | opposes | neutral` relative to the board question (`src/lib/model/extract.ts`, `FactRecord` in `src/lib/contracts/board.ts`). The field is optional and additive. Old boards and archives import unchanged, and a missing stance counts as neutral.
2. **PerspectiveSearch scoring ported to pure TypeScript** (`src/lib/perspective/index.ts`): weighted rank with renormalization over the available metrics, coverage, all-zero weights restoring the defaults (70/20/60), and per-origin popularity in which an origin that contradicts itself counts once, as mixed. Time consistency uses the coverage-scaled weakest-period formula. The module also computes a verdict (Leans yes / Leans no / Contested / Insufficient evidence) from weighted supporting vs. opposing quotes, and a sensitivity sweep over a {0,50,100}^3 weight grid that reports how many lenses hold the verdict and which single weight flips it.
3. **Perspectives tab** in the board inspector (`src/components/Perspectives.tsx`) has three accessible range sliders, a verdict pill with a one-line explanation, a sensitivity summary, and a ranked evidence list showing quote, source, publisher tier, stance chip and A/P/T bars. Everything recomputes instantly on the client and honors `prefers-reduced-motion`. Fact cards in the Dependency map show a stance chip.
4. Ripple's selective-recompute semantics are unchanged. Stance never enters the dependency graph or the freshness state.

Quota keys moved from `ripple:v1:*` to `tide:v1:*`, so Tide and Ripple don't share counters.

## Run (local)

```bash
npm ci
cp /path/to/your/.env.local .env.local     # same variables as Ripple; see RIPPLE-README.md
npm run check && npm test && npm run build # 140 tests (133 inherited + 7 perspective)
npx next start --hostname 127.0.0.1 --port 4920
```

## Honest limits

- **Authority is a publisher-tier heuristic**, not PerspectiveSearch's per-document LLM rubric: .gov/.edu/standards bodies/official docs rank above code hosts, which rank above blogs. Ripple's docs allowlist means most boards have equal authority across sources, so in practice Agreement moves the ranking most.
- **Popularity** needs two or more source pages taking a stance. It treats each page as one origin, while PerspectiveSearch deduplicates origins by content. Two pages on the same docs site are not truly independent.
- **Time consistency** uses the board's saved revisions as periods, not publication dates. It shows N/A until there are at least two revisions with three or more stance observations. A freshly created board therefore always shows T = N/A.
- Stance is a model judgement on a verbatim quote. A quote shows that a page says something, not that it is true. Scores are transparent heuristics, not probabilities.
- Not ported: PerspectiveSearch's proposition/scope planning, open-web discovery, Claude-written grounded synthesis, and baseline-vs-lens answer diff. Lens changes do not create revisions.
- Some internal identifiers still say "ripple": package name, `RIPPLE_*` env vars, MCP tool names, IndexedDB name and the health `project` field. These are kept for compatibility with frozen contracts.
- Verified locally only. Tide has not been deployed.

Screenshots: `demo/desktop-perspectives.png`, `demo/desktop-perspectives-crowd.png`, `demo/desktop-map.png`, `demo/mobile-perspectives.png`, `demo/desktop-home.png`, `demo/mobile-home.png`.

The original Ripple README, with its architecture, env vars and safety notes, is in `RIPPLE-README.md`.
