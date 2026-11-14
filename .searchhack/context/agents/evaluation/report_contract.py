"""Validate the independently executed stdio MCP/deployed API gate. Not native-client certification."""
REQUIRED_CHECKS=('protocol','catalog','real_custom_board','structured_evidence','local_reload',
                 'requirements_update','source_refresh','portable_archive','local_delete',
                 'source_rejection','revision_conflict','no_secret_summary')
def validate_report(data,url,commit,nonce):
 if not isinstance(data,dict):raise ValueError('Agent gate returned no object')
 for k,v in [('schemaVersion',1),('project','ripple'),('gate','agent-mcp-v1'),('base_url',url.rstrip('/')),('commit',commit),('nonce',nonce)]:
  if data.get(k)!=v:raise ValueError('Agent gate identity mismatch: '+k)
 for k in ('live','executed','passed'):
  if data.get(k) is not True:raise ValueError('Agent gate not passed: '+k)
 if data.get('errors')!=[]:raise ValueError('Agent gate errors')
 for k in REQUIRED_CHECKS:
  c=data.get('checks',{}).get(k,{})
  if not isinstance(c,dict) or c.get('passed') is not True or c.get('skipped'):raise ValueError('Missing/failed agent check: '+k)
 return data
