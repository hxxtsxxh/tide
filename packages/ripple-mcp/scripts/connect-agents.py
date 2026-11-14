#!/usr/bin/env python3
"""Configure this reviewed local Ripple kit in a project. Dry-run unless --apply. No logins or network."""
from __future__ import annotations
import argparse,datetime,hashlib,ipaddress,json,os,shutil,sys,tempfile,uuid
from pathlib import Path
from urllib.parse import urlsplit
try: import tomllib
except ImportError: tomllib=None

def safe(root,rel):
 p=root
 for part in Path(rel).parts:
  if part in ('..','.') or Path(rel).is_absolute():raise RuntimeError('Unsafe path')
  p=p/part
  if p.is_symlink():raise RuntimeError('Refusing symlink: '+str(p))
 return p

def atomic(path,data,mode=0o600):
 path.parent.mkdir(parents=True,exist_ok=True)
 fd,tmp=tempfile.mkstemp(prefix='.ripple-config-',dir=path.parent)
 try:
  with os.fdopen(fd,'wb') as f:os.fchmod(f.fileno(),mode);f.write(data);f.flush();os.fsync(f.fileno())
  os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)

def configure(project,kit,base_url,agents,apply=False,backup_root=None,state_root=None):
 raw=Path(project).expanduser()
 if raw.is_symlink():raise RuntimeError('Refusing symlink project root')
 project=raw.resolve();kit=Path(kit).resolve()
 if not project.is_dir():raise RuntimeError('Project must already exist')
 server=kit/'src/server.mjs'
 if not server.is_file():raise RuntimeError('The extracted Ripple agent kit is missing src/server.mjs')
 u=urlsplit(base_url)
 try: ipaddress.ip_address(u.hostname or '');literal_ip=True
 except ValueError: literal_ip=False
 if literal_ip or '.' not in (u.hostname or '') or (u.hostname or '').endswith(('.local','.internal','.localhost')):raise RuntimeError('Use the verified HTTPS deployment origin only')
 if u.scheme!='https' or not u.hostname or u.username or u.password or u.path not in ('','/') or u.query or u.fragment or u.port or u.hostname in ('localhost','127.0.0.1','::1'):raise RuntimeError('Use the verified HTTPS deployment origin only')
 base_url='https://'+u.hostname
 node=shutil.which('node')
 if not node:raise RuntimeError('Node.js 22+ must be installed')
 import subprocess
 v=subprocess.run([node,'--version'],capture_output=True,text=True,timeout=10)
 if v.returncode or int(v.stdout.strip().lstrip('v').split('.')[0])<22:raise RuntimeError('Node.js 22+ is required')
 ident=hashlib.sha256(str(project).encode()).hexdigest()[:16]
 state=str(Path(state_root or Path.home()/'.local/share/ripple-agent').expanduser()/ident)
 config={'command':node,'args':[str(server)],'env':{'RIPPLE_API_BASE_URL':base_url,'RIPPLE_STATE_DIR':state}}
 writes={}
 if 'claude' in agents:
  path=safe(project,'.mcp.json');d=json.loads(path.read_text()) if path.exists() else {}
  if not isinstance(d,dict) or not isinstance(d.get('mcpServers',{}),dict):raise RuntimeError('Invalid existing .mcp.json')
  m=d.setdefault('mcpServers',{})
  if 'ripple' in m and m['ripple']!=config:raise RuntimeError('Existing ripple MCP name conflict; preserving config')
  if 'ripple' not in m:m['ripple']=config;writes[path]=(json.dumps(d,indent=2)+'\n').encode()
 if 'codex' in agents:
  if tomllib is None:raise RuntimeError('Python 3.11+ is required to preserve and validate Codex TOML')
  path=safe(project,'.codex/config.toml');text=path.read_text() if path.exists() else '';d=tomllib.loads(text)
  wanted=dict(config,tool_timeout_sec=90)
  existing=d.get('mcp_servers',{}).get('ripple')
  if existing is not None and existing!=wanted:raise RuntimeError('Existing ripple MCP name conflict; preserving config')
  if existing is None:
   text+='\n# Ripple project integration (does not alter approval or sandbox settings).\n[mcp_servers.ripple]\n'
   text+='command = '+json.dumps(node)+'\nargs = '+json.dumps([str(server)])+'\ntool_timeout_sec = 90\n'
   text+='[mcp_servers.ripple.env]\nRIPPLE_API_BASE_URL = '+json.dumps(base_url)+'\nRIPPLE_STATE_DIR = '+json.dumps(state)+'\n'
   tomllib.loads(text);writes[path]=text.encode()
 for agent in agents:
  prefix='.claude/skills' if agent=='claude' else '.agents/skills'
  for name in ('ripple-research','ripple-refresh'):
   src=kit/'skills'/name/'SKILL.md';p=safe(project,prefix+'/'+name+'/SKILL.md');data=src.read_bytes()
   if p.exists() and p.read_bytes()!=data:raise RuntimeError('Existing Ripple skill conflict: '+str(p))
   if not p.exists():writes[p]=data
 report={'status':'configured' if apply else 'dry-run','project':str(project),'files':[str(p.relative_to(project)) for p in writes],
  'api_origin':base_url,'state_dir':state,'network_requests':0,'global_settings_changed':False,
  'next':'Start a NEW ordinary Claude/Codex session in this trusted project; check /mcp and invoke ripple_status.'}
 if not writes:report['status']='already-configured';return report
 if not apply:return report
 backups=Path(backup_root or Path.home()/'.local/share/ripple-agent-config-backups').expanduser()
 if backups.is_symlink():raise RuntimeError('Refusing symlink backup directory')
 backups.mkdir(parents=True,exist_ok=True,mode=0o700);os.chmod(backups,0o700)
 backup=backups/(ident+'-'+uuid.uuid4().hex[:10]);backup.mkdir(mode=0o700)
 before={p:p.read_bytes() if p.exists() else None for p in writes}
 for p,data in before.items():
  if data is not None:atomic(backup/p.relative_to(project),data)
 atomic(backup/'RESTORE.json',(json.dumps({'project':str(project),'files':[{'path':str(p.relative_to(project)),'existed':data is not None} for p,data in before.items()]},indent=2)+'\n').encode())
 try:
  for p,data in writes.items():atomic(p,data)
 except Exception:
  for p,data in before.items():
   if data is None:p.unlink(missing_ok=True)
   else:atomic(p,data)
  raise
 report['backup']=str(backup);return report

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--project',required=True);p.add_argument('--base-url',required=True)
 p.add_argument('--agent',choices=('claude','codex','both'),default='both');p.add_argument('--apply',action='store_true')
 a=p.parse_args()
 try:
  agents=['claude','codex'] if a.agent=='both' else [a.agent]
  print(json.dumps(configure(a.project,Path(__file__).resolve().parents[1],a.base_url,agents,a.apply),indent=2));return 0
 except Exception as e:print('Not configured: '+str(e),file=sys.stderr);return 1
if __name__=='__main__':raise SystemExit(main())
