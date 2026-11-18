'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
let user,allowRows=true,creditCalls=0;
const auth=require.resolve('../middleware/auth');require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{requireAuth:(req,_res,next)=>{req.user=user;next();},requireRole:()=>((_req,_res,next)=>next()),requireCapability:()=>((_req,_res,next)=>next())}};
// No customer data: these are synthetic fixtures modelling assigned and unassigned rows.
const customers=[{id:1,owner:null,sales:[]},{id:2,owner:2,sales:[10]},{id:3,owner:99,sales:[]},{id:4,owner:2,sales:[]},{id:5,owner:34,sales:[47]}];
function allowed(row,inputs){if(!row||!allowRows)return false;const scopes=[0,1].map(i=>inputs[`customerScope${i}U0`]).filter(v=>v!=null);return scopes.every(id=>row.owner==null||row.owner===Number(id)||row.sales.includes(Number(id)));}
const db=h.installDbStub(({text,inputs})=>{
 if(/SELECT Id, EmpId, PositionCode FROM wf\.AppUser/.test(text))return [{Id:Number(inputs.id),EmpId:null,PositionCode:null}];
 if(/WHERE c\.CustID=@visibilityCustId/.test(text))return allowed(customers.find(x=>x.id===Number(inputs.visibilityCustId)),inputs)?[{ok:1}]:[];
 if(/FROM dbo\.EMCust c WITH \(UPDLOCK,HOLDLOCK\)/.test(text))return allowed(customers.find(x=>x.id===Number(inputs.c)),inputs)?[{ok:1}]:[];
 if(/FROM dbo\.EMCust c WITH \(NOLOCK\)/.test(text))return customers.filter(x=>allowed(x,inputs)).map(x=>({CustID:x.id}));
 if(/FROM wf\.CreditMaster cm JOIN dbo\.EMCust/.test(text))return customers.filter(x=>allowed(x,inputs)).map(x=>({CustId:String(x.id)}));
 if(/SELECT CustId, CustName, CreditLimit/.test(text))return [{CustId:inputs.c}];
 return [];
});
const creditService=require.resolve('../services/credit-service');const orig=require(creditService);require.cache[creditService].exports={...orig,checkCustomerCreditAndAging:async()=>{creditCalls++;return {ok:true};}};
let app;test.before(async()=>{app=await h.startApp([['/api/master','../../routes/master'],['/api/credit','../../routes/credit']]);});test.after(async()=>app.close());
test.beforeEach(()=>{db.calls.length=0;allowRows=true;creditCalls=0;user={sub:2,id:2,actorSub:10,role:'SALES',roles:['SALES'],actorRole:'SALES',actorRoles:['SALES'],isImpersonating:true};});
test('primary customer list includes unassigned and intersects both assigned scopes',async()=>{
 const r=await app.call('GET','/api/master/customers');assert.equal(r.status,200);assert.deepEqual(r.body.map(x=>x.CustID),[1,2]);
 const q=db.calls.find(c=>/FROM dbo\.EMCust c WITH \(NOLOCK\)/.test(c.text));assert.ok(q);assert.match(q.text,/ISNULL\(c\.BillEmp,0\)=0 AND ISNULL\(cx\.SalespersonUserId,0\)=0/);
 assert.equal(q.inputs.customerScope0U0,2);assert.equal(q.inputs.customerScope1U0,10);assert.equal(q.inputs.customerStartDate,'2026-01-01');
});
test('credit list, status and detail use the same customer visibility',async()=>{
 const list=await app.call('GET','/api/credit');assert.equal(list.status,200);assert.deepEqual(list.body.map(x=>x.CustId),['1','2']);
 for(const id of [1,2])assert.equal((await app.call('GET',`/api/credit/${id}/status`)).status,200);
 for(const id of [3,4]){assert.equal((await app.call('GET',`/api/credit/${id}/status`)).status,404);assert.equal((await app.call('GET',`/api/credit/${id}`)).status,404);}
 assert.equal(creditCalls,2);
});
test('credit status rejects invalid amounts before evaluating credit and keeps customer scope',async()=>{
 for(const amount of ['-1','abc','Infinity','%20','1%26amount%3D2']) {
  const r=await app.call('GET',`/api/credit/1/status?amount=${amount}`);
  assert.equal(r.status,400,amount);assert.equal(r.body.code,'CREDIT_AMOUNT_INVALID');
 }
 assert.equal(creditCalls,0);
 assert.equal((await app.call('GET','/api/credit/4/status?amount=-1')).status,404);
 assert.equal((await app.call('GET','/api/credit/1/status?amount=1.25')).status,200);
 assert.equal(creditCalls,1);
});
test('credit update rejects a customer outside either scope before mutation',async()=>{
 const r=await app.call('PUT','/api/credit/4',{body:{creditLimit:100}});assert.equal(r.status,404);
 assert.equal(db.calls.some(c=>/MERGE wf\.CreditMaster/.test(c.text)),false);
 const q=db.calls.find(c=>/FROM dbo\.EMCust c WITH \(UPDLOCK,HOLDLOCK\)/.test(c.text));assert.equal(q.inputs.customerScope0U0,2);assert.equal(q.inputs.customerScope1U0,10);
});
test('customer-specific price and ticket queries cannot bypass primary scope',async()=>{
 for(const path of ['/api/master/prices?custId=4','/api/master/control-tickets?custId=4','/api/master/customers/4/top-goods','/api/master/truck-plates?custId=4'])assert.equal((await app.call('GET',path)).status,404,path);
 assert.equal(db.calls.some(c=>/FROM dbo\.WFCoupon c/.test(c.text)),false);
});
test('secondary mapped identities retain unassigned customers and use business IDs for scope',async()=>{
 user={sub:8,id:8,actorSub:17,role:'SALES',roles:['SALES'],actorRole:'SALES',actorRoles:['SALES'],isImpersonating:true,
   identityMapping:{primaryEffectiveUserId:8,primaryActorUserId:17,businessEffectiveUserId:34,businessActorUserId:47}};
 const r=await app.call('GET','/api/master/customers');assert.equal(r.status,200);assert.deepEqual(r.body.map(x=>x.CustID),[1,5]);
 const q=db.calls.find(c=>/FROM dbo\.EMCust c WITH \(NOLOCK\)/.test(c.text));assert.equal(q.inputs.customerScope0U0,34);assert.equal(q.inputs.customerScope1U0,47);
 assert.equal((await app.call('GET','/api/credit/5/status')).status,200);assert.equal((await app.call('GET','/api/credit/2/status')).status,404);
});
