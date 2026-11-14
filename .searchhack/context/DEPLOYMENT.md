# Ripple public-beta deployment

Existing Vercel + Next.js path remains. The controller alone publishes. No new account for visitors.
Owner prerequisite: one persistent Upstash Redis REST database with write/EVAL access. Run
`python3 configure-ripple-public.py` from the installed bundle before the first launch. It prompts
locally for URL/token, creates a signing secret, and verifies a short-lived atomic read/write probe.
It does not build a product or create/deploy cloud resources. Do not use temporary 72-hour scratch
storage for a public launch. Redis is only for quotas, not users' research data.

Required runtime environment: TELEM_API_KEY; APP_MODEL_PROVIDER/APP_MODEL plus the chosen model
key; UPSTASH_REDIS_REST_URL; UPSTASH_REDIS_REST_TOKEN; RIPPLE_STATE_SECRET. Operator policy uses
RIPPLE_PUBLIC_BETA, RIPPLE_SOURCE_HOSTS and the three RIPPLE_*RUNS* limits. Values are injected
server-side into Ripple alone by the patched harness; tokens/signing keys are marked sensitive
when uploaded to Vercel. No NEXT_PUBLIC/VITE prefix is permitted for secrets.

`bash start.sh ripple` uses the upgraded backlog. After build/check/test, the controller deploys,
runs the existing live comparison, then runs public-beta/evaluation/browser-gate.mjs against the
actual HTTPS site. Missing configuration, failed custom workflow or local-only evidence keeps the
release partial/public_ready=false. Supporting media generation continues where possible; inspect
both status and checks in ~/SearchHack/ripple/artifacts/release.json.

The generated site must work with the laptop off. Data persistence is in the visitor's browser,
not the server filesystem. No scheduled background refresh/cloud sync is claimed. Vercel deployment
protection must permit public judge access; authenticated browser state is not proof of accessibility.

## Operating after launch
Use provider/account consoles to set budgets/alerts and inspect actual bills. Finite request caps
are not exact dollar caps. Start with the supplied 100/day global research-operation limit, then
adjust only after observing cost and load. Keep monthly hosting and Redis costs monitored too.
Quota counters reset by UTC bucket. Changing local settings requires another deployment to affect
production. RIPPLE_PUBLIC_BETA=false disables paid routes; redeploy for it to take effect.

Keep a known-good deployment for rollback. Rotating RIPPLE_STATE_SECRET invalidates old browser
snapshots; the app must offer a source revalidation without deleting archived boards. Clearing site
data loses local boards, so visible export/import is mandatory. Document source failures and reduce
promises instead of fabricating results. Keep no unrelated production credentials in this site.


## Cumulative v2: agent workflow integration
Read AGENT-INTEGRATION.md and agents/BUILD-PLAN.md. The hosted web app remains mandatory.
Also ship the local stdio MCP kit, portable skills and native setup documentation as specified there.
Do not duplicate research logic, introduce shared anonymous cloud boards, bypass public quotas,
or assume browser-local boards are visible to agents. The additional controller gate records
mcp_ready only from a fresh deployed-API protocol run. Native Claude/Codex status is separate.
The same deadline remains in force; unfinished adapter work is explicitly unverified, not silently
removed from the final deliverable list. Preserve the web/video/slides/evaluation obligations.
