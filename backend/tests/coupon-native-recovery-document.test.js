'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {planDocumentRecovery}=require('../services/coupon-native-recovery-document');
function fixture(){return {
 beforeLines:[{couponId:'1',qty:'0.1000'},{couponId:'2',qty:'0.1000'}],
 afterLines:[{couponId:'1',qty:'0.0500'},{couponId:'2',qty:'0.1000'}],
 links:['1','2'].map(couponId=>({couponId,originalSettledQty:'0.1000',previouslyReturnedQty:'0.0000',
  reservedQty:'0.1000',consumedQty:'0.1000',reservationStatus:'CONSUMED',
  evidenceBalanceBefore:'0.5000',evidenceBalanceAfter:'0.4000'})),
};}
test('document edit only returns the changed coupon despite native intermediate unwind of both',()=>{
 const plan=planDocumentRecovery(fixture());assert.equal(plan.requiresAtomicProof,true);
 assert.equal(plan.lines[0].pendingReturnQty,'0.0500');assert.equal(plan.lines[0].expectedNativeNetIncrease,'0.0500');
 assert.equal(plan.lines[1].pendingReturnQty,'0.0000');assert.equal(plan.lines[1].expectedNativeNetIncrease,'0.0000');
});
test('document deletion plans each outstanding line exactly once',()=>{
 const f=fixture();f.afterLines=[];const plan=planDocumentRecovery(f);
 assert.deepEqual(plan.lines.map(x=>x.pendingReturnQty),['0.1000','0.1000']);
});
test('duplicate, missing, added, increased or stale source lines fail closed',()=>{
 const scenarios=[
  [f=>f.beforeLines.push({...f.beforeLines[0]}),'RECOVERY_DOCUMENT_INVALID'],
  [f=>f.afterLines.push({...f.afterLines[0]}),'RECOVERY_DOCUMENT_AMBIGUOUS'],
  [f=>f.afterLines.push({couponId:'3',qty:'0.1000'}),'RECOVERY_NEW_AUTHORIZATION_REQUIRED'],
  [f=>f.afterLines[0].qty='0.2000','RECOVERY_NEW_AUTHORIZATION_REQUIRED'],
  [f=>f.links[0].previouslyReturnedQty='0.0100','RECOVERY_DOCUMENT_SOURCE_MISMATCH'],
  [f=>f.beforeLines[0].qty=0.1,'RECOVERY_DOCUMENT_INVALID'],
 ];
 for(const [mutate,code] of scenarios){const f=fixture();mutate(f);assert.throws(()=>planDocumentRecovery(f),{code});}
});
