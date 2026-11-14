"""Fail-closed validation of the externally run browser/API report."""
REQUIRED_CHECKS = ('public_home','real_custom_board','observed_provenance','persistent_reload',
                  'independent_browser','requirement_edit','live_refresh','export_import_delete',
                  'source_rejection','tamper_rejection','cross_origin_rejection','privacy_and_limits',
                  'mobile_layout','server_safety_contract','search_discovery')
def validate_report(data, url, commit, nonce):
    if not isinstance(data,dict): raise ValueError('Public gate did not return an object')
    for key, expected in [('schemaVersion',1),('project','ripple'),('gate','public-beta-v1'),
                          ('base_url',url.rstrip('/')),('commit',commit),('nonce',nonce)]:
        if data.get(key)!=expected: raise ValueError('Public gate identity mismatch: '+key)
    for key in ('live','executed','passed'):
        if data.get(key) is not True: raise ValueError('Public gate not passed: '+key)
    if data.get('errors')!=[]: raise ValueError('Public gate reported errors')
    checks=data.get('checks',{})
    for name in REQUIRED_CHECKS:
        value=checks.get(name,{})
        if not isinstance(value,dict) or value.get('passed') is not True or value.get('skipped'):
            raise ValueError('Required public check missing/failed: '+name)
    return data
