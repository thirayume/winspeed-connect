'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const h=require('./helpers/route-harness.cjs');
let user,policy,audits,failAudit,withContext;
const authPath=require.resolve('../middleware/auth');
require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{requireAuth:(req,_res,next)=>{req.user=user;if(withContext)require('../services/request-context').runWithUser(user,next);else next();},requireRole:()=> (_req,_res,next)=>next()}};
const db=h.installDbStub(({kind,text,inputs})=>{
 if(/COL_LENGTH\('wf\.ChangeEvent'/.test(text))return [{HasCol:1}];
 if(/INSERT INTO wf\.ApprovalPolicy/.test(text)){assert.equal(kind,'tx');policy={Id:7,CaseType:inputs.c,RequiredRole:inputs.role,CreatedBy:inputs.uid,IsActive:1};return [{Id:7}];}
 if(/SELECT \* FROM wf\.ApprovalPolicy/.test(text)){assert.equal(kind,'tx');return policy&&inputs.id===policy.Id?[{...policy}]:[];}
 if(/UPDATE wf\.ApprovalPolicy SET/.test(text)){assert.equal(kind,'tx');if(!policy||inputs.id!==policy.Id)return {rowsAffected:[0]};if(/IsActive = 0/.test(text))policy.IsActive=0;else if(inputs.role)policy.RequiredRole=inputs.role;return {rowsAffected:[1]};}
 if(/INSERT INTO wf\.ChangeEvent/.test(text)){assert.equal(kind,'tx');if(failAudit)throw Error('AUDIT_FAILED');audits.push({...inputs});return {rowsAffected:[1]};}
 return [];
});
db.stub.wfTransaction=async fn=>{const before=structuredClone({policy,audits});try{return await fn(db.tx);}catch(e){policy=before.policy;audits=before.audits;throw e;}};
let app;
test.before(async()=>{app=await h.startApp([['/api/policy','../../routes/policy']]);});
test.after(async()=>app.close());
test.beforeEach(()=>{user={sub:8,actorSub:63,role:'ADMIN',isImpersonating:true,identityMapping:{primaryEffectiveUserId:8,primaryActorUserId:63,businessEffectiveUserId:17,businessActorUserId:31}};policy={Id:7,CaseType:'TEST',RequiredRole:'SALES',IsActive:1};audits=[];failAudit=false;withContext=true;});
for(const [method,url,body] of [['POST','/api/policy',{caseType:'TEST',requiredRole:'MANAGER'}],['PUT','/api/policy/7',{requiredRole:'MANAGER'}],['DELETE','/api/policy/7',{}]])
 test(`${method} approval policy audit is atomic with actor and effective IDs`,async()=>{
  const before=structuredClone(policy);failAudit=true;
  assert.equal((await app.call(method,url,{body})).status,500);assert.deepEqual(policy,before);assert.deepEqual(audits,[]);
  failAudit=false;assert.equal((await app.call(method,url,{body})).status,200);
  assert.equal(audits.length,1);assert.equal(audits[0].userId,'17');assert.equal(audits[0].actorUserId,'31');
 });
for(const [method,url,body] of [['POST','/api/policy',{caseType:'TEST',requiredRole:'MANAGER'}],['PUT','/api/policy/7',{requiredRole:'MANAGER'}],['DELETE','/api/policy/7',{}]])
 test(`${method} policy rolls back when actor context is missing`,async()=>{
  const before=structuredClone(policy);withContext=false;
  assert.equal((await app.call(method,url,{body})).status,503);assert.deepEqual(policy,before);assert.deepEqual(audits,[]);
 });
