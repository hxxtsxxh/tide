import { serverConfig, secrets } from '@/lib/server/config';
import { errorResponse, publicUrl } from '@/lib/server/guarded';
import { mintVisitor, verifyVisitor } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

/** Mint a signed anonymous visitor cookie if missing. No account; the key never leaves the server. */
export function GET(req: Request) {
  if (!serverConfig().configured.signing) return errorResponse('QUOTA_UNAVAILABLE', 'Session signing is not configured.', 'session');
  const { stateSecret } = secrets();
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  if (!verifyVisitor(req.headers.get('cookie'), stateSecret)) headers['Set-Cookie'] = mintVisitor(stateSecret, publicUrl(req).protocol === 'https:').setCookie;
  return Response.json({ ok: true }, { headers });
}
