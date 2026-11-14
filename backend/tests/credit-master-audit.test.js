'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const h=require('./helpers/route-harness.cjs');
const fs=require('node:fs');
const path=require('node:path');
const auth=require.resolve('../middleware/auth');
let currentUser,credit,ext,audits,failAudit,missing,windowUnavailable;
require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{
 requireAuth:(req,_res,next)=>{req.user=currentUser;next();},requireRole:()=> (_req,_res,next)=>next(),
}};
const db=h.installDbStub(({kind,text,inputs})=>{
 if(/FROM dbo\.EMCust WHERE CustID = @c/.test(text))return missing?[]:[{ok:1}];
 if(/SELECT CustName, CreditLimit, CreditHold, AgingDays, Note FROM wf\.CreditMaster/.test(text))return credit?[{...credit}]:[];
 if(/MERGE wf\.CreditMaster/.test(text)){assert.equal(kind,'tx');credit={CreditLimit:inputs.lim,CreditHold:inputs.hold,AgingDays:inputs.hasAging?inputs.aging:credit?.AgingDays??null};return {rowsAffected:[1]};}
 if(/IF OBJECT_ID\('wf\.CustomerExt'/.test(text)){assert.equal(kind,'tx');ext={CreditLimit:inputs.lim,AgingDays:inputs.hasAging?inputs.aging:ext?.AgingDays??null};return {rowsAffected:[1]};}
 if(/INSERT INTO wf\.CreditMasterAudit/.test(text)){assert.equal(kind,'tx');if(failAudit)throw Error('simulated audit failure');audits.push({...inputs});return {rowsAffected:[1]};}
 if(/FROM wf\.CreditMasterAudit/.test(text))return [{Id:2,CreatedAt:new Date('2025-12-31T17:00:00Z')},{Id:1,CreatedAt:new Date('2025-12-31T16:59:59Z')}].filter(v=>v.CreatedAt>=inputs.globalStartUtc);
 return [];
});
db.stub.wfTransaction=async fn=>{const before=structuredClone({credit,ext,audits});try{return await fn(db.tx);}catch(e){credit=before.credit;ext=before.ext;audits=before.audits;throw e;}};
const windowPath=require.resolve('../services/global-data-window-store');
require.cache[windowPath].exports.readGlobalDataWindow=async()=>{if(windowUnavailable)throw Error('missing');return require('../services/data-window').boundaries('2026-01-01');};
let app;
test.before(async()=>{app=await h.startApp([['/api/credit','../../routes/credit']]);});
test.after(async()=>app.close());
test.beforeEach(()=>{currentUser={sub:22,actorSub:17,role:'ADMIN',isImpersonating:true,identityMapping:{primaryEffectiveUserId:22,primaryActorUserId:17,businessEffectiveUserId:34,businessActorUserId:47}};credit={CreditLimit:100,CreditHold:0,AgingDays:60};ext={CreditLimit:100,AgingDays:60};audits=[];failAudit=false;missing=false;windowUnavailable=false;db.calls.length=0;});
test('credit, customer extension and both identities are committed together',async()=>{
 const r=await app.call('PUT','/api/credit/123',{body:{creditLimit:150,creditHold:true,agingDays:45}});
 assert.equal(r.status,200);assert.equal(credit.CreditLimit,150);assert.equal(ext.CreditLimit,150);
 assert.equal(audits.length,1);assert.deepEqual([audits[0].actorPrimary,audits[0].effectivePrimary,audits[0].actorBusiness,audits[0].effectiveBusiness],[17,22,47,34]);
 assert.equal(JSON.parse(audits[0].before).CreditLimit,100);assert.equal(JSON.parse(audits[0].after).CreditLimit,150);
});
test('an audit failure rolls back the credit and extension',async()=>{
 failAudit=true;const r=await app.call('PUT','/api/credit/123',{body:{creditLimit:150,creditHold:true}});
 assert.equal(r.status,500);assert.equal(credit.CreditLimit,100);assert.equal(ext.CreditLimit,100);assert.deepEqual(audits,[]);
});
test('missing customer or invalid reviewed binding never writes',async()=>{
 missing=true;assert.equal((await app.call('PUT','/api/credit/123',{body:{creditLimit:150}})).status,404);
 assert.equal(credit.CreditLimit,100);assert.deepEqual(audits,[]);db.calls.length=0;
 missing=false;currentUser.identityMapping.primaryActorUserId=999;
 assert.equal((await app.call('PUT','/api/credit/123',{body:{creditLimit:150}})).status,409);assert.equal(db.calls.length,0);
});
test('history hides pre-cutoff changes and fails closed if cutoff unavailable',async()=>{
 const r=await app.call('GET','/api/credit/123/history');assert.equal(r.status,200);assert.deepEqual(r.body.map(x=>x.Id),[2]);
 const call=db.calls.find(c=>/FROM wf\.CreditMasterAudit/.test(c.text));assert.equal(call.inputs.globalStartUtc.toISOString(),'2025-12-31T17:00:00.000Z');
 db.calls.length=0;windowUnavailable=true;assert.equal((await app.call('GET','/api/credit/123/history')).status,503);assert.equal(db.calls.length,0);
});
test('credit audit migration is idempotent and compatible with SQL Server 2008',()=>{
 const migration=fs.readFileSync(path.join(__dirname,'../migrations/211_credit_master_audit.sql'),'utf8');
 assert.match(migration,/IF OBJECT_ID\('wf\.CreditMasterAudit','U'\) IS NULL/);
 assert.doesNotMatch(migration,/\bdbo\.|\bTHROW\b|CREATE\s+OR\s+ALTER|\bIIF\s*\(/i);
 const {splitBatches}=require('../run_migrations');const {assertNoCrossDbWrite}=require('../safety-validator');
 for(const batch of splitBatches(migration))assert.doesNotThrow(()=>assertNoCrossDbWrite(batch));
});
