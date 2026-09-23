#!/usr/bin/env python3
"""Run the approved backup refresh in a one-off container using existing SQL credentials.
Usage: python3 refresh-hostinger-20260914.py plan|execute
Does not print credentials or modify deployed application images.
"""
import json,os,subprocess,sys,tempfile,pathlib
mode=sys.argv[1]
token=mode+'-r2'
if mode not in ('plan','execute'): raise SystemExit('Invalid mode')
root=pathlib.Path('/opt/worldfert/refresh-20260914');root.mkdir(parents=True,exist_ok=True)
subprocess.run(['tar','-xzf','/tmp/wf-refresh-20260914.tar.gz','-C',str(root)],check=True)
def inspect(n): return json.loads(subprocess.check_output(['docker','inspect',n]))[0]
base=inspect('wf-backend-test');sql=inspect('wf-mssql')
networks=set(base['NetworkSettings']['Networks']) & set(sql['NetworkSettings']['Networks'])
if len(networks)!=1: raise SystemExit('SQL network ambiguous; no action')
network=next(iter(networks)); targets=['dbwins_worldfert9_test','dbwins_worldfert9_test_v2','dbwins_worldfert9']
out=root/'receipts';out.mkdir(exist_ok=True)
for db in targets:
 if mode=='execute' and (out/(db+'-execute-r2.json')).exists(): raise SystemExit('Existing execution receipt; inspect before retry, do not repeat restore')
fd,secret=tempfile.mkstemp(prefix='refresh-env-',dir=str(root));os.fchmod(fd,0o600)
with os.fdopen(fd,'w') as f:
 for item in base['Config']['Env']:
  if item.split('=',1)[0] not in ('COUPON_NATIVE_POSTING_ENABLED','DISABLE_BACKGROUND_WORKERS'): f.write(item+'\n')
 f.write('COUPON_NATIVE_POSTING_ENABLED=false\nDISABLE_BACKGROUND_WORKERS=true\n')
stopped=False;safe_restart=True
try:
 if mode=='execute':
  subprocess.run(['docker','stop','wf-backend','wf-backend-test'],check=True);stopped=True
 for db in targets:
  receipt='/app/refresh/receipts/'+db+'-'+token+'.json'
  cmd=['docker','run','--rm','--name','wf-refresh-20260914','--network',network,'--env-file',secret,'--user','0:0','-v',str(root)+':/app/refresh','-v','/srv/wf-transfer/incoming/mssql:/var/opt/mssql/backup/incoming:ro',base['Image'],'node','/app/refresh/backend/scripts/refresh-approved-20260914.cjs','--mode',mode,'--target',db,'--host',sql['Config']['Hostname'],'--source','/var/opt/mssql/backup/incoming/dbwins_worldfert9.bak','--file','/var/opt/mssql/backup/incoming/dbwins_worldfert9.bak','--backup-dir','/var/opt/mssql/backup/work','--receipt',receipt]
  log=out/(db+'-'+token+'.log')
  with log.open('w') as stream: result=subprocess.run(cmd,stdout=stream,stderr=subprocess.STDOUT)
  rp=out/(db+'-'+token+'.json');state=json.loads(rp.read_text()) if rp.exists() else {}
  print(json.dumps({'db':db,'exit':result.returncode,'status':state.get('status'),'receipt':str(rp)}),flush=True)
  if result.returncode:
   print('\n'.join(log.read_text().splitlines()[-12:]),flush=True)
   if mode=='execute' and state.get('status') not in ('FAILED_ROLLED_BACK','FAILED','PLAN_VERIFIED','SAFETY_BACKUP_VERIFIED'):safe_restart=False
   if state.get('rollbackError'):safe_restart=False
   raise SystemExit(result.returncode)
finally:
 os.unlink(secret)
 if stopped and safe_restart: subprocess.run(['docker','start','wf-backend','wf-backend-test'],check=True)
 elif stopped: print('Backends retained stopped: inspect failed recovery before restarting',flush=True)
