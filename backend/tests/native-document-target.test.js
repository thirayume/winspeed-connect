'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const t=require('../services/native-document-target');
const env={DB_MODE:'onprem',ONPREM_DB_NAME:t.UAT,ONPREM_TARGET_KIND:'uat',ONPREM_EXPECTED_SERVERNAME:t.SERVER,NATIVE_DOCUMENT_WRITER_VERSION:'v3'};
const row={ServerName:t.SERVER,DbName:t.UAT,IsSysadmin:0,ContractApproved:1};
test('operational writer uses the same approved contract on UAT and Production',()=>{
 assert.equal(t.validateTarget(row,env).policyVersion,t.POLICY);
 assert.equal(t.validateTarget({...row,DbName:t.PRODUCTION},{...env,ONPREM_DB_NAME:t.PRODUCTION,ONPREM_TARGET_KIND:'production'}).simulation,false);
});
test('a flag alone cannot opt an unapproved, secondary, privileged or wrong server into native writes',()=>{
 for(const [record,config] of [[{...row,ContractApproved:0},env],[{...row,IsSysadmin:1},env],[{...row,IsSysadmin:null},env],
  [{...row,ServerName:'other'},env],[{...row,DbName:'dbwins_worldfert2'},env],[row,{...env,ONPREM_DB_NAME:t.PRODUCTION}],
  [row,{...env,ONPREM_TARGET_KIND:'production'}],[row,{...env,DB_MODE:'local'}]])assert.throws(()=>t.validateTarget(record,config),{code:'ND_TARGET_NOT_READY'});
});
test('disabled or missing runtime version does not even query SQL',async()=>{
 let called=false;await assert.rejects(t.assertTarget(()=>{called=true;},{...env,NATIVE_DOCUMENT_WRITER_VERSION:''}),{code:'ND_WRITER_DISABLED'});assert.equal(called,false);
});
test('isolated QA requires a single DB, disabled profiles and disabled background workers',()=>{
 const qa={...env,ONPREM_DB_NAME:t.QA},record={...row,DbName:t.QA};
 assert.throws(()=>t.validateTarget(record,qa),{code:'ND_REHEARSAL_ISOLATION_REQUIRED'});
 assert.equal(t.validateTarget(record,{...qa,ONPREM_SWITCHABLE_DATABASES:t.QA,ONPREM_CONNECTION_PROFILES_DISABLE:'true',DISABLE_BACKGROUND_WORKERS:'true'}).simulation,true);
});
