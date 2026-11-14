import Link from "next/link";
import { PUBLIC_LIMITS } from "@/lib/contracts/board";
import { serverConfig } from "@/lib/server/config";
export const dynamic = "force-dynamic";
export const metadata = { title: "Privacy and limits — Ripple" };
export default function Privacy() {
  const config = serverConfig();
  return (
    <main className="prose-page">
      <nav className="prose-nav" aria-label="Page navigation">
        <Link href="/" className="brand">
          ripple
        </Link>
        <Link href="/integrations">For coding agents</Link>
      </nav>
      <span className="eyebrow">YOUR RESEARCH · YOUR LOCAL LIBRARY</span>
      <h1>Privacy and limits.</h1>
      <p className="lead">
        Your board library lives in your browser. Research requests use external
        services. Here is what gets stored, what gets sent, and where this beta
        stops.
      </p>
      <div className="privacy-grid">
        <section className="panel">
          <h2>Stored in this browser</h2>
          <p>
            Boards, evidence, immutable revisions and local review notes use
            IndexedDB. There is no account, cloud backup or cross-device sync. A
            fresh browser or device has an empty library. Browser storage is not
            encrypted by Ripple. A small localStorage journal stores only board
            IDs and expected revisions so a confirmed deletion can finish after
            an interrupted page reload.
          </p>
        </section>
        <section className="panel">
          <h2>Sent for research</h2>
          <p>
            Your question, requirements, selected public URLs and necessary page
            excerpts go to this site&apos;s server. Telem searches, routes and
            qualifies the public pages. The selected public URLs (never your
            question or requirements) are also sent to Tavily Extract, whose
            page text is the quoted evidence. The configured model provider
            extracts facts and drafts decisions. Not all data stays on-device.
          </p>
        </section>
      </div>
      <h2>Save, export, clear or delete</h2>
      <p>
        Successful operations save automatically. The workspace shows storage
        errors and offers a recovery download when a write fails. Concurrent
        tabs use expected local revisions, so an old tab cannot silently
        overwrite a newer board. Use Reload saved to reconcile.
      </p>
      <p>
        Export a JSON archive before clearing site data. Clearing browser data
        removes all local boards. Delete board asks for confirmation and removes
        that board, its full local revision records and local review notes.
        Downloaded exports, copies in another browser and the agent vault are
        separate; deleting here does not remove them.
      </p>
      <p>
        All successfully saved revisions remain locally until you delete the
        board. A bounded archive includes up to the latest 20 full revision
        records, with a 1 MiB maximum. Earlier local records are retained. A
        current-only recovery download omits prior full revision records. Keep
        exports private: they contain your question, source excerpts and
        observed answers.
      </p>
      <h2>Historical evidence is not a fresh check</h2>
      <p>
        Imported archives are unverified historical records, even if they
        contain a signed snapshot. Imports may have no snapshot at all. A live
        rebuild fetches permitted sources and creates a new board while
        preserving the old archive. Server signatures protect observation
        integrity; they do not encrypt data or establish truth.
      </p>
      <p>
        A passage shows what a page said when observed. Cached, failed, partial
        or contradictory reads may leave freshness unknown. Model-inferred
        dependencies can be incomplete. Review notes are local annotations; to
        correct the computed graph, describe the correction in requirements and
        rebuild. A changed requirement is your input, not evidence of a remote
        page change.
      </p>
      <p>
        Direct Tavily extraction uses basic depth, one attempt and at most five
        selected URLs. The evidence view shows returned provider request IDs,
        batch credits when reported, partial content and errors. A reported zero
        is an observation, not a promise of free usage. If Tavily fails, any
        Telem text used instead is labeled degraded. Both services reading one
        URL still represent one source. Observation time does not establish
        page publication or provider cache age; upstream cache freshness and
        complete provider-side redirect chains cannot be independently checked.
      </p>
      <h2>Supported public sources</h2>
      <p>
        Only HTTPS public text pages on these exact operator-approved hosts are
        accepted:
      </p>
      <div className="host-list">
        {config.sourceHosts.map((host) => (
          <code key={host}>{host}</code>
        ))}
      </div>
      <p>
        Private documents, logins, paywalled pages, signed URLs, PDF/video
        uploads, arbitrary internet crawling and medical, legal or financial
        advice are outside this beta. We do not silently follow outbound links.
        Discovery returns candidates for you to choose; a search snippet alone
        cannot support a fact.
      </p>
      <h2>Bounded public usage</h2>
      <p>
        Each admitted research operation allows at most {PUBLIC_LIMITS.sources}{" "}
        source pages, {PUBLIC_LIMITS.search_queries} search queries with at most{" "}
        {PUBLIC_LIMITS.search_providers} providers, {PUBLIC_LIMITS.model_calls}{" "}
        model attempts and {PUBLIC_LIMITS.timeout_ms / 1000} seconds. A board
        holds at most {PUBLIC_LIMITS.facts} facts and {PUBLIC_LIMITS.answers}{" "}
        decisions. Failed attempts count. Creating, discovering and refreshing
        each consume shared allowance; remaining allowance is not currently
        displayed.
      </p>
      <p>
        This deployment admits at most {config.quota.visitorDaily} operations
        per signed anonymous visitor per day, {config.quota.visitorMinute} per
        minute, and {config.quota.globalDaily} per day globally. These are
        operation limits, not a dollar billing guarantee. A quota response shows
        Retry-After when provided. Browser requests are never automatically retried. The Telem adapter may retry a transient failure once within the same operation deadline; direct Tavily extraction is attempted once.
      </p>
      <p>
        A signed anonymous HttpOnly, SameSite cookie identifies the visitor
        quota. Production cookies use Secure. Shared Redis stores expiring
        pseudonymous quota counters, not your boards or source text. If the
        quota service is unavailable or public access is disabled, paid
        operations fail without a simulated substitute. Clearing cookies does
        not remove the global cap.
      </p>
      <h2>Logs, agents and the Simulation Lab</h2>
      <p>
        Application logs are intended to contain request IDs, coded errors and
        bounded timings, without raw questions, source documents, credentials or
        provider errors. No analytics or marketing tracking is added by this
        application.
      </p>
      <p>
        The <Link href="/integrations">local agent connector</Link> keeps a
        separate file vault. Browser and agent libraries share only through
        explicit JSON export/import. Host permissions remain in effect. Native
        client compatibility requires separate verification.
      </p>
      <p>
        Simulation Lab is finite authored teaching data, visibly labeled
        synthetic. It runs entirely in the client, makes no live-model or
        source-fetch calls, and never stands in for failed live research. There
        is no background polling or scheduled monitoring; real refresh happens
        only when you ask.
      </p>
      <footer className="prose-footer">
        <Link href="/">Back to your workspace</Link>
      </footer>
    </main>
  );
}
