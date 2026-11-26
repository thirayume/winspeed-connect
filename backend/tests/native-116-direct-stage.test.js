'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const schema=require('../services/coupon-bridge-schema'),metadata=require('./helpers/coupon-bridge-metadata');
const {assertRecoveryReadiness}=require('../services/coupon-recovery-readiness');
test('native staging requires both ledgers, visible tables and explicit reader permissions',()=>{
 assert.equal(schema.directAvailable(metadata.absent),false);assert.equal(schema.directAvailable(metadata.current),false);assert.equal(schema.directAvailable(metadata.direct),true);
 for(const row of [{},{...metadata.direct,NativeStageLedger:0},{...metadata.direct,NativeAdmissionLedger:0},{...metadata.direct,NativeStageVisible:0},
  {...metadata.direct,NativeIdRangeLedger:0},{...metadata.direct,NativeSetOptionsLedger:0},{...metadata.direct,NativeStageSelect:0},{...metadata.direct,NativeStageCouponSelect:null},{...metadata.direct,NativeStageReceiptSelect:undefined},{...metadata.direct,BridgeView:0}])
  assert.throws(()=>schema.directAvailable(row),{code:'COUPON_BRIDGE_SCHEMA_UNAVAILABLE',status:503});
});
function fixture(pending=false){
 const calls=[];
 return {calls,q:async text=>{calls.push(text);
  if(text.includes('COUPON_RECOVERY_READINESS_V1'))return {recordset:[{...metadata.direct,RecoverySchemaState:'COUPON_RECOVERY_READINESS_V1',Ledger231:1,RecoveryVisible:1,RecoverySelect:1,Ledger232:1,EditHoldVisible:1,EditHoldSelect:1}]};
  if(text.includes('COUPON_RELEASE_SCHEMA_V1'))return {recordset:[{ReleaseSchemaState:'COUPON_RELEASE_SCHEMA_V1',Ledger236:1,ViewVisible:1,ViewSelect:1,ReleaseSelect:1}]};
  if(text.includes('FROM wf.Native116Contract'))return {recordset:[{Enabled:1,HooksReady:1}]};
  if(text.includes('AS PendingNative116')&&pending)return {recordset:[{PendingNative116:1,PrivateValue:'QA private operator'}]};
  return {recordset:[]};
 }};
}
test('an unfinished native save blocks reads and reservation arithmetic without expiry or cutoff shortcuts',async()=>{
 const f=fixture(true);await assert.rejects(assertRecoveryReadiness(f.q),e=>e.code==='COUPON_NATIVE116_PENDING_REVIEW'&&e.status===409&&!e.message.includes('QA private'));
 const query=f.calls.find(q=>q.includes('AS PendingNative116'));assert.match(query,/WITH\(HOLDLOCK\)/);assert.doesNotMatch(query,/ExpiresAt|DocuDate|CreatedAt|CouponId|UserId/i);
 assert.ok(!f.calls.some(q=>q.includes('AS RecoveryExists')));
 const ready=fixture(false);assert.equal(await assertRecoveryReadiness(ready.q),'wf.CouponBridgeEffectiveSettlement');
});
test('a native SQL fence rolls back and reports typed 409 even without the lock-timeout option',async()=>{
 const {runTransaction,nativeStageConflict}=require('../services/transaction-execution');const log=[];
 const sqlError=Object.assign(Error('server aborted'),{number:3609,precedingErrors:[{number:50000,message:'NATIVE_116_COUPON_PENDING_REVIEW'}]});
 const tx={commit:async()=>log.push('COMMIT'),rollback:async()=>log.push('ROLLBACK')};
 await assert.rejects(runTransaction(tx,async()=>{throw sqlError;},()=>log.push('CLEANED')),e=>e.status===409&&e.code==='COUPON_NATIVE116_PENDING_REVIEW'&&e.originalError===sqlError);
 assert.deepEqual(log,['ROLLBACK','CLEANED']);
 assert.equal(nativeStageConflict(Object.assign(Error('NATIVE_116_COUPON_PENDING_REVIEW'),{number:547})),false);
 assert.equal(nativeStageConflict(Object.assign(Error('arbitrary error'),{number:50000})),false);
});
test('candidate native hooks preserve every native definition and explicitly pin admission/capture order',()=>{
 const hooks=require('../services/native-116-direct-hooks'),baseline=require('../services/native-document-metadata.json').triggers;
 const result=hooks.expectedTriggers(baseline);assert.equal(result.length,baseline.length+1);
 for(const row of baseline)if(!hooks.definitions.some(d=>d.name.toLowerCase()===row[1]))assert.deepEqual(result.find(r=>r[0]===row[0]&&r[1]===row[1]),row);
 assert.deepEqual(hooks.orders,[{name:'WF_CouponNativeEditHeadHook',event:'DELETE',order:'First'},{name:'WF_Native116AuditHook',event:'INSERT',order:'Last'}]);
 assert.match(hooks.moduleHash,/^[a-f0-9]{64}$/);
});
