export type NodeKind = 'source' | 'fact' | 'answer';
export type GraphNode = { id: string; kind: NodeKind; depends_on: string[] };
export type GraphErrorCode = 'TOO_MANY_NODES' | 'DUPLICATE_ID' | 'DANGLING_DEPENDENCY' | 'SELF_DEPENDENCY' | 'CYCLE';

export class GraphError extends Error {
  readonly code: GraphErrorCode;
  readonly ids: string[];
  constructor(code: GraphErrorCode, ids: string[] = []) {
    super(`${code}${ids.length ? `: ${ids.join(',')}` : ''}`);
    this.code = code;
    this.ids = ids;
  }
}

export type Graph = {
  /** Dependencies before dependents; ties keep input order (deterministic). */
  order: string[];
  nodes: Map<string, GraphNode>;
  dependents: Map<string, string[]>;
};

/** Validates (duplicate/dangling/self/cycle/size) and topologically orders a source→fact→answer graph in O(V+E). */
export function buildGraph(list: GraphNode[], maxNodes = 40): Graph {
  if (list.length > maxNodes) throw new GraphError('TOO_MANY_NODES');
  const nodes = new Map<string, GraphNode>();
  for (const n of list) {
    if (nodes.has(n.id)) throw new GraphError('DUPLICATE_ID', [n.id]);
    nodes.set(n.id, n);
  }
  const dependents = new Map<string, string[]>(list.map((n) => [n.id, []]));
  const indeg = new Map<string, number>();
  for (const n of list) {
    const deps = [...new Set(n.depends_on)];
    if (deps.includes(n.id)) throw new GraphError('SELF_DEPENDENCY', [n.id]);
    const bad = deps.filter((d) => !nodes.has(d));
    if (bad.length) throw new GraphError('DANGLING_DEPENDENCY', [n.id, ...bad]);
    indeg.set(n.id, deps.length);
    for (const d of deps) dependents.get(d)!.push(n.id);
  }
  const order: string[] = [];
  const ready = list.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  for (let i = 0; i < ready.length; i++) {
    const id = ready[i]!;
    order.push(id);
    for (const dep of dependents.get(id)!) {
      const left = indeg.get(dep)! - 1;
      indeg.set(dep, left);
      if (left === 0) ready.push(dep);
    }
  }
  if (order.length !== list.length) throw new GraphError('CYCLE', list.filter((n) => !order.includes(n.id)).map((n) => n.id));
  return { order, nodes, dependents };
}

/** Reverse transitive closure: every node that (transitively) depends on a seed, in topological order. Seeds only when `includeSeeds`. */
export function reverseClosure(g: Graph, seeds: Iterable<string>, includeSeeds = false): string[] {
  const seedSet = new Set(seeds);
  for (const s of seedSet) if (!g.nodes.has(s)) throw new GraphError('DANGLING_DEPENDENCY', [s]);
  const hit = new Set<string>();
  const stack = [...seedSet];
  while (stack.length) for (const dep of g.dependents.get(stack.pop()!)!) if (!hit.has(dep)) (hit.add(dep), stack.push(dep));
  if (includeSeeds) for (const s of seedSet) hit.add(s);
  return g.order.filter((id) => hit.has(id));
}
