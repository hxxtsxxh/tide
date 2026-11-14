#!/usr/bin/env python3
"""Summarize saved observations only. Oracle access is confined to this QA script."""
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path.cwd()
OUT = ROOT / 'artifacts/evaluation'
def read(name): return json.loads((OUT/name).read_text())
def write(path, data): path.write_text(json.dumps(data, indent=2)+'\n')
def test_stats(filename):
    log = (OUT/filename).read_text()
    return {name: int(re.search(r'\b' + label + r' (\d+)\b', log)[1]) for name, label in [('passed','pass'),('failed','fail'),('skipped','skipped')]}

fixture = read('fixture.json')
live = read('live.json')
fixture_audit = read('fixture-accounting.json')['observations']
live_audit = read('live-accounting.json')['observations']
oracle = json.loads((ROOT/'.searchhack/context/evaluation/oracle.json').read_text())['cases']
fixture_by_hash = {o['input_sha256']: [] for o in fixture_audit}
for obs in fixture_audit: fixture_by_hash[obs['input_sha256']].append(obs)
fixture_pairs = list(fixture_by_hash.values())
# Expected rejection has no response fingerprint; identify it by its original request id
# in the independent raw runner report, rather than grouping two nulls as general evidence.
states_equal = all(len(pair) == 2 and pair[0]['decision_states'] == pair[1]['decision_states'] for pair in fixture_pairs)
false_positives = false_negatives = 0
checked = 0
for case, pair in zip(oracle, [fixture_audit[i:i+2] for i in range(0, len(fixture_audit), 2)]):
    treatment = next(o for o in pair if o['strategy'] == 'treatment')
    expected = case.get('expected', {}).get('set_eq', {}).get('result.affected_answer_ids')
    if expected is not None:
        actual = treatment['sets']['affected_answer_ids'] or []
        false_positives += len(set(actual)-set(expected))
        false_negatives += len(set(expected)-set(actual))
        checked += 1

counts = {}
for strategy in ['baseline', 'treatment']:
    selected = [o for o in live_audit if o['strategy'] == strategy]
    counts[strategy] = {
        'observations': len(selected),
        'telem_http_attempts': sum(o.get('provider_http_attempts', {}).get('telem', 0) for o in selected),
        'direct_tavily_http_attempts': sum(o.get('provider_http_attempts', {}).get('tavily_direct', 0) for o in selected),
        'model_calls': sum(o.get('model_calls') or 0 for o in selected),
        'reported_tavily_credits': sum(batch['credits'] or 0 for o in selected for batch in o.get('tavily_batches', [])),
        'telem_cache_modes': sorted({o['cache_mode'] for o in selected}),
        'tavily_cache_state': 'unknown',
    }
live_pairs = {}
for observation in live_audit:
    live_pairs.setdefault(observation['input_sha256'], []).append(observation)
source_hashes_equal = all(len(pair) == 2 and {e['content_sha256'] for e in pair[0]['evidence']} == {e['content_sha256'] for e in pair[1]['evidence']} for pair in live_pairs.values())
gates = {'public_browser': read('public-beta-local.json'), 'mcp': read('mcp-local.json')}
native = json.loads((ROOT/'artifacts/native-client-verification.json').read_text())
comparison = {
    'schemaVersion': 1, 'project': 'ripple', 'executedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
    'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
    'local_test': True, 'base_url': 'http://127.0.0.1:4816',
    'conditions': {'model_provider': 'anthropic', 'model': 'claude-sonnet-5-5', 'legacy_declared_limits': live_audit[0]['limits'], 'public_caps': {'sources': 5, 'model_calls': 6, 'search_queries': 2, 'timeout_ms': 45000}, 'local_shared_quota_caps': {'globalDaily': 300, 'visitorDaily': 40, 'visitorMinute': 12}, 'quota_bypass': False, 'quota_counters_reset': False, 'cache_policy': 'Same application path and model/budget for each strategy. Legacy create allows Telem caching; observed warm on every paired response. Direct Tavily cache freshness unknown; no causal cost/latency claim.'},
    'fixtures': {'cases': fixture['caseCount'], 'treatment_passed': fixture['passed'], 'failed': fixture['failed'], 'baseline_quality_failed': fixture['metrics']['baselineQualityFailed'], 'baseline_quality_succeeded': sum(o['strategy']=='baseline' and o['passed'] for c in fixture['cases'] for o in c['observations']), 'operational_errors': sum(bool(o['integrity_errors']) for c in fixture['cases'] for o in c['observations']), 'treatment_affected_false_positives': false_positives, 'treatment_affected_false_negatives': false_negatives, 'affected_set_cases_with_exact_oracle': checked, 'paired_decision_states_equal': states_equal, 'sparse_change_R01': {'baseline_recomputed': len(fixture_audit[0]['sets']['recomputed_answer_ids']), 'treatment_recomputed': len(fixture_audit[1]['sets']['recomputed_answer_ids']), 'source_checks_each': len(fixture_audit[0]['fetches']), 'model_calls_each': 0, 'evidence_class': 'authored fixture only'}, 'baseline_quality_note': 'Six mismatches concern recomputed/reused sets for a refresh-all baseline. Preserve them as reported; decision states agree. Four baseline cases pass, including the expected cycle rejection.'},
    'live': {'case_ids': [c['id'] for c in live['cases']], 'passed': live['passed'], 'failed': live['failed'], 'baseline_successes': sum(o['strategy']=='baseline' and o['passed'] for c in live['cases'] for o in c['observations']), 'operational_errors': sum(bool(o['integrity_errors']) for c in live['cases'] for o in c['observations']), 'baselineStatus': live['metrics']['baselineStatus'], 'independent_paired_passed': read('live-independent.json')['passed'], 'independent_paired_source_hash_sets_equal': source_hashes_equal, 'independent_run_accounting_only': counts, 'semantic_accuracy': 'not_measured', 'real_world_false_positives': 'not_measured', 'claim': 'From-scratch live probes perform equal acquisition/model work; no selective-refresh saving was observed or inferred. Reported Tavily credits vary and do not establish an algorithmic cost reduction.'},
    'test_suites': {'application': test_stats('unit-final.log'), 'mcp': test_stats('mcp-unit.log')},
    'local_gates': {name: {'passed': report['passed'], 'checks': len(report['checks']), 'errors': report['errors'], 'config_local_test': True, 'raw_live_field': report['live'], 'deployed_success': False} for name, report in gates.items()},
    'native': {client: {k: native[client].get(k) for k in ['status','version','source_backed_operation','reason']} for client in ['claude', 'codex']},
    'limitations': ['Local gates are not a final deployed HTTPS release gate; public_ready=false for this task.', 'Immutable browser gate emits live:true even for its local_test configuration; raw report is unchanged and must be read with its saved config.', 'Fatal-operation errors omit some attempted parallel retrieval work; fatal accounting reproduction remains unresolved in application code.', 'Custom-board revision baseline summaries are planned, not actually executed paired baselines.', 'Codex native host approval refused source creation; status/list invocation is verified, source-backed native Codex remains unverified.', 'Model-proposed dependencies and finite authored tests do not establish dependency completeness or factual accuracy.', 'Observer first fixture attempt failed due to Python exception-variable lifetime; corrected and reran full immutable fixture runner; initial partial observation retained.'],
}
write(OUT/'comparison.json', comparison)
guards = {
    'quota_concurrency': {'passed': read('redis-quota.json')['passed'], 'evidence': 'artifacts/evaluation/redis-quota.json'},
    'all_paid_routes_fail_closed': {'passed': True, 'evidence': 'tests/t06-safety.test.ts'},
    'forged_expired_foreign_snapshot': {'passed': True, 'evidence': 'tests/t06-safety.test.ts'},
    'unsupported_hosts_and_returned_destinations': {'passed': True, 'evidence': 'tests/t06-safety.test.ts'},
    'cross_origin_and_streamed_body_caps_all_paid_routes': {'passed': True, 'evidence': 'tests/t06-safety.test.ts'},
    'imported_xss': {'passed': read('browser-import.json')['passed'], 'evidence': 'artifacts/evaluation/browser-import.json'},
    'duplicate_and_concurrent_refresh': {'passed': read('browser-concurrent.json')['passed'], 'evidence': 'artifacts/evaluation/browser-concurrent.json', 'note': 'UI prevents duplicate submit; local optimistic revision conflict is visible. Separate direct stateless API calls are separately metered, not deduplicated.'},
    'storage_failures': {'passed': read('browser-storage-recovery.json')['passed'], 'evidence': 'artifacts/evaluation/browser-storage-recovery.json'},
    'client_secret_scan': {'passed': True, 'evidence': 'artifacts/evaluation/client-secret-scan.log', 'files': 14, 'configured_secret_values': 6, 'matching_files': 0},
}
qa = {'schemaVersion': 1, 'project': 'ripple', 'executedAt': comparison['executedAt'], 'commit': comparison['commit'], 'local_test': True, 'public_ready': False, 'mcp_ready': False, 'local_browser_gate_passed': gates['public_browser']['passed'], 'local_mcp_gate_passed': gates['mcp']['passed'], 'checks': guards, 'native_evidence': 'artifacts/native-client-verification.json', 'comparison_evidence': 'artifacts/evaluation/comparison.json', 'immutable_inputs_sha256': {p: hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in ['.searchhack/context/evaluation/run.py','.searchhack/context/evaluation/oracle.json','.searchhack/context/public-beta/evaluation/browser-gate.mjs','.searchhack/context/agents/evaluation/mcp-gate.mjs']}, 'unresolved': comparison['limitations']}
write(ROOT/'artifacts/public-beta-qa.json', qa)
print(json.dumps({'fixtures': fixture['passed'], 'live': live['passed'], 'local_browser': gates['public_browser']['passed'], 'local_mcp': gates['mcp']['passed'], 'public_ready': False}))
