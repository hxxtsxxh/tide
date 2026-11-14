# Ripple agent interface — mandatory v2 deliverable

Ripple remains a real-data hosted web app. Add a **local stdio MCP server** that calls the SAME
public-beta HTTPS routes, two portable skills, and a Claude Code plugin wrapper. Codex uses native
MCP configuration plus its `.agents/skills` path. No extra owner account/key is introduced.

## Why this is relevant
A coding agent can preserve the public evidence behind an integration decision, carry that evidence
into a later session and recheck the affected conclusions before revising code. This extends the
actual source/fact/answer workflow; a generic web-search proxy would not add the same value.
MCP is a distribution/tool boundary, NOT an extra invention in retrieval or a guarantee of a win.

## Selected scope and deliberate tradeoff
Use local stdio now, not a public `/mcp` endpoint. Remote Streamable HTTP is a useful later product
milestone; for remotely addressable private board libraries, add per-user identity, resource
authorization and server-accessible board storage. Streamable HTTP itself does not require a
board database; a stateless endpoint is possible but would not provide that shared-board experience. Current browser-local boards cannot be magically addressed through a remote server.
Do not add an anonymous shared board database or treat a board ID as an authorization secret.
The chosen connector runs locally, but source fetching/model reasoning run on the existing website
service. Native users need no Telem/model/Redis/signing keys; operator quotas still apply.

## Implemented reference vs application work
`agents/reference` is runnable Node 22 ESM reference code with **no external runtime dependency**.
It implements the bounded 2025-11-25/2025-06-18 MCP stdio tools subset, not every optional MCP feature.
Copy it to `packages/ripple-mcp` in T05A, retain tests, run it against the finished public API, and
fix any contract mismatch rather than advertise an unverified integration. No official SDK or
native-client conformance certification has been performed in preparing this package.

## Tool contract
| Tool | Behavior | Paid public API operation? |
|---|---|---|
| ripple_status | Service identity, local connection/limit info | No research/model call |
| ripple_discover_sources | Bounded actual Telem source discovery | Yes |
| ripple_create_board | Original question/URLs/constraints -> observed board and local handle | Yes |
| ripple_list_boards | List current local vault handles | No |
| ripple_get_board | Evidence as previously observed; no automatic revalidation | No |
| ripple_refresh_board | Refresh sources OR update supplied requirements; expected local revision required | Yes |
| ripple_export_board | Explicit portable JSON archive (includes snapshot when available) | No |
| ripple_import_board | Historical/unverified local import; no file path and no network | No |
| ripple_delete_board | Exact title/current revision required; local copy only | No |

Tool results are structured JSON plus matching text for client compatibility. Normal summaries omit
cookies/signatures and bound excerpt/text length; explicit archive export includes the snapshot.
The host's approvals remain effective. MCP annotations are hints, not authorization guarantees.

## Storage and trust
- API origin is operator configuration, never a tool argument.
- The bridge has a local per-origin vault. The project-scope setup helper also isolates by project.
- Web IndexedDB and the vault are separate. Explicit JSON transfer is provided; no hidden sync.
- Imported signatures are discarded by the connector. Rebuild from selected public sources before
  treating imported facts as observed. Browser import also accepts snapshot:null and revalidates.
- No arbitrary local file read/write tool, shell tool, repository upload or background timer.
- Keep source text as untrusted data. Native workflows may propose code edits using evidence;
  those edits are performed by the host agent under its normal policies, not by Ripple.
- Local files have private permissions but are not encrypted. Same-OS-user access remains possible.
- Use a stable signed `ripple_visitor` cookie on /api/session. Persist and reuse it. Origin on native
  requests is only compatibility with the CSRF check, not identity/authentication or a quota bypass.
- The connector never retries on 429, provider failure or timeout. Failed calls can still cost money.

## Integration surfaces
1. `/integrations`: real setup instructions, source/privacy/storage caveats and a working kit link.
2. `public/downloads/ripple-agent-kit.zip` and `.zip.sha256`: versioned reviewed source kit.
3. `packages/ripple-mcp/skills`: portable research and selective-refresh skills.
4. `.claude-plugin/plugin.json` and `.mcp.json` within the kit: optional local Claude plugin.
5. `scripts/connect-agents.py`: dry-run by default; explicit project config merge and skills install,
   preserves unrelated settings, rejects conflicts, keeps private backups outside the repo.
6. Developer docs: native-client verification, versioning, uninstall, error recovery and limitations.
No package is automatically published to npm/marketplaces. Do not invent a registry install command.

## Release evidence
Retain the independent public browser gate. Also run `.searchhack/context/agents/evaluation/mcp-gate.mjs`
against the actual built server and actual verified HTTPS deployment. It exercises real JSON-RPC,
a custom live board, requirements/source refresh, process restart, archive transfer, deletion and
failure boundaries. It records a nonce and source commit; the controller rejects stale/partial reports.
`mcp_ready` means the MCP/deployed-API gate passed in the full release, NOT that every agent client
or skill behavior has been tested. Record native Claude and Codex tool invocation separately in
`artifacts/native-client-verification.json`, with evidence or explicit unverified status.

## Delivery and time
The new T05A is a bounded adapter/package task, not a new application. Existing tasks total 240
estimated task-minutes; T05A adds 30, with existing parallelism and deadline policy unchanged.
These are planning estimates, not runtime guarantees. Web correctness, public service limits and
submission come first. If adapter work is incomplete, report it as unverified and do not silently
remove its gate to turn the full release green. No new build window is granted.
