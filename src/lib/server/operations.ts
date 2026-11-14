import 'server-only';
import { BODY_LIMITS, CreateBoardRequest, DiscoverRequest, RefreshBoardRequest } from '../contracts/board.ts';
import { LegacyRequest } from '../contracts/legacy.ts';
import { ApiError, normalizeUrlsOrThrow, type GuardSpec } from './guarded.ts';

// Route specs for the single guarded entrypoint. T02/T04 add `execute`; until then each route
// validates fully and answers 501 NOT_IMPLEMENTED without reserving quota or calling upstream.

export const createBoardSpec: GuardSpec<CreateBoardRequest> = {
  schema: CreateBoardRequest,
  maxBytes: BODY_LIMITS.create,
  prepare: (body, { config }) => ({ ...body, urls: normalizeUrlsOrThrow(body.urls, config.sourceHosts) }),
};

export const refreshBoardSpec: GuardSpec<RefreshBoardRequest> = {
  schema: RefreshBoardRequest,
  maxBytes: BODY_LIMITS.refresh,
};

export const discoverSpec: GuardSpec<DiscoverRequest> = {
  schema: DiscoverRequest,
  maxBytes: BODY_LIMITS.discover,
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
};
