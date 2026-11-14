"use client";
import { useState } from "react";
import { simulate, type Scenario } from "@/lib/client/simulation";
import { TEST_IDS } from "@/lib/contracts/testids";
import { Icon, Status } from "./ui";

export default function SimulationLab() {
  const [scenario, setScenario] = useState<Scenario>("capacity");
  const [result, setResult] = useState<ReturnType<typeof simulate> | null>(
    null,
  );
  return (
    <section className="lab-view">
      <div className="simulation-banner">
        <strong>SYNTHETIC · Simulation Lab</strong>
        <span>
          Authored teaching data. No live sources, model calls or website
          changes.
        </span>
      </div>
      <div className="page-heading">
        <span className="eyebrow">A SMALL CHANGE. A VISIBLE RIPPLE.</span>
        <h1>See which decisions move.</h1>
        <p>
          One room capacity fact supports two decisions. The opening time
          supports a separate branch.
        </p>
      </div>
      <div className="lab-grid">
        <section className="panel">
          <h2>Choose an authored event</h2>
          <fieldset className="scenario-list">
            <legend className="sr-only">Synthetic source event</legend>
            {(
              [
                [
                  "capacity",
                  "Capacity changes",
                  "The room now seats 80 instead of 120.",
                ],
                [
                  "failure",
                  "Source read fails",
                  "The last capacity is retained; freshness becomes unknown.",
                ],
                [
                  "body",
                  "Formatting changes",
                  "The words move. The fact stays the same.",
                ],
              ] as const
            ).map(([id, title, description]) => (
              <label
                key={id}
                className={"scenario " + (scenario === id ? "selected" : "")}
              >
                <input
                  type="radio"
                  name="scenario"
                  checked={scenario === id}
                  onChange={() => {
                    setScenario(id);
                    setResult(null);
                  }}
                />
                <span>
                  <strong>{title}</strong>
                  <small>{description}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <button
            data-testid={TEST_IDS.runSimulation}
            onClick={() => setResult(simulate(scenario))}
          >
            Run synthetic event <Icon />
          </button>
        </section>
        <section
          className="panel lab-chain"
          data-mode="fixture"
          data-testid={result ? TEST_IDS.simulationResult : undefined}
        >
          <div className="row spread">
            <h2>Workshop planning</h2>
            <span className="badge amber">SYNTHETIC FIXTURE</span>
          </div>
          <div className="lab-fact">
            <span>Room capacity</span>
            <strong>
              120{" "}
              {result && scenario === "capacity" && (
                <>
                  <span aria-hidden="true">→</span> 80
                </>
              )}
            </strong>
            <code>f-cap</code>
          </div>
          <div className="lab-branches">
            {[
              ["a-workshop", "Workshop guest list"],
              ["a-keynote", "Keynote seating"],
              ["a-doors", "Open doors at 10:00"],
            ].map(([id, label]) => (
              <div
                key={id}
                className={
                  result?.affected.includes(id)
                    ? "lab-decision changed"
                    : "lab-decision"
                }
              >
                <div className="row spread">
                  <strong>{label}</strong>
                  <Status
                    value={
                      !result
                        ? "before"
                        : result.unknown.includes(id)
                          ? "unknown"
                          : result.recomputed.includes(id)
                            ? "recomputed"
                            : "unchanged"
                    }
                  />
                </div>
                <code>
                  {id} ← {id === "a-doors" ? "f-time" : "f-cap"}
                </code>
              </div>
            ))}
          </div>
          {result && (
            <>
              <p className="notice">{result.note}</p>
              <div className="lab-counts">
                <span>
                  <strong>{result.affected.length}</strong> affected
                </span>
                <span>
                  <strong>{result.recomputed.length}</strong> simulated
                  recomputes
                </span>
                <span>
                  <strong>{result.reused.length}</strong> reused
                </span>
              </div>
              <p className="small muted">
                mode=fixture · This illustrates dependency closure; it is not a
                measured live refresh-all benchmark.
              </p>
            </>
          )}
        </section>
      </div>
    </section>
  );
}
