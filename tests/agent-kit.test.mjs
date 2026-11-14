import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const zip = "public/downloads/ripple-agent-kit.zip";
const entry = (name) => execFileSync("unzip", ["-p", zip, `ripple-agent-kit/${name}`]);
const list = () => execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).trim().split("\n");

test("committed kit matches its checksum and the package source", () => {
  const digest = createHash("sha256").update(readFileSync(zip)).digest("hex");
  assert.equal(readFileSync(`${zip}.sha256`, "utf8").split(/\s+/)[0], digest);
  const { files } = JSON.parse(entry("MANIFEST.json"));
  for (const f of files) {
    assert.equal(createHash("sha256").update(readFileSync(`packages/ripple-mcp/${f.path}`)).digest("hex"), f.sha256, `${f.path} is stale; run npm run package:integrations`);
  }
});

test("kit ships two skills, plugin manifest and no secrets or local state", () => {
  const names = list();
  for (const n of ["skills/ripple-research/SKILL.md", "skills/ripple-refresh/SKILL.md", ".claude-plugin/plugin.json", "scripts/connect-agents.py", "LICENSE"]) {
    assert.ok(names.includes(`ripple-agent-kit/${n}`), n);
  }
  assert.ok(!names.some((n) => /(^|\/)(\.env|node_modules|vault|state|\.git)(\/|\.|$)/.test(n) || n.endsWith(".pyc")));
  for (const n of names.filter((x) => !x.endsWith("/"))) {
    assert.ok(!/(sk-[A-Za-z0-9]{16}|tvly-[A-Za-z0-9]{8}|ripple_visitor=)/.test(entry(n.replace("ripple-agent-kit/", "")).toString()), n);
  }
});

test("connect helper is dry-run by default and refuses to overwrite a conflicting ripple entry", () => {
  const project = mkdtempSync(join(tmpdir(), "ripple-kit-"));
  const run = (...extra) => spawnSync("python3", ["packages/ripple-mcp/scripts/connect-agents.py", "--project", project, "--base-url", "https://example.vercel.app", ...extra], { encoding: "utf8" });
  const dry = run();
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(JSON.parse(dry.stdout).status, "dry-run");
  assert.ok(!existsSync(join(project, ".mcp.json")));
  const mine = JSON.stringify({ mcpServers: { ripple: { command: "other" } } });
  writeFileSync(join(project, ".mcp.json"), mine);
  mkdirSync(join(project, ".codex"));
  const clash = run("--apply", "--agent", "claude");
  assert.notEqual(clash.status, 0);
  assert.match(clash.stderr, /conflict/i);
  assert.equal(readFileSync(join(project, ".mcp.json"), "utf8"), mine);
});
