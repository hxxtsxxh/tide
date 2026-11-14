#!/usr/bin/env python3
"""Package only the reviewed agent integration files; never include .env, vaults or node_modules."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED,ZipInfo
import argparse,hashlib,json,os

def package(root,output):
 root=Path(root).resolve();output=Path(output).resolve()
 include=['src','scripts','skills','.claude-plugin','.mcp.json','package.json','package-lock.json','README.md','LICENSE']
 files=[]
 for name in include:
  p=root/name
  if p.is_symlink():raise RuntimeError('Refusing symlink '+name)
  if not p.exists():
   if name=='package-lock.json':continue
   raise RuntimeError('Missing kit file '+name)
  for f in sorted(p.rglob('*')) if p.is_dir() else [p]:
   if f.is_symlink():raise RuntimeError('Refusing symlink kit entry')
   parts=f.relative_to(root).parts
   forbidden=any(part in ('__pycache__','node_modules','.git','vault','state') or part=='.env' or part.startswith('.env.') for part in parts)
   if f.is_file() and not forbidden and f.suffix!='.pyc':files.append(f)
 output.parent.mkdir(parents=True,exist_ok=True)
 manifest=[]
 with ZipFile(output,'w',ZIP_DEFLATED,compresslevel=9) as z:
  for f in files:
   rel=str(f.relative_to(root));data=f.read_bytes();z.writestr('ripple-agent-kit/'+rel,data)
   manifest.append({'path':rel,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)})
  z.writestr('ripple-agent-kit/MANIFEST.json',json.dumps({'version':'0.2.0','files':manifest},indent=2)+'\n')
 digest=hashlib.sha256(output.read_bytes()).hexdigest()
 output.with_suffix(output.suffix+'.sha256').write_text(digest+'  '+output.name+'\n')
 return {'archive':str(output),'sha256':digest,'files':len(files),'published':False}
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',required=True);a=p.parse_args()
 print(json.dumps(package(Path(__file__).resolve().parents[1],a.output),indent=2))
