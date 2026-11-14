# R01 findings

- Worktree started clean at cb7e060; earlier R01 repair is preserved in that commit.
- Deployed 3eb7c5c MCP gate failed QUOTA_EXCEEDED after 2 protocol/catalog checks.
- Failed HTTPS media manifest 20261114T210352.949183Z: board-result wait timed out; unresolved slides=[] and presentation_text_resolved=true. Missing capture/video/screenshots; draft files are a consequence, not unresolved text.
- Earlier localhost capture 20261114T205343.401996Z is complete, with MP4/captions/screenshots/non-draft slides. It cannot replace HTTPS release evidence.
- Fresh 2026-11-14T21:10:47Z read-only Redis GET/TTL: global day 20771 used=1, TTL=172664. Local cap=300, deployed cap not independently inspected. No Redis writes or provider calls in this check.
- HTTPS health 200, project=ripple, mode=live, durable quotas/snapshots/source bounds configured. This is configuration evidence, not functional readiness.

- Fresh unchanged independent HTTPS MCP gate passed all 12 checks; full report demo/R01-mcp-gate.json.
- Actual supplied Playwright UI recheck completed create/evidence/edit/refresh; safe counts stored in demo/R01-release-verification.json.
- Fresh typecheck, 125 application tests, 23 MCP tests and production build passed.
