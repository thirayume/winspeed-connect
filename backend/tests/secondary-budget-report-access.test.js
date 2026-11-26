'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),jwt=require('jsonwebtoken'),{AsyncLocalStorage}=require('async_hooks'),h=require('./helpers/route-harness.cjs');
const als=new AsyncLocalStorage();let failAudit=false,binding=true,targetActive=true,targetRole=null,targetPermissions=null,primaryRole='ADMIN';const attempts=[];
const caps=require('../services/role-capabilities');
const roleOf=id=>id>=100?(targetRole||primaryRole):primaryRole;
const db=h.installDbStub(({text,inputs})=>{
 const id=Number(inputs.id),role=roleOf(id);
 if(text.includes('INSERT INTO wf.ApiAuditLog')){if(failAudit)throw Error('audit failed');attempts.push({database:als.getStore()?.database,...inputs});return [];}
 if(text.includes('AS PolicySchemaMissing'))return [{Role:role,RoleCode:role,IsActive:id<100||targetActive?1:0,AuthVersion:0}];
 if(text.includes('FROM wf.vUserRole u')){const permissions=id>=100&&targetPermissions!==null?targetPermissions:Object.keys(caps.ACTIONS).filter(k=>caps.hasPermission({role},k));return (permissions.length?permissions:[null]).map(PermissionCode=>({Code:role,BaseRole:role,PermissionCode}));}
 if(text.includes('SELECT Id,EmpId,AuthVersion'))return [{Id:id,EmpId:id+1000,AuthVersion:0,IsActive:targetActive?1:0}];
 if(text.includes('SELECT IsActive FROM wf.AppUser'))return [{IsActive:1}];
 if(text.includes('SELECT Id, Username, DisplayName, Role, RoleCode, AuthVersion'))return [{Id:id,Username:'QA',DisplayName:'QA',Role:role,IsActive:1,AuthVersion:0}];
 if(text.includes('SELECT Id, EmpId, PositionCode'))return [{Id:id,EmpId:id+1000,PositionCode:null}];
 if(text.includes('SELECT p.*'))return [{PlanId:111,PeriodYear:2569,Channel:'ทั่วไป',Title:'QA target',PreparedBy:117,PreparedActorId:117,Status:'DRAFT'}];
 return [];
},{activeUserIds:[17,117]}).stub;
db.getTarget=()=> 'onprem';db.getDbName=()=>als.getStore()?.database||null;db.runWithTarget=(target,fn,database)=>als.run({database},fn);db.runWithDb=(database,fn)=>als.run({database},fn);
const active=require.resolve('../services/active-database');require.cache[active]={id:active,filename:active,loaded:true,exports:{primaryDatabase:()=> 'primary',onpremEnabled:()=>true,systemActiveDatabase:async()=> 'secondary',getDatabaseThemes:async()=>({}),canAccessDatabase:()=>true,DEFAULT_DATABASE_THEMES:{}}};
const resolver=require.resolve('../services/database-identity-resolver');require.cache[resolver]={id:resolver,filename:resolver,loaded:true,exports:{sqlRepository:()=>({}),resolveReviewedActorAndEffective:async a=>{if(!binding)throw Object.assign(Error('invalid'),{code:'IDENTITY_BINDING_INVALID'});return {primaryActorUserId:a.actorUserId,primaryEffectiveUserId:a.effectiveUserId,businessActorUserId:a.actorUserId+100,businessEffectiveUserId:a.effectiveUserId+100,identityServer:'QA',businessServer:'QA'};}}};
const {requireAuth,clearAccountStatusCache}=require('../middleware/auth');const access=require('../services/secondary-budget-report-access');let server,base;
test.before(async()=>{const app=express();app.use(express.json());app.use((req,res,next)=>db.runWithTarget('onprem',next,'secondary'));app.use('/api/reports',require('../routes/reports'));const budget=express.Router();budget.use(requireAuth);budget.use((req,res)=>res.json({ids:require('../services/business-identity').businessIds(req.user),actor:require('../services/request-context').currentActorId(),context:access.context(req.user,'secondary')}));app.use('/api/budget',budget);server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;});
test.after(()=>new Promise(r=>server.close(r)));test.beforeEach(()=>{clearAccountStatusCache();failAudit=false;binding=true;targetActive=true;targetRole=null;targetPermissions=null;primaryRole='ADMIN';attempts.length=0;});
async function call(path,method='GET',body,claims={}){const token=h.token({sub:17,role:primaryRole,...claims});const r=await fetch(base+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
test('reviewed Budget CRUD routes carry translated IDs and a durable primary attempt audit',async()=>{
 for(const [method,path]of [['GET','/plans'],['POST','/plans'],['PUT','/plans/111'],['DELETE','/plans/111'],...['submit','review','approve','reject','cancel','restore'].map(k=>['POST','/plans/111/'+k])]){
  const r=await call('/api/budget'+path,method,method==='GET'?undefined:{expectedDatabase:'secondary'});assert.equal(r.status,200,path);assert.equal(r.body.ids.effective,117);assert.equal(r.body.actor,117);assert.equal(r.body.context.userId,117);const audit=attempts.at(-1);assert.equal(audit.database,'primary');assert.equal(audit.effective,17);assert.equal(audit.businessEffective,117);assert.equal(audit.method,method);
 }
});
test('stale database, missing binding, inactive target and attempt audit failure stop the handler',async()=>{
 assert.equal((await call('/api/budget/plans','POST',{expectedDatabase:'primary'})).status,409);assert.equal(attempts.length,0);
 binding=false;assert.equal((await call('/api/budget/plans')).status,409);binding=true;
 targetActive=false;assert.equal((await call('/api/budget/plans')).status,403);targetActive=true;
 failAudit=true;assert.equal((await call('/api/budget/plans','POST',{expectedDatabase:'secondary'})).status,503);
});
test('report list and financial report require both company roles and all-record scopes',async()=>{
 let r=await call('/api/reports/types');assert.equal(r.status,200);assert.equal(r.body.length,38);
 targetRole='SALES';r=await call('/api/reports/types');assert.equal(r.status,200);assert.ok(r.body.some(v=>v.key==='so-status'));assert.ok(!r.body.some(v=>v.key==='daily-invoice'));assert.equal((await call('/api/reports/daily-invoice/export')).status,403);
 targetRole='ACCOUNTING';targetPermissions=[];assert.equal((await call('/api/reports/costlist_sheet')).status,403);assert.equal((await call('/api/reports/daily-invoice/template')).status,503,'allowed role reaches native template resolution; none is seeded in this fixture');
});
test('different permitted roles retain budget read while target cannot acquire admin create rights',async()=>{
 targetRole='ACCOUNTING';targetPermissions=[];const r=await call('/api/budget/plans');assert.equal(r.status,200);assert.equal(r.body.context.canReadAnnual,true);assert.equal(r.body.context.actions.includes('budget.plan.create'),false);
});
test('both Access As parties need mapping/profiles; effective privilege cannot widen actor report scope',async()=>{
 const r=await call('/api/budget/plans','GET',undefined,{actorSub:8,actorRole:'ADMIN',impersonating:true});assert.equal(r.status,200);assert.equal(r.body.ids.actor,108);assert.equal(attempts.at(-1).actor,8);assert.equal(attempts.at(-1).businessActor,108);
 targetRole='SALES';const reports=await call('/api/reports/types','GET',undefined,{actorSub:8,actorRole:'ADMIN',impersonating:true});assert.equal(reports.status,200);assert.ok(reports.body.some(v=>v.key==='so-status'));assert.ok(!reports.body.some(v=>v.key==='gl-sales-journal'));
});
test('unreviewed methods and routes remain closed and forged JWT authorization is ignored',async()=>{
 for(const [m,p]of [['PUT','/api/reports/catalog-config'],['POST','/api/reports/daily-invoice'],['PATCH','/api/budget/plans/111'],['POST','/api/budget/plans/111/unknown']])assert.equal((await call(p,m,{expectedDatabase:'secondary'})).status,409,p);
 targetRole='SEPARATION';const r=await call('/api/budget/plans','GET',undefined,{secondaryModuleAccess:{users:{17:{id:117,role:'ADMIN'}}}});assert.equal(r.status,401);
});
