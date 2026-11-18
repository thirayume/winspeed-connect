'use strict';const test=require('node:test');const assert=require('node:assert/strict');const h=require('./helpers/route-harness.cjs');let grant=null,audits=[],fail=false;
const db=h.installDbStub(({kind,text,inputs})=>{
 if(/COL_LENGTH\('wf\.ChangeEvent'/.test(text))return [{HasCol:1}];
 if(/FROM dbo\.EMCust/.test(text))return [{CustID:'1',CustName:'A'},{CustID:'2',CustName:'B'}];
 if(/SELECT \* FROM wf\.CouponBeneficiary/.test(text))return grant?[grant]:[];
 if(/FROM wf\.CouponBeneficiary WITH/.test(text))return [];
 if(/INSERT INTO wf\.CouponBeneficiary/.test(text)){assert.equal(kind,'tx');grant={Id:5,OwnerCustId:'1',BeneficiaryCustId:'2',Status:'ACTIVE'};return [{Id:5}];}
 if(/UPDATE wf\.CouponBeneficiary/.test(text)){assert.equal(kind,'tx');grant.Status='REVOKED';return {rowsAffected:[1]};}
 if(/UPDATE wf\.CouponReservation/.test(text)){assert.equal(kind,'tx');return [{Id:22},{Id:23}];}
 if(/INSERT INTO wf\.ChangeEvent/.test(text)){assert.equal(kind,'tx');if(fail)throw Error('AUDIT_FAILED');audits.push(inputs);return {rowsAffected:[1]};}
 return [];
});
let isolation;
db.stub.wfTransaction=async(fn,options)=>{isolation=options?.isolationLevel;const old=structuredClone({grant,audits});try{return await fn(db.tx);}catch(e){grant=old.grant;audits=old.audits;throw e;}};
const svc=require('../services/coupon-service');const {runWithUser}=require('../services/request-context');const user={sub:4,actorSub:8,isImpersonating:true};
test('beneficiary grant rolls back on audit failure and records actor and effective',async()=>{grant=null;audits=[];fail=true;const run=()=>runWithUser(user,()=>svc.grantBeneficiary({ownerCustId:'1',beneficiaryCustId:'2',reason:'test reason',userId:4}));await assert.rejects(run(),/AUDIT_FAILED/);assert.equal(grant,null);fail=false;await run();assert.equal(grant.Status,'ACTIVE');assert.equal(audits[0].action,'GRANT');assert.equal(audits[0].actorUserId,'8');});
test('beneficiary revoke rolls back on audit failure and records affected reservation IDs',async()=>{grant={Id:5,OwnerCustId:'1',BeneficiaryCustId:'2',Status:'ACTIVE'};audits=[];fail=true;const run=()=>runWithUser(user,()=>svc.revokeBeneficiary(5,'test reason',4));await assert.rejects(run(),/AUDIT_FAILED/);assert.equal(grant.Status,'ACTIVE');fail=false;const r=await run();assert.equal(r.cancelledUnattachedReservations,2);assert.deepEqual(JSON.parse(audits[0].afterJson).cancelledReservationIds,[22,23]);assert.equal(audits[0].actorUserId,'8');
 const cancel=db.calls.find(c=>c.text.includes('DECLARE @cancelled TABLE'));
 assert.ok(cancel);assert.doesNotMatch(cancel.text,/NOLOCK/);
 for(const alias of ['sol','so','hd'])assert.match(cancel.text,new RegExp(`${alias} WITH \\(UPDLOCK, HOLDLOCK\\)`));
 assert.match(cancel.text,/ISNULL\(so\.Status, ''\) NOT IN/);
 assert.match(cancel.text,/ISNULL\(hd\.DocuStatus, ''\) NOT IN/);
 assert.match(cancel.text,/so\.Id IS NULL AND hd\.SOID IS NULL/);
 assert.equal(isolation,db.stub.sql.ISOLATION_LEVEL.SERIALIZABLE);
});
