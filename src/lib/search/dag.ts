export type GraphNode = { id: string; depends_on: string[] };

/** Validates fact+answer graph: duplicate/dangling IDs, node cap, cycles. Throws Error(code). */
export function validateGraph(factIds: string[], answers: GraphNode[], maxNodes = 40): string[] {
  const ids = [...factIds, ...answers.map((a) => a.id)];
  if (ids.length > maxNodes) throw new Error('TOO_MANY_NODES');
  if (new Set(ids).size !== ids.length) throw new Error('DUPLICATE_ID');
  const known = new Set(ids);
  for (const a of answers) if (a.depends_on.some((d) => !known.has(d) || d === a.id)) throw new Error('DANGLING_DEPENDENCY');
  return topoOrder(answers);
}

/** Kahn order over answer->answer edges (fact deps are leaves). Throws Error('CYCLE'). */
export function topoOrder(answers: GraphNode[]): string[] {
  const byId = new Map(answers.map((a) => [a.id, a]));
  const indeg = new Map(answers.map((a) => [a.id, a.depends_on.filter((d) => byId.has(d)).length]));
  const out: string[] = [];
  const ready = answers.filter((a) => indeg.get(a.id) === 0).map((a) => a.id);
  while (ready.length) {
    const id = ready.shift()!;
    out.push(id);
    for (const a of answers) if (a.depends_on.includes(id)) {
      const n = indeg.get(a.id)! - 1;
      indeg.set(a.id, n);
      if (n === 0) ready.push(a.id);
    }
  }
  if (out.length !== answers.length) throw new Error('CYCLE');
  return out;
}

/** Reverse transitive closure: answers that are seeds or depend (transitively) on any seed ID. */
export function affectedClosure(answers: GraphNode[], seeds: Iterable<string>): Set<string> {
  const hit = new Set(seeds);
  const out = new Set<string>();
  for (const id of topoOrder(answers)) {
    const a = answers.find((x) => x.id === id)!;
    if (hit.has(a.id) || a.depends_on.some((d) => hit.has(d))) {
      hit.add(a.id);
      out.add(a.id);
    }
  }
  return out;
}
