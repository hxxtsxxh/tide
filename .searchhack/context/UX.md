## UX and demo design
Use a warm light canvas, dark text, a restrained blue accent for fresh and amber for stale, with textual status labels. The hero is the decision board, not a wall of model messages. Desktop: sources left, facts center, decisions right; mobile: stacked dependency cards. Fixed graph layout; an evidence drawer never changes node sizes. A small execution strip shows Checked sources / Changed facts / Recomputed answers / Reused answers. Keep the before/after result visible long enough to understand.

90-second script: 0–15 explain a plan built from changing facts; 15–35 load real sources; 35–60 change a requirement and inspect the affected branch; 60–75 show the labeled source-change lab and comparison; 75–90 state measured evidence and the narrow scope.

## Adoption, risks and stop conditions
Potential buyer: teams maintaining recurring research and launch decisions; future wedge could be an answer-freshness API. No market-size or revenue claims are established. Largest risk: extracting a wrong dependency produces misleading freshness. Start from user-inspectable, explicitly confirmed dependencies. Do not present an LLM-inferred edge as proven without a source-backed relationship.

At 30 minutes, require a live Telem-backed fact. At 90 minutes, require the exact DAG invalidation behavior and an editable result. If either fails, adopt Minimum scope; do not add persistence infrastructure. Before demo, disclose that the sample graph is bounded and simulations are authored.

Sources: [E1–E3,J1,T1–T3,R1,R2] in SOURCES.md.

## Public-beta upgrade
The primary action is "Create your board" with editable title, question, URL list and requirements;
"Try an example" is secondary. Provide a source discovery chooser, visible supported-domain list,
evidence/dependency review, board library, retained revisions, refresh, export/import and delete.
Browser-local storage and provider processing disclosure is visible before sending data. Use exact
selectors in public-beta/API.md. No source is green merely because a model returned fluent text.
Display quotas, retry timing, partial results and revalidation notices. Preserve entered text after
errors. Desktop columns become stacked cards on 390px screens. No forced signup.
