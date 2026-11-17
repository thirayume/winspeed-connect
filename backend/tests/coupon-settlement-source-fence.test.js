'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const h=require('./helpers/route-harness.cjs');
let conflict=false,recovery=false;
const db=h.installDbStub(({text})=>/AS SourceConflict/.test(text)&&conflict?[{SourceConflict:1}]:
  /AS RecoveryExists/.test(text)&&recovery?[{RecoveryExists:1}]:[],
  {nativeRecoverySchema:()=>recovery?{RecoverySchemaState:'COUPON_RECOVERY_READINESS_V1',Ledger232:0,EditHoldVisible:0,Ledger231:1,RecoveryVisible:1,RecoverySelect:1,SchemaSelect:1}:{RecoverySchemaState:'COUPON_RECOVERY_READINESS_V1',Ledger232:0,EditHoldVisible:0,Ledger231:0,RecoveryVisible:0,SchemaSelect:1}});
const {assertSettledSourcesUnchanged}=require('../services/coupon-settlement-source-fence');
test.beforeEach(()=>{conflict=false;recovery=false;db.calls.length=0;});
test('checks every historical settlement under locks and scopes by coupon',async()=>{
 await assertSettledSourcesUnchanged(db.tx,42);
 const call=db.calls.find(c=>c.text.includes('AS SourceConflict'));
 assert.equal(call.inputs.cid,42);
 assert.match(call.text,/wf\.CouponReservationSettlement s WITH \(HOLDLOCK\)/);
 assert.match(call.text,/WFRedemtionHD h WITH \(HOLDLOCK\)/);
 assert.match(call.text,/WFRedemtionDT d WITH \(HOLDLOCK\)/);
 assert.match(call.text,/ISNULL\(LTRIM\(RTRIM\(h\.DocuStatus\)\),''\) NOT IN \('N','Y'\)/);
 assert.match(call.text,/nativeLine\.LineCount<>1/);
 assert.match(call.text,/nativeLine\.NativeQty<settled\.SettledQty/);
 assert.doesNotMatch(call.text,/globalStart|DocuDate/);
});
test('source guard stops before legacy settlement arithmetic when any recovery exists',async()=>{
 recovery=true;
 await assert.rejects(assertSettledSourcesUnchanged(db.tx,42),{code:'COUPON_RECOVERY_REVIEW_REQUIRED'});
 assert.ok(!db.calls.some(c=>c.text.includes('AS SourceConflict')));
});
test('a changed source fails closed; invalid IDs never query',async()=>{
 conflict=true;
 await assert.rejects(assertSettledSourcesUnchanged(db.tx,42),{code:'COUPON_SETTLEMENT_SOURCE_CHANGED',status:409});
 const before=db.calls.length;
 for(const id of [0,-1,1.5,NaN,2147483648])await assert.rejects(assertSettledSourcesUnchanged(db.tx,id),{code:'COUPON_ID_INVALID'});
 assert.equal(db.calls.length,before);
});
