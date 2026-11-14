import Link from "next/link";
import { existsSync } from "node:fs";
import { join } from "node:path";
export const dynamic = "force-dynamic";
export const metadata = { title: "Use Tide with coding agents — Tide" };
export default function Integrations() {
  const checksumAvailable = existsSync(
    join(process.cwd(), "public/downloads/ripple-agent-kit.zip.sha256"),
  );
  const kitAvailable = existsSync(
    join(process.cwd(), "public/downloads/ripple-agent-kit.zip"),
  );
  return (
    <main className="prose-page">
      <nav className="prose-nav" aria-label="Page navigation">
        <Link href="/" className="brand">
          tide
        </Link>
        <Link href="/privacy">Privacy & limits</Link>
      </nav>
      <span className="eyebrow">
        PUBLIC EVIDENCE, CARRIED INTO YOUR NEXT SESSION
      </span>
      <h1>
        Keep the reasoning
        <br />
        with the work.
      </h1>
      <p className="lead">
        Use Tide from Claude Code or Codex to save the public evidence behind
        a decision, then recheck that evidence before changing your integration.
      </p>
      <div className="panel">
        <h2>A local bridge to the same service</h2>
        <p>
          The agent kit runs a local stdio MCP server. It calls the same bounded
          public research endpoints as this website. Source fetching and model
          reasoning run on the Tide service; you do not supply Telem, Tavily,
          model, Redis or signing keys.
        </p>
        {kitAvailable ? (
          <div className="integration-status">
            <a href="/downloads/ripple-agent-kit.zip" download>
              Download the Tide agent source kit (.zip)
            </a>
            {checksumAvailable && (
              <>
                <span>·</span>
                <a href="/downloads/ripple-agent-kit.zip.sha256">
                  SHA-256 checksum
                </a>
              </>
            )}
          </div>
        ) : (
          <p className="notice">
            The downloadable agent kit has not been packaged in this build.
            Setup below describes the supplied connector workflow; a working
            download appears only after the reviewed archive exists.
          </p>
        )}
        <p className="small muted">
          This is a local source distribution. It is not an npm package or
          marketplace listing. Native Claude Code and Codex invocation must be
          verified separately; this page is not a compatibility certification.
        </p>
      </div>
      <h2>Connect a trusted project</h2>
      <p>
        After downloading and reviewing the kit, extract it to a permanent local
        directory. Node 22 or newer is required. The optional setup helper uses
        Python 3.11 or newer. Run from the extracted kit directory with your
        project path and the operator&apos;s actual verified deployment origin:
      </p>
      <pre>
        <code>{`python3 scripts/connect-agents.py \\\n  --project "/absolute/path/to/your-project" \\\n  --base-url "https://YOUR-VERIFIED-RIPPLE-DEPLOYMENT" \\\n  --agent both`}</code>
      </pre>
      <p>
        The first command is a dry run. Review its proposed changes, then run
        the same arguments with <code>--apply</code> to install the project
        connection. Replace both placeholders with your own paths and the
        verified service URL.
      </p>
      <pre>
        <code>{`python3 scripts/connect-agents.py \\\n  --project "/absolute/path/to/your-project" \\\n  --base-url "https://YOUR-VERIFIED-RIPPLE-DEPLOYMENT" \\\n  --agent both --apply`}</code>
      </pre>
      <p>
        The helper merges the <code>ripple</code> entry into{" "}
        <code>.mcp.json</code> for Claude Code and{" "}
        <code>.codex/config.toml</code> for Codex. It installs portable skills
        into <code>.claude/skills/</code> and <code>.agents/skills/</code>,
        preserves unrelated settings, rejects conflicts and keeps private
        configuration backups outside the repository. Choose{" "}
        <code>--agent claude</code> or <code>--agent codex</code> for a single
        client.
      </p>
      <h2>Verify the connection in the client</h2>
      <ol>
        <li>
          Open a new ordinary trusted Claude Code or Codex session in the
          configured project. Use <code>/mcp</code> to inspect the connection.
        </li>
        <li>
          Explicitly ask the agent to call <code>ripple_status</code> and{" "}
          <code>ripple_list_boards</code>. A configuration listing alone does
          not prove invocation.
        </li>
        <li>
          Invoke <code>/ripple-research</code> in Claude Code or{" "}
          <code>$ripple-research</code> in Codex, or ask for a public-source
          board directly. Tool prefixes can vary by client.
        </li>
        <li>
          Before revisiting a decision, read the board and use{" "}
          <code>ripple_refresh_board</code> with the expected current local
          revision. <code>ripple_get_board</code> reads history without checking
          sources.
        </li>
      </ol>
      <p className="notice">
        Normal host permissions and organization policies still apply. Skills
        and MCP annotations do not grant authority. Tide does not edit your
        repository, run shell commands, read arbitrary local files or upload
        your code.
      </p>
      <h2>Two local libraries. Explicit transfer.</h2>
      <div className="privacy-grid">
        <section className="panel">
          <h3>Web workspace</h3>
          <p>
            Boards live in this browser&apos;s IndexedDB. Another browser or
            device starts empty. Clearing site data deletes that local library.
          </p>
        </section>
        <section className="panel">
          <h3>Agent vault</h3>
          <p>
            The connector uses private local files, separated by service origin.
            The helper also isolates by project. Vault files are not encrypted;
            sessions and users with access to that local directory may read
            them.
          </p>
        </section>
      </div>
      <p>
        Browser boards do not automatically appear in the agent vault. Export a{" "}
        <code>ripple-board-v1</code> JSON archive from one interface, then
        explicitly import it into the other. Imported evidence remains
        historical and unverified, including archives with{" "}
        <code>snapshot: null</code>. Rebuild from permitted live public sources
        before calling those facts fresh.
      </p>
      <h2>Research only when you ask</h2>
      <p>
        There is no background polling, scheduled monitoring, cross-device sync,
        anonymous cloud library or public remote MCP endpoint. Refresh is an
        explicit operation. Questions, URLs and necessary source excerpts reach
        Tide, Telem, Tavily (selected URLs only) and the configured model
        provider. The same
        supported-source restrictions and shared usage quotas apply to agent
        requests.
      </p>
      <p>
        By default, the connector bounds each process to 12 admitted billable
        operations and each HTTP request to 55 seconds, with up to 50 local
        boards. Failed attempts may use allowance. It never retries a timeout,
        provider failure or quota rejection automatically. Do not restart it or
        rotate cookies to evade limits.
      </p>
      <h2>Recover or disconnect</h2>
      <p>
        On a revision conflict, read the latest saved board and reconcile before
        writing. If revalidation is required, preserve the historical board and
        explicitly rebuild from the original question and public URLs. If the
        vault is busy, stop the competing process; do not remove a lock while a
        client is using it.
      </p>
      <p>
        To uninstall, remove only the <code>ripple</code> MCP entry and the two
        Ripple skill directories, or unload the optional local Claude plugin.
        Preserve unrelated client configuration. Local boards remain until you
        explicitly delete them or the vault. Deleting a browser board does not
        delete agent copies or exported archives.
      </p>
      <footer className="prose-footer">
        <Link href="/">Open your browser workspace</Link> ·{" "}
        <Link href="/privacy">
          Read privacy, source restrictions and limits
        </Link>
      </footer>
    </main>
  );
}
