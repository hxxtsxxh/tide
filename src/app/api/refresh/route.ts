import { runGuarded } from '@/lib/server/guarded';
import { legacyRefreshSpec } from '@/lib/server/operations';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export function POST(req: Request) {
  return runGuarded(req, legacyRefreshSpec);
}
