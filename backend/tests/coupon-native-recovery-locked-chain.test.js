'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadRecoveryChainForUpdate}=require('../services/coupon-native-recovery-locked-chain');
const base={LineId:'100',LineReservationId:'200',LineCouponId:'300',AuthorizedQty:'0.6000',EvidenceLineId:'100',
 EvidenceRedemptionId:'400',EvidenceState:'APPLIED',EvidenceBalanceBefore:'1.0000',EvidenceBalanceAfter:'0.4000',
 SettlementId:'500',SettlementReservationId:'200',SettlementCouponId:'300',SettlementRedemptionId:'400',SettledQty:'0.6000'};
const row={Id:'600',AuthorizationLineId:'100',SettlementId:'500',RecoveryKey:'r1',SettledBefore:'0.6000',
 SettledAfter:'0.4000',RestoredQty:'0.2000',NativeBefore:'0.4000',NativeAfter:'0.6000',AuditEventId:'800',
 EffectiveUserId:'10',ActorUserId:'11',AuditEntityType:'COUPON_RESERVATION',AuditEntityId:'200',AuditAction:'NATIVE_RECOVERY',
 AuditUserId:'10',AuditActorUserId:'11',AuditAfterJson:JSON.stringify({authorizationLineId:'100',settlementId:'500',
 settledBefore:'0.6000',settledAfter:'0.4000',restoredQty:'0.2000',nativeBefore:'0.4000',nativeAfter:'0.6000'})};
function fake({context=[{TransactionCount:1,TransactionState:1}],source=[base],history=[row]}={}) {
 const calls=[];return {calls,tx:{request(){const inputs={};return {input(k,_t,v){inputs[k]=v;return this;},async query(text){
  calls.push({text,inputs});return {recordset:calls.length===1?context:calls.length===2?source:history};
 }}}}};
}
test('loads linked chain under transaction locks without a business-date cutoff',async()=>{
 const f=fake();assert.deepEqual(await loadRecoveryChainForUpdate(f.tx,'500','100'),{settledQty:'0.4000',returnedQty:'0.2000',requiresAtomicProof:true});
 assert.equal(f.calls.length,3);assert.equal(f.calls[1].inputs.sid,'500');assert.equal(f.calls[1].inputs.lid,'100');
 assert.match(f.calls[1].text,/wf\.CouponNativeCutEvidence e WITH \(UPDLOCK,HOLDLOCK\)/);
 assert.match(f.calls[2].text,/r\.SettlementId=CONVERT\(bigint,@sid\) OR r\.AuthorizationLineId=CONVERT\(bigint,@lid\)/);
 assert.doesNotMatch(f.calls[2].text,/DocuDate|cutoff|globalStart/i);
});
test('requires canonical identifiers and an active committable transaction',async()=>{
 for(const [sid,lid] of [['0','100'],['1e2','100'],['9223372036854775808','100'],[500,'100']]) {
  const f=fake();await assert.rejects(loadRecoveryChainForUpdate(f.tx,sid,lid),{code:'RECOVERY_LOCKED_CHAIN_INVALID'});assert.equal(f.calls.length,0);
 }
 for(const context of [[],[{TransactionCount:0,TransactionState:1}],[{TransactionCount:1,TransactionState:-1}]]) {
  const f=fake({context});await assert.rejects(loadRecoveryChainForUpdate(f.tx,'500','100'),{code:'RECOVERY_LOCKED_CHAIN_INVALID'});assert.equal(f.calls.length,1);
 }
});
test('fails closed on absent/ambiguous source and conflicting history links',async()=>{
 for(const source of [[],[base,base]]) {
  const f=fake({source});await assert.rejects(loadRecoveryChainForUpdate(f.tx,'500','100'),{code:'RECOVERY_LOCKED_CHAIN_INVALID'});assert.equal(f.calls.length,2);
 }
 const f=fake({history:[{...row,SettlementId:'501'}]});
 await assert.rejects(loadRecoveryChainForUpdate(f.tx,'500','100'),{code:'RECOVERY_LOCKED_CHAIN_INVALID'});
});
test('rejects missing or mismatched recovery audit and either identity',async()=>{
 for(const change of [{AuditEntityType:null},{AuditEntityId:'201'},{AuditAction:'RECOVER'},
  {AuditUserId:'11'},{AuditActorUserId:'10'},{ActorUserId:'0'},{AuditAfterJson:null},
  {AuditAfterJson:'{'},{AuditAfterJson:JSON.stringify({settlementId:'500'})},
  {AuditAfterJson:row.AuditAfterJson.replace('0.2000','0.3000')}]) {
  const f=fake({history:[{...row,...change}]});
  await assert.rejects(loadRecoveryChainForUpdate(f.tx,'500','100'),{code:'RECOVERY_LOCKED_CHAIN_INVALID'});
 }
});
