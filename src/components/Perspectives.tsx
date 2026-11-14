"use client";
import { useMemo, useState } from "react";
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
  time: ["Time consistency", "How much holding up across rechecks counts"],
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
                aria-describedby={`lens-${k}-hint`}
                onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) })}
              />
              <small id={`lens-${k}-hint`} className="muted">
                {LABELS[k][1]}
              </small>
            </div>
          ))}
          <button type="button" className="lens-reset" onClick={() => setWeights(DEFAULT_WEIGHTS)}>
            Reset to 70 / 20 / 60
          </button>
        </div>
        <div className="verdict-card" aria-live="polite">
          <span className="eyebrow">CURRENT LENS</span>
          <span className={`verdict-pill verdict-${tone}`} data-testid="perspective-verdict">
            {verdict.verdict}
          </span>
          <p data-testid="perspective-explanation">{verdict.explanation}</p>
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
      <ol className="ranked-evidence" data-testid="perspective-ranking">
        {ranked.map((r, i) => (
          <li key={r.fact.id} className="ranked-item" data-fact-id={r.fact.id}>
            <div className="ranked-head">
              <span className="ranked-rank">
                #{i + 1} <span className="muted">{r.fact.id}</span>
              </span>
              <span className="ranked-meta">
                <StanceChip stance={r.stance} />
                <strong className="ranked-score">{r.score === null ? "N/A" : Math.round(r.score)}</strong>
              </span>
            </div>
            <p className="ranked-value">{valueText(r.fact.value)}</p>
            <blockquote>{r.fact.quote || "No supporting quotation was returned."}</blockquote>
            <p className="small muted">
              {host(r.url)} · {r.tier} · coverage {Math.round(r.coverage * 100)}%
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
        Scores are transparent heuristics, not probabilities of truth. Authority uses a publisher tier; agreement needs
        two or more pages taking a stance; time consistency needs two or more saved revisions. N/A never counts as zero.
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
