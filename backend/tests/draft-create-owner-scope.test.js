'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
let user,customerVisible=false,revokeInsideTransaction=false,creditReads=0,ambiguousCustomer=false;
const auth=require.resolve('../middleware/auth');require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{requireAuth:(req,_res,next)=>{req.user=user;next();},requireRole:()=>((_req,_res,next)=>next()),requireCapability:()=>((_req,_res,next)=>next()),requireRebateAmountAccess:(_req,_res,next)=>next(),canViewAllRebateAmounts:()=>false}};
const db=h.installDbStub(({text,inputs,kind})=>{
 if(text.includes('WHERE CustID=@scopeCustomerId'))return [{CustID:123,CustCode:'QA-123'},...(ambiguousCustomer?[{CustID:124,CustCode:'123'}]:[])];
 if(text.includes('WHERE c.CustID=@visibilityCustId'))return customerVisible&&!(kind==='tx'&&revokeInsideTransaction)?[{ok:1}]:[];
 if(text.includes('SELECT Id, EmpId, PositionCode'))return [{Id:Number(inputs.id),EmpId:null,PositionCode:Number(inputs.id)===25?'QA-SALES-MGR':null}];
 if(text.includes('SELECT PositionCode,ReportsTo,RecordScope,IsActive'))return [{PositionCode:inputs.pos,IsActive:1,RecordScope:'ORG'}];
 if(text.includes(';WITH tree AS'))return [{Id:25,EmpId:null},{Id:43,EmpId:null}];
 return [];
});
const credit=require.resolve('../services/credit-service'),realCredit=require(credit);require.cache[credit].exports={...realCredit,checkCustomerCreditAndAging:async()=>{creditReads++;return {ok:true,blocked:false};}};
let app;test.before(async()=>{app=await h.startApp([['/api/so','../../routes/so']]);});test.after(()=>app.close());
test.beforeEach(()=>{db.calls.length=0;customerVisible=false;revokeInsideTransaction=false;creditReads=0;ambiguousCustomer=false;});
test('manager cannot create a bill for a sibling branch before credit reads or trip creation',async()=>{
 user={sub:25,role:'MANAGER'};
 const result=await app.call('POST','/api/so',{body:{salesUserId:77}});
 assert.equal(result.status,403);assert.equal(db.calls.some(c=>c.kind==='tx'||/CreditMaster|INSERT INTO wf.SalesTrip|INSERT INTO wf.SalesOrder/.test(c.text)),false);
});
test('an effective administrator cannot lend ticket or bill creation scope to an outside actual actor',async()=>{
 user={sub:63,actorSub:43,role:'ADMIN',actorRole:'SALES',isImpersonating:true};
 const result=await app.call('POST','/api/so',{body:{salesUserId:77}});
 assert.equal(result.status,403);assert.equal(db.calls.some(c=>c.kind==='tx'),false);
});
test('malformed owner IDs are rejected rather than silently replaced by the current user',async()=>{
 user={sub:63,role:'ADMIN'};
 for(const salesUserId of ['not-an-id',-1,1.5,0])assert.equal((await app.call('POST','/api/so',{body:{salesUserId}})).status,400);
 assert.equal(db.calls.some(c=>c.kind==='tx'),false);
});
const order=()=>({soPrefix:'I',custId:'123',lines:[{goodId:'QA-GOOD',qtyTon:1,pricePerTon:100}]});
test('an own bill cannot reveal credit or create records for a customer outside the current branch',async()=>{
 user={sub:43,role:'SALES'};const r=await app.call('POST','/api/so',{body:order()});assert.equal(r.status,404);assert.equal(creditReads,0);assert.equal(db.calls.some(c=>c.kind==='tx'),false);
});
test('customer visibility is rechecked under the bill transaction before a trip or bill is inserted',async()=>{
 user={sub:43,role:'SALES'};customerVisible=true;revokeInsideTransaction=true;
 const r=await app.call('POST','/api/so',{body:{...order(),tripSetup:{}}});assert.equal(r.status,404);assert.equal(creditReads,1);
 assert.ok(db.calls.some(c=>c.kind==='tx'&&c.text.includes('WHERE c.CustID=@visibilityCustId')));
 assert.equal(db.calls.some(c=>/INSERT INTO wf.SalesTrip|INSERT INTO wf.SalesOrder/.test(c.text)),false);
});
test('a legacy customer code is resolved to one native ID before applying the same branch predicate',async()=>{
 customerVisible=true;
 const scope={all:false,userIds:[43],empIds:[]};
 const allowed=await require('../services/secondary-customer-scope').customerReferenceVisible({sub:43,role:'SALES'},'QA-123',{scopes:[scope]});
 assert.equal(allowed,true);
 const identity=db.calls.find(c=>c.text.includes('WHERE CustID=@scopeCustomerId'));assert.equal(identity.inputs.scopeCustomerId,null);assert.equal(identity.inputs.scopeCustomerCode,'QA-123');
 const visibility=db.calls.find(c=>c.text.includes('WHERE c.CustID=@visibilityCustId'));assert.equal(visibility.inputs.visibilityCustId,123);assert.equal(visibility.inputs.customerScope0U0,43);
});
test('a numeric code colliding with a native ID is rejected before credit and all writes',async()=>{
 user={sub:43,role:'SALES'};customerVisible=true;ambiguousCustomer=true;
 const r=await app.call('POST','/api/so',{body:order()});assert.equal(r.status,409);assert.equal(r.body.code,'AMBIGUOUS_CUSTOMER_ID');assert.equal(creditReads,0);assert.equal(db.calls.some(c=>c.kind==='tx'),false);
});
