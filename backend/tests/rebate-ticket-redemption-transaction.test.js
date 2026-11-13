'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {applyTicketRedemption,executeTicketRedemption}=require('../services/rebate-ticket-redemption-transaction');
const requestId='e15f7d22-3a47-4fcb-a954-0112b1a3ed07';
const input={requestId,treatment:'ZERO'};
function fixture(){
  const state={receipt:null,allocations:[],history:[],balance:'1.0000',failHistory:false,context:{
    bookingId:10,lineNo:1,customer:7,good:3,requestedTonnage:'0.5000',docuNo:'TEST',
    today:'2026-11-14',nativeFingerprint:'a'.repeat(64),
    identity:{actorId:2,effectiveId:1},business:{actor:22,effective:11}}};
  let queue=Promise.resolve();
  const options={lockContext:async()=>({...state.context}),verifyFinancialTreatment:async()=>true,assertAging:async()=>{},
    epoch:{environment:'uat',generation:1},participantFence:async()=>{}};
  const query=async(text,p)=>{
    if(/SELECT \* FROM wf.RebateTicketRedemptionReceipt/.test(text))
      return {recordset:state.receipt?[state.receipt]:[]};
    if(/SELECT TicketId,Ordinal/.test(text))return {recordset:state.allocations};
    if(/SELECT Id,CustId,GoodId/.test(text))return {recordset:[{Id:5,CustId:7,GoodId:3,IssuedTonnage:'1.0000',
      RemainingTonnage:state.balance,IssuedDate:'2026-01-01',ExpiryDate:'2026-12-31',Status:'ACTIVE'}]};
    if(/INSERT wf.RebateTicketRedemptionReceipt/.test(text)){
      state.receipt={Id:9,RequestId:p.requestId,BookingSOID:p.bookingId,BookingLineNo:p.lineNo,CustId:p.customer,
        GoodId:p.good,QuantityTon:p.quantity,Treatment:p.treatment,NativeFingerprint:p.fingerprint,
        ActorPrimaryId:p.actor,EffectivePrimaryId:p.effective,ActorBusinessId:p.actorBusiness,EffectiveBusinessId:p.effectiveBusiness};
      return {recordset:[{Id:9}]};
    }
    if(/UPDATE wf.FertilizerTicket/.test(text)){
      if(state.balance!==p.before)return {rowsAffected:[0]};state.balance=p.after;return {rowsAffected:[1]};
    }
    if(/INSERT wf.RebateTicketRedemptionAllocation/.test(text)){
      state.allocations.push({TicketId:p.ticketId,Ordinal:p.ordinal,QuantityTon:p.quantity,RemainingBefore:p.before,RemainingAfter:p.after});
      return {rowsAffected:[1]};
    }
    if(/INSERT wf.TicketRedemptionHistory/.test(text)){if(state.failHistory)throw Error('audit failure');state.history.push(p);return {rowsAffected:[1]};}
    throw Error('unexpected SQL');
  };
  const run=(payload=input,opts=options)=>{
    const operation=async()=>{const before=structuredClone(state);
      try{return await applyTicketRedemption(query,payload,opts);}catch(e){Object.assign(state,before);throw e;}};
    const next=queue.then(operation,operation);queue=next.catch(()=>{});return next;
  };
  return {state,options,run};
}
test('concurrent identical retries deduct once and receipt records both mapped identities',async()=>{
  const f=fixture();const [a,b]=await Promise.all([f.run(),f.run()]);
  assert.equal(a.replayed,false);assert.equal(b.replayed,true);assert.equal(f.state.balance,'0.5000');
  assert.equal(f.state.history.length,1);assert.equal(f.state.allocations.length,1);
  assert.deepEqual([f.state.receipt.ActorPrimaryId,f.state.receipt.EffectivePrimaryId,
    f.state.receipt.ActorBusinessId,f.state.receipt.EffectiveBusinessId],[2,1,22,11]);
});
test('same booking with a different request or changed native source cannot deduct again',async()=>{
  const f=fixture();await f.run();
  await assert.rejects(f.run({...input,requestId:'1a5f7d22-3a47-4fcb-a954-0112b1a3ed07'}),{code:'TICKET_REDEMPTION_CONFLICT'});
  f.state.context.nativeFingerprint='b'.repeat(64);
  await assert.rejects(f.run(),{code:'TICKET_REDEMPTION_CONFLICT'});
  assert.equal(f.state.balance,'0.5000');assert.equal(f.state.history.length,1);
});
test('no accounting verifier, failed verifier or audit insertion failure leaves no deduction',async()=>{
  let f=fixture();await assert.rejects(f.run(input,{...f.options,verifyFinancialTreatment:undefined}),{code:'TICKET_FINANCIAL_PROOF_UNAVAILABLE'});
  assert.equal(f.state.receipt,null);
  f=fixture();await assert.rejects(f.run(input,{...f.options,verifyFinancialTreatment:async()=>false}),{code:'TICKET_FINANCIAL_PROOF_UNAVAILABLE'});
  assert.equal(f.state.balance,'1.0000');
  f=fixture();f.options.assertAging=async()=>{throw Error('aging blocked');};
  await assert.rejects(f.run(),/aging blocked/);assert.equal(f.state.receipt,null);
  f=fixture();f.state.failHistory=true;
  await assert.rejects(f.run(),/audit failure/);assert.equal(f.state.balance,'1.0000');assert.equal(f.state.receipt,null);
});
test('damaged allocation receipt cannot be replayed as success',async()=>{
  const f=fixture();await f.run();f.state.allocations[0].QuantityTon='0.4000';
  await assert.rejects(f.run(),{code:'TICKET_REDEMPTION_RECEIPT_INVALID'});
  assert.equal(f.state.balance,'0.5000');
});
test('missing or failing participant fence prevents all ticket writes',async()=>{
  let f=fixture();await assert.rejects(f.run(input,{...f.options,epoch:null}),{code:'REBATE_RESET_PARTICIPANT_MISMATCH'});
  assert.equal(f.state.receipt,null);assert.equal(f.state.balance,'1.0000');
  f=fixture();f.options.participantFence=async()=>{throw Error('reset fence');};
  await assert.rejects(f.run(),/reset fence/);assert.equal(f.state.receipt,null);assert.equal(f.state.balance,'1.0000');
});
test('transaction wrapper binds cutoff from the server rather than request data',async()=>{
  const f=fixture(),user={sub:1,role:'ADMIN'};
  const options={...f.options,readWindow:async()=>({businessDate:'2026-01-01'}),
    runFence:async fn=>fn({environment:'uat',generation:1}),
    runTx:async fn=>fn(async()=>{throw Error('stop after context');}),
    lockContext:async(_q,input)=>{assert.equal(input.startDate,'2026-01-01');assert.equal(input.user,user);throw Error('context inspected');}};
  await assert.rejects(executeTicketRedemption(user,{...input,bookingId:10,lineNo:1,requestedTonnage:'0.5',startDate:'1900-01-01'},options),/context inspected/);
});
