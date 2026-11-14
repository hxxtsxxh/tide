#!/usr/bin/env python3
"""Passively observe the immutable HTTP runner, without modifying requests or verdicts.

Only bounded accounting/provenance projections are persisted; source text, prompts,
snapshots, cookies, credentials and model prose are excluded.
"""
import argparse
import datetime as dt
import json
from pathlib import Path
import re
import runpy
import sys
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--audit-output', required=True)
    parser.add_argument('runner_args', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    runner_args = args.runner_args[1:] if args.runner_args[:1] == ['--'] else args.runner_args
    observations = []
    original = urllib.request.OpenerDirector.open

    def observe(req, response, raw):
        request = json.loads(req.data or b'{}')
        try:
            body = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            body = {}
        trace = body.get('trace', {})
        result = body.get('result', {})
        record = {
            'request_id': request.get('request_id'), 'mode': request.get('mode'),
            'strategy': request.get('strategy'), 'fixture_id': request.get('fixture_id'),
            'limits': request.get('limits'), 'http_status': response.code,
            'input_sha256': body.get('input_sha256'), 'status': body.get('status'),
            'error_code': body.get('error', {}).get('code'),
            'model_calls': trace.get('model_calls'), 'elapsed_ms': trace.get('elapsed_ms'),
            'cache_mode': trace.get('cache_mode'),
            'sets': {k: result.get(k) for k in ['affected_answer_ids', 'recomputed_answer_ids', 'reused_answer_ids', 'unknown_answer_ids']},
            'decision_states': [{'id': d.get('id'), 'state': d.get('state')} for d in result.get('decisions', [])],
            'evidence': [{k: e.get(k) for k in ['id', 'source_id', 'origin', 'retrieved_at', 'content_sha256']} for e in body.get('evidence', [])],
            'queries': [{k: q.get(k) for k in ['providers', 'status', 'request_id']} for q in trace.get('queries', [])],
            'fetches': [{k: f.get(k) for k in ['source_id', 'status', 'origin', 'request_id']} for f in trace.get('fetches', [])],
        }
        # These fields have fixed application-generated syntax, rather than source/model text.
        for note in trace.get('notes', []):
            match = re.match(r'^Actual acquisition HTTP attempts: Telem=(\d+).*direct Tavily=(\d+)\.', note)
            if match:
                record['provider_http_attempts'] = {'telem': int(match[1]), 'tavily_direct': int(match[2])}
            match = re.fullmatch(r'tavily direct extract: status=(\w+) request_id=([\w-]+) credits=(\d+(?:\.\d+)?|not reported)', note)
            if match:
                record.setdefault('tavily_batches', []).append({'status': match[1], 'request_id': None if match[2] == 'null' else match[2], 'credits': None if match[3] == 'not reported' else float(match[3]), 'cache_state': 'unknown'})
        observations.append(record)

    def opened(self, req, *a, **kw):
        try:
            response = original(self, req, *a, **kw)
        except urllib.error.HTTPError as error:
            # Preserve its type/status so the unchanged runner handles it normally.
            original_read = error.read
            def error_read(*a, _error=error, **kw):
                raw = original_read(*a, **kw)
                observe(req, _error, raw)
                return raw
            error.read = error_read
            raise
        original_read = response.read
        def read(*a, **kw):
            raw = original_read(*a, **kw)
            observe(req, response, raw)
            return raw
        response.read = read
        return response

    urllib.request.OpenerDirector.open = opened
    sys.argv = ['.searchhack/context/evaluation/run.py', *runner_args]
    try:
        runpy.run_path(sys.argv[0], run_name='__main__')
    finally:
        urllib.request.OpenerDirector.open = original
        output = Path(args.audit_output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps({'schemaVersion': 1, 'project': 'ripple', 'executedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'passive_observer': True, 'observations': observations, 'limitations': ['Application-reported traces, not a provider billing audit.', 'Tavily cache freshness remains unknown.', 'Fatal-operation errors may omit already-attempted work; missing counts are unknown.']}, indent=2) + '\n')


if __name__ == '__main__':
    main()
