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

## Research modes

Modes live in one data registry, `src/lib/modes.ts`. Each mode has an id, label, helper copy, requirements-field label, exact-host list and example questions, so adding a mode is a data change. The home page defaults to **General**. Boards store their `mode`; a board with no mode or an unknown one is treated as **Technical**, which is Ripple's original behavior, so older boards, archives and snapshots stay valid.

| Mode | Sources (exact hosts) | Examples |
|---|---|---|
| General | Every non-technical curated host below combined. The technical docs hosts are deliberately excluded, so docs questions use Technical. `TIDE_GENERAL_HOSTS` overrides this list. | yield curve, gold, remote work |
| Technical | `RIPPLE_SOURCE_HOSTS` (or the 14-host docs default) | Telem page fetching |
| Finance & Economics | federalreserve, newyorkfed, fred/stlouisfed, bls, bea, census, nber, imf, worldbank, oecd, bis, ecb, gold.org, wikipedia, britannica, apnews/bbc/npr | yield curve, gold |
| Health & Science | who, cdc, nih, pubmed, pmc, nature, arxiv, ourworldindata, wikipedia, britannica, news | coffee and type 2 diabetes |
| Work & Society | pewresearch, gallup, brookings, news.stanford.edu, nber, bls, oecd, ourworldindata, wikipedia, britannica, news | remote work |

- **How the source policy is applied.** Create, discovery and refresh use the host list of the board's own mode. Discovery's `include_domains` is that same list. Signed snapshots are rechecked against their own mode's list. The SSRF, redirect and private-IP guards are unchanged.
- **Investopedia is excluded.** Tavily Extract rejected its URLs ("Invalid URL format").
- **Authority tiers for curated hosts.** These live in the same registry (`HOST_TIERS`), and the Perspectives cards show each tier's label:
  1. Official statistics, central banks and intergovernmental bodies: 95
  2. Peer-reviewed or academic: 88
  3. Reference or data: 78
  4. Survey or think tank: 70
  5. News: 60
  6. Industry body, an interested party such as gold.org: 45
- **Long pages.** Non-technical modes keep up to 300,000 characters of fetched text per page (`long_page_chars`), so long Wikipedia or Fed pages are no longer routinely truncated and marked partial.
  - The model sees at most 12,000 characters per page: the most question-relevant literal passages, chosen deterministically (`selectPassages`). The total model input stays bounded at 5 × 12,000 = 60,000 source characters per call, the same bound as before.
  - Quotes are still verified literally against the full fetched text, and truncated pages are still labelled partial.
  - Limit: facts that sit only in passages the model never saw are not extracted.

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
