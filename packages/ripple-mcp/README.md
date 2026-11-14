# Ripple agent kit (0.2.0)

A local **stdio MCP server**, two portable skills and a Claude Code plugin wrapper for a working
Ripple public-beta HTTPS service. The Node 22+ server has no third-party runtime dependencies.
It calls the same API as the website; it is not a second search engine or a remote `/mcp` endpoint.
This kit is not published to npm or approved in an agent marketplace.

## Before use
Use the verified deployed application URL supplied by the operator, not a sample domain.
The API must implement the Ripple public-beta contract and have Telem/model/shared-quota access.
Consumers need no provider/Redis/signing secrets. A failed quota or service check is an error,
never a signal to create new cookies or switch endpoints to circumvent limits.

Store this extracted directory in a permanent, trusted location. The connection records its
absolute server path. Node 22+ is required. Python 3.11+ is used by the optional convenience helper.
No `npm install` is required. Review the source and MANIFEST.json before installing.

## Recommended: project-scoped connection for Claude Code and Codex
Run from this kit folder, substituting your real project directory and the real deployed origin:

```sh
python3 scripts/connect-agents.py --project "$HOME/Projects/my-project" \
  --base-url "https://YOUR-VERIFIED-RIPPLE-DEPLOYMENT" --agent both
# Review the dry-run, then apply exactly the same arguments:
python3 scripts/connect-agents.py --project "$HOME/Projects/my-project" \
  --base-url "https://YOUR-VERIFIED-RIPPLE-DEPLOYMENT" --agent both --apply
```

This merges only the `ripple` entry into `.mcp.json` and `.codex/config.toml`, copies the two skills
into `.claude/skills/` and `.agents/skills/`, preserves unrelated settings, rejects conflicts,
and backs up previous configuration outside the repository with private permissions. It never
changes approval/sandbox policies, signs in, starts a model session, or calls the service.
Each project gets its own local data root; Claude and Codex in that project can share the vault.

Start a **new ordinary trusted client session in that project**. In Claude Code use `/mcp`; in
Codex use `/mcp` (or `codex mcp list` for configuration inventory). Then explicitly ask the agent
to call `ripple_status` and show the result. A listing alone does not prove a tool was invoked.
Use `/ripple-research` in Claude or `$ripple-research` in Codex as a direct skill invocation;
plugin-scoped names may be namespaced. Actual tool prefixes vary by client.

The SearchHack construction harness uses strict MCP/user-config isolation. It will NOT inherit
this project's connector simply because you installed it elsewhere. Test consumers separately;
do not disable the development harness's safeguards or assume these are the builder's tools.

## Native CLI alternative (MCP only)
Set `RIPPLE_API_BASE_URL` in the MCP entry rather than rely on an interactive shell export.
Use an absolute reviewed server path. These commands are alternatives to the helper, not extra
steps to run after it:

```sh
claude mcp add --transport stdio --scope project \
  --env RIPPLE_API_BASE_URL=https://YOUR-VERIFIED-RIPPLE-DEPLOYMENT \
  ripple -- node /ABSOLUTE/PATH/ripple-agent-kit/src/server.mjs

codex mcp add ripple --env RIPPLE_API_BASE_URL=https://YOUR-VERIFIED-RIPPLE-DEPLOYMENT \
  -- node /ABSOLUTE/PATH/ripple-agent-kit/src/server.mjs
```

Check installed-client `mcp add --help` first. Codex CLI additions may be user-scoped; the helper
is preferred when project isolation is desired. The commands above do not install the skills.
Copy the whole corresponding skill directory, or use the helper. There are no broad tool allowlists.

## Claude plugin alternative
The folder contains `.claude-plugin/plugin.json`, `.mcp.json` and `skills/`. For local development:

```sh
export RIPPLE_API_BASE_URL="https://YOUR-VERIFIED-RIPPLE-DEPLOYMENT"
# Optional: select a private per-project vault, outside your repository.
export RIPPLE_STATE_DIR="$HOME/.local/share/ripple-agent/my-project"
claude --plugin-dir /ABSOLUTE/PATH/ripple-agent-kit
```

Verify `claude --help`/`claude plugin validate` on your installed version. Do not also install the
same kit by the helper under the same server name in the same session. This is a local plugin
bundle, not a marketplace listing. Codex has an explicit MCP+skill installation path above;
no claim is made that Claude's plugin manifest is a native Codex manifest.

## Tools and workflow
- `ripple_status`: check service identity/configuration, not factual freshness.
- `ripple_discover_sources`: bounded source search; consumes quota.
- `ripple_create_board`: public question/requirements/URLs -> observed board and local handle.
- `ripple_list_boards`, `ripple_get_board`: local reads; do not revalidate sources.
- `ripple_refresh_board`: use current local revision; omit requirements to check sources, or supply
  requirements to change the user's question constraints. Imported archives rebuild from live sources.
- `ripple_export_board`, `ripple_import_board`: explicit portable JSON, not automatic synchronization.
- `ripple_delete_board`: exact title + current revision required; removes only this local copy.

Example request: “Use Ripple to check the public fetch documentation, save the evidence for this
integration decision, and identify unknowns. Before changing the integration later, refresh that board.”
The connector does not edit your code, run a shell, read arbitrary local paths, or upload your repository.

## Browser / agent transfer
The web app uses IndexedDB; the connector uses local files. Export `ripple-board-v1` JSON in one
interface and explicitly import it in the other. Do not claim seamless sharing. Imported evidence
is historical/unverified, even if an old snapshot is included. Rebuild/refresh before relying on it.
Only ordinary tool summaries omit signed snapshots; explicit export deliberately includes the
snapshot when available. A signature is integrity protection, not encryption or proof of truth.

## Privacy and boundaries
Vault files are private (directory 0700, files 0600), **not encrypted**. The default vault is under
`~/.local/share/ripple-agent/` and is separated by endpoint. The helper adds a project-specific root.
All sessions using the same configured root/origin can read those boards. It is not multi-user auth.
Keep sensitive data out of the public-beta workflow. Questions and selected public-source excerpts
reach Ripple/Telem/the model provider; selected URLs also reach direct Tavily Extract (the question and requirements are not sent to Tavily); sending an Origin header does not turn it into authentication.

No background refresh, automatic web monitoring, cross-device sync or cloud account library is
included. No remote OAuth/Streamable HTTP server is included. Native clients' normal permissions
and organization policy continue to apply. Skill text cannot grant authority or force a model to comply.

## Limits and recovery
Default: 12 admitted billable operations per MCP process, 55s per HTTP request, 50 local boards,
5 sources per new board; server-side shared quotas and source restrictions still apply. Do not
restart a process to evade limits. Timeouts are not automatically retried: a server operation might
have completed after cancellation. Reconcile before repeating a billable action.

`REVISION_CONFLICT`: read the current board and reconcile. `REVALIDATION_REQUIRED`: retain history
and explicitly create a new board from the public URLs. `VAULT_BUSY`: another process owns the lock.
A crash can leave `<vault-origin>/.lock`; stop ALL clients using that vault, inspect its owner PID,
and only then remove that lock directory. There is deliberately no automatic lock stealing.

To uninstall, remove only the `ripple` MCP entry and the two copied skill directories (or unload the
plugin). Do not delete your entire Claude/Codex config. Local research remains until you explicitly
delete boards or the chosen vault. Backups remain at the path printed by the helper.

## Verification status
`node --test tests/*.test.mjs` runs source-distribution tests (tests are in the development package,
not the compact end-user ZIP). The independent release gate tests actual stdio messages and the
actual deployed API. Native-client connection/invocation and skill behavior are separate checks.
No protocol conformance certification, universal compatibility or security audit is claimed.

## Evidence providers

The same public API uses Telem for real discovery and selected-page qualification, and direct Tavily basic extraction for the quoted evidence text. Consumer setup needs no Telem/Tavily/model/Redis keys. Source records add extractor, extraction status and observed provider request ID; traces distinguish direct Tavily from Tavily routed within Telem. Missing metadata remains unknown. Two reads of one URL are one source. Failed direct extraction may yield a labeled degraded Telem fallback, never successful Tavily evidence. Cache age and complete provider-side redirects cannot be independently established. The API still verifies origins/snapshots and reserves shared quotas before provider calls; there is no connector exemption.
