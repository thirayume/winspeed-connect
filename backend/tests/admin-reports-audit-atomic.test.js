'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
const user={sub:8,actorSub:17,username:'effective-test',role:'ADMIN',actorRole:'ADMIN',isImpersonating:true,identityMapping:{primaryEffectiveUserId:8,primaryActorUserId:17,businessEffectiveUserId:28,businessActorUserId:37}};
let withContext=true,column=true,lockResult=0,failAudit=false,state;
const auth=require.resolve('../middleware/auth');require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{requireAuth:(req,_res,next)=>{req.user=user;if(withContext)require('../services/request-context').runWithUser(user,next);else next();},requireCapability:()=>((_req,_res,next)=>next())}};
const db=h.installDbStub(({kind,text,inputs})=>{
 if(text.includes('sp_getapplock')){assert.equal(kind,'tx');assert.match(text,/@Resource=@resource/);assert.match(text,/@LockTimeout=10000/);state.lockResource=inputs.resource;return [{LockResult:lockResult}];}
 if(text.includes('SELECT HeaderId FROM wf.ReportHeaderMaster'))return [];
 if(text.includes('INSERT INTO wf.ReportHeaderMaster')){assert.equal(kind,'tx');state.writes++;return [{HeaderId:14,HeaderCode:'TEST',Version:1}];}
 if(text.includes('SELECT TemplateId, IsActive FROM wf.ReportTemplate'))return [{TemplateId:2,IsActive:true}];
 if(text.includes('SELECT * FROM wf.ReportTemplateAssignment'))return [];
 if(text.includes('INSERT INTO wf.ReportTemplateAssignment')){state.writes++;return [{ReportKey:'test',TemplateId:2}];}
 if(text.includes('INSERT INTO wf.ChangeEvent')){assert.equal(kind,'tx');if(failAudit)throw Error('TEST_AUDIT_FAILED');state.events.push(inputs);return {rowsAffected:[1]};}
 if(text.includes('FROM wf.ChangeEvent WITH')){assert.match(text,/ActorUserId/);return [];}
 return [];
});
db.stub.wfTransaction=async fn=>{const old=structuredClone(state);try{return await fn(db.tx);}catch(e){state=old;throw e;}};
const ctxPath=require.resolve('../services/request-context'),ctx=require('../services/request-context');require.cache[ctxPath].exports={...ctx,hasColumn:async()=>column};
let app;test.before(async()=>{app=await h.startApp([['/api/admin/reports','../../routes/admin-reports']]);});test.after(async()=>app.close());
test.beforeEach(()=>{state={writes:0,events:[],lockResource:null};column=true;withContext=true;lockResult=0;failAudit=false;});
const header={headerCode:'TEST',headerName:'Test',companyNameTh:'Test',addressTh:'Test',taxId:'TEST',reason:'Test'};
test('report header audit uses mapped identities and audit failure rolls back',async()=>{
 failAudit=true;let r=await app.call('POST','/api/admin/reports/headers',{body:header});assert.equal(r.status,500);assert.equal(state.writes,0);
 failAudit=false;r=await app.call('POST','/api/admin/reports/headers',{body:header});assert.equal(r.status,201);assert.equal(state.writes,1);assert.equal(state.events[0].userId,'28');assert.equal(state.events[0].actorUserId,'37');
});
test('Access As fails closed before write when actor context or audit column is missing',async()=>{
 withContext=false;let r=await app.call('POST','/api/admin/reports/headers',{body:header});assert.equal(r.status,503);assert.equal(state.writes,0);
 withContext=true;column=false;r=await app.call('POST','/api/admin/reports/headers',{body:header});assert.equal(r.status,503);assert.equal(state.writes,0);
});
test('assignment refuses a failed application lock before write',async()=>{
 lockResult=-1;let r=await app.call('PUT','/api/admin/reports/assignments/test',{body:{templateId:2,reason:'test'}});assert.equal(r.status,409);assert.equal(state.writes,0);
 lockResult=0;r=await app.call('PUT','/api/admin/reports/assignments/test',{body:{templateId:2,reason:'test'}});assert.equal(r.status,200);assert.equal(state.writes,1);assert.equal(state.lockResource,'ReportAssignment_test');assert.equal(state.events[0].userId,'28');assert.equal(state.events[0].actorUserId,'37');
});
test('audit history includes actor column when available',async()=>{const r=await app.call('GET','/api/admin/reports/audit');assert.equal(r.status,200);});
