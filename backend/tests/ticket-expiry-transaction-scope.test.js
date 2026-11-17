'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
let state,guardAllowed,failAudit,failReconcile,optsSeen;
const db=h.installDbStub(({text,kind})=>{
 if(/FROM dbo\.WFCoupon c WITH \(NOLOCK\)/.test(text))return [{CouponID:42,CouponNo:'D42',DocuID:7,Docutype:104,GoodCode:'FAKE',CustID:1}];
 if(/SELECT \* FROM wf\.ControlTicketOverlay WITH \(UPDLOCK, HOLDLOCK\)/.test(text))return [];
 if(/INSERT INTO wf\.ControlTicketOverlay/.test(text)){assert.equal(kind,'tx');state.overlay++;return [{Id:9}];}
 if(/SELECT DocuNo, ExpiryDate, ExpiryType, StrictOverrideFlag/.test(text)){if(failReconcile)throw Error('ALERT_FAILURE');return [];}
 return [];
});
db.stub.wfTransaction=async(fn,opts)=>{optsSeen=opts;const before=structuredClone(state);try{return await fn(db.tx);}catch(e){state=before;throw e;}};
const path=require.resolve('../services/policy-contract');
require.cache[path]={id:path,filename:path,loaded:true,exports:{
 getEffectivePolicySnapshot:async()=>null,
 validateReasonCode:async()=>({valid:true,reasonCode:'TEST',reasonText:null}),
 logChangeEvent:async()=>{if(failAudit)throw Error('AUDIT_FAILED');state.audit++;},
}};
const {updateTicketExpiryOverlay}=require('../services/ticket-policy');
const base={docuNo:'D42',exactId:42,reasonCode:'TEST',expiryDate:'2027-01-01',userId:34,
 authorizeInTransaction:async(tx,id)=>{assert.equal(tx,db.tx);assert.equal(id,42);if(!guardAllowed)throw Object.assign(Error('SCOPE_REVOKED'),{status:404});}};
test.beforeEach(()=>{state={overlay:0,audit:0};guardAllowed=true;failAudit=false;failReconcile=false;optsSeen=null;});
test('expiry write rechecks authorization in the same serializable transaction before writing',async()=>{
 guardAllowed=false;await assert.rejects(updateTicketExpiryOverlay(base),/SCOPE_REVOKED/);
 assert.deepEqual(state,{overlay:0,audit:0});assert.equal(optsSeen.isolationLevel,db.stub.sql.ISOLATION_LEVEL.SERIALIZABLE);
});
test('audit failure rolls back the overlay and success records one audit',async()=>{
 failAudit=true;await assert.rejects(updateTicketExpiryOverlay(base),/AUDIT_FAILED/);assert.deepEqual(state,{overlay:0,audit:0});
 failAudit=false;const result=await updateTicketExpiryOverlay(base);assert.equal(result.success,true);assert.deepEqual(state,{overlay:1,audit:1});
});
test('alert refresh failure reports the committed expiry update without replaying it',async()=>{
 failReconcile=true;const result=await updateTicketExpiryOverlay(base);
 assert.equal(result.success,true);assert.equal(result.alertsPending,true);assert.deepEqual(state,{overlay:1,audit:1});
});
