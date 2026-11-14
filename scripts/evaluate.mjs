#!/usr/bin/env node
// npm run evaluate -- --mode live|fixture --output artifacts/evaluation.json [--limit N]
// Thin wrapper over the prepared independent runner (.searchhack/context/evaluation/run.py), which
// owns case selection and the oracle. This script only forwards arguments and reshapes its report.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const mode = opt('mode', 'live');
if (!['live', 'fixture'].includes(mode)) throw new Error('--mode must be live or fixture');
const output = resolve(opt('output', 'artifacts/evaluation.json'));
const baseUrl = process.env.SEARCHHACK_BASE_URL || 'http://127.0.0.1:4317';
const raw = output.replace(/\.json$/, '') + `.raw-${mode}.json`;

const runner = ['.searchhack/context/evaluation/run.py', '--base-url', baseUrl, '--mode', mode, '--output', raw];
const limit = opt('limit', null);
if (limit) runner.push('--limit', limit);
// Reduced scope selects explicit supported live cases; full scope uses the runner's default sample.
if (mode === 'live' && existsSync('IMPLEMENTED-SCOPE.json')) {
  const ids = JSON.parse(readFileSync('IMPLEMENTED-SCOPE.json', 'utf8')).evaluation_case_ids ?? [];
  if (ids.length) runner.push('--cases', ids.join(','));
}

mkdirSync(dirname(output), { recursive: true });
const run = spawnSync('python3', runner, { stdio: ['ignore', 'inherit', 'inherit'], timeout: 175_000 });
const executedAt = new Date().toISOString();

let report;
if (existsSync(raw) && run.status !== null) {
  const r = JSON.parse(readFileSync(raw, 'utf8'));
  const byCase = new Map();
  for (const o of r.observations) byCase.set(o.case_id, [...(byCase.get(o.case_id) ?? []), o]);
  const cases = [...byCase].map(([id, obs]) => ({
    id,
    passed: obs.every((o) => o.integrity_errors.length === 0) && (obs.find((o) => o.strategy === 'treatment') ?? obs[0]).passed,
    observations: obs,
  }));
  const pairedOk = cases.length > 0 && cases.every((c) => ['baseline', 'treatment'].every((s) => c.observations.some((o) => o.strategy === s && o.http_status === 200 && o.integrity_errors.length === 0)));
  report = {
    schemaVersion: 1,
    project: r.project,
    mode,
    executedAt,
    baseUrl,
    caseCount: r.total,
    passed: r.passed,
    failed: r.failed,
    skipped: 0,
    cases,
    metrics: { baselineStatus: r.strategy === 'paired' && pairedOk ? 'measured' : 'not_measured', baselineQualityFailed: r.baseline_quality_failed },
    limitations: r.limitations,
  };
} else {
  report = {
    schemaVersion: 1, project: 'ripple', mode, executedAt, baseUrl, caseCount: 0, passed: 0, failed: 1, skipped: 0, cases: [],
    metrics: { baselineStatus: 'not_measured' },
    limitations: [`Evaluator did not complete (exit ${run.status ?? run.signal ?? 'unknown'}); no cases were measured.`],
  };
}
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, passed: report.passed, failed: report.failed, baselineStatus: report.metrics.baselineStatus }));
process.exitCode = report.failed || run.status ? 1 : 0;
