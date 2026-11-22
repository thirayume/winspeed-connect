'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
const db=h.installDbStub(({text})=>/COL_LENGTH\('wf.ChangeEvent'/.test(text)?[{HasCol:1}]:[]);
const svc=require('../services/coupon-service'),{runWithUser}=require('../services/request-context');
let state,failAudit,failFence=false;
const user={sub:43,actorSub:44,isImpersonating:true};
const matchQuery=async text=>{
  const legacy=require('./helpers/native-hold-legacy.cjs')(text);if(legacy)return legacy;
  if(text.includes('FROM wf.CouponReservation cr'))return {recordset:[{Id:101,CouponId:246000,CarrierSoId:'278001',ReservedQty:4,ConsumedQty:0,RemainingReservedQty:4,CreatedAt:new Date('2026-10-04T08:00:00Z'),TripPlate:'TEST-1',ConfirmDate:new Date('2026-10-04T08:00:00Z')}]};
  if(text.includes('FROM dbo.WFRedemtionDT rd')){assert.match(text,/rh\.DocuType\s*=\s*116/);return {recordset:[{RedemtionID:183000,CouponID:246000,CouponNo:'D-TEST',GoodQty:4,DocuNo:'TEST',RedemptionDocuNo:'TEST',DocuDate:new Date('2026-10-04T09:00:00Z'),CarLicense:'TEST-1'}]};}
  return {recordset:[]};
};
test('automatic preflight refuses legacy cut calculation when a recovery exists',async()=>{
  state={settlements:[],consumed:0,events:[]};let cutRead=false;
  const query=async text=>{
    if(text.includes('COUPON_RECOVERY_READINESS_V1'))return {recordset:[{...require('./helpers/coupon-bridge-metadata').absent,RecoverySchemaState:'COUPON_RECOVERY_READINESS_V1',Ledger232:0,EditHoldVisible:0,Ledger231:1,RecoveryVisible:1,RecoverySelect:1,SchemaSelect:1}]};
    if(text.includes('AS RecoveryExists'))return {recordset:[{RecoveryExists:1}]};
    if(text.includes('FROM dbo.WFRedemtionDT rd'))cutRead=true;
    return matchQuery(text);
  };
  await assert.rejects(svc.settleCouponReservations(246000,user,{...deps,wfQuery:query}),{code:'COUPON_RECOVERY_REVIEW_REQUIRED'});
  assert.equal(cutRead,false);assert.deepEqual(state,{settlements:[],consumed:0,events:[]});
});
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
test('single plate and quantity match is held without settlement or audit writes',async()=>{
  state={settlements:[],consumed:0,events:[]};failAudit=false;
  const r=await runWithUser(user,()=>svc.settleCouponReservations(246000,user,deps));
  assert.equal(r.settledCount,0);
  assert.equal(r.ambiguous[0].reason,'AUTHORITATIVE_LINK_REQUIRED');
  assert.deepEqual(r.ambiguous[0].candidateReservationIds,['101']);
  assert.equal(r.unmatched[0].reason,'AUTHORITATIVE_LINK_REQUIRED');
  assert.equal(r.unmatched[0].couponId,246000);assert.equal(r.unmatched[0].couponNo,'D-TEST');
  assert.deepEqual(state,{settlements:[],consumed:0,events:[]});
});
test('partial cut and a policy requesting heuristic matching are still held',async()=>{
  state={settlements:[],consumed:0,events:[]};
  const query=async text=>{
    const result=await matchQuery(text);
    if(text.includes('FROM dbo.WFRedemtionDT rd')) result.recordset[0].GoodQty=1;
    return result;
  };
  const r=await runWithUser(user,()=>svc.settleCouponReservations(246000,user,{
    ...deps,wfQuery:query,settlementPolicy:{settlementWindowDays:3,requireAuthoritativeLink:false},
  }));
  assert.equal(r.settledCount,0);
  assert.equal(r.ambiguous[0].reason,'AUTHORITATIVE_LINK_REQUIRED');
  assert.deepEqual(state,{settlements:[],consumed:0,events:[]});
});
test('multiple matching reservations are held without writing a settlement or audit',async()=>{
  state={settlements:[],consumed:0,events:[]};failAudit=false;
  const query=async text=>{
    const result=await matchQuery(text);
    if(text.includes('FROM wf.CouponReservation cr')) result.recordset.push({...result.recordset[0],Id:102,CarrierSoId:'278002',ReservedQty:2,RemainingReservedQty:2});
    return result;
  };
  const r=await runWithUser(user,()=>svc.settleCouponReservations(246000,user,{...deps,wfQuery:query}));
  assert.equal(r.settledCount,0);assert.equal(r.ambiguous[0].reason,'MULTIPLE_CANDIDATE_RESERVATIONS');
  assert.deepEqual(state,{settlements:[],consumed:0,events:[]});
});
test('settlement rejects a ticket or reservation outside the actor scope',async()=>{
  state={settlements:[],consumed:0,events:[]};
  await assert.rejects(svc.settleCouponReservations(246000,user,{...deps,couponVisible:async()=>false}),e=>e.status===404);
  await assert.rejects(svc.settleCouponReservations(246000,user,{...deps,reservationsVisible:async()=>false}),e=>e.status===404);
  assert.deepEqual(state,{settlements:[],consumed:0,events:[]});
});
test('shared audit writer retains Access As actor and effective user',async()=>{
  state={settlements:[],consumed:0,events:[]};failAudit=false;
  const {logChangeEvent}=require('../services/policy-contract');
  await runWithUser(user,()=>logChangeEvent(tx,{
    entityType:'COUPON_RESERVATION',entityId:'101',action:'REVIEW',
    reasonCode:'TEST_REVIEW',userId:'43',
  }));
  assert.equal(state.events[0].actorUserId,'44');
  assert.equal(state.events[0].userId,'43');
});
test('coupon list and reconcile forward the authenticated actor',async()=>{
  const originalList=svc.getCouponsForCustomer,originalRecon=svc.reconcileCoupon,router=require('../routes/coupons');let captured=[];
  svc.getCouponsForCustomer=async(_id,options)=>{captured.push(options.actor);return [];};svc.reconcileCoupon=async(_id,options)=>{captured.push(options.actor);return {};};
  try{for(const [path,query,params] of [['/',{customerId:'1'},{}],['/reconcile/:couponId',{}, {couponId:'2'}]]){
    const handler=router.stack.find(x=>x.route?.path===path).route.stack.at(-1).handle;
    const res={json(){return this;},status(){return this;}};await handler({user,query,params},res);
  }assert.deepEqual(captured,[user,user]);}finally{svc.getCouponsForCustomer=originalList;svc.reconcileCoupon=originalRecon;}
});
