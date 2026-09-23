#!/usr/bin/env python3
"""Owner approved on 21 September: invalidate pre-restore sessions, retain image/DB/passwords."""
import subprocess,json,pathlib,secrets,re,os,time,base64,hmac,hashlib
items=[('wf-backend','backend',['/opt/worldfert/app/deploy/cloud-vps/.env'],'JWT_SECRET'),('wf-backend-test','backend-test',['/opt/worldfert/app/deploy/cloud-vps/.env','/opt/worldfert/secrets/test-stack/test-stack.env'],'TEST_JWT_SECRET')]
receipts=[]
for name,service,envs,key in items:
 old=json.loads(subprocess.check_output(['docker','inspect',name]))[0]
 image=json.loads(subprocess.check_output(['docker','image','inspect',old['Config']['Image']]))[0]
 if image['Id']!=old['Image']:raise SystemExit('Image tag changed; refuse unrelated deployment')
 labels=old['Config']['Labels'];cmd=['docker','compose','--project-name',labels['com.docker.compose.project']]
 for e in envs:cmd+=['--env-file',e]
 for f in labels['com.docker.compose.project.config_files'].split(','):cmd+=['-f',f]
 expected=json.loads(subprocess.check_output(cmd+['config','--format','json']))['services'][service]['environment']
 actual=dict(e.split('=',1) for e in old['Config']['Env'])
 differences={k for k,v in expected.items() if str(v)!=actual.get(k)}
 if differences-({'DB_NAME'} if name.endswith('-test') else set()):raise SystemExit('Unexpected compose environment drift')
 p=pathlib.Path(envs[-1]);text=p.read_text();backup=p.with_name(p.name+'.before-refresh-jwt-20260921')
 if backup.exists():raise SystemExit('JWT rotation already attempted; inspect state')
 backup.write_text(text);os.chmod(backup,0o600)
 def put(text,key,value):
  pattern=r'^'+re.escape(key)+r'=.*$'
  return re.sub(pattern,lambda m:key+'='+value,text,flags=re.M) if re.search(pattern,text,re.M) else text.rstrip()+'\n'+key+'='+value+'\n'
 text=put(text,key,secrets.token_hex(48))
 if name.endswith('-test'):text=put(text,'MSSQL_TEST_DATABASE',actual['DB_NAME'])
 p.write_text(text);os.chmod(p,0o600)
 subprocess.run(cmd+['up','--no-start','--no-deps','--no-build','--force-recreate',service],check=True)
 fresh=json.loads(subprocess.check_output(['docker','inspect',name]))[0];newenv=dict(e.split('=',1) for e in fresh['Config']['Env'])
 if newenv['DB_NAME']!=actual['DB_NAME'] or newenv['JWT_SECRET']==actual['JWT_SECRET'] or fresh['Image']!=old['Image']:raise SystemExit('Post-rotation invariant failed')
 changed={k for k in set(newenv)|set(actual) if newenv.get(k)!=actual.get(k)}
 if changed!={'JWT_SECRET'}:raise SystemExit('Unexpected runtime key change: '+','.join(changed))
 subprocess.run(['docker','start',name],check=True)
 def b64(x):return base64.urlsafe_b64encode(x).rstrip(b'=')
 data=b64(b'{"alg":"HS256","typ":"JWT"}')+b'.'+b64(json.dumps({'sub':99999999,'role':'ADMIN','exp':int(time.time())+300}).encode())
 token=(data+b'.'+b64(hmac.new(actual['JWT_SECRET'].encode(),data,hashlib.sha256).digest())).decode()
 code="(async()=>{for(let i=0;i<20;i++){try{const r=await fetch('http://localhost:3000/api/health');const h=await r.json();if(h.db?.sqlserver!=='up')throw Error('db');const a=await fetch('http://localhost:3000/api/auth/me',{headers:{Authorization:'Bearer '+"+json.dumps(token)+"}});console.log(JSON.stringify({db:h.db.sqlserver,oldTokenStatus:a.status}));process.exit(a.status===401?0:1);}catch(e){await new Promise(r=>setTimeout(r,2000));}}process.exit(1)})()"
 check=subprocess.run(['docker','exec','-i',name,'node'],input=code,text=True,capture_output=True,timeout=60)
 if check.returncode:raise SystemExit('Post-rotation health/token rejection check failed')
 outcome={'name':name,'jwtRotated':True,'sameImage':True,'sameDatabase':True,'check':json.loads(check.stdout.strip())}
 receipts.append(outcome);pathlib.Path('/opt/worldfert/refresh-20260914/session-epoch-20260921.json').write_text(json.dumps(receipts,indent=2));print(json.dumps(outcome),flush=True)
