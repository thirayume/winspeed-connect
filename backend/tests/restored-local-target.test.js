'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validateLocalTargetRecord,validateTargetRecord}=require('../safety-validator');
const {requestTarget}=require('../db-target-policy');
const row={serverName:'AMYOU-YOGA7\\V2008R2',dbName:'dbwins_worldfert9',loginName:'wf_uat_app',originalLogin:'wf_uat_app',productVersion:'10.50.4042.0',netTransport:'Shared memory',isSysadmin:0,isSecurityadmin:0,isServeradmin:0,isDbcreator:0,hasControlServer:0,hasProdAccess:1,prodAccess:1,otherUserDbCount:0};
const env={ALLOW_RESTORED_LOCAL_UAT:'true',COUPON_NATIVE_POSTING_ENABLED:'false'};
test('original local database requires explicit opt-in and exact safe identity',()=>{
 assert.throws(()=>validateLocalTargetRecord(row,{}));
 assert.doesNotThrow(()=>validateLocalTargetRecord(row,env,{operation:'runtime'}));
 for(const change of [{serverName:'other\\V2008R2'},{netTransport:'TCP'},{productVersion:'16.0.1'},{loginName:'sa'},{originalLogin:'sa'},{otherUserDbCount:1},{isSysadmin:1},{hasProdAccess:0},{hasProdAccess:null},{dbName:'dbwins_worldfert9_local_uat'}]) assert.throws(()=>validateLocalTargetRecord({...row,...change},env,{operation:'runtime'}));
 assert.throws(()=>validateTargetRecord(row,env));
 assert.throws(()=>validateLocalTargetRecord(row,env,{targetType:'rehearsal'}));
});
test('local-only forbids target switching even in development',()=>{
 const previous=process.env.LOCAL_ONLY_MODE;process.env.LOCAL_ONLY_MODE='true';
 try{assert.equal(requestTarget(undefined,'local_uat',false),'local_uat');for(const t of ['remote','remote_b','local','local_rehearsal'])assert.throws(()=>requestTarget(t,'local_uat',false));assert.throws(()=>requestTarget(undefined,'remote_b',false));}
 finally{if(previous===undefined)delete process.env.LOCAL_ONLY_MODE;else process.env.LOCAL_ONLY_MODE=previous;}
});

test('072 override preserves rollback and numbered error without changing native artifact',()=>{
 const fs=require('fs'),path=require('path');
 const native=fs.readFileSync(path.join(__dirname,'../migrations/072_fix_winspeed_approval.sql'),'utf8');
 const compat=fs.readFileSync(path.join(__dirname,'../migrations/compat/sql2008/072_fix_winspeed_approval.sql'),'utf8');
 assert.match(native,/THROW;/);assert.doesNotMatch(compat,/THROW;/);
 assert.match(compat,/ROLLBACK TRANSACTION/);assert.match(compat,/ERROR_NUMBER\(\)/);assert.match(compat,/RAISERROR/);
});

test('app runtime refuses migrator login and migrator operation requires migrator login', () => {
 const migratorRow = { ...row, loginName: 'wf_uat_migrator', originalLogin: 'wf_uat_migrator' };
 assert.throws(
   () => validateLocalTargetRecord(migratorRow, env, { operation: 'runtime' }),
   /Application runtime requires app principal "wf_uat_app", but active principal is "wf_uat_migrator"!/
 );
 assert.doesNotThrow(() => validateLocalTargetRecord(migratorRow, env, { operation: 'migrator' }));
 assert.throws(
   () => validateLocalTargetRecord(row, env, { operation: 'migrator' }),
   /Migration runner requires migrator principal "wf_uat_migrator", but active principal is "wf_uat_app"!/
 );
});

