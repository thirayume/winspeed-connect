'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
let state,failAudit=false,scopeDenied=false,typeUnavailable=false;
const user={sub:8,actorSub:17,role:'ADMIN',actorRole:'ADMIN',isImpersonating:true};
const auth=require.resolve('../middleware/auth');
require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{requireAuth:(req,_res,next)=>{req.user=user;require('../services/request-context').runWithUser(user,next);},requireRole:()=>((_req,_res,next)=>next()),requireCapability:()=>((_req,_res,next)=>next())}};
const db=h.installDbStub(({kind,text,inputs})=>{
  if(text.includes('SELECT 1 AS ok FROM wf.SalesTrip'))return kind==='tx'&&scopeDenied?[]:[{ok:1}];
  if(text.includes('FROM wf.TruckType WITH(HOLDLOCK)'))return typeUnavailable?[]:[{Id:'QA-TYPE',MaxWeightMain:12,MaxWeightTrailer:8}];
  if(text.includes("COL_LENGTH('wf.ChangeEvent'"))return [{HasCol:1}];
  if(text.includes('SELECT * FROM wf.SalesTrip WITH'))return [state.trip];
  if(text.includes('SELECT * FROM wf.v_TripMember'))return [{MemberKind:'DRAFT',MemberId:'10'}];
  if(text.includes('SELECT CAST(l.SoId AS VARCHAR(50))'))return [{MemberId:'10',LineNum:1,QtyTon:1}];
  if(text.includes('SELECT CAST(d.SOID AS VARCHAR(50))'))return [];
  if(text.includes('UPDATE wf.SalesOrderLine')){state.lineChanged=true;return {rowsAffected:[1]};}
  if(text.includes('UPDATE wf.SalesTrip')){state.trip.LoadPlanStatus=text.includes("'WAREHOUSE_ACK'")?'WAREHOUSE_ACK':'SALE_CONFIRMED';return {rowsAffected:[1]};}
  if(text.includes('INSERT INTO wf.ChangeEvent')){assert.equal(kind,'tx');if(failAudit)throw Error('AUDIT_FAILED');state.audits.push(inputs);return {rowsAffected:[1]};}
  return [];
});
db.stub.wfTransaction=async fn=>{const before=structuredClone(state);try{return await fn(db.tx);}catch(e){state=before;throw e;}};
let app;
test.before(async()=>{app=await h.startApp([['/api/trips','../../routes/trips']]);});
test.after(async()=>app.close());
test.beforeEach(()=>{state={trip:{TripId:2,LoadPlanStatus:'DRAFT',LoadPlanRevision:1,CreatedBy:8,TruckTypeId:'QA-TYPE',TruckCapacityTon:20},lineChanged:false,audits:[]};failAudit=false;scopeDenied=false;typeUnavailable=false;});
test('load plan confirmation rolls back lines and state when audit fails',async()=>{
  const request={body:{expectedPlanRevision:1,lines:[{memberKind:'DRAFT',memberId:'10',lineNum:1,masterQty:1,childQty:0}]}};
  failAudit=true;assert.equal((await app.call('PUT','/api/trips/2/load-plan',request)).status,500);assert.equal(state.trip.LoadPlanStatus,'DRAFT');assert.equal(state.lineChanged,false);
  failAudit=false;assert.equal((await app.call('PUT','/api/trips/2/load-plan',request)).status,200);assert.equal(state.trip.LoadPlanStatus,'SALE_CONFIRMED');
  assert.equal(state.audits[0].action,'LOAD_PLAN_CONFIRM');assert.equal(state.audits[0].userId,'8');assert.equal(state.audits[0].actorUserId,'17');
});
test('warehouse acknowledgement and audit roll back together',async()=>{
  state.trip.LoadPlanStatus='SALE_CONFIRMED';const request={body:{expectedPlanRevision:1}};
  failAudit=true;assert.equal((await app.call('POST','/api/trips/2/load-plan/ack',request)).status,500);assert.equal(state.trip.LoadPlanStatus,'SALE_CONFIRMED');
  failAudit=false;assert.equal((await app.call('POST','/api/trips/2/load-plan/ack',request)).status,200);assert.equal(state.trip.LoadPlanStatus,'WAREHOUSE_ACK');assert.equal(state.audits[0].action,'LOAD_PLAN_ACK');assert.equal(state.audits[0].actorUserId,'17');
});
test('submit plan audits mutation and does not duplicate audit on replay',async()=>{
  failAudit=true;assert.equal((await app.call('POST','/api/trips/2/submit-plan',{body:{}})).status,500);assert.equal(state.trip.LoadPlanStatus,'DRAFT');
  failAudit=false;assert.equal((await app.call('POST','/api/trips/2/submit-plan',{body:{}})).status,200);assert.equal(state.audits[0].action,'LOAD_PLAN_SUBMIT');assert.equal(state.audits[0].actorUserId,'17');
  assert.equal((await app.call('POST','/api/trips/2/submit-plan',{body:{}})).status,200);assert.equal(state.audits.length,1);
});
test('a trip leaving the actor scope after preflight cannot be acknowledged or submitted',async()=>{
 state.trip.LoadPlanStatus='SALE_CONFIRMED';scopeDenied=true;const before=structuredClone(state);
 for(const action of ['load-plan/ack','submit-plan']){
  assert.equal((await app.call('POST','/api/trips/2/'+action,{body:{expectedPlanRevision:1}})).status,404);
  assert.deepEqual(state,before);
 }
});
test('warehouse must choose a valid active type and reload its capacity even for a previously selected type',async()=>{
 state.trip.LoadPlanStatus='SALE_CONFIRMED';state.trip.TruckTypeId=null;
 const request={body:{expectedPlanRevision:1}};
 assert.equal((await app.call('POST','/api/trips/2/load-plan/ack',request)).status,400);
 state.trip.TruckTypeId='QA-TYPE';typeUnavailable=true;
 assert.equal((await app.call('POST','/api/trips/2/load-plan/ack',request)).status,409);assert.equal(state.audits.length,0);
 typeUnavailable=false;state.trip.TruckCapacityTon=999;
 const result=await app.call('POST','/api/trips/2/load-plan/ack',request);
 assert.equal(result.status,200);assert.equal(result.body.truckCapacityTon,20);assert.equal(result.body.loadPlanRevision,2);
});
