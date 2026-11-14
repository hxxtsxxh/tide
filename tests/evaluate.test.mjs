import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('failed evaluator invocation never reports a previous raw run as measured', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripple-evaluate-'));
  try {
    mkdirSync(join(dir, 'scripts'));
    mkdirSync(join(dir, 'bin'));
    copyFileSync(resolve('scripts/evaluate.mjs'), join(dir, 'scripts/evaluate.mjs'));
    const raw = {project:'ripple', strategy:'paired', total:1, passed:1, failed:0,
      baseline_quality_failed:0, limitations:[], observations:['baseline','treatment'].map(strategy =>
        ({case_id:'OLD',strategy,http_status:200,integrity_errors:[],passed:true}))};
    writeFileSync(join(dir, 'report.raw-live.json'), JSON.stringify(raw));
    // A failed runner writes no report. The wrapper must not ingest the old file.
    writeFileSync(join(dir, 'bin/python3'), `#!${process.execPath}\nprocess.exit(2);\n`, {mode:0o700});
    const run = spawnSync(process.execPath, ['scripts/evaluate.mjs','--output','report.json'], {
      cwd:dir, encoding:'utf8', env:{...process.env, PATH:join(dir,'bin')}, timeout:10000,
    });
    assert.equal(run.status, 1, run.stderr);
    const report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));
    assert.equal(report.metrics.baselineStatus, 'not_measured');
    assert.equal(report.caseCount, 0);
    assert.equal(report.passed, 0);
    assert.ok(report.failed > 0);
  } finally { rmSync(dir, {recursive:true, force:true}); }
});
