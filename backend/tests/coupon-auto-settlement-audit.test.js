'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
const db=h.installDbStub(({text})=>/COL_LENGTH\('wf.ChangeEvent'/.test(text)?[{HasCol:1}]:[]);
const svc=require('../services/coupon-service'),{runWithUser}=require('../services/request-context');
let state,failAudit,failFence=false;
const user={sub:43,actorSub:44,isImpersonating:true};
const matchQuery=async text=>{
  if(text.includes('FROM wf.CouponReservation cr'))return {recordset:[{Id:101,CouponId:246000,CarrierSoId:'278001',ReservedQty:4,ConsumedQty:0,RemainingReservedQty:4,CreatedAt:new Date('2026-10-04T08:00:00Z'),TripPlate:'TEST-1',ConfirmDate:new Date('2026-10-04T08:00:00Z')}]};
  if(text.includes('FROM dbo.WFRedemtionDT rd'))return {recordset:[{RedemtionID:183000,CouponID:246000,GoodQty:4,DocuNo:'TEST',RedemptionDocuNo:'TEST',DocuDate:new Date('2026-10-04T09:00:00Z'),CarLicense:'TEST-1'}]};
  return {recordset:[]};
};
const tx={request(){const args={};return {input(k,t,v){args[k]=v;return this;},async query(text){
  if(text.includes('SELECT 1 FROM wf.CouponReservationSettlement'))return {recordset:[]};
  if(text.includes('INSERT INTO wf.CouponReservationSettlement')){state.settlements.push({...args});return {rowsAffected:[1]};}
  if(text.includes('UPDATE wf.CouponReservation')){state.consumed+=args.qty;return {rowsAffected:[1]};}
  if(text.includes('INSERT INTO wf.ChangeEvent')){if(failAudit)throw Error('AUDIT_FAILED');state.events.push({...args});return {rowsAffected:[1]};}
  throw Error('UNEXPECTED_SQL');
}};}};
const deps={checkMigration139:async()=>true,wfQuery:matchQuery,couponVisible:async()=>true,reservationsVisible:async()=>true,settlementPolicy:{settlementWindowDays:3,goLiveCutoffDate:null},
  wfTransaction:async fn=>{const before=structuredClone(state);try{return await fn(tx);}catch(e){state=before;throw e;}}, validateSettlementSnapshot:async()=>{if(failFence)throw Object.assign(Error('STALE'),{code:'COUPON_SETTLEMENT_STALE'});},
  logChangeEvent:async(actual,event)=>{assert.equal(actual,tx);if(failAudit)throw Error('AUDIT_FAILED');state.events.push(event);}};
test('auto settlement and its actor-attributed audit commit together',async()=>{
  state={settlements:[],consumed:0,events:[]};failAudit=false;
  const r=await runWithUser(user,()=>svc.settleCouponReservations(246000,user,deps));
  assert.equal(r.settledCount,1);assert.equal(state.consumed,4);assert.equal(state.settlements[0].uid,43);
  assert.equal(state.events[0].action,'AUTO_SETTLE');assert.equal(state.events[0].userId,'43');
});
test('auto settlement rolls back when audit fails',async()=>{
  state={settlements:[],consumed:0,events:[]};failAudit=true;
  await assert.rejects(runWithUser(user,()=>svc.settleCouponReservations(246000,user,deps)),/AUDIT_FAILED/);
  assert.deepEqual(state,{settlements:[],consumed:0,events:[]});
});
test('auto settlement does not write when locked snapshot has changed',async()=>{
  state={settlements:[],consumed:0,events:[]};failAudit=false;failFence=true;
  try{await assert.rejects(runWithUser(user,()=>svc.settleCouponReservations(246000,user,deps)),{code:'COUPON_SETTLEMENT_STALE'});assert.deepEqual(state,{settlements:[],consumed:0,events:[]});}finally{failFence=false;}
});
test('auto settlement rejects missing scope before reads and rechecks it before writes',async()=>{
  state={settlements:[],consumed:0,events:[]};failAudit=false;
  let checks=0;
  await assert.rejects(svc.settleCouponReservations(246000,user,{...deps,couponVisible:async()=>{checks++;return false;}}),e=>e.status===404);
  assert.equal(checks,1);assert.deepEqual(state,{settlements:[],consumed:0,events:[]});
  checks=0;
  await assert.rejects(svc.settleCouponReservations(246000,user,{...deps,couponVisible:async()=>++checks===1}),e=>e.status===404);
  assert.equal(checks,2);assert.deepEqual(state,{settlements:[],consumed:0,events:[]});
});
test('auto settlement fails closed if a reservation is outside scope or scope changes',async()=>{
  state={settlements:[],consumed:0,events:[]};let checks=0;
  await assert.rejects(svc.settleCouponReservations(246000,user,{...deps,reservationsVisible:async()=>false}),e=>e.status===404);
  assert.deepEqual(state,{settlements:[],consumed:0,events:[]});
  await assert.rejects(svc.settleCouponReservations(246000,user,{...deps,reservationsVisible:async()=>++checks===1}),e=>e.status===404);
  assert.equal(checks,2);assert.deepEqual(state,{settlements:[],consumed:0,events:[]});
});
test('actual audit writer records Access As actor and effective user',async()=>{
  state={settlements:[],consumed:0,events:[]};failAudit=false;const realAuditDeps={...deps};delete realAuditDeps.logChangeEvent;
  await runWithUser(user,()=>svc.settleCouponReservations(246000,user,realAuditDeps));
  assert.equal(state.events[0].actorUserId,'44');assert.equal(state.events[0].userId,'43');
});
test('coupon list and reconcile forward the authenticated actor',async()=>{
  const originalList=svc.getCouponsForCustomer,originalRecon=svc.reconcileCoupon,router=require('../routes/coupons');let captured=[];
  svc.getCouponsForCustomer=async(_id,options)=>{captured.push(options.actor);return [];};svc.reconcileCoupon=async(_id,options)=>{captured.push(options.actor);return {};};
  try{for(const [path,query,params] of [['/',{customerId:'1'},{}],['/reconcile/:couponId',{}, {couponId:'2'}]]){
    const handler=router.stack.find(x=>x.route?.path===path).route.stack.at(-1).handle;
    const res={json(){return this;},status(){return this;}};await handler({user,query,params},res);
  }assert.deepEqual(captured,[user,user]);}finally{svc.getCouponsForCustomer=originalList;svc.reconcileCoupon=originalRecon;}
});
