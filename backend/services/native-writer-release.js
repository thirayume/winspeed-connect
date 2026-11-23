'use strict';
// Builds a credential-free, exact-source release plan for the official R740 wrapper.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const metadata=require('./native-document-metadata.json'),hooks=require('./coupon-bridge-hooks');
const digest=s=>crypto.createHash('sha256').update(s.replace(/\r\n/g,'\n')).digest('hex');
function literal(source,prefix){
 let n=source.indexOf("EXEC(N'"+prefix);if(n<0)throw Error('NATIVE_BASELINE_SOURCE_MISSING');n+=7;let out='';
 for(;n<source.length;n++){if(source[n]!=="'"){out+=source[n];continue;}if(source[n+1]==="'"){out+="'";n++;}else return out;}
 throw Error('NATIVE_BASELINE_LITERAL_INVALID');
}
function originals(){
 const root=path.join(__dirname,'../migrations');
 const values=[
  literal(fs.readFileSync(path.join(root,'230_coupon_native_consume.sql'),'utf8'),'CREATE TRIGGER dbo.WF_CouponNativeConsume'),
  literal(fs.readFileSync(path.join(root,'224_coupon_guard_durable_evidence.sql'),'utf8'),'ALTER TRIGGER dbo.WF_CouponReservationGuard'),
 ];
 const source=fs.readFileSync(path.join(root,'234_coupon_native_edit_hooks.sql'),'utf8').replace(/\r\n/g,'\n');
 for(const name of ['WF_CouponNativeEditHeadHook','WF_CouponNativeEditDetailHook']){
  const start=source.indexOf('CREATE TRIGGER dbo.'+name),end=source.indexOf('\nGO',start);
  if(start<0||end<0)throw Error('NATIVE_BASELINE_SOURCE_MISSING');values.push(source.slice(start,end));
 }
 return hooks.definitions.map((h,i)=>{
  const expected=metadata.triggers.find(r=>r[0]===h.table.toLowerCase()&&r[1]===h.name.toLowerCase());
  let text=values[i].replace(/^ALTER TRIGGER /,'CREATE TRIGGER ').replace(/\r\n/g,'\n');
  text=['','\n','\n\n'].flatMap(p=>[text,text.trimEnd(),text.trimEnd()+'\n',text.trimEnd()+'\n\n'].map(t=>p+t)).find(v=>digest(v)===expected[3]);
  if(!text)throw Error('NATIVE_BASELINE_BYTES_MISMATCH_'+h.name);
  return {...h,sql:text.replace(/CREATE TRIGGER /,'ALTER TRIGGER '),disabled:expected[2]};
 });
}
function payload({database,action='ENABLE',approverId,actorId,reason,sourceRevision}){
 if(!['dbwins_worldfert9','dbwins_worldfert9_uat','dbwins_worldfert9_uat_v3'].includes(database))throw Error('NATIVE_RELEASE_TARGET_INVALID');
 if(!['ENABLE','DISABLE'].includes(action)||![approverId,actorId].every(n=>Number.isSafeInteger(n)&&n>0)
  ||typeof reason!=='string'||reason.trim().length<20||reason.length>500||!/^([a-f0-9]{40}|QA-WORKTREE)$/.test(sourceRevision||''))throw Error('NATIVE_RELEASE_APPROVAL_REQUIRED');
 if(sourceRevision==='QA-WORKTREE'&&database!=='dbwins_worldfert9_uat_v3')throw Error('NATIVE_RELEASE_REVISION_REQUIRED');
 const dir=path.join(__dirname,'../migrations'),files=fs.readdirSync(dir).filter(f=>/^(26[3-9]|27[0-7])_.*\.sql$/.test(f)).sort();
 if(files.length!==15)throw Error('NATIVE_RELEASE_MIGRATIONS_MISSING');
 const migrations=files.map(file=>({file,hash:crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,file))).digest('hex')}));
 const originalHooks=originals(),reader=fs.readFileSync(path.join(dir,'277_native_writer_metadata_release.sql'),'utf8');
 const start=reader.indexOf('ALTER PROCEDURE'),readerSql=reader.slice(start,reader.indexOf('\nGO',start));
 const sourceHash=digest(JSON.stringify({migrations,baseline:metadata.triggers,expected:hooks.expectedTriggers(metadata.triggers),module:hooks.moduleHash}));
 return {server:'R740-SRV\\SQL2008',database,action,approverId,actorId,reason:reason.trim(),sourceRevision,sourceHash,
  policy:'NATIVE-DOCUMENTS-v3',metadataHash:require('./initial-invoice-metadata').EXPECTED,moduleHash:hooks.moduleHash,
  migrations,baseline:metadata.triggers,expected:hooks.expectedTriggers(metadata.triggers),hooks:hooks.definitions,originalHooks,
  readerSql,
  metadataQuery:'SELECT OBJECT_NAME(t.parent_id) AS TableName,t.name,t.is_disabled,m.definition FROM sys.triggers t LEFT JOIN sys.sql_modules m ON m.object_id=t.object_id WHERE t.parent_id IN('+metadata.tables.map(t=>"OBJECT_ID('dbo."+t+"')").join(',')+') ORDER BY OBJECT_NAME(t.parent_id),t.name'};
}
module.exports={payload,originals,digest};
