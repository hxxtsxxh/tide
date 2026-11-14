"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Board } from "@/lib/contracts/board";
import {
  DEFAULT_WEIGHTS,
  rank,
  scoreBoard,
  sensitivity,
  verdictOf,
  type Metric,
  type Weights,
} from "@/lib/perspective";

const LABELS: Record<Metric, [string, string]> = {
  authority: ["Authority", "How much to trust the publisher tier"],
  popularity: ["Agreement", "How much cross-source agreement counts"],
  time: ["Time", "Recency on a first read; consistency across rechecks later"],
};
const SHORT: Record<Metric, string> = { authority: "A", popularity: "P", time: "T" };

function valueText(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value);
}
function host(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url || "unknown source";
  }
}

/** Perspective lens: client-only rerank of existing facts. Moving a slider never calls the network. */
export default function Perspectives({ board, history, historical }: { board: Board; history: Board[]; historical: boolean }) {
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const scored = useMemo(() => scoreBoard(board, history), [board, history]);
  const ranked = useMemo(() => rank(scored, weights), [scored, weights]);
  const verdict = useMemo(() => verdictOf(ranked), [ranked]);
  const sweep = useMemo(() => sensitivity(scored, weights), [scored, weights]);
  // Dimensions with no value for any item cannot change the ranking: disable them with a reason, never silently.
  const unavailable = (k: Metric) => scored.length > 0 && scored.every((s) => s.metrics[k] === null);
  // FLIP reorder animation + transient rank-change badges after a slider move.
  const listRef = useRef<HTMLOListElement>(null);
  const rects = useRef(new Map<string, number>());
  const prevOrder = useRef<string[]>([]);
  const [moves, setMoves] = useState<Record<string, number>>({});
  const order = ranked.map((r) => r.fact.id).join();
  useLayoutEffect(() => {
    const items = [...(listRef.current?.querySelectorAll<HTMLLIElement>("li[data-fact-id]") ?? [])];
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const el of items) {
      const id = el.dataset.factId!;
      const top = el.offsetTop;
      const before = rects.current.get(id);
      if (!reduce && before !== undefined && before !== top) {
        el.style.transition = "none";
        el.style.transform = `translateY(${before - top}px)`;
        requestAnimationFrame(() => {
          el.style.transition = "transform 300ms cubic-bezier(0.25, 0.1, 0.25, 1)";
          el.style.transform = "";
        });
      }
    }
    // offsetTop ignores transforms and scrolling, so this is the settled layout position.
    for (const el of items) rects.current.set(el.dataset.factId!, el.offsetTop);
    const ids = order ? order.split(",") : [];
    if (prevOrder.current.length) {
      const next: Record<string, number> = {};
      ids.forEach((id, i) => {
        const was = prevOrder.current.indexOf(id);
        if (was >= 0 && was !== i) next[id] = was - i;
      });
      if (Object.keys(next).length) setMoves(next);
    }
    prevOrder.current = ids;
  }, [order]);
  useEffect(() => {
    if (!Object.keys(moves).length) return;
    const t = setTimeout(() => setMoves({}), 2500);
    return () => clearTimeout(t);
  }, [moves]);
  const total = verdict.support + verdict.oppose;
  const supportPct = total ? Math.round((verdict.support / total) * 100) : 0;
  const tone = verdict.verdict === "Leans yes" ? "yes" : verdict.verdict === "Leans no" ? "no" : verdict.verdict === "Contested" ? "split" : "none";
  return (
    <section className="panel perspective-panel" data-testid="perspectives-panel">
      <div className="section-title">
        <h2>Perspectives</h2>
        <span className="eyebrow">{historical ? "UNVERIFIED ARCHIVE" : "WEIGH WHOM YOU TRUST"}</span>
      </div>
      <p className="muted">
        Re-rank the same verified quotes by the evidence qualities you care about. Nothing is searched again; the
        dependency map and freshness are unchanged.
      </p>
      <div className="perspective-layout">
        <div className="lens-controls" role="group" aria-label="Evidence weights">
          {(Object.keys(LABELS) as Metric[]).map((k) => (
            <div className="lens-slider" key={k}>
              <div className="row spread">
                <label htmlFor={`lens-${k}`}>{LABELS[k][0]}</label>
                <output htmlFor={`lens-${k}`} data-testid={`lens-value-${k}`}>
                  {weights[k]}
                </output>
              </div>
              <input
                id={`lens-${k}`}
                data-testid={`lens-${k}`}
                type="range"
                min={0}
                max={100}
                step={5}
                value={weights[k]}
                disabled={unavailable(k)}
                aria-describedby={`lens-${k}-hint`}
                onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) })}
              />
              <small id={`lens-${k}-hint`} className="muted">
                {unavailable(k) ? (k === "popularity" ? "Unavailable: needs two or more readable sources on this board." : "Unavailable for this board.") : LABELS[k][1]}
              </small>
            </div>
          ))}
          <button type="button" className="lens-reset" onClick={() => setWeights(DEFAULT_WEIGHTS)}>
            Reset to 70 / 20 / 60
          </button>
        </div>
        <div className="verdict-card" aria-live="polite">
          <span className="eyebrow">CURRENT LENS</span>
          <span key={verdict.verdict} className={`verdict-pill verdict-${tone}`} data-testid="perspective-verdict">
            {verdict.verdict}
          </span>
          <p data-testid="perspective-explanation">{verdict.explanation}</p>
          {total > 0 && (
            <div className="support-meter" data-testid="support-meter" role="img" aria-label={`Weighted evidence: ${supportPct}% supports, ${100 - supportPct}% opposes`}>
              <span className="support-fill" style={{ width: `${supportPct}%` }} />
              <span className="support-labels" aria-hidden="true">
                <span>supports {supportPct}%</span>
                <span>opposes {100 - supportPct}%</span>
              </span>
            </div>
          )}
          <p className="small muted" data-testid="perspective-sensitivity">
            {sweep.stable
              ? `Stable: the verdict holds under all ${sweep.lenses} lenses on the 0/50/100 grid.`
              : `Holds under ${sweep.holds} of ${sweep.lenses} lenses; can become ${sweep.alternatives.join(" or ")}.` +
                (sweep.flippers.length
                  ? ` Changing ${sweep.flippers.map((f) => LABELS[f][0].toLowerCase()).join(" or ")} alone flips it.`
                  : " No single weight flips it from here.")}
          </p>
        </div>
      </div>
      <h3 className="column-heading">
        <span>01</span> Ranked evidence <span className="count">{ranked.length}</span>
      </h3>
      <ol className="ranked-evidence" data-testid="perspective-ranking" ref={listRef}>
        {ranked.map((r, i) => (
          <li key={r.fact.id} className="ranked-item" data-fact-id={r.fact.id}>
            <div className="ranked-head">
              <span className="ranked-rank">
                #{i + 1} <span className="muted">{r.fact.id}</span>
              </span>
              <span className="ranked-meta">
                {moves[r.fact.id] ? (
                  <span className={`rank-move ${moves[r.fact.id]! > 0 ? "up" : "down"}`} data-testid="rank-move">
                    {moves[r.fact.id]! > 0 ? `↑${moves[r.fact.id]}` : `↓${-moves[r.fact.id]!}`}
                  </span>
                ) : null}
                <StanceChip stance={r.stance} />
                <strong className="ranked-score" key={r.score === null ? "na" : Math.round(r.score)}>{r.score === null ? "N/A" : Math.round(r.score)}</strong>
              </span>
            </div>
            <p className="ranked-value">{valueText(r.fact.value)}</p>
            <blockquote>{r.fact.quote || "No supporting quotation was returned."}</blockquote>
            <p className="small muted">
              {host(r.url)} · {r.tier} · coverage {Math.round(r.coverage * 100)}%
            </p>
            <p className="small muted ranked-basis">
              Agreement: {r.basis.popularity} · Time: {r.basis.time}
            </p>
            <div className="metric-bars">
              {(Object.keys(SHORT) as Metric[]).map((k) => {
                const v = r.metrics[k];
                return (
                  <div className="metric-bar" key={k} title={`${LABELS[k][0]}: ${v === null ? "not available" : Math.round(v)}`}>
                    <span aria-hidden="true">{SHORT[k]}</span>
                    <span className="bar-track" aria-hidden="true">
                      <span className="bar-fill" style={{ width: `${v ?? 0}%` }} />
                    </span>
                    <span className="sr-only">{LABELS[k][0]}</span>
                    <span className="bar-value">{v === null ? "N/A" : Math.round(v)}</span>
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ol>
      {!ranked.length && <p className="empty">No verified facts to weigh yet.</p>}
      <p className="map-footnote">
        Scores are transparent heuristics, not probabilities of truth. Authority uses a publisher tier. Agreement counts
        other sources that corroborate or contest each quote (50 = neither). Time is a recency proxy on a first read and
        cross-revision consistency after rechecks. N/A never counts as zero.
      </p>
    </section>
  );
}

export function StanceChip({ stance }: { stance: "supports" | "opposes" | "neutral" }) {
  return (
    <span className={`stance-chip stance-${stance}`} data-testid="stance-chip">
      {stance}
    </span>
  );
}
