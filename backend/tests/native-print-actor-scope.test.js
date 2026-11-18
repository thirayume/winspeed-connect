'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
const user={sub:8,actorSub:17,role:'ACCOUNTING',roles:['ACCOUNTING'],actorRole:'MANAGER',actorRoles:['MANAGER'],isImpersonating:true,identityMapping:{primaryActorUserId:17,primaryEffectiveUserId:8,businessActorUserId:55,businessEffectiveUserId:34}};let items,actorAllowed,logs;
const auth=require.resolve('../middleware/auth');require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{requireAuth:(req,_res,next)=>{req.user=user;next();},requireCapability:()=>((_req,_res,next)=>next())}};
const db=h.installDbStub(({text,inputs})=>{
 if(/FROM dbo\.WFRedemtionHD h/.test(text))return [{RedemtionID:501,DocuNo:'QA123',DocuDate:'2026-01-02'}];
 if(/FROM dbo\.WFRedemtionDT d/.test(text))return items;
 if(/SELECT SOID, SalesUserId FROM wf\.SalesOrderExt/.test(text))return [];
 if(/FROM wf\.NativePrintLog WHERE/.test(text))return [{count:0,lastAt:null}];
 if(/INSERT INTO wf\.NativePrintLog/.test(text)){logs++;return {rowsAffected:[1]};}
 return [];
});
const scope=require.resolve('../services/visible-scope');const original=require(scope);require.cache[scope].exports={...original,getVisibleScope:async u=>{const id=require('../services/business-identity').businessIds(u).effective;return id===34?{all:true,userIds:[],empIds:[]}:{all:actorAllowed,userIds:[],empIds:['7001']};}};
let app;test.before(async()=>{app=await h.startApp([['/api/native-print','../../routes/native-print']]);});test.after(async()=>app.close());test.beforeEach(()=>{items=[{SalesEmpID:7001,BookingSOID:301}];actorAllowed=false;logs=0;db.calls.length=0;});
test('Access As denies mixed-owner 116 if any item is out of the actual actor scope',async()=>{items.push({SalesEmpID:7002,BookingSOID:302});let r=await app.call('GET','/api/native-print/116/QA123');assert.equal(r.status,404);r=await app.call('POST','/api/native-print/116/QA123/printed');assert.equal(r.status,404);assert.equal(logs,0);const calls=db.calls.filter(c=>/SELECT SOID, SalesUserId FROM wf\.SalesOrderExt/.test(c.text));assert.equal(calls.length,2);assert.equal(Object.keys(calls[0].inputs).length,2);});
test('Access As allows 116 when every line belongs to the actor scope',async()=>{items.push({SalesEmpID:7001,BookingSOID:301});const r=await app.call('GET','/api/native-print/116/QA123');assert.equal(r.status,200);assert.equal(r.body.items.length,2);assert.equal(db.calls.filter(c=>/SELECT SOID, SalesUserId FROM wf\.SalesOrderExt/.test(c.text)).length,1);});
test('restricted actor cannot inspect ownerless slip even if effective user can see all',async()=>{items=[];const r=await app.call('GET','/api/native-print/116/QA123');assert.equal(r.status,404);});
test('both unrestricted users can inspect an ownerless slip',async()=>{items=[];actorAllowed=true;const r=await app.call('GET','/api/native-print/116/QA123');assert.equal(r.status,200);});
