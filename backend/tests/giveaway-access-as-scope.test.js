'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
let user, withContext=true, currentRequest={RequesterId:2,LenderId:3};
const auth=require.resolve('../middleware/auth');require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{requireAuth:(req,_res,next)=>{req.user=user;if(withContext)require('../services/request-context').runWithUser(user,next);else next();},requireRole:()=>((_req,_res,next)=>next()),requireCapability:()=>((_req,_res,next)=>next())}};
const db=h.installDbStub(({text,inputs})=>{
 if(/SELECT Id, EmpId, PositionCode FROM wf\.AppUser/.test(text))return [{Id:Number(inputs.id),EmpId:null,PositionCode:null}];
 if(/SELECT RequesterId, LenderId FROM wf\.GiveawayBorrowRequest WHERE Id=@id/.test(text))return [currentRequest];
 if(/SELECT TOP 1 Region, RemainingQty FROM wf\.v_GiveawayBudgetStatus/.test(text))return [{Region:'LENDER',RemainingQty:100}];
 if(/SELECT TOP 1 Region FROM wf\.GiveawayBudget/.test(text))return [{Region:'REQUESTER'}];
 return [];
});
let app;test.before(async()=>{app=await h.startApp([['/api/giveaway','../../routes/giveaway']]);});test.after(async()=>app.close());
test.beforeEach(()=>{db.calls.length=0;withContext=true;currentRequest={RequesterId:2,LenderId:3};user={sub:2,id:2,actorSub:10,role:'SALES',roles:['SALES'],actorRole:'SALES',actorRoles:['SALES'],isImpersonating:true};});
test('primary quota requires scope of both real and effective identity',async()=>{
 const r=await app.call('GET','/api/giveaway/my-quota?year=2026');assert.equal(r.status,403);
 assert.equal(db.calls.some(c=>/SELECT \* FROM wf\.v_GiveawayBudgetStatus/.test(c.text)),false);
 user.actorRole='ADMIN';user.actorRoles=['ADMIN'];const allowed=await app.call('GET','/api/giveaway/my-quota?year=2026');assert.equal(allowed.status,200);
});
test('borrow list intersects requester/lender scopes for each identity and keeps UTC cutoff',async()=>{
 const r=await app.call('GET','/api/giveaway/borrow-requests');assert.equal(r.status,200);
 const q=db.calls.find(c=>/FROM wf\.GiveawayBorrowRequest b/.test(c.text));assert.ok(q);
 assert.match(q.text,/b\.RequestedAt >= @globalStartUtc/);assert.match(q.text,/b\.RequesterId IN \(@bqU0\)/);assert.match(q.text,/b\.LenderId IN \(@blU0\)/);
 assert.match(q.text,/b\.RequesterId IN \(@abqU0\)/);assert.match(q.text,/b\.LenderId IN \(@ablU0\)/);
 assert.equal(q.inputs.bqU0,2);assert.equal(q.inputs.abqU0,10);
});
test('borrow resolution rejects a record outside the real actor scope before a write',async()=>{
 const r=await app.call('PATCH','/api/giveaway/borrow-requests/5/resolve',{body:{approve:true}});assert.equal(r.status,404);
 assert.equal(db.calls.some(c=>/UPDATE wf\.GiveawayBorrowRequest/.test(c.text)),false);
});
test('borrow creation fails closed when actor audit context is missing',async()=>{
 withContext=false;const r=await app.call('POST','/api/giveaway/borrow-requests',{body:{lenderId:3,brand:'TEST',itemName:'TEST',qty:1}});
 assert.equal(r.status,503);assert.equal(db.calls.some(c=>/INSERT INTO wf\.GiveawayBorrowRequest/.test(c.text)),false);
});
