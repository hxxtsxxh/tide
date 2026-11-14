# Product implementation handoff

## Files and interfaces
- Copy `.searchhack/context/agents/reference/` to `packages/ripple-mcp/` without node_modules or caches.
- Existing API routes remain the only retrieval implementation; preserve `public-beta/API.md`.
- `Bridge.call(name,args,signal)` implements nine bounded operations; `src/server.mjs` implements stdio.
- Expose `/integrations` with the actual kit download after packaging, not a fake registry name.
- Add root `test:mcp`: `node --test packages/ripple-mcp/tests/*.test.mjs`.
- Add root `package:integrations`: `python3 packages/ripple-mcp/scripts/package-kit.py --output public/downloads/ripple-agent-kit.zip`.
  Generate and commit the archive before deployment; a Vercel build must NOT depend on Python being
  present to regenerate it. Keep source and packaged checksum in sync; validate before release.
- Run existing root tests/build as well as MCP tests. Record the measured outcomes, not their intent.

## Task test cycle
1. Before changing reference behavior, add a failing regression test for the actual mismatch.
2. Run adapter unit/protocol tests, then implement the smallest API/adapter correction.
3. Run the full suite. Do not alter independent gates or oracle fixtures to force a pass.
4. Run the independent gate locally with `local_test:true` and label it LOCAL, not public readiness.
5. From two fresh disposable trusted projects use the connection helper separately for Claude and
   Codex. Start ordinary authenticated sessions, call ripple_status and list_boards, then perform
   one source-backed operation if quota allows. Save redacted tool invocation evidence and client
   versions. A config listing or synthetic CLI output is not proof of native use.
6. Repackage and verify archive contents. Include source, two skills, manifests, setup helper,
   README/license and integrity manifest. Never include `.env`, cookies, local boards or credentials.
7. Controller deploys, runs its existing web gate, then the MCP protocol+HTTPS gate. Review failures.

## Real integration scenario
In Claude Code: research network versus HTTP failures for fetch using a public MDN source; retain
board_id/local_revision. In a later session in the same configured project/vault, use Codex to list,
read and refresh that board before proposing code changes. Keep browser transfer explicit: export
JSON from one interface and import into the other, then revalidate. Do not claim automatic sync.

## Native verification record (truthful template)
{
  "schemaVersion":1,
  "claude":{"status":"not_run","version":null,"evidence":null},
  "codex":{"status":"not_run","version":null,"evidence":null},
  "notes":"Change to passed only after actual tool invocation; do not infer from MCP protocol gate."
}

## Scope to cut first
Do not add remote HTTP transport, OAuth, auto-monitoring, additional MCP tools or skill catalogs.
Do not remove the core public web functionality. Preserve ordinary consumer approval policies.
