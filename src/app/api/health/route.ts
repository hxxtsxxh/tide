import { healthBody } from '@/lib/server/health';

export const dynamic = 'force-dynamic';

/** Readiness/configuration only: no Telem, model or Redis calls, no secrets. */
export function GET() {
  return Response.json(healthBody(), { headers: { 'Cache-Control': 'no-store' } });
}
