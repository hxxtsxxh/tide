import 'server-only';
import { BODY_LIMITS, CreateBoardRequest, DiscoverRequest, RefreshBoardRequest } from '../contracts/board.ts';
import { LegacyRequest } from '../contracts/legacy.ts';
import { ApiError, normalizeUrlsOrThrow, type GuardContext, type GuardSpec } from './guarded.ts';
import { withMode } from './config.ts';
import { runLegacyFixture, runLegacyLive } from './legacy.ts';
import { createBoard, discover, openSnapshot, refreshBoard, type RunDeps } from './research.ts';

// Route specs for the single guarded entrypoint. Every route validates origin/body/schema/source
// policy (and verifies snapshots) BEFORE quota is reserved or any provider is called.

export const runDeps = (ctx: GuardContext): RunDeps => ({
  requestId: ctx.requestId,
  config: ctx.config,
  secrets: ctx.secrets,
  budget: ctx.budget,
  signal: ctx.signal,
  deadlineAt: ctx.budget.started + ctx.budget.timeoutMs,
  fetchImpl: ctx.fetchImpl,
});

export const createBoardSpec: GuardSpec<CreateBoardRequest> = {
  schema: CreateBoardRequest,
  maxBytes: BODY_LIMITS.create,
  prepare: (body, { config }) => ({ ...body, urls: normalizeUrlsOrThrow(body.urls, withMode(config, body.mode).sourceHosts) }),
  execute: async (body, ctx) => ({ status: 201, body: await createBoard(body, runDeps({ ...ctx, config: withMode(ctx.config, body.mode) })) }),
};

export const refreshBoardSpec: GuardSpec<RefreshBoardRequest> = {
  schema: RefreshBoardRequest,
  maxBytes: BODY_LIMITS.refresh,
  prepare: (body, { config, secrets }) => {
    // Tampered/expired/foreign snapshots are rejected here, before any quota or paid call.
    if (config.configured.signing) {
      const state = openSnapshot(body.snapshot, secrets.stateSecret, config.sourceHosts);
      if (!body.force && (body.requirements === undefined || body.requirements === state.board.requirements)) throw new ApiError('INVALID_INPUT', 'Nothing to do: set force=true to re-check sources or change the requirements.');
    }
    return body;
  },
  execute: async (body, ctx) => {
    const state = openSnapshot(body.snapshot, ctx.secrets.stateSecret, ctx.config.sourceHosts);
    return { status: 200, body: await refreshBoard(body, state, runDeps(ctx)) };
  },
};

export const discoverSpec: GuardSpec<DiscoverRequest> = {
  schema: DiscoverRequest,
  maxBytes: BODY_LIMITS.discover,
  execute: async (body, ctx) => ({ status: 200, body: await discover(body, runDeps({ ...ctx, config: withMode(ctx.config, body.mode) })) }),
};

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export const legacyRefreshSpec: GuardSpec<LegacyRequest> = {
  schema: LegacyRequest,
  maxBytes: BODY_LIMITS.legacy,
  prepare: (body, { config, url }) => {
    if (body.mode === 'fixture' && !(config.fixtureTransportAllowed && LOCAL_HOSTS.has(url.hostname)))
      throw new ApiError('FIXTURE_MODE_DISABLED', 'Fixture transport is only available on localhost with ALLOW_FIXTURE_MODE=true.');
    const urls = body.input.source_urls;
    if (urls !== undefined) {
      if (!Array.isArray(urls) || urls.length > 5 || urls.some((u) => typeof u !== 'string')) throw new ApiError('INVALID_INPUT', 'input.source_urls must be up to 5 URLs.');
      if (body.mode === 'live') normalizeUrlsOrThrow(urls as string[], config.sourceHosts);
    }
    return body;
  },
  // Localhost fixture replay makes no paid calls; live mode always spends shared quota.
  billable: (body) => body.mode === 'live',
  execute: async (body, ctx) => ({
    status: 200,
    body: body.mode === 'fixture'
      ? await runLegacyFixture(body, { config: ctx.config, hostname: ctx.url.hostname, requestId: ctx.requestId })
      : await runLegacyLive(body, runDeps(ctx), ctx.budget),
  }),
};
