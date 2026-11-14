// Server-only wrapper around the prepared reference primitives (copied verbatim into guards-core.mjs;
// its regression suite runs in tests/guards.test.mjs). Never import from client components.
import 'server-only';
import { verifySnapshot as verifyReferenceSnapshot } from './guards-core.mjs';
export { normalizeSourceUrl, signSnapshot, reserveBudget, RunBudget, QUOTA_LUA } from './guards-core.mjs';

/** Require the exact unpadded encoding emitted by signSnapshot, including unused bits. */
export function verifySnapshot(token: string, secret: string, now?: number): unknown {
  if (typeof token !== 'string' || token.length > 550_000) throw new Error('INVALID_SNAPSHOT');
  const parts = token.split('.');
  if (parts.length !== 2 || parts.some((part) => !part || Buffer.from(part, 'base64url').toString('base64url') !== part)) {
    throw new Error('INVALID_SNAPSHOT');
  }
  return verifyReferenceSnapshot(token, secret, now);
}
