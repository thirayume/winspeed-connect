'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
const user={sub:8,actorSub:17,role:'ADMIN',actorRole:'ADMIN',isImpersonating:true};let state,failAudit,withContext;
const auth=require.resolve('../middleware/auth');require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{requireAuth:(req,_res,next)=>{req.user=user;if(withContext)require('../services/request-context').runWithUser(user,next);else next();},requireCapability:()=>((_req,_res,next)=>next()),requireRole:()=>((_req,_res,next)=>next())}};
const db=h.installDbStub(({kind,text,inputs})=>{
 if(/SELECT \* FROM wf\.PriceApproval/.test(text)){assert.match(text,/so\.CreatedAt >= @globalStartUtc/);return [{Id:5,Status:state.price,SoId:10,RequestedBy:99,DocumentRevision:1,GoodId:'11',RequestedPrice:20}];}
 if(/SELECT \* FROM wf\.TripMultiCustomerApproval/.test(text))return [{Id:5,Status:state.trip,TripId:10,RequestedBy:99,CustomerIdsJson:'["1"]',TotalAmount:10}];
 if(/SELECT DocumentRevision, Status, DeliveryDate/.test(text))return [{DocumentRevision:state.revision,Status:'DRAFT'}];
 if(/FROM wf\.SalesOrderLine WITH/.test(text))return [];
 if(/SELECT COUNT\(\*\) AS Cnt FROM wf\.PriceApproval/.test(text))return [{Cnt:1}];
 if(/SELECT TripId, Status, DocumentRevision FROM wf\.SalesTrip/.test(text))return [{TripId:10,Status:'DRAFT',DocumentRevision:1}];
 if(/FROM wf\.v_TripMember/.test(text))return [];
 if(/UPDATE wf\.PriceApproval/.test(text)&&/Status = 'SUPERSEDED'/.test(text)){assert.equal(kind,'tx');if(state.race)return {rowsAffected:[0]};state.price='SUPERSEDED';return {rowsAffected:[1]};}
 if(/UPDATE wf\.TripMultiCustomerApproval/.test(text)&&/Status = 'SUPERSEDED'/.test(text)){assert.equal(kind,'tx');if(state.race)return {rowsAffected:[0]};state.trip='SUPERSEDED';return {rowsAffected:[1]};}
 if(/UPDATE wf\.PriceApproval/.test(text)&&/Status = '(APPROVED|REJECTED)'/.test(text)){assert.equal(kind,'tx');state.price=text.includes("'APPROVED'")?'APPROVED':'REJECTED';return {rowsAffected:[1]};}
 if(/UPDATE wf\.TripMultiCustomerApproval/.test(text)&&/Status = '(APPROVED|REJECTED)'/.test(text)){assert.equal(kind,'tx');state.trip=text.includes("'APPROVED'")?'APPROVED':'REJECTED';return {rowsAffected:[1]};}
 if(/UPDATE wf\.SalesOrder SET PriceApprovalStatus/.test(text))return {rowsAffected:[1]};
 if(/INSERT INTO wf\.ChangeEvent/.test(text)){assert.equal(kind,'tx');if(failAudit)throw Error('AUDIT_FAIL');state.events.push(inputs);return {rowsAffected:[1]};}
 return [];
});
db.stub.wfTransaction=async fn=>{const old=structuredClone(state);try{return await fn(db.tx);}catch(e){state=old;throw e;}};
const ctx=require.resolve('../services/request-context'),original=require(ctx);require.cache[ctx].exports={...original,hasColumn:async()=>true};
const trip=require.resolve('../services/trip-multi-cust-approval'),tripReal=require(trip);require.cache[trip].exports={...tripReal,canUserApproveMultiCustTrip:async()=>({allowed:true}),computeTripCustomerSnapshot:()=>({customerIds:state.changedTrip?['2']:['1']})};
const cost=require.resolve('../services/cost-authority'),costReal=require(cost);require.cache[cost].exports={...costReal,assertPricesAboveCost:async()=>({blocked:false})};
let app;test.before(async()=>{app=await h.startApp([['/api/edit-requests','../../routes/edit-requests']]);});test.after(async()=>app.close());
test.beforeEach(()=>{state={price:'PENDING',trip:'PENDING',events:[],revision:1,changedTrip:false,race:false};failAudit=false;withContext=true;});
for(const [type,kind] of [['price-approvals','price'],['trip-approvals','trip']])for(const [action,status] of [['approve','APPROVED'],['reject','REJECTED']]){
 test(`${type} ${action}: audit failure rolls back, success records both identities`,async()=>{
  const path=`/api/edit-requests/${type}/5/${action}`,body={note:'synthetic reason'};failAudit=true;
  let r=await app.call('PATCH',path,{body});assert.equal(r.status,500);assert.equal(state[kind],'PENDING');assert.equal(state.events.length,0);
  failAudit=false;r=await app.call('PATCH',path,{body});assert.equal(r.status,200);assert.equal(state[kind],status);assert.equal(state.events[0].userId,'8');assert.equal(state.events[0].actorUserId,'17');
 });
}
test('Access As without actor context fails closed and rolls back',async()=>{
 withContext=false;const r=await app.call('PATCH','/api/edit-requests/trip-approvals/5/reject',{body:{note:'synthetic reason'}});assert.equal(r.status,503);assert.equal(state.trip,'PENDING');assert.equal(state.events.length,0);
});

for (const [type,action,kind] of [['price-approvals','approve','price'],['price-approvals','reject','price'],['trip-approvals','approve','trip']]) {
 test(`${type} ${action}: source changes commit SUPERSEDED with both audit identities`,async()=>{
  state.revision=2;state.changedTrip=true;let r=await app.call('PATCH',`/api/edit-requests/${type}/5/${action}`,{body:{note:'synthetic reason'}});
  assert.equal(r.status,409);assert.equal(r.body.code,'APPROVAL_SUPERSEDED');assert.equal(state[kind],'SUPERSEDED');assert.equal(state.events[0].action,'SUPERSEDED');assert.equal(state.events[0].userId,'8');assert.equal(state.events[0].actorUserId,'17');
 });
 test(`${type} ${action}: audit failure or a concurrent decision leaves prior status intact`,async()=>{
  state.revision=2;state.changedTrip=true;failAudit=true;let r=await app.call('PATCH',`/api/edit-requests/${type}/5/${action}`,{body:{note:'synthetic reason'}});assert.equal(r.status,500);assert.equal(state[kind],'PENDING');assert.equal(state.events.length,0);
  failAudit=false;state.race=true;r=await app.call('PATCH',`/api/edit-requests/${type}/5/${action}`,{body:{note:'synthetic reason'}});assert.equal(r.status,409);assert.equal(state[kind],'PENDING');assert.equal(state.events.length,0);
 });
}
