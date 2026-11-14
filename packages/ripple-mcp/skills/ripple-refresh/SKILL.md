---
name: ripple-refresh
description: Use when a user asks whether an existing Ripple-backed decision still holds, changes a requirement, or wants to recheck evidence before implementing or revising a plan.
---
# Revisit an evidence-backed decision
Read the board first using `ripple_get_board`. Retain the board ID and current local revision.

For a source recheck call `ripple_refresh_board` with `board_id` and `expected_revision` only.
For a requirement change also supply `requirements`; describe this as a user edit, not a web change.
Imported/unverified boards are rebuilt through the real backend; never trust an imported signature
as current evidence. Revalidation requires permitted network access and consumes existing quotas.

Inspect affected/recomputed/reused/unknown sets and their source evidence. A failed source fetch
means freshness is unknown, not unchanged. "Fresh" is scoped to the checked dependencies and
observation time. Reading the vault alone does not check the web. Preserve baseline successes and
include checking/extraction overhead when discussing savings.

On REVISION_CONFLICT, read again and reconcile the user's intent instead of blindly retrying.
On VAULT_BUSY, stop and report the lock; never delete a lock while another process could own it.
On QUOTA_EXCEEDED or SESSION_BUDGET_EXCEEDED, report the limit/reset information. Do not rotate
cookies, change API origins, or launch extra server processes to evade quotas.
On REVALIDATION_REQUIRED, preserve the historical board and offer an explicitly requested new
live rebuild. Do not discard research history silently.

Summarize what changed, what did not, unresolved evidence, and the new revision. Cite real sources.
Do not claim automatic/background monitoring, cloud synchronization or a global always-current
memory. Delete only on the user's explicit request and use the exact title/current revision.
