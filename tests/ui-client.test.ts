import test from "node:test";
import assert from "node:assert/strict";
import {
  validateArchive,
  safeSourceLink,
  emptyUpdate,
} from "../src/lib/client/archive.ts";
import { simulate } from "../src/lib/client/simulation.ts";

const board = {
  id: "b",
  title: "Research",
  question: "What?",
  requirements: "",
  sources: [
    {
      id: "s",
      url: "https://docs.python.org/3/",
      title: "Python",
      status: "succeeded",
      observedAt: "2026-11-14T18:00:00Z",
      contentHash: "hash",
      excerpt: "Evidence",
    },
  ],
  facts: [
    {
      id: "f",
      value: 1,
      status: "supported",
      source_id: "s",
      quote: "Evidence",
    },
  ],
  answers: [{ id: "a", text: "Answer", status: "fresh", depends_on: ["f"] }],
  revisions: [
    {
      id: "r",
      parent_id: null,
      createdAt: "2026-11-14T18:00:00Z",
      kind: "created",
      summary: "Created",
    },
  ],
};
const raw = (b: unknown = board) =>
  JSON.stringify({
    schemaVersion: 1,
    format: "ripple-board-v1",
    board: b,
    snapshot: null,
    exportedAt: "2026-11-14T18:00:00Z",
  });

test("accepts a null-snapshot archive for historical import", () =>
  assert.equal(validateArchive(raw()).snapshot, null));
test("rejects dangling or cyclic dependency graphs on import", () => {
  assert.throws(
    () =>
      validateArchive(
        raw({
          ...board,
          answers: [{ ...board.answers[0], depends_on: ["missing"] }],
        }),
      ),
    /dependency/i,
  );
  assert.throws(
    () =>
      validateArchive(
        raw({
          ...board,
          answers: [{ ...board.answers[0], depends_on: ["a"] }],
        }),
      ),
    /cycle/i,
  );
});
test("rejects unsafe source URLs, polluted objects and unsafe revision records", () => {
  assert.throws(() =>
    validateArchive(
      raw({
        ...board,
        sources: [{ ...board.sources[0], url: "javascript:alert(1)" }],
      }),
    ),
  );
  assert.throws(() =>
    validateArchive(
      raw().replace('"schemaVersion":1', '"__proto__":{},"schemaVersion":1'),
    ),
  );
  const a = JSON.parse(raw());
  a.revisions = [
    {
      revisionId: "r2",
      createdAt: "2026-11-14T18:00:00Z",
      board: {
        ...board,
        answers: [{ ...board.answers[0], depends_on: ["missing"] }],
      },
    },
  ];
  assert.throws(() => validateArchive(JSON.stringify(a)), /dependency/i);
  assert.equal(safeSourceLink("javascript:alert(1)"), null);
  assert.equal(safeSourceLink("https://user:secret@docs.python.org/"), null);
  for (const url of [
    "https://127.0.0.1/",
    "https://localhost/",
    "https://docs.python.org/?token=secret",
    "https://docs.python.org/?X-Amz-Signature=secret",
    "https://docs.python.org./",
  ])
    assert.equal(safeSourceLink(url), null);
});
test("simulation separates semantic change, unknown freshness and harmless body edits", () => {
  assert.deepEqual(simulate("capacity").affected, ["a-workshop", "a-keynote"]);
  assert.deepEqual(simulate("failure").unknown, ["a-workshop", "a-keynote"]);
  assert.deepEqual(simulate("body").affected, []);
  assert.deepEqual(simulate("capacity").reused, ["a-doors"]);
  assert.deepEqual(emptyUpdate().recomputed, []);
});

test("API boundary rejects fixture/malformed responses and never silently retries", async () => {
  const { createBoard, RequestError } = await import(
    "../src/lib/client/api.ts"
  );
  const original = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    return new Response(JSON.stringify({ mode: "fixture" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    await assert.rejects(
      () =>
        createBoard({
          request_id: "test",
          title: "Test",
          question: "Test?",
          requirements: "",
          urls: ["https://docs.python.org/3/"],
        }),
      (e) => e instanceof RequestError && e.code === "INVALID_RESPONSE",
    );
    assert.equal(attempts, 1);
  } finally {
    globalThis.fetch = original;
  }
});
