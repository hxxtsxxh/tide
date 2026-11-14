"""Run the unchanged external gate; retain only safe response accounting, never cookies/snapshots.

Usage: python tests/tv02-sponsor-audit.py <the normal sponsor_gate.py arguments>
The observer does not change requests, responses, assertions, or provider configuration.
"""
import json
import pathlib
import runpy
import subprocess
import sys
import urllib.error
import urllib.request
from urllib.parse import urlparse

GATE = pathlib.Path('/Users/heetshah/.local/share/searchhack/addons/ripple-tavily-v1/sponsor_gate.py')
rows = []
original = urllib.request.OpenerDirector.open


def observe(self, request, *args, **kwargs):
    try:
        response = original(self, request, *args, **kwargs)
    except urllib.error.HTTPError as error:
        rows.append({'route': urlparse(request.full_url).path, 'status': error.code, 'retrieval': [], 'error': 'HTTP_ERROR'})
        raise
    read = response.read

    def observed_read(*read_args, **read_kwargs):
        raw = read(*read_args, **read_kwargs)
        try:
            body = json.loads(raw)
            if 'trace' in body:
                board = body.get('board', {})
                sources = {s['id']: s for s in board.get('sources', [])}
                supported = [f for f in board.get('facts', []) if f['status'] == 'supported']
                trace = body['trace']
                adapter_ok = None
                if board:
                    check = subprocess.run(['node', '--input-type=module', '-e',
                        "import {validateEnvelope} from './packages/ripple-mcp/src/bridge.mjs'; let s=''; for await(const c of process.stdin)s+=c; validateEnvelope(JSON.parse(s));"],
                        input=raw, capture_output=True, timeout=10)
                    adapter_ok = check.returncode == 0
                rows.append({
                    'route': urlparse(request.full_url).path,
                    'status': response.status,
                    'retrieval': trace.get('retrieval', []),
                    'model_calls': trace.get('model_calls'),
                    'supported_facts': len(supported),
                    'quotes_mapped': all(f['quote'] in sources[f['source_id']]['excerpt'] for f in supported),
                    'adapter_envelope_compatible': adapter_ok,
                })
        except (ValueError, KeyError, TypeError):
            pass
        return raw

    response.read = observed_read
    return response


if __name__ == '__main__':
    urllib.request.OpenerDirector.open = observe
    sys.path.insert(0, str(GATE.parent))
    sys.argv = [str(GATE), *sys.argv[1:]]
    try:
        runpy.run_path(str(GATE), run_name='__main__')
    finally:
        output = pathlib.Path('artifacts/tavily/gate-http-accounting.json')
        output.parent.mkdir(parents=True, exist_ok=True)
        traces = [t for r in rows for t in r['retrieval']]
        output.write_text(json.dumps({
            'schemaVersion': 1, 'project': 'ripple', 'mode': 'live-services-localhost',
            'public_ready': False, 'sponsors_ready': False, 'observations': rows,
            'provider_http_attempts': {service: sum(t.get('http_attempts', 0) for t in traces if t.get('service') == service) for service in ['telem', 'tavily']},
            'tavily_observed_credits': sum(t.get('usage', {}).get('credits', 0) for t in traces if isinstance(t.get('usage'), dict) and t.get('service') == 'tavily'),
            'baselineStatus': 'not_measured',
            'limitations': ['Only returned trace attempts/credits are observed; provider billing is not audited. No paired baseline was executed.'],
        }, indent=2) + '\n')
