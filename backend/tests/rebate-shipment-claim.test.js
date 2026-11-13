'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {reserveShipmentClaim}=require('../services/rebate-shipment-claim');
function fixture(){
  const epoch={environment:'uat',generation:1,resetId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',lastResetAtUtc:new Date('2026-01-01T00:00:00Z')};
  const make=(id,so,date)=>({AccrualId:id,SourceSOID:so,SourceListNo:1,SourceDocuNo:'TEST',SourceDocuDate:date,GoodCode:'F',GoodName:'TEST',
    PlanId:null,BookingSOID:so+20,BookingLineNo:1,SourceRefSOID:so+20,SourceRefListNo:1,
    ListPricePerTon:'1500.00',NetPricePerTon:'1250.00',RebatePerTon:'250.00',RemainingTon:'1.000',RemainingAmountBaht:'250.00',
    OccurredAtUtc:new Date('2026-02-01T00:00:00Z')});
  const rows=[make(1,11,'2025-12-01'),make(2,12,'2026-02-01')], state={reservations:[],failAt:0,scope:null};
  const query=async text=>{if(/sp_getapplock/.test(text))return {recordset:[{LockResult:0}]};throw Error('Unexpected SQL');};
  const options={participantFence:async()=>{},scopeFilter:async()=>({sql:'actor_scope AND effective_scope',inputs:{}}),
    readLots:async(_q,p)=>{state.scope=p.scopeSql;return rows;},reserve:async(_q,_e,p)=>{if(state.failAt===p.accrualId)throw Error('source changed');state.reservations.push(p);}};
  const input={custId:9,claimId:10,startDate:'2026-01-01',lines:[{goodCode:'F',qtyTon:'0.500',openingBalance:true},{goodCode:'F',qtyTon:'0.250'}]};
  const run=async()=>{const before=structuredClone(state);try{return await reserveShipmentClaim(query,epoch,{sub:1},input,options);}catch(e){Object.assign(state,before);throw e;}};
  return {state,input,run,options};
}
test('claim reserves opening and current lots under both identity scopes',async()=>{
  const f=fixture(),r=await f.run();assert.equal(r.totalAmount,'187.50');assert.equal(f.state.scope,'actor_scope AND effective_scope');
  assert.deepEqual(f.state.reservations.map(p=>[p.accrualId,p.documentType,p.quantityTon]),[[1,'CLAIM','0.500'],[2,'CLAIM','0.250']]);
});
test('a later changed source rolls back the first reservation as well',async()=>{
  const f=fixture();f.state.failAt=2;await assert.rejects(f.run(),/source changed/);assert.deepEqual(f.state.reservations,[]);
});
test('unavailable participant or no visible lots fails before reservation',async()=>{
  const f=fixture();f.options.participantFence=async()=>{throw Error('reset');};await assert.rejects(f.run(),/reset/);assert.deepEqual(f.state.reservations,[]);
  const g=fixture();g.options.readLots=async()=>[];await assert.rejects(g.run(),{code:'REBATE_CUSTOMER_OUT_OF_SCOPE'});assert.deepEqual(g.state.reservations,[]);
});

// ── plan / apply / release used by POST /api/rebate/claims and the reject route ──
const {planShipmentClaim,applyShipmentClaimPlan,claimLinesFromPlan,releaseShipmentClaimReservations}=require('../services/rebate-shipment-claim');
const epoch1={environment:'uat',generation:1,resetId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',lastResetAtUtc:new Date('2026-01-01T00:00:00Z')};

test('planning allocates under the participant fence and customer lock without reserving anything',async()=>{
  const f=fixture(),order=[];
  const query=async(text,inputs)=>{if(/sp_getapplock/.test(text)){order.push(`lock:${inputs.resource}`);return {recordset:[{LockResult:0}]};}throw Error('Unexpected SQL');};
  const options={...f.options,participantFence:async()=>{order.push('participant');},readLots:async(q,p)=>{order.push('lots');return f.options.readLots(q,p);}};
  const plan=await planShipmentClaim(query,epoch1,{sub:1},{custId:9,lines:f.input.lines,startDate:'2026-01-01'},options);
  assert.deepEqual(order,['participant','lock:RebateCust_9','lots']);
  assert.equal(plan.totalAmount,'187.50');
  assert.deepEqual(f.state.reservations,[],'planning must not reserve');
  await assert.rejects(planShipmentClaim(query,{...epoch1,generation:0},{sub:1},{custId:9,lines:f.input.lines,startDate:'2026-01-01'},options),{code:'REBATE_CLAIM_INPUT_INVALID',status:400});
  await assert.rejects(planShipmentClaim(query,epoch1,{sub:1},{custId:0,lines:f.input.lines,startDate:'2026-01-01'},options),{code:'REBATE_CLAIM_INPUT_INVALID'});
  const busy=async text=>{if(/sp_getapplock/.test(text))return {recordset:[{LockResult:-1}]};throw Error('Unexpected SQL');};
  await assert.rejects(planShipmentClaim(busy,epoch1,{sub:1},{custId:9,lines:f.input.lines,startDate:'2026-01-01'},options),{code:'REBATE_RESERVATION_LOCK_UNAVAILABLE'});
});

test('applying a plan reserves each allocated accrual for the claim and stops at the first failure',async()=>{
  const seen=[];const reserve=async(_q,_e,p)=>{if(p.accrualId===2)throw Object.assign(Error('REBATE_RESERVATION_SOURCE_CHANGED'),{code:'REBATE_RESERVATION_SOURCE_CHANGED'});seen.push(p);return {id:p.accrualId,replayed:false};};
  const allocations=[{accrualId:1,quantityTon:'0.500'},{accrualId:2,quantityTon:'0.250'},{accrualId:3,quantityTon:'0.100'}];
  await assert.rejects(applyShipmentClaimPlan(async()=>{},epoch1,{custId:9,claimId:10,allocations},{reserve}),{code:'REBATE_RESERVATION_SOURCE_CHANGED'});
  assert.deepEqual(seen,[{accrualId:1,custId:9,documentId:10,documentType:'CLAIM',quantityTon:'0.500'}]);
  for(const bad of [{custId:9,claimId:10,allocations:[]},{custId:9,claimId:0,allocations},{custId:9,claimId:2147483648,allocations}])
    await assert.rejects(applyShipmentClaimPlan(async()=>{},epoch1,bad,{reserve}),{code:'REBATE_CLAIM_INPUT_INVALID'});
});

test('claim lines are priced from the accrual snapshot',()=>{
  const lines=claimLinesFromPlan({allocations:[{accrualId:7,quantityTon:'1.250',amountBaht:'250.00',isOpeningBalance:false,sourceSOID:5,sourceListNo:2,
    sourceDocuNo:'I69-1',sourceDocuDate:'2026-11-14',sourceCouponNo:'C1',sourceRefSOID:3,sourceRefListNo:1,sourceBookingDocuNo:'B1',
    goodCode:'F',goodName:'Formula',listPricePerTon:'15600.00',netPricePerTon:'15800.00',rebatePerTon:'200.00',planId:null}]});
  assert.deepEqual(lines,[{lineNo:1,lineType:'REBATE',invoiceNo:'I69-1',goodCode:'F',goodName:'Formula',qtyTon:1.25,pricePerTon:15600,netPricePerTon:15800,
    rebatePerTon:200,planId:null,remark:null,amountBaht:'250.00',isOpeningBalance:false,accrualId:7,sourceSOID:5,sourceListNo:2,sourceDocuNo:'I69-1',
    sourceDocuDate:'2026-11-14',sourceCouponNo:'C1',sourceRefSOID:3,sourceRefListNo:1,sourceBookingDocuNo:'B1'}]);
  assert.throws(()=>claimLinesFromPlan({allocations:[]}),{code:'REBATE_CLAIM_INPUT_INVALID'});
});

test('release returns the reservations of a rejected claim with both identities and a reason',async()=>{
  const make=({claim={Id:10,CustId:'9'},affected=2}={})=>{const calls=[];return {calls,query:async(text,inputs)=>{calls.push({text,inputs});
    if(/sp_getapplock/.test(text))return {recordset:[{LockResult:0}]};
    if(/FROM wf\.RebateClaim WITH\(UPDLOCK,HOLDLOCK\)/.test(text))return {recordset:claim?[claim]:[]};
    if(/UPDATE wf\.RebateShipmentReservation/.test(text))return {recordset:[],rowsAffected:[affected]};
    return {recordset:[]};}};};
  const release={actorPrimaryId:1,effectivePrimaryId:12,actorBusinessId:101,effectiveBusinessId:112,reason:'  ปฏิเสธคำขอ: เอกสารไม่ครบ  '};
  const order=[],ok=make();
  const result=await releaseShipmentClaimReservations(ok.query,epoch1,{custId:9,claimId:10,release},{participantFence:async()=>{order.push('participant');}});
  assert.deepEqual(result,{released:2});
  assert.match(ok.calls[0].text,/SET ANSI_NULLS ON;.*SET NUMERIC_ROUNDABORT OFF;/s,'filtered-index SET options come first');
  assert.equal(ok.calls[1].inputs.resource,'RebateCust_9');
  const update=ok.calls.find(c=>/UPDATE wf\.RebateShipmentReservation/.test(c.text));
  assert.match(update.text,/WHERE ClaimId=@claimId AND Status='ACTIVE'/);
  assert.deepEqual(update.inputs,{claimId:10,actorPrimary:1,effectivePrimary:12,actorBusiness:101,effectiveBusiness:112,reason:'ปฏิเสธคำขอ: เอกสารไม่ครบ'});
  assert.deepEqual(order,['participant']);

  // nothing is released without a reason, a complete identity, a matching claim or a reset epoch
  const fence={participantFence:async()=>{}};
  for(const bad of [{...release,reason:'  '},{...release,reason:'x'.repeat(501)},{...release,actorBusinessId:0},{...release,effectivePrimaryId:null}]){
    const f=make();await assert.rejects(releaseShipmentClaimReservations(f.query,epoch1,{custId:9,claimId:10,release:bad},fence),{code:'REBATE_RELEASE_INPUT_INVALID'});assert.equal(f.calls.length,0);
  }
  await assert.rejects(releaseShipmentClaimReservations(make().query,{...epoch1,generation:0},{custId:9,claimId:10,release},fence),{code:'REBATE_RELEASE_INPUT_INVALID'});
  for(const claim of [null,{Id:10,CustId:'8'}]){
    const f=make({claim});await assert.rejects(releaseShipmentClaimReservations(f.query,epoch1,{custId:9,claimId:10,release},fence),{code:'REBATE_RELEASE_CLAIM_INVALID'});
    assert.equal(f.calls.some(c=>/UPDATE wf\.RebateShipmentReservation/.test(c.text)),false);
  }
  assert.deepEqual(await releaseShipmentClaimReservations(make({affected:0}).query,epoch1,{custId:9,claimId:10,release},fence),{released:0});
});
