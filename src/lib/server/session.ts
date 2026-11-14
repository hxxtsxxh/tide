import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Anonymous visitor cookie; the MCP bridge persists cookies matching /^ripple[_-]/. */
export const VISITOR_COOKIE = 'ripple_visitor';
const MAX_AGE_SECONDS = 180 * 86400;

function sign(id: string, secret: string): string {
  if (secret.length < 32) throw new Error('STATE_SECRET_REQUIRED');
  return createHmac('sha256', secret).update('ripple-visitor-cookie-v1\0' + id).digest('base64url');
}

export function readCookie(header: string | null, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** Returns the verified visitor ID, or null for missing/forged cookies. Client-chosen IDs never pass. */
export function verifyVisitor(cookieHeader: string | null, secret: string): string | null {
  const value = readCookie(cookieHeader, VISITOR_COOKIE);
  if (!value || value.length > 200) return null;
  const [id, mac, extra] = value.split('.');
  if (extra !== undefined || !id || !mac || !/^[\w-]{22}$/.test(id)) return null;
  const want = Buffer.from(sign(id, secret));
  const got = Buffer.from(mac);
  return got.length === want.length && timingSafeEqual(got, want) ? id : null;
}

export function mintVisitor(secret: string, secure: boolean): { id: string; setCookie: string } {
  const id = randomBytes(16).toString('base64url');
  const attrs = [`${VISITOR_COOKIE}=${id}.${sign(id, secret)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${MAX_AGE_SECONDS}`];
  if (secure) attrs.push('Secure');
  return { id, setCookie: attrs.join('; ') };
}
