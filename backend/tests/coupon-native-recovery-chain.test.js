'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validateRecoveryChain}=require('../services/coupon-native-recovery-chain');
const fixture=()=>({
 line:{id:'100',reservationId:'200',couponId:'300',authorizedQty:'0.6000'},
 evidence:{authorizationLineId:'100',nativeRedemptionId:'400',state:'APPLIED',balanceBefore:'1.0000',balanceAfter:'0.4000'},
 settlement:{id:'500',reservationId:'200',couponId:'300',nativeRedemptionId:'400',settledQty:'0.6000'},
 history:[{id:'600',authorizationLineId:'100',settlementId:'500',auditEventId:'800',recoveryKey:'test-1',settledBefore:'0.6000',settledAfter:'0.4000',restoredQty:'0.2000',nativeBefore:'0.4000',nativeAfter:'0.6000'},
 {id:'601',authorizationLineId:'100',settlementId:'500',auditEventId:'801',recoveryKey:'test-2',settledBefore:'0.4000',settledAfter:'0.1000',restoredQty:'0.3000',nativeBefore:'0.3000',nativeAfter:'0.6000'}],
});
test('consecutive partial returns produce exact net settlement without assuming consecutive native balances',()=>{
 assert.deepEqual(validateRecoveryChain(fixture()),{settledQty:'0.1000',returnedQty:'0.5000',requiresAtomicProof:true});
 const f=fixture();f.history=[];assert.deepEqual(validateRecoveryChain(f),{settledQty:'0.6000',returnedQty:'0.0000',requiresAtomicProof:true});
});
test('rejects mismatched settlement, authorization, coupon and native source identities',()=>{
 for(const mutate of [f=>f.evidence.authorizationLineId='101',f=>f.evidence.nativeRedemptionId='401',
  f=>f.settlement.reservationId='201',f=>f.settlement.couponId='301',f=>f.history[0].settlementId='501',
  f=>f.history[0].authorizationLineId='101',f=>f.evidence.state='PREPARED',f=>f.line.authorizedQty='0.5000']) {
  const f=fixture();mutate(f);assert.throws(()=>validateRecoveryChain(f),{code:'RECOVERY_CHAIN_INVALID'});
 }
});
test('rejects replay, gaps, reversed order and invalid audit or balance changes',()=>{
 for(const mutate of [f=>f.history[1].recoveryKey=f.history[0].recoveryKey,
  f=>f.history[1].auditEventId=f.history[0].auditEventId,f=>f.history[1].id=f.history[0].id,
  f=>f.history[1].settledBefore='0.5000',f=>f.history[0].nativeAfter='0.5000',
  f=>f.history[0].restoredQty='0.1000',f=>f.history[0].settledAfter='0.6000',
  f=>f.history[0].auditEventId=0,f=>f.history[0].nativeBefore=0.4,
  f=>f.evidence.balanceAfter='0.5000']) {
  const f=fixture();mutate(f);assert.throws(()=>validateRecoveryChain(f),{code:'RECOVERY_CHAIN_INVALID'});
 }
});
