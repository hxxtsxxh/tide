import {
  parseArchive,
  type Board,
  type BoardArchive,
  type UpdateSets,
} from "../contracts/board.ts";

export function safeSourceLink(value: string): string | null {
  try {
    const u = new URL(value);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      (u.port && u.port !== "443")
    )
      return null;
    if (
      !/^[a-z0-9.-]+$/.test(u.hostname) ||
      !u.hostname.includes(".") ||
      /(?:^|\.)(?:localhost|local|internal)$/.test(u.hostname) ||
      u.hostname.endsWith(".") ||
      /^\d+(?:\.\d+)*$/.test(u.hostname)
    )
      return null;
    if (
      [...u.searchParams.keys()].some((key) =>
        /(?:token|secret|password|signature|credential|api.?key|authorization|x-amz|x-goog)/i.test(
          key,
        ),
      )
    )
      return null;
    return u.href;
  } catch {
    return null;
  }
}
export function emptyUpdate(): UpdateSets {
  return { affected: [], recomputed: [], reused: [], unknown: [] };
}

function validateBoard(board: Board) {
  const nodes = [...board.sources, ...board.facts, ...board.answers];
  if (
    nodes.length > 40 ||
    new Set([board.id, ...nodes.map((n) => n.id)]).size !== nodes.length + 1
  )
    throw new Error("Duplicate IDs or too many nodes in archive.");
  if (
    !board.id ||
    !board.title ||
    board.title.length > 120 ||
    board.question.length > 2000 ||
    board.requirements.length > 2000
  )
    throw new Error("Invalid archive inputs.");
  const sources = new Set(board.sources.map((s) => s.id));
  for (const source of board.sources)
    if (!safeSourceLink(source.url))
      throw new Error("Unsafe source URL in archive.");
  for (const fact of board.facts) {
    if (
      !sources.has(fact.source_id) ||
      fact.support_sets?.some(
        (set) => !set.length || set.some((id) => !sources.has(id)),
      )
    )
      throw new Error("Invalid source dependency in archive.");
  }
  const facts = new Set(board.facts.map((f) => f.id));
  const answers = new Map(board.answers.map((a) => [a.id, a]));
  const visited = new Set<string>(),
    visiting = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) throw new Error("Dependency cycle in archive.");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of answers.get(id)!.depends_on) {
      if (answers.has(dep)) visit(dep);
      else if (!facts.has(dep))
        throw new Error("Missing dependency in archive.");
    }
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of answers.keys()) visit(id);
  const revisionIds = board.revisions.map((r) => r.id);
  if (new Set(revisionIds).size !== revisionIds.length)
    throw new Error("Duplicate revision IDs.");
}

export function validateArchive(text: string): BoardArchive {
  const archive = parseArchive(text);
  validateBoard(archive.board);
  const ids = new Set<string>();
  for (const revision of archive.revisions ?? []) {
    validateBoard(revision.board);
    if (revision.board.id !== archive.board.id || ids.has(revision.revisionId))
      throw new Error("Invalid archived revision.");
    ids.add(revision.revisionId);
  }
  return archive;
}
