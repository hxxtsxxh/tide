import 'server-only';
import { BODY_LIMITS, CreateBoardRequest, RefreshBoardRequest } from '../../../lib/contracts/board.ts';
import { ApiError, normalizeUrlsOrThrow, type GuardSpec } from '../../../lib/server/guarded.ts';
import { runDeps } from '../../../lib/server/operations.ts';
import { openState } from '../../../lib/server/snapshots.ts';
import { createBoardDomain, refreshBoardDomain } from '../../../lib/search/planner.ts';

// Route specs for the domain engine; same guard chain as every route (origin -> body -> schema -> snapshot -> quota -> execute).
export const createBoardSpec: GuardSpec<CreateBoardRequest> = {
  schema: CreateBoardRequest,
  maxBytes: BODY_LIMITS.create,
  prepare: (body, { config }) => ({ ...body, urls: normalizeUrlsOrThrow(body.urls, config.sourceHosts) }),
  execute: async (body, ctx) => ({ status: 201, body: await createBoardDomain(body, runDeps(ctx)) }),
};

export const refreshBoardSpec: GuardSpec<RefreshBoardRequest> = {
  schema: RefreshBoardRequest,
  maxBytes: BODY_LIMITS.refresh,
  prepare: (body, { config, secrets }) => {
    // Tampered/expired/foreign snapshots are rejected here, before any quota or paid call.
    if (config.configured.signing) {
      const state = openState(body.snapshot, secrets.stateSecret, config.sourceHosts);
      if (!body.force && (body.requirements === undefined || body.requirements === state.board.requirements)) throw new ApiError('INVALID_INPUT', 'Nothing to do: set force=true to re-check sources or change the requirements.');
    }
    return body;
  },
  execute: async (body, ctx) => ({ status: 200, body: await refreshBoardDomain(body, openState(body.snapshot, ctx.secrets.stateSecret, ctx.config.sourceHosts), runDeps(ctx)) }),
};
