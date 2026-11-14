'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const h=require('./helpers/route-harness.cjs');
let rows=[],audits=[],fail=false;
const db=h.installDbStub(({kind,text,inputs})=>{
 if(/COL_LENGTH\('wf\.ChangeEvent'/.test(text))return [{HasCol:1}];
 if(/SELECT CouponID FROM dbo\.WFCoupon/.test(text))return [{CouponID:12}];
 if(/FROM wf\.CouponExpiry WITH \(UPDLOCK,HOLDLOCK\)/.test(text))return rows;
 if(/INSERT INTO wf\.CouponExpiry/.test(text)){assert.equal(kind,'tx');rows=[{CouponId:12,ExpiryDate:inputs.exp}];return {rowsAffected:[1]};}
 if(/UPDATE wf\.CouponExpiry/.test(text)){assert.equal(kind,'tx');rows=[{CouponId:12,ExpiryDate:inputs.exp}];return {rowsAffected:[1]};}
 if(/INSERT INTO wf\.ChangeEvent/.test(text)){assert.equal(kind,'tx');if(fail)throw Error('AUDIT_FAILED');audits.push(inputs);return {rowsAffected:[1]};}
 if(/FROM wf\.CouponExpiry WITH \(NOLOCK\)/.test(text))return rows;
 if(/FROM dbo\.WFCoupon c/.test(text))return [{CouponID:12,CouponNo:'TEST',SourceDocuDate:new Date('2026-01-01')}];
 return [];
});
db.stub.wfTransaction=async fn=>{const old=structuredClone({rows,audits});try{return await fn(db.tx);}catch(e){rows=old.rows;audits=old.audits;throw e;}};
const service=require('../services/coupon-service');const {runWithUser}=require('../services/request-context');
test('expiry and audit roll back together and record real actor during Access As',async()=>{
 rows=[];audits=[];fail=true;const user={sub:4,actorSub:8,isImpersonating:true};
 await assert.rejects(runWithUser(user,()=>service.updateCouponExpiry(12,'2027-01-01',4,'test')),/AUDIT_FAILED/);
 assert.equal(rows.length,0);assert.equal(audits.length,0);fail=false;
 const result=await runWithUser(user,()=>service.updateCouponExpiry(12,'2027-01-01',4,'test'));
 assert.ok(result);assert.equal(rows.length,1);assert.equal(audits.length,1);assert.equal(audits[0].userId,'4');assert.equal(audits[0].actorUserId,'8');
});
test('updating expiry records the previous expiry in the same transaction',async()=>{
 rows=[{CouponId:12,ExpiryDate:new Date('2026-12-31')}];audits=[];fail=false;
 await runWithUser({sub:4},()=>service.updateCouponExpiry(12,'2027-01-01',4));
 assert.equal(audits[0].action,'UPDATE');assert.ok(JSON.parse(audits[0].beforeJson).ExpiryDate);
});
