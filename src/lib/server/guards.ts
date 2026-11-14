// Server-only wrapper around the prepared reference primitives (copied verbatim into guards-core.mjs;
// its regression suite runs in tests/guards.test.mjs). Never import from client components.
import 'server-only';
export { normalizeSourceUrl, signSnapshot, verifySnapshot, reserveBudget, RunBudget, QUOTA_LUA } from './guards-core.mjs';
