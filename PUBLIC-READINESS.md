# Ripple public readiness

public_ready=false

The controller deployed the application at https://searchhack-ripple-08a1a865.vercel.app from commit `3eb7c5ca37f5c85b44275151592c049454c78c32`. The saved independent HTTPS public-beta browser gate passed all 15 checks for that deployment (`artifacts/public-beta-gate.json`). This is observed deployment evidence, not a declaration that a later release is ready.

The first deployed MCP gate passed protocol/catalog checks, then failed with `QUOTA_EXCEEDED`. The prior R01 diagnosis recorded the shared daily allowance exhausted at 100. During this resume, a read-only counter check at 2026-11-14T21:10:47Z observed usage 1; local configuration now has a cap of 300, while the deployed cap was not independently inspected. No counter reset or quota exemption was added by this resume. The unchanged supplied MCP gate then passed **12/12** against the existing HTTPS deployment; its complete report is `demo/R01-mcp-gate.json`. Native Claude Code and Codex invocation remain unverified.

The failed HTTPS media manifest (`artifacts/demo/20261114T210352.949183Z/manifest.json`) stopped waiting for `board-result` after creation. It has no completed capture, MP4 or screenshots. Its draft HTML/PDF has no unresolved presentation text. An earlier localhost capture (`20261114T205343.401996Z`) is complete, including video, captions, screenshots and non-draft slides; it does not stand in for HTTPS release media. The controller must rerun capture and review the actual final video and deck.

The controller retains ownership of integration, deployment, final gate nonces/commit binding and media production. Its final release must rerun the applicable browser, MCP and sponsor gates against its actual deployed commit. Neither local tests, health configuration nor this targeted recheck sets `public_ready=true`. See `demo/R01-release-verification.json` and `handoffs/R01.md` for the current handoff.

Earlier local API/browser/evaluator checks remain in `demo/T05-integration-checks.json`, `demo/L01-resume-verification.json`, `demo/L02-verification.json` and `demo/TV01-verification.json`. Refresh-all counts shown in custom-board revision summaries are planned counts; no measured live refresh-savings percentage is claimed. The finite Simulation Lab is visibly synthetic and client-only.
