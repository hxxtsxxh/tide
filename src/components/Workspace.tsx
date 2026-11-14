"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ARCHIVE_MAX_BYTES,
  type BoardArchive,
  type DiscoverResponse,
} from "@/lib/contracts/board";
import type { BoardRecord, RevisionRecord } from "@/lib/contracts/storage";
import { TEST_IDS } from "@/lib/contracts/testids";
import { SIMULATION_LAB_ENABLED } from "@/lib/demo-policy";
import * as api from "@/lib/client/api";
import * as storage from "@/lib/client/storage";
import { safeSourceLink, validateArchive } from "@/lib/client/archive";
import BoardInspector from "./BoardInspector";
import SimulationLab from "./SimulationLab";
import { Icon, Modal, time } from "./ui";
import RippleGrid from "./bits/RippleGrid";
import BlurText from "./bits/BlurText";

type Draft = {
  title: string;
  question: string;
  urls: string;
  requirements: string;
};
const blank: Draft = { title: "", question: "", urls: "", requirements: "" };
const sample: Draft = {
  title: "My page-ingestion research",
  question:
    "Can I safely fetch public pages in batches of three and recover from individual page failures?",
  urls: "https://docs.telem.ai/api/\nhttps://docs.telem.ai/resources/fetch-best-practices/",
  requirements: "I need to process three source URLs at a time.",
};
function download(data: unknown, title: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download =
    (title.replace(/[^a-z0-9_-]/gi, "-").slice(0, 80) || "ripple-board") +
    ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export default function Workspace({
  hosts,
  quota,
}: {
  hosts: string[];
  quota: { globalDaily: number; visitorDaily: number; visitorMinute: number };
}) {
  const [view, setView] = useState<"new" | "board" | "lab">("new");
  const [draft, setDraft] = useState<Draft>(blank);
  const [library, setLibrary] = useState<BoardRecord[]>([]),
    [record, setRecord] = useState<BoardRecord | null>(null);
  const [requirements, setRequirements] = useState("");
  const [revisions, setRevisions] = useState<RevisionRecord[]>([]),
    [reviews, setReviews] = useState<storage.ReviewNotes>({});
  const [ready, setReady] = useState(false),
    [unsaved, setUnsaved] = useState(false),
    [storageError, setStorageError] = useState("");
  const [error, setError] = useState<api.RequestError | null>(null),
    [notice, setNotice] = useState("");
  const [pending, setPending] = useState(""),
    [confirmDelete, setConfirmDelete] = useState(false),
    [externalChange, setExternalChange] = useState(false);
  const [discover, setDiscover] = useState(false),
    [query, setQuery] = useState(""),
    [discovery, setDiscovery] = useState<DiscoverResponse | null>(null);
  const operation = useRef(false);
  const pendingHistory = useRef<BoardArchive["revisions"]>([]);
  const busy = Boolean(pending);
  const fileRef = useRef<HTMLInputElement>(null);

  async function reloadLibrary(restore = false) {
    const stored = await storage.loadLibrary();
    setLibrary(stored.boards);
    if (restore) {
      const active = stored.boards.find((b) => b.id === stored.activeId);
      if (active) await openBoard(active, false);
      else {
        setRecord(null);
        setView("new");
      }
    }
  }
  async function openBoard(board: BoardRecord, remember = true) {
    setRecord(board);
    setRequirements(board.board.requirements);
    setView("board");
    setUnsaved(false);
    setError(null);
    setNotice("");
    setExternalChange(false);
    try {
      if (remember) await storage.setActiveBoard(board.id);
      const [rs, notes] = await Promise.all([
        storage.getRevisions(board.id),
        storage.getReviews(board.id),
      ]);
      setRevisions(rs);
      setReviews(notes);
      setStorageError("");
    } catch (e) {
      setStorageError(storage.storageMessage(e));
    }
  }
  useEffect(() => {
    let alive = true;
    storage
      .loadLibrary()
      .then(async (stored) => {
        if (!alive) return;
        setLibrary(stored.boards);
        const active = stored.boards.find((b) => b.id === stored.activeId);
        if (active) await openBoard(active, false);
      })
      .catch((e) => {
        if (alive) setStorageError(storage.storageMessage(e));
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    const unwatch = storage.watchLibrary(() => setExternalChange(true));
    return () => {
      alive = false;
      unwatch();
    };
    // This effect connects to the browser library once. Board switches are explicit user actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (discover) {
      document
        .getElementById("source-discovery")
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
      document
        .getElementById("discovery-query")
        ?.focus({ preventScroll: true });
    }
  }, [discover]);

  function fail(e: unknown) {
    setError(
      e instanceof api.RequestError
        ? e
        : new api.RequestError(
            "LOCAL_ERROR",
            e instanceof Error
              ? e.message
              : "The operation could not complete.",
          ),
    );
  }
  async function run(label: string, work: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true;
    setPending(label);
    setError(null);
    setNotice("");
    try {
      await work();
    } catch (e) {
      fail(e);
    } finally {
      operation.current = false;
      setPending("");
    }
  }
  async function persist(
    next: BoardRecord,
    expected: number | null,
    archives: BoardArchive["revisions"] = [],
  ) {
    pendingHistory.current = archives;
    // Show the board only after the write settles, so a visible board is never an uncommitted one.
    let saved: BoardRecord | null = null;
    try {
      saved = await storage.saveBoard(next, expected, archives);
    } catch (e) {
      setUnsaved(true);
      setStorageError(storage.storageMessage(e));
    }
    setRecord(saved ?? next);
    setRequirements(next.board.requirements);
    setView("board");
    setReviews({});
    if (!saved) return;
    try {
      setUnsaved(false);
      setStorageError("");
      pendingHistory.current = [];
      const [rs, notes] = await Promise.all([
        storage.getRevisions(saved.id),
        storage.getReviews(saved.id),
      ]);
      setRevisions(rs);
      setReviews(notes);
      await reloadLibrary();
    } catch (e) {
      setUnsaved(true);
      setStorageError(storage.storageMessage(e));
    }
  }
  function urls() {
    return [
      ...new Set(
        draft.urls
          .split(/\r?\n/)
          .map((u) => u.trim())
          .filter(Boolean),
      ),
    ];
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    await run("Building your board from public sources", async () => {
      const selected = urls();
      if (!selected.length || selected.length > 5)
        throw new Error("Add between one and five source URLs.");
      for (const source of selected) {
        const href = safeSourceLink(source);
        if (!href || !hosts.includes(new URL(href).hostname))
          throw new Error(
            "Use an HTTPS URL on one of the supported exact hosts.",
          );
      }
      const envelope = await api.createBoard({
        request_id: api.newRequestId(),
        title: draft.title,
        question: draft.question,
        requirements: draft.requirements,
        urls: selected,
      });
      await persist(storage.fromEnvelope(envelope), null);
      setNotice(
        "Live observation received. Review the proposed dependencies before relying on the decisions.",
      );
    });
  }
  async function update(force: boolean) {
    if (!record) return;
    const prior = record;
    await run(
      force
        ? "Rechecking the selected public sources"
        : "Applying your requirement edit",
      async () => {
        if (prior.trust !== "observed" || !prior.snapshot)
          throw new Error(
            "This historical record needs a live rebuild before it can be refreshed.",
          );
        try {
          const envelope = await api.refreshBoard({
            request_id: api.newRequestId(),
            snapshot: prior.snapshot,
            force,
            ...(!force ? { requirements } : {}),
          });
          await persist(
            {
              ...storage.fromEnvelope(envelope),
              localRevision: prior.localRevision,
            },
            prior.localRevision,
          );
          setNotice(
            force
              ? "Source recheck recorded. Unchanged observations may reuse answer versions; failed reads retain unknown freshness."
              : "User requirement edit recorded. This does not mean a remote page changed.",
          );
        } catch (e) {
          if (
            e instanceof api.RequestError &&
            e.code === "REVALIDATION_REQUIRED"
          ) {
            const archived = {
              ...prior,
              trust: "archived-unverified" as const,
              snapshot: null,
            };
            await persist(archived, prior.localRevision);
          }
          throw e;
        }
      },
    );
  }
  async function rebuild() {
    if (!record) return;
    const prior = record;
    await run(
      "Rebuilding from the original question and public sources",
      async () => {
        const envelope = await api.createBoard({
          request_id: api.newRequestId(),
          title: prior.board.title,
          question: prior.board.question,
          requirements,
          urls: prior.board.sources.map((s) => s.url),
        });
        await persist(storage.fromEnvelope(envelope), null);
        setNotice(
          "A new live board was built. The original historical board remains in your library.",
        );
      },
    );
  }
  async function importFile(file?: File) {
    if (!file) return;
    await run("Validating the historical archive", async () => {
      if (file.size > ARCHIVE_MAX_BYTES)
        throw new Error("Archives must be at most 1 MiB.");
      const archive = validateArchive(await file.text());
      const stored = await storage.loadLibrary();
      if (stored.boards.some((b) => b.id === archive.board.id))
        throw new Error(
          "This board already exists locally. Export it before deleting or importing a replacement.",
        );
      const imported: BoardRecord = {
        id: archive.board.id,
        title: archive.board.title,
        board: archive.board,
        trust: "archived-unverified",
        snapshot: null,
        localRevision: 0,
        lastTrace: null,
        lastUpdate: null,
        updatedAt: new Date().toISOString(),
      };
      await persist(imported, null, archive.revisions);
      setNotice(
        "Archive imported as historical evidence. No network request was made.",
      );
    });
    if (fileRef.current) fileRef.current.value = "";
  }
  async function exportBoard(recovery = false) {
    if (!record) return;
    try {
      const archive = recovery
        ? {
            schemaVersion: 1,
            format: "ripple-board-v1",
            board: record.board,
            snapshot: record.snapshot,
            exportedAt: new Date().toISOString(),
          }
        : await storage.exportArchive(record);
      download(archive, record.title);
      setNotice(
        recovery
          ? "Current-only archive downloaded. Previous revisions remain in the saved browser library."
          : "Archive downloaded. It includes up to 20 full saved revisions; imports are always unverified.",
      );
    } catch (e) {
      setStorageError(storage.storageMessage(e));
    }
  }
  async function remove() {
    if (!record) return;
    await run("Deleting local board records", async () => {
      await storage.deleteBoard(record);
      setConfirmDelete(false);
      setRecord(null);
      setRevisions([]);
      setReviews({});
      setView("new");
      setDraft(blank);
      setError(null);
      setUnsaved(false);
      await reloadLibrary();
      setNotice(
        "Board and its local revisions deleted. Previously exported copies are separate.",
      );
    });
  }
  async function search(event: FormEvent) {
    event.preventDefault();
    await run("Discovering permitted source candidates", async () => {
      const result = await api.discoverSources({
        request_id: api.newRequestId(),
        query: query || draft.question,
      });
      setDiscovery(result);
    });
  }
  async function review(id: string, note: storage.ReviewNote) {
    if (!record || unsaved) throw new Error("Save this board first.");
    const saved = await storage.saveReview(record, id, note);
    setRecord(saved);
    setReviews({ ...reviews, [id]: note });
    await reloadLibrary();
  }
  const retryText = error?.retryAt
    ? new Date(error.retryAt).toLocaleString()
    : null;
  return (
    <div className="app-shell">
      {/* Decorative, click-through ambient layer; RippleGrid itself skips motion under prefers-reduced-motion. */}
      <div className="ambient-layer" aria-hidden="true">
        <RippleGrid lightMode color="#0071E3" variant="dots" cellSize={34} opacity={0.55} glow={0.4} rippleStrength={0.6} rippleSpeed={0.5} autoRipple="random" rippleInterval={4.5} fade={0.55} clickRipple={false} />
      </div>
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <header className="app-header">
        <Link className="brand" href="/" aria-label="Tide home">
          <span className="ripple-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          tide<span className="beta-label">BETA</span>
        </Link>
        <div className="header-note">
          Decisions that know how well they hold up.
        </div>
        <nav aria-label="Resources">
          <Link href="/integrations">
            For agents <Icon name="arrow" size={14} />
          </Link>
          <Link href="/privacy">Privacy & limits</Link>
        </nav>
      </header>
      <div className="app-body">
        <aside className="sidebar" aria-label="Board library">
          <button
            className={"new-board-button " + (view === "new" ? "active" : "")}
            disabled={busy}
            onClick={() => {
              setView("new");
              setError(null);
              setNotice("");
            }}
          >
            <Icon name="plus" /> New board
          </button>
          <div className="library-label">
            <span>YOUR LIBRARY</span>
            <span>{library.length.toString().padStart(2, "0")}</span>
          </div>
          <div data-testid={TEST_IDS.libraryBoardList} className="library-list">
            {library.map((b) => (
              <button
                className={
                  "library-item " +
                  (view === "board" && record?.id === b.id ? "selected" : "")
                }
                key={b.id}
                disabled={busy}
                onClick={() => void openBoard(b)}
              >
                <Icon name="file" size={17} />
                <span>
                  <strong>{b.title}</strong>
                  <small>
                    {b.trust === "observed"
                      ? "Local board"
                      : "Unverified archive"}
                  </small>
                </span>
              </button>
            ))}
            {ready && !library.length && (
              <p className="library-empty">
                Your research starts here.
                <br />
                Saved in this browser.
              </p>
            )}
            {!ready && (
              <p className="library-empty" role="status">
                Opening local library…
              </p>
            )}
          </div>
          <div className="sidebar-bottom">
            <label className={"import-control " + (busy ? "disabled" : "")}>
              <Icon name="download" size={16} />
              <span>Import archive</span>
              <input
                ref={fileRef}
                aria-label="Import board JSON archive"
                data-testid={TEST_IDS.importBoardFile}
                type="file"
                accept=".json,application/json"
                disabled={busy}
                onChange={(e) => void importFile(e.target.files?.[0])}
              />
            </label>
            {SIMULATION_LAB_ENABLED && (
              <button
                data-testid={TEST_IDS.simulationTab}
                className={"sidebar-link " + (view === "lab" ? "selected" : "")}
                disabled={busy}
                onClick={() => {
                  setView("lab");
                  setError(null);
                }}
              >
                <Icon name="layers" size={17} /> Simulation Lab{" "}
                <span className="tiny-tag">SYNTHETIC</span>
              </button>
            )}
            <div className="local-note">
              <span className="local-dot" /> Browser-local storage
              <p>No account. No background polling.</p>
            </div>
          </div>
        </aside>
        <main id="workspace" className="workspace" tabIndex={-1}>
          <div className="workspace-bar">
            <span>
              {view === "new"
                ? "Workspace / New board"
                : view === "lab"
                  ? "Learn / Simulation Lab"
                  : "Workspace / Research board"}
            </span>
            <span className="workspace-mode">
              {view === "lab"
                ? "Synthetic teaching mode"
                : view === "board" && record?.trust !== "observed"
                  ? "Unverified archive"
                  : "Live research mode"}
            </span>
          </div>
          {storageError && (
            <div className="alert warning" role="alert">
              <strong>Local storage needs attention</strong>
              <p>{storageError}</p>
              {record && (
                <button
                  className="text-button"
                  onClick={() => void exportBoard(true)}
                >
                  Download current-only recovery archive{" "}
                  <Icon name="download" size={14} />
                </button>
              )}
            </div>
          )}
          {externalChange && (
            <div className="alert warning">
              <strong>The library changed in another tab.</strong>
              <p>
                Reload saved state before editing. A conflicting save will
                preserve the previously stored revision.
              </p>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void run("Reloading saved state", async () => {
                    await reloadLibrary(true);
                    setExternalChange(false);
                  })
                }
              >
                Reload saved library
              </button>
            </div>
          )}
          {error && (
            <div className="alert error" role="alert">
              <div className="row spread">
                <strong>{error.code.replaceAll("_", " ")}</strong>
                <button
                  className="icon-button"
                  onClick={() => setError(null)}
                  aria-label="Dismiss error"
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
              <p>{error.message}</p>
              {retryText && (
                <p>
                  Retry after {retryText}. Requests are never retried
                  automatically.
                </p>
              )}
              {error.requestId && (
                <p className="small">
                  Request ID: <code>{error.requestId}</code>
                </p>
              )}
            </div>
          )}
          {notice && (
            <p className="inline-notice" role="status">
              <Icon name="check" size={16} />
              {notice}
            </p>
          )}
          {busy && (
            <div className="loading-banner" role="status" aria-live="polite">
              <span className="spinner" />
              <div>
                <strong>{pending}…</strong>
                <span>
                  {pending.includes("archive") ||
                  pending.includes("local") ||
                  pending.includes("saved")
                    ? "Processing in this browser."
                    : "Waiting for the service. Source and model work is bounded to 45 seconds; failed attempts may use allowance."}
                </span>
              </div>
            </div>
          )}
          {view === "new" && (
            <section className="new-board-view">
              <div className="page-heading">
                <span className="eyebrow">
                  EVIDENCE · PERSPECTIVE · FRESHNESS
                </span>
                <h1 className="hero-title">
                  <BlurText text="Know what your decision rests on —" delay={70} stepDuration={0.4} distance={18} blur={12} className="hero-line" />
                  <BlurText text="and how well it holds up." delay={70} stepDuration={0.4} distance={18} blur={12} className="hero-line" />
                </h1>
                <p>
                  Connect public sources to facts and decisions, weigh them by whom you trust.
                  <br className="desktop-break" /> When something changes, see
                  what needs another look.
                </p>
              </div>
              <div className="new-board-layout">
                <section className="create-panel panel">
                  <div className="section-title">
                    <h2>Create your board</h2>
                    <span className="step-label">
                      01 — START WITH A QUESTION
                    </span>
                  </div>
                  <form onSubmit={create}>
                    <label htmlFor="board-title">Board title</label>
                    <input
                      id="board-title"
                      data-testid={TEST_IDS.newBoardTitle}
                      maxLength={120}
                      required
                      value={draft.title}
                      onChange={(e) =>
                        setDraft({ ...draft, title: e.target.value })
                      }
                      placeholder="e.g. A reliable page-ingestion workflow"
                      disabled={busy}
                    />
                    <label htmlFor="board-question">
                      What are you deciding?
                    </label>
                    <textarea
                      id="board-question"
                      data-testid={TEST_IDS.newBoardQuestion}
                      maxLength={2000}
                      required
                      value={draft.question}
                      onChange={(e) =>
                        setDraft({ ...draft, question: e.target.value })
                      }
                      placeholder="Ask an original question about your integration or launch plan…"
                      disabled={busy}
                    />
                    <div className="row spread label-row">
                      <label htmlFor="board-urls">
                        Public source URLs{" "}
                        <span className="field-hint">1–5 pages</span>
                      </label>
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() => {
                          setDiscover(!discover);
                          if (!query) setQuery(draft.question);
                        }}
                      >
                        <Icon name="search" size={14} /> Discover sources
                      </button>
                    </div>
                    <textarea
                      id="board-urls"
                      className="url-input"
                      data-testid={TEST_IDS.newBoardUrls}
                      maxLength={10240}
                      value={draft.urls}
                      onChange={(e) =>
                        setDraft({ ...draft, urls: e.target.value })
                      }
                      placeholder={
                        "https://docs…\nOne permitted HTTPS URL per line"
                      }
                      disabled={busy}
                      aria-describedby="sources-help"
                    />
                    <p id="sources-help" className="field-help">
                      Choose public text documentation. Discovery offers
                      candidates for your review.
                    </p>
                    <label htmlFor="board-constraints">
                      Requirements <span className="field-hint">optional</span>
                    </label>
                    <textarea
                      id="board-constraints"
                      data-testid={TEST_IDS.newBoardRequirements}
                      maxLength={2000}
                      value={draft.requirements}
                      onChange={(e) =>
                        setDraft({ ...draft, requirements: e.target.value })
                      }
                      placeholder="Your workload, constraints, and what a useful answer must cover…"
                      disabled={busy}
                    />
                    <p className="processing-copy">
                      Your question, URLs, requirements and necessary source
                      excerpts go to Telem and the configured model provider.
                      Boards save in this browser.{" "}
                      <Link href="/privacy">Read privacy & limits</Link>.
                    </p>
                    <div className="form-actions">
                      <button
                        type="submit"
                        data-testid={TEST_IDS.createBoard}
                        disabled={busy || !ready}
                      >
                        <span
                          className="button-label"
                          data-testid={TEST_IDS.runRequest}
                        >
                          Create board <Icon />
                        </span>
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        data-testid={TEST_IDS.sampleButton}
                        disabled={busy}
                        onClick={() => {
                          setDraft(sample);
                          setNotice(
                            "Example inputs loaded. Creating this board makes a real live request. Edit any field first.",
                          );
                        }}
                      >
                        Use example inputs
                      </button>
                    </div>
                  </form>
                </section>
                <aside className="new-board-aside">
                  <div className="explainer">
                    <span className="eyebrow">
                      FROM OBSERVATION TO DECISION
                    </span>
                    <ol>
                      <li>
                        <span>1</span>
                        <div>
                          <strong>Bring the sources</strong>
                          <p>
                            Select the public pages your answer should be
                            grounded in.
                          </p>
                        </div>
                      </li>
                      <li>
                        <span>2</span>
                        <div>
                          <strong>Inspect the connections</strong>
                          <p>
                            Review literal passages and proposed dependencies.
                          </p>
                        </div>
                      </li>
                      <li>
                        <span>3</span>
                        <div>
                          <strong>Recheck the affected branch</strong>
                          <p>
                            Edit a requirement or refresh the sources. Keep the
                            history.
                          </p>
                        </div>
                      </li>
                    </ol>
                  </div>
                  <div className="limits-card">
                    <Icon name="layers" size={23} />
                    <h3>Small enough to inspect.</h3>
                    <p>
                      Up to 5 sources, 10 facts and 6 decisions per board.
                      Refresh runs only when you ask.
                    </p>
                    <p className="small muted">
                      {quota.visitorDaily} admitted operations / visitor / day ·{" "}
                      {quota.visitorMinute} / minute · {quota.globalDaily} / day
                      shared globally. Allowance remaining is not reported.
                    </p>
                  </div>
                </aside>
              </div>
              {discover && (
                <section
                  id="source-discovery"
                  className="panel discovery-panel"
                >
                  <div className="section-title">
                    <h2>Discover public sources</h2>
                    <button
                      className="icon-button"
                      onClick={() => setDiscover(false)}
                      aria-label="Close source discovery"
                    >
                      <Icon name="close" />
                    </button>
                  </div>
                  <p className="muted">
                    A real Telem search uses one research operation. Select
                    candidates, then create your board to fetch the actual
                    pages.
                  </p>
                  <form onSubmit={search}>
                    <label htmlFor="discovery-query">Search question</label>
                    <div className="search-row">
                      <input
                        id="discovery-query"
                        maxLength={2000}
                        required
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        disabled={busy}
                      />
                      <button disabled={busy}>
                        Search sources <Icon name="search" size={16} />
                      </button>
                    </div>
                  </form>
                  {discovery && (
                    <>
                      <p className="small muted">
                        Live discovery · {discovery.results.length} candidates ·{" "}
                        {
                          discovery.trace.retrieval.filter(
                            (r) => r.kind === "search",
                          ).length
                        }{" "}
                        search attempts · {discovery.trace.model_calls} model
                        attempts
                      </p>
                      {!discovery.results.length && (
                        <p className="empty">
                          No permitted candidates were returned. Refine the
                          query or paste a supported public URL.
                        </p>
                      )}
                      {discovery.results.map((s, i) => {
                        const selected = urls().includes(s.url);
                        const allowed = Boolean(
                          safeSourceLink(s.url) &&
                            hosts.includes(new URL(s.url).hostname),
                        );
                        return (
                          <label className="discovery-result" key={i}>
                            <input
                              type="checkbox"
                              checked={selected}
                              disabled={
                                busy ||
                                !allowed ||
                                (!selected && urls().length >= 5)
                              }
                              onChange={() =>
                                setDraft({
                                  ...draft,
                                  urls: (selected
                                    ? urls().filter((u) => u !== s.url)
                                    : [...urls(), s.url]
                                  ).join("\n"),
                                })
                              }
                            />
                            <span>
                              <strong>{s.title}</strong>
                              <small>{s.url}</small>
                              {!allowed && (
                                <small>
                                  Unavailable under this deployment&apos;s host
                                  policy.
                                </small>
                              )}
                            </span>
                          </label>
                        );
                      })}
                      {discovery.trace.limitations.map((l, i) => (
                        <p className="small muted" key={i}>
                          {l}
                        </p>
                      ))}
                    </>
                  )}
                </section>
              )}
              <details className="supported-hosts">
                <summary>
                  Supported source hosts <span>{hosts.length} exact hosts</span>
                </summary>
                <p>
                  HTTPS public text pages only. No private documents, logins,
                  signed URLs, PDFs or automatic outbound crawling.
                </p>
                <div>
                  {hosts.map((host) => (
                    <code key={host}>{host}</code>
                  ))}
                </div>
              </details>
            </section>
          )}
          {view === "board" && record && (
            <section
              data-testid={TEST_IDS.boardResult}
              aria-busy={busy}
              className="board-view"
            >
              <div className="board-heading">
                <div>
                  <span className="eyebrow">
                    {record.trust === "observed"
                      ? "LIVE OBSERVATION · BROWSER-LOCAL BOARD"
                      : "HISTORICAL ARCHIVE · UNVERIFIED"}
                  </span>
                  <h1 data-testid={TEST_IDS.boardTitleCurrent}>
                    {record.board.title}
                  </h1>
                  <p>{record.board.question}</p>
                </div>
                <div className="board-toolbar">
                  <button
                    className="secondary"
                    data-testid={TEST_IDS.exportBoard}
                    onClick={() => void exportBoard()}
                    disabled={busy}
                  >
                    <Icon name="download" size={16} /> Export JSON
                  </button>
                  <button
                    data-testid={TEST_IDS.refreshBoard}
                    onClick={() => void update(true)}
                    disabled={busy || unsaved || record.trust !== "observed"}
                  >
                    <Icon name="refresh" size={16} /> Refresh evidence
                  </button>
                </div>
              </div>
              {record.trust !== "observed" && (
                <div
                  className="alert warning"
                  data-testid={TEST_IDS.importRevalidationNotice}
                >
                  <strong>Imported / historical evidence — unverified</strong>
                  <p>
                    Previous facts and answer states are historical records.
                    They are not fresh observations. Rebuild from the question
                    and permitted public sources before relying on them. The
                    original archive stays in your library.
                  </p>
                  <button onClick={() => void rebuild()} disabled={busy}>
                    Rebuild with live sources <Icon />
                  </button>
                </div>
              )}
              {unsaved && (
                <div className="alert warning">
                  <strong>This result is not saved.</strong>
                  <p>
                    Export a recovery copy before leaving. Saving will check for
                    concurrent edits.
                  </p>
                </div>
              )}
              <BoardInspector
                key={record.id}
                record={record}
                revisions={revisions}
                reviews={reviews}
                onReview={review}
                busy={busy || unsaved}
              />
              <section className="requirements-panel panel">
                <div>
                  <span className="eyebrow">
                    YOUR INPUT · SEPARATE FROM SOURCE FACTS
                  </span>
                  <h2>Change the requirements</h2>
                  <p className="muted">
                    A local requirement edit recalculates dependencies. It is
                    not an external website change. To correct proposed
                    dependencies, include the correction here and rebuild.
                  </p>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void update(false);
                  }}
                >
                  <label htmlFor="requirements-current">
                    Current requirements
                  </label>
                  <textarea
                    id="requirements-current"
                    data-testid={TEST_IDS.boardRequirements}
                    maxLength={2000}
                    value={requirements}
                    onChange={(e) => setRequirements(e.target.value)}
                    disabled={busy}
                  />
                  <div className="row wrap">
                    <button
                      data-testid={TEST_IDS.applyRequirements}
                      disabled={
                        busy ||
                        unsaved ||
                        record.trust !== "observed" ||
                        requirements === record.board.requirements
                      }
                    >
                      Apply requirement edit <Icon size={16} />
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => void rebuild()}
                      disabled={busy || unsaved}
                    >
                      Rebuild as new board
                    </button>
                  </div>
                </form>
              </section>
              <div className="board-storage-bar">
                <div>
                  <span
                    className={"local-dot " + (unsaved ? "amber-dot" : "")}
                  />
                  <strong>
                    {unsaved ? "Unsaved result" : "Saved in this browser"}
                  </strong>
                  <span>
                    Local revision {record.localRevision} ·{" "}
                    {time(record.updatedAt)}
                  </span>
                </div>
                <div className="row wrap">
                  <button
                    className="text-button"
                    disabled={busy || !unsaved}
                    onClick={() =>
                      void run("Saving the current board", async () => {
                        await persist(
                          record,
                          record.localRevision || null,
                          pendingHistory.current,
                        );
                      })
                    }
                  >
                    Save locally
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      void run("Reloading the saved board", async () => {
                        await reloadLibrary(true);
                        setStorageError("");
                      })
                    }
                  >
                    Reload saved
                  </button>
                  <button
                    className="text-button danger"
                    data-testid={TEST_IDS.deleteBoard}
                    disabled={busy}
                    onClick={() => setConfirmDelete(true)}
                  >
                    Delete board
                  </button>
                </div>
              </div>
            </section>
          )}
          {view === "lab" && <SimulationLab />}
          <footer className="workspace-footer">
            <span>Answers have dependencies. Evidence has a date.</span>
            <Link href="/privacy">
              Privacy, supported sources & usage limits <Icon size={13} />
            </Link>
          </footer>
        </main>
      </div>
      {confirmDelete && record && (
        <Modal
          title="Delete this local board?"
          onClose={() => {
            if (!busy) setConfirmDelete(false);
          }}
        >
          <p>
            <strong>{record.title}</strong>
          </p>
          <p>
            This removes the board, full revision records and local review notes
            from this browser. Exported files and copies in an agent&apos;s
            local vault are separate.
          </p>
          <p>
            Export a JSON archive before deleting if you want to keep a copy.
          </p>
          <div className="row wrap">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void exportBoard()}
            >
              Export first
            </button>
            <button
              className="danger-button"
              data-testid={TEST_IDS.confirmDeleteBoard}
              disabled={busy}
              onClick={() => void remove()}
            >
              Delete local board
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
