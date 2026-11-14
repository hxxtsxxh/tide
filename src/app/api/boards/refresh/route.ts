import { runGuarded } from '@/lib/server/guarded';
import { refreshBoardSpec } from '@/app/api/_lib/specs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export function POST(req: Request) {
  return runGuarded(req, refreshBoardSpec);
}
