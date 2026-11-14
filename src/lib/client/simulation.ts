// Finite authored teaching scenarios. No network, model, runtime fixture input or live-board state.
export type Scenario = "capacity" | "failure" | "body";
export function simulate(scenario: Scenario) {
  const affected = scenario === "body" ? [] : ["a-workshop", "a-keynote"];
  return {
    mode: "fixture" as const,
    affected,
    recomputed: scenario === "capacity" ? affected : [],
    reused:
      scenario === "body"
        ? ["a-workshop", "a-keynote", "a-doors"]
        : ["a-doors"],
    unknown: scenario === "failure" ? affected : [],
    note:
      scenario === "capacity"
        ? "Synthetic room capacity changed from 120 to 80. Both capacity-dependent decisions need an update. Doors still open at 10:00."
        : scenario === "failure"
          ? "The synthetic capacity source failed to load. Its prior value is retained, but both dependent decisions have unknown freshness."
          : "Only the synthetic page formatting changed. Capacity is still 120; no answer needs recomputation.",
  };
}
