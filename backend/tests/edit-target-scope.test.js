'use strict';const test=require('node:test');const assert=require('node:assert/strict');const h=require('./helpers/route-harness.cjs');let user;
const db=h.installDbStub(({text,inputs})=>{
 if(/FROM\s+dbo\.SOHD s[\s\S]*JOIN\s+dbo\.EMCust/.test(text))return [{SOID:'54321',DocuNo:'QA',SalesUserId:19,EmpId:'1919'}];
 if(/SELECT Id, EmpId, PositionCode FROM wf\.AppUser WHERE Id = @id/.test(text))return [{Id:inputs.id,EmpId:String(inputs.id)+'19',PositionCode:null}];
 if(/FROM dbo\.WGHD/.test(text))return [{Rows:0}];
 return [];
});
const auth=require.resolve('../middleware/auth');require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{requireAuth:(req,_res,next)=>{req.user=user;require('../services/request-context').runWithUser(user,next);},requireRole:()=> (_req,_res,next)=>next(),requireCapability:()=> (_req,_res,next)=>next()}};
const native=require.resolve('../services/native-status');require.cache[native]={id:native,filename:native,loaded:true,exports:{findIssuedDelivery:async()=>null}};
let app;test.before(async()=>{app=await h.startApp([['/api/edit-requests','../../routes/edit-requests']]);});test.after(async()=>app.close());
test('owner can view stage and another salesperson cannot view or create',async()=>{
 user={sub:19,actorSub:19,role:'SALES'};assert.equal((await app.call('GET','/api/edit-requests/stage/54321')).status,200);
 user={sub:20,actorSub:20,role:'SALES'};assert.equal((await app.call('GET','/api/edit-requests/stage/54321')).status,404);
 const r=await app.call('POST','/api/edit-requests',{body:{soid:54321,reasonCode:'QA'}});assert.equal(r.status,404);assert.ok(!db.calls.some(c=>c.kind==='tx'));
});
test('Access As must satisfy both actor and effective data scope',async()=>{
 user={sub:19,actorSub:20,role:'SALES',actorRole:'SALES',actorRoles:['SALES'],isImpersonating:true};
 assert.equal((await app.call('GET','/api/edit-requests/stage/54321')).status,404);
 assert.equal((await app.call('POST','/api/edit-requests',{body:{soid:54321,reasonCode:'QA'}})).status,404);
});
