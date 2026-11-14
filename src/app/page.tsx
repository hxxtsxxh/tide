import Link from 'next/link';
import { TEST_IDS } from '@/lib/contracts/testids';
import { PUBLIC_LIMITS } from '@/lib/contracts/board';
import { serverConfig } from '@/lib/server/config';

export const dynamic = 'force-dynamic';

// T01 application shell. T03 replaces this with the client board workflow (IndexedDB library,
// evidence inspector, refresh/export/import/delete). The selectors here are the frozen ones.
export default function Home() {
  return (
    <main>
      <h1>Ripple</h1>
      <p>When one source changes, know exactly which decisions to revisit.</p>
      <section aria-labelledby="new-board-heading">
        <h2 id="new-board-heading">Create your board</h2>
        <p className="notice">
          Your question, URLs and requirements are sent to Telem and the configured model provider for processing. Boards are saved only in this
          browser. See <Link href="/privacy">privacy and limits</Link>.
        </p>
        <form>
          <label htmlFor="nb-title">Board title</label>
          <input id="nb-title" data-testid={TEST_IDS.newBoardTitle} maxLength={120} required />
          <label htmlFor="nb-question">Question</label>
          <textarea id="nb-question" data-testid={TEST_IDS.newBoardQuestion} maxLength={2000} required />
          <label htmlFor="nb-urls">Source URLs (one per line, up to {PUBLIC_LIMITS.sources})</label>
          <textarea id="nb-urls" data-testid={TEST_IDS.newBoardUrls} />
          <label htmlFor="nb-req">Requirements</label>
          <textarea id="nb-req" data-testid={TEST_IDS.newBoardRequirements} maxLength={2000} />
          <p>
            <button type="submit" data-testid={TEST_IDS.createBoard} disabled>
              Create board
            </button>{' '}
            <span className="muted">Board creation is not wired up yet in this build.</span>
          </p>
        </form>
        <p className="muted">Supported hosts: {serverConfig().sourceHosts.join(', ')}</p>
      </section>
    </main>
  );
}
