import Link from 'next/link';
import { PUBLIC_LIMITS } from '@/lib/contracts/board';
import { serverConfig } from '@/lib/server/config';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Privacy and limits — Ripple' };

export default function Privacy() {
  return (
    <main>
      <h1>Privacy and limits</h1>
      <h2>Where your boards live</h2>
      <p>
        Ripple is a no-login public beta. Your boards, revisions and evidence are stored only in this browser (IndexedDB). There is no account,
        cloud backup or cross-device sync. A different browser or device starts empty. Clearing site data for this site removes your boards, so
        export a JSON archive first. You can delete a board at any time; deletion removes its local records.
      </p>
      <h2>What is sent for processing</h2>
      <p>
        When you create or refresh a board, your question, requirements and source URLs are sent to this site&apos;s server, which uses Telem to
        search and fetch public pages and the configured model provider to extract facts and draft answers. Necessary page excerpts are sent to
        the model provider. Not all data stays on your device. Server logs keep request IDs, error codes and timings, not your questions or
        documents. No analytics or marketing tracking is added.
      </p>
      <h2>Supported public sources</h2>
      <p>Only HTTPS public documentation pages on these exact hosts are accepted: {serverConfig().sourceHosts.join(', ')}.</p>
      <p>Private documents, logins, paywalled pages, uploads and scheduled monitoring are not supported. Refresh only happens when you ask.</p>
      <h2>Usage limits</h2>
      <p>
        Each operation is capped at {PUBLIC_LIMITS.sources} source pages, {PUBLIC_LIMITS.search_queries} search queries,{' '}
        {PUBLIC_LIMITS.model_calls} model calls and {PUBLIC_LIMITS.timeout_ms / 1000} seconds. Shared daily and per-minute limits apply to every
        visitor through a signed anonymous cookie, plus a global daily cap. The shared limiter stores only expiring pseudonymous counters, never
        your research. When a limit is reached you will see when to retry.
      </p>
      <p>
        <Link href="/">Back to Ripple</Link>
      </p>
    </main>
  );
}
