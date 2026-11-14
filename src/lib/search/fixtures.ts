import 'server-only';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export type FixtureSource = { id: string; url: string; title: string; text: string };
export type FixtureWorld = { id: string; label: string; sources: FixtureSource[]; input: Record<string, unknown> };

// Only this file is ever read: never evaluation/oracle.json. Kept in the repo root; the prepared
// context copy is a dev-time fallback so a fresh checkout works before fixtures/ is promoted.
/**
 * Explicitly gated fixture transport. `allowed` must be computed by the caller from
 * ALLOW_FIXTURE_MODE=true && !VERCEL && localhost request; this loader refuses otherwise so no
 * code path can fall back to fixtures implicitly.
 */
export async function loadWorld(fixtureId: string, allowed: boolean): Promise<FixtureWorld | null> {
  if (!allowed) throw new Error('FIXTURE_TRANSPORT_DISABLED');
  let text: string;
  try {
    // Literal paths keep the deployment tracer scoped to these two fixture files.
    text = await readFile(resolve(process.cwd(), 'fixtures/worlds.json'), 'utf8');
  } catch {
    try {
      text = await readFile(resolve(process.cwd(), '.searchhack/context/fixtures/worlds.json'), 'utf8');
    } catch {
      throw new Error('FIXTURES_UNAVAILABLE');
    }
  }
  const worlds = (JSON.parse(text) as { worlds?: FixtureWorld[] }).worlds ?? [];
  return worlds.find((w) => w.id === fixtureId) ?? null;
}
