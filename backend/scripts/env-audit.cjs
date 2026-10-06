'use strict';
// Offline, values never leave this process. No db.js import or dotenv.config().
const fs = require('fs'), path = require('path');
const dotenv = require('dotenv');
const root = path.resolve(__dirname,'../..');
function inspect(text) {
  const keys = [...text.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map(m=>m[1]);
  const counts = new Map();
  for(const k of keys)counts.set(k,(counts.get(k)||0)+1);
  return {keys:[...counts.keys()].sort(),duplicates:[...counts].filter(([,n])=>n>1).map(([k])=>k)};
}
function normalizeDuplicates(text) {
  const lines=text.split(/\r?\n/), last=new Map();
  lines.forEach((line,i)=>{const m=/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);if(m)last.set(m[1],i);});
  const normalized=lines.filter((line,i)=>{const m=/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);return !m||last.get(m[1])===i;}).join(text.includes('\r\n')?'\r\n':'\n');
  // Multiline parsing and all effective values must stay identical; fail rather than guessing.
  const before=dotenv.parse(text),after=dotenv.parse(normalized);
  if(JSON.stringify(before,Object.keys(before).sort())!==JSON.stringify(after,Object.keys(after).sort()))throw new Error('Normalization changes effective environment; manual review required');
  return normalized;
}
function effectiveEnv(text, inherited={}) {return {...dotenv.parse(text),...inherited};}
function validate(env,{frontend=false}={}) {
  const errors=[];
  if(frontend) {
    for(const k of Object.keys(env)) if(/^VITE_/i.test(k)&&/PASSWORD|SECRET|TOKEN|PRIVATE_KEY|CONNECTION_STRING/i.test(k))errors.push(k+': forbidden public client key');
    return errors;
  }
  if(!['local','remote','remote_b','local_uat','local_rehearsal'].includes(env.DB_MODE))errors.push('DB_MODE: explicit supported target required');
  const required={remote:['REMOTE_DB_SERVER','REMOTE_DB_USER','REMOTE_DB_PASSWORD','DB_NAME'],
    remote_b:['REMOTE_B_DB_SERVER','REMOTE_B_DB_USER','REMOTE_B_DB_PASSWORD','REMOTE_B_DB_NAME'],
    local:['LOCAL_DB_SERVER','DB_NAME'],
    local_uat:['LOCAL_UAT_SERVER','LOCAL_UAT_DB','LOCAL_UAT_USER','LOCAL_UAT_PASSWORD'],
    local_rehearsal:['LOCAL_REHEARSAL_SERVER','LOCAL_REHEARSAL_DB','LOCAL_REHEARSAL_USER','LOCAL_REHEARSAL_PASSWORD']};
  const hasConnectionString=env.DB_MODE==='local'&&env.LOCAL_DB_CONNECTION_STRING ||
    env.DB_MODE==='local_uat'&&env.LOCAL_UAT_CONNECTION_STRING ||
    env.DB_MODE==='local_rehearsal'&&env.LOCAL_REHEARSAL_CONNECTION_STRING;
  if(!hasConnectionString)for(const k of required[env.DB_MODE]||[]) if(!env[k]?.trim())errors.push(k+': required for target');
  for(const k of ['PORT','REMOTE_DB_PORT','REMOTE_B_DB_PORT'])if(env[k]&&(!/^\d+$/.test(env[k])||Number(env[k])<1||Number(env[k])>65535))errors.push(k+': invalid port');
  for(const k of ['COUPON_NATIVE_POSTING_ENABLED','ALLOW_LIVE_REHEARSAL','DISABLE_BACKGROUND_WORKERS'])if(env[k]!==undefined&&!['true','false'].includes(env[k]))errors.push(k+': expected true/false');
  return errors;
}
function audit({normalizeBackend=false}={}) {
  const files=['.env.example','.env.docker.example','backend/.env','backend/.env.example','WSSale-App/.env.local','WSSale-App/.env.production',
    'deploy/onprem/.env','deploy/onprem/.env.example','deploy/cloud-vps/.env','deploy/cloud-vps/.env.example','deploy/cloud-vps/server/server-config.env','deploy/cloud-vps/server/server-config.env.example'];
  const results=[];
  for(const file of files) {
    const absolute=path.join(root,file);if(!fs.existsSync(absolute))continue;
    const text=fs.readFileSync(absolute,'utf8');
    const info=inspect(text);
    const record={file,...info,template:file.endsWith('.example')};
    if(normalizeBackend&&file==='backend/.env') {
      const normalized=normalizeDuplicates(text);
      if(normalized!==text)fs.writeFileSync(absolute,normalized);
      record.normalizedKeys=info.duplicates;record.effectiveValuesPreserved=true;
    }
    if(file.startsWith('WSSale-App/'))record.issues=validate(dotenv.parse(text),{frontend:true});
    else if(file==='backend/.env'||file==='backend/.env.example')record.issues=validate(dotenv.parse(text));
    results.push(record);
  }
  return results;
}
if(require.main===module){
  if(process.argv.slice(2).some(a=>a!=='--normalize-backend'))throw new Error('Unknown argument');
  console.log(JSON.stringify(audit({normalizeBackend:process.argv.includes('--normalize-backend')}),null,2));
}
module.exports={inspect,normalizeDuplicates,effectiveEnv,validate,audit};

