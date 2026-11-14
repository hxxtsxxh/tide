"use client";
import { useState } from "react";
import type {
  Board,
  AnswerRecord,
  SourceRecord,
  FactRecord,
} from "@/lib/contracts/board";
import type { BoardRecord, RevisionRecord } from "@/lib/contracts/storage";
import type { ReviewNote, ReviewNotes } from "@/lib/client/storage";
import { safeSourceLink } from "@/lib/client/archive";
import { TEST_IDS } from "@/lib/contracts/testids";
import { Icon, Modal, Status, time } from "./ui";

function SourceLink({ source }: { source: SourceRecord }) {
  const href = safeSourceLink(source.url);
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {source.url}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  ) : (
    <span>Unsafe archived URL — link disabled</span>
  );
}
function valueText(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export default function BoardInspector({
  record,
  revisions,
  reviews,
  onReview,
  busy,
}: {
  record: BoardRecord;
  revisions: RevisionRecord[];
  reviews: ReviewNotes;
  onReview: (id: string, note: ReviewNote) => Promise<void>;
  busy: boolean;
}) {
  const [tab, setTab] = useState("map");
  const [selected, setSelected] = useState<{
    kind: "source" | "fact" | "answer";
    id: string;
  } | null>(null);
  const [past, setPast] = useState<RevisionRecord | null>(null);
  const board = record.board;
  const historical = record.trust !== "observed";
  const latest = board.revisions.at(-1)?.id ?? "unknown";
  const update = record.lastUpdate,
    trace = record.lastTrace;
  const source =
    selected?.kind === "source"
      ? board.sources.find((s) => s.id === selected.id)
      : null;
  const fact =
    selected?.kind === "fact"
      ? board.facts.find((f) => f.id === selected.id)
      : null;
  const answer =
    selected?.kind === "answer"
      ? board.answers.find((a) => a.id === selected.id)
      : null;
  const status = (state: string) => (historical ? "unverified" : state);
  function showFact(f: FactRecord) {
    const supporting = board.sources.find((s) => s.id === f.source_id);
    const quoteVerified = Boolean(
      f.quote && supporting?.excerpt.includes(f.quote),
    );
    return (
      <div className="evidence-fact" key={f.id}>
        <div className="row spread">
          <code>{f.id}</code>
          <Status
            value={
              historical ? "unverified" : !quoteVerified ? "unknown" : f.status
            }
          />
        </div>
        <h3>{valueText(f.value)}</h3>
        <blockquote>
          {f.quote || "No supporting quotation was returned."}
        </blockquote>
        {supporting && (
          <>
            <p className="small muted">
              Source {supporting.id} · observed {time(supporting.observedAt)}
            </p>
            <SourceLink source={supporting} />
          </>
        )}
        {!quoteVerified && (
          <p className="notice">
            The quotation cannot be matched to the preserved excerpt. Treat this
            fact as unresolved.
          </p>
        )}
        <p className="small muted">
          A literal quote establishes presence in a page, not truth.
        </p>
        {f.support_sets && (
          <p className="small">
            Alternative support sets (OR between groups, AND within each):{" "}
            <code>
              {f.support_sets
                .map((s) => "(" + s.join(" + ") + ")")
                .join(" OR ")}
            </code>
          </p>
        )}
      </div>
    );
  }
  function renderAnswer(a: AnswerRecord) {
    const local = reviews[a.id];
    const reviewed = local?.revisionId === latest ? local : undefined;
    return (
      <article
        key={a.id}
        className={
          "node answer-node " +
          (update?.affected.includes(a.id) ? "affected" : "")
        }
      >
        <div className="row spread">
          <code>{a.id}</code>
          <Status value={status(a.status)} />
        </div>
        <p className="answer-text">
          {a.text || "This decision is unresolved."}
        </p>
        <div className="dependencies">
          {a.depends_on.length ? (
            a.depends_on.map((id) => (
              <button
                key={id}
                className="edge"
                onClick={() =>
                  setSelected({
                    kind: board.facts.some((f) => f.id === id)
                      ? "fact"
                      : "answer",
                    id,
                  })
                }
              >
                <Icon name="link" size={12} />
                {id}
              </button>
            ))
          ) : (
            <span className="small muted">
              No dependencies mapped — inspect for omissions.
            </span>
          )}
        </div>
        <div className="node-footer">
          <span>
            {reviewed?.state === "disputed"
              ? "Correction noted"
              : reviewed?.state === "reviewed"
                ? "Reviewed locally"
                : "Proposed dependencies"}
          </span>
          <button
            className="text-button"
            onClick={() => setSelected({ kind: "answer", id: a.id })}
          >
            Inspect <Icon size={13} />
          </button>
        </div>
        {update?.reused.includes(a.id) && (
          <p className="small muted">
            Reused answer version · observation {time(a.observedAt)}
          </p>
        )}
      </article>
    );
  }
  return (
    <>
      <div className="execution-strip" aria-label="Last operation accounting">
        <div>
          <span>Source reads attempted</span>
          <strong>
            {trace
              ? trace.retrieval.filter((r) => r.kind === "fetch").length
              : "—"}
          </strong>
        </div>
        <div>
          <span>Affected answers</span>
          <strong>{update?.affected.length ?? "—"}</strong>
        </div>
        <div>
          <span>Recomputation attempted</span>
          <strong>{update?.recomputed.length ?? "—"}</strong>
        </div>
        <div>
          <span>Answer versions reused</span>
          <strong>{update?.reused.length ?? "—"}</strong>
        </div>
      </div>
      <div className="tab-list" aria-label="Board views">
        {[
          ["map", "Dependency map"],
          ["evidence", "Evidence"],
          ["history", "History"],
          ["trace", "Execution trace"],
        ].map(([id, label]) => (
          <button
            key={id}
            data-testid={id === "evidence" ? TEST_IDS.evidenceTab : undefined}
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {id === "history" && <Icon name="clock" size={15} />} {label}
            {id === "history" && (
              <span className="count">{board.revisions.length}</span>
            )}
          </button>
        ))}
      </div>
      {tab === "map" && (
        <div data-testid={TEST_IDS.primaryResult}>
          <div className="map-intro">
            <p>Follow the evidence.</p>
            <span>
              Sources <span aria-hidden="true">→</span> Facts{" "}
              <span aria-hidden="true">→</span> Decisions
            </span>
          </div>
          <div className="dependency-grid">
            <section>
              <h3 className="column-heading">
                <span>01</span> Source pages{" "}
                <span className="count">{board.sources.length}</span>
              </h3>
              {board.sources.map((s, i) => (
                <button
                  key={s.id}
                  className="node source-node"
                  onClick={() => setSelected({ kind: "source", id: s.id })}
                >
                  <div className="row spread">
                    <span className="source-number">
                      S{String(i + 1).padStart(2, "0")}
                    </span>
                    <Status value={status(s.status)} />
                  </div>
                  <h4>{s.title || new URL(s.url).hostname}</h4>
                  <p className="source-url">{s.url}</p>
                  <div className="node-footer">
                    <span>
                      {historical ? "Archived observation" : time(s.observedAt)}
                    </span>
                    <Icon name="arrow" size={15} />
                  </div>
                </button>
              ))}
              {!board.sources.length && (
                <p className="empty">No usable source pages returned.</p>
              )}
            </section>
            <section>
              <h3 className="column-heading">
                <span>02</span> Extracted facts{" "}
                <span className="count">{board.facts.length}</span>
              </h3>
              {board.facts.map((f) => (
                <button
                  className="node fact-node"
                  key={f.id}
                  onClick={() => setSelected({ kind: "fact", id: f.id })}
                >
                  <div className="row spread">
                    <code>{f.id}</code>
                    <Status value={status(f.status)} />
                  </div>
                  <p>{valueText(f.value)}</p>
                  <div className="node-footer">
                    <span>
                      <Icon name="link" size={12} /> {f.source_id}
                    </span>
                    <Icon size={15} />
                  </div>
                </button>
              ))}
              {!board.facts.length && (
                <p className="empty">
                  No verified facts extracted. Recheck sources before relying on
                  answers.
                </p>
              )}
            </section>
            <section>
              <h3 className="column-heading">
                <span>03</span> Decisions{" "}
                <span className="count">{board.answers.length}</span>
              </h3>
              {board.answers.map(renderAnswer)}
              {!board.answers.length && (
                <p className="empty">No supported decision could be drafted.</p>
              )}
            </section>
          </div>
          <p className="map-footnote">
            <Icon name="link" size={14} /> Dependencies are proposed by the
            model. Inspect and review them; missing edges can hide a stale
            answer.
          </p>
        </div>
      )}
      {tab === "evidence" && (
        <section className="panel evidence-panel">
          <div className="section-title">
            <h2>Evidence, as observed</h2>
            <span className="eyebrow">
              {historical ? "UNVERIFIED ARCHIVE" : "LIVE SOURCE OBSERVATIONS"}
            </span>
          </div>
          <p className="muted">
            Inspect a literal passage and its observation time. Failed reads
            leave freshness unknown.
          </p>
          {board.facts.map(showFact)}
          {!board.facts.length && (
            <p className="empty">There are no extracted facts to inspect.</p>
          )}
          <h3>Source checks</h3>
          {board.sources.map((s) => (
            <div className="source-check" key={s.id}>
              <div className="row spread">
                <strong>{s.title || s.id}</strong>
                <Status value={status(s.status)} />
              </div>
              <SourceLink source={s} />
              <p className="small muted">
                Observation {time(s.observedAt)} · cache state{" "}
                {s.cache_state ?? "not provided"} · content hash{" "}
                <code>{s.contentHash || "not provided"}</code>
              </p>
            </div>
          ))}
        </section>
      )}
      {tab === "history" && (
        <section className="panel">
          <h2>Observation history</h2>
          <p className="muted">
            Immutable local revisions preserve previous content. Viewing history
            does not recheck a source.
          </p>
          <div className="history-list">
            {[...board.revisions].reverse().map((r, i) => {
              const stored = revisions.find((x) => x.revisionId === r.id);
              return (
                <article key={r.id} className="history-item">
                  <span className="history-dot" />
                  <div>
                    <div className="row wrap">
                      <strong>{r.kind.replaceAll("_", " ")}</strong>
                      {i === 0 && <span className="badge">Current</span>}
                    </div>
                    <p>{r.summary}</p>
                    <p className="small muted">
                      {time(r.createdAt)} · <code>{r.id}</code>
                    </p>
                    {stored ? (
                      <button
                        className="text-button"
                        onClick={() => setPast(stored)}
                      >
                        View saved content <Icon size={14} />
                      </button>
                    ) : (
                      <p className="small muted">
                        Summary retained; full content was not included in this
                        archive.
                      </p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          <p className="small muted">
            All successfully saved revisions remain in this browser. Export
            includes up to the latest 20 full revision records, within 1 MiB.
          </p>
        </section>
      )}
      {tab === "trace" && (
        <section className="panel">
          <h2>What actually ran</h2>
          {trace ? (
            <>
              <div className="trace-stats">
                <div>
                  <strong>{trace.model_calls}</strong>
                  <span>Model attempts</span>
                </div>
                <div>
                  <strong>{(trace.elapsed_ms / 1000).toFixed(1)}s</strong>
                  <span>Reported duration</span>
                </div>
                <div>
                  <strong>Not measured</strong>
                  <span>Refresh-all comparison</span>
                </div>
              </div>
              <p className="small muted">
                Source checks and failed attempts count as work. A comparison
                requires actual paired execution with the same observations and
                cache policy.
              </p>
              <div className="trace-table">
                <table>
                  <caption className="sr-only">
                    Actual retrieval attempts
                  </caption>
                  <thead>
                    <tr>
                      <th>Action / source</th>
                      <th>Provider</th>
                      <th>Status</th>
                      <th>Cache</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trace.retrieval.map((r, i) => (
                      <tr key={i}>
                        <td>
                          <strong>{r.kind} · live</strong>
                          <span>{r.url ?? "Discovery query"}</span>
                          {r.requestId && <code>{r.requestId}</code>}
                        </td>
                        <td>{r.provider ?? "Not returned"}</td>
                        <td>{r.status}</td>
                        <td>
                          {r.cached === undefined
                            ? "Unknown"
                            : r.cached
                              ? "Cached"
                              : "Uncached"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="trace-sets">
                {update &&
                  Object.entries(update).map(([name, ids]) => (
                    <p key={name}>
                      <strong>{name}</strong>
                      <code>{ids.join(", ") || "None"}</code>
                    </p>
                  ))}
              </div>
              {trace.limitations.length > 0 && (
                <>
                  <h3>Operation limitations</h3>
                  <ul>
                    {trace.limitations.map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                </>
              )}
            </>
          ) : (
            <p className="empty">
              No live execution trace is available for this imported record.
            </p>
          )}
        </section>
      )}
      {selected && (
        <Modal
          title={
            source
              ? "Source observation"
              : fact
                ? "Supporting evidence"
                : "Review dependencies"
          }
          onClose={() => setSelected(null)}
        >
          {source && (
            <>
              <div className="row spread">
                <code>{source.id}</code>
                <Status value={status(source.status)} />
              </div>
              <h3>{source.title}</h3>
              <SourceLink source={source} />
              <p className="small muted">
                Observed {time(source.observedAt)} · cache{" "}
                {source.cache_state ?? "unknown"}
              </p>
              <h4>Preserved excerpt</h4>
              <blockquote className="source-excerpt">
                {source.excerpt || "No usable page excerpt was returned."}
              </blockquote>
              <p className="small muted">
                Content hash <code>{source.contentHash || "not provided"}</code>
              </p>
              <h4>Facts using this source</h4>
              {board.facts
                .filter(
                  (f) =>
                    f.source_id === source.id ||
                    f.support_sets?.some((set) => set.includes(source.id)),
                )
                .map((f) => (
                  <button
                    className="list-link"
                    key={f.id}
                    onClick={() => setSelected({ kind: "fact", id: f.id })}
                  >
                    {f.id} · {valueText(f.value)} <Icon size={14} />
                  </button>
                ))}
            </>
          )}
          {fact && (
            <>
              {showFact(fact)}
              <h4>Dependent decisions</h4>
              {board.answers
                .filter((a) => a.depends_on.includes(fact.id))
                .map((a) => (
                  <button
                    className="list-link"
                    key={a.id}
                    onClick={() => setSelected({ kind: "answer", id: a.id })}
                  >
                    {a.id} <Icon size={14} />
                  </button>
                ))}
            </>
          )}
          {answer && (
            <ReviewAnswer
              key={answer.id}
              answer={answer}
              board={board}
              review={
                reviews[answer.id]?.revisionId === latest
                  ? reviews[answer.id]
                  : undefined
              }
              disabled={busy || historical}
              onSave={async (state, note) => {
                await onReview(answer.id, { state, note, revisionId: latest });
                setSelected(null);
              }}
            />
          )}
        </Modal>
      )}
      {past && (
        <Modal
          title="Historical revision — not a live check"
          wide
          onClose={() => setPast(null)}
        >
          <p className="eyebrow">ARCHIVED CONTENT · {time(past.createdAt)}</p>
          <h3>{past.board.title}</h3>
          <p>{past.board.question}</p>
          <h4>Requirements at this revision</h4>
          <p className="preserve-text">
            {past.board.requirements || "No requirements supplied."}
          </p>
          <h4>Decisions as previously recorded</h4>
          {past.board.answers.map((a) => (
            <article className="evidence-fact" key={a.id}>
              <code>{a.id}</code>
              <p>{a.text}</p>
              <p className="small muted">
                Recorded state: {a.status}; dependencies:{" "}
                {a.depends_on.join(", ") || "none"}. This historical view is
                unverified for current use.
              </p>
            </article>
          ))}
          <h4>Previous fact values</h4>
          {past.board.facts.map((f) => (
            <p key={f.id}>
              <code>{f.id}</code> · {valueText(f.value)}
            </p>
          ))}
        </Modal>
      )}
    </>
  );
}
function ReviewAnswer({
  answer,
  board,
  review,
  disabled,
  onSave,
}: {
  answer: AnswerRecord;
  board: Board;
  review?: ReviewNote;
  disabled: boolean;
  onSave: (state: "reviewed" | "disputed", note: string) => Promise<void>;
}) {
  const [note, setNote] = useState(review?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save(state: "reviewed" | "disputed") {
    setSaving(true);
    try {
      await onSave(state, note);
    } catch {
      setError(
        "Could not save this review. Reload the saved board if another tab changed it.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <code>{answer.id}</code>
      <p>{answer.text}</p>
      <h4>Proposed support (all required)</h4>
      {answer.depends_on.map((id) => (
        <div className="dependency-review" key={id}>
          <code>{id}</code>
          <p>
            {valueText(
              board.facts.find((f) => f.id === id)?.value ??
                board.answers.find((a) => a.id === id)?.text ??
                "Unresolved dependency",
            )}
          </p>
        </div>
      ))}
      <p className="notice">
        Model-inferred dependencies may be incomplete. Your local review is an
        annotation, not proof and not a change to the signed computation.
      </p>
      <label htmlFor="review-note">Correction or review note</label>
      <textarea
        id="review-note"
        maxLength={2000}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Describe a missing or incorrect dependency…"
      />
      <p className="small muted">
        To change the live dependency calculation, add this correction to
        Requirements and rebuild from the public sources. Imported evidence must
        be rebuilt before review.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="row wrap">
        <button disabled={disabled || saving} onClick={() => save("reviewed")}>
          <Icon name="check" size={15} /> Confirm local review
        </button>
        <button
          className="secondary"
          disabled={disabled || saving || !note.trim()}
          onClick={() => save("disputed")}
        >
          Record correction
        </button>
      </div>
    </>
  );
}
