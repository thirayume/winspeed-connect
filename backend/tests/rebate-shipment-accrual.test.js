'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { accrueVerifiedShipment, accrueReviewedShipment } = require('../services/rebate-shipment-accrual');

function fixture() {
  const epoch={environment:'uat',generation:1,resetId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',lastResetAtUtc:new Date('2026-11-13T12:00:00Z')};
  const source={evidenceId:1,sourceSOID:40,sourceListNo:1,couponId:30,goodId:20,quantityTon:'0.500',occurredAtUtc:new Date('2026-11-13T13:00:00Z')};
  const lot={bookingId:50,bookingLineNo:1,customerId:9,bookingQty:'1.000',deliveryQty:'1.000',basePrice:'2000.00',sellingPrice:'1750.00',rebatePerTon:'250.00'};
  const state={rows:[], snapshotAvailable:true, invalidSource:false, failAfterInsert:false}; let queue=Promise.resolve();
  const overrides={lockShipment:async()=>{if(state.invalidSource) throw Object.assign(Error('changed'),{code:'REBATE_EVIDENCE_SOURCE_CHANGED'});return source;},
    lockSnapshot:async()=>{if(!state.snapshotAvailable) throw Object.assign(Error('missing'),{code:'REBATE_BOOKING_SNAPSHOT_UNAVAILABLE'});return lot;}};
  const query=async(text,p)=>{
    if (/SELECT \* FROM wf.RebateShipmentAccrual/.test(text)) return {recordset:state.rows.filter(r=>r.EvidenceId===p.evidenceId)};
    if (/AS DeliveryTon/.test(text)) return {recordset:[{
      DeliveryTon:state.rows.filter(r=>r.SourceSOID===p.sourceSOID&&r.SourceListNo===p.sourceListNo).reduce((n,r)=>n+Number(r.QuantityTon),0).toFixed(3),
      BookingTon:state.rows.filter(r=>r.BookingSOID===p.bookingId&&r.BookingLineNo===p.bookingLineNo).reduce((n,r)=>n+Number(r.QuantityTon),0).toFixed(3)}]};
    if (/INSERT wf.RebateShipmentAccrual/.test(text)) {
      assert.match(text, /OUTPUT INSERTED\.Id INTO @inserted/);
      assert.match(text, /SELECT Id FROM @inserted/);
      const row={Id:state.rows.length+1,Generation:p.generation,EvidenceId:p.evidenceId,SourceSOID:p.sourceSOID,SourceListNo:p.sourceListNo,
        CouponId:p.couponId,GoodId:p.goodId,CustId:p.custId,PlanId:null,BookingSOID:p.bookingId,BookingLineNo:p.bookingLineNo,QuantityTon:p.quantity,ListPricePerTon:p.listPrice,NetPricePerTon:p.netPrice,
        RebatePerTon:p.rate,AmountBaht:p.amount,OccurredAtUtc:p.occurred};
      state.rows.push(row);if(state.failAfterInsert) throw Error('simulated insert failure');return {recordset:[{Id:row.Id}]};
    }
    throw Error('Unexpected SQL');
  };
  const run=()=>{const execute=async()=>{const before=structuredClone(state);try{return await accrueVerifiedShipment(query,epoch,{redemptionId:10,listNo:1},overrides);}
    catch(e){Object.assign(state,before);throw e;}};const next=queue.then(execute,execute);queue=next.catch(()=>{});return next;};
  return {state,source,lot,run,query,epoch,overrides};
}
test('verified shipment accrues once and retry returns its receipt',async()=>{
  const f=fixture();const [a,b]=await Promise.all([f.run(),f.run()]);
  assert.deepEqual(a,{id:1,replayed:false});assert.deepEqual(b,{id:1,replayed:true});
  assert.equal(f.state.rows.length,1);assert.equal(f.state.rows[0].AmountBaht,'125.00');
});
test('multiple shipments cannot exceed the source sale quantity',async()=>{
  const f=fixture();await f.run();f.source.evidenceId=2;f.source.quantityTon='0.501';
  await assert.rejects(f.run(),{code:'REBATE_SHIPMENT_EXCEEDS_SALE'});assert.equal(f.state.rows.length,1);
  f.source.quantityTon='0.500';await f.run();assert.equal(f.state.rows.length,2);
});
test('different 104 documents cannot together exceed the same 103 booking line',async()=>{
  const f=fixture();await f.run();f.source.evidenceId=2;f.source.sourceSOID=41;f.source.quantityTon='0.501';
  await assert.rejects(f.run(),{code:'REBATE_SHIPMENT_EXCEEDS_SALE'});assert.equal(f.state.rows.length,1);
});
test('a zero rebate records no positive balance',async()=>{
  const f=fixture();f.lot.rebatePerTon='0.00';
  assert.deepEqual(await f.run(),{skipped:true,reason:'NO_REBATE'});assert.equal(f.state.rows.length,0);
});
test('a zero rate on a changed replay never hides an existing accrued balance',async()=>{
  const f=fixture();await f.run();f.lot.rebatePerTon='0.00';
  await assert.rejects(f.run(),{code:'REBATE_SHIPMENT_RECEIPT_INVALID'});
  assert.equal(f.state.rows.length,1);assert.equal(f.state.rows[0].AmountBaht,'125.00');
});
test('source changes, missing snapshot and a failed insert cannot create a balance',async()=>{
  for(const mutate of [f=>f.state.invalidSource=true,f=>f.state.snapshotAvailable=false,f=>f.state.failAfterInsert=true]){
    const f=fixture();mutate(f);await assert.rejects(f.run());assert.deepEqual(f.state.rows,[]);
  }
});
test('a changed replay receipt fails closed',async()=>{
  const f=fixture();await f.run();f.state.rows[0].QuantityTon='0.600';
  await assert.rejects(f.run(),{code:'REBATE_SHIPMENT_RECEIPT_INVALID'});
});
test('fractional baht uses exact half-up rounding and tiny nonpositive credits are refused',async()=>{
  const f=fixture();f.source.quantityTon='0.001';f.lot.rebatePerTon='15.00';await f.run();
  assert.equal(f.state.rows[0].AmountBaht,'0.02');
  const g=fixture();g.source.quantityTon='0.001';g.lot.rebatePerTon='0.01';
  await assert.rejects(g.run(),{code:'REBATE_SHIPMENT_AMOUNT_INVALID'});assert.deepEqual(g.state.rows,[]);
});
test('the entry point holds the global fence around the entire business transaction',async()=>{
  const calls=[];const failure=Object.assign(Error('closed'),{code:'REBATE_RESET_IN_PROGRESS_OR_UNINITIALIZED'});
  await assert.rejects(accrueReviewedShipment({redemptionId:10,listNo:1},{
    runFence:async()=>{calls.push('fence');throw failure;},
    runTx:async()=>{calls.push('transaction');},
  }),{code:failure.code});
  assert.deepEqual(calls,['fence']);
  const f=fixture(); let fenced=false,participant=false;
  await assert.rejects(accrueReviewedShipment({redemptionId:10,listNo:1},{...f.overrides,
    runFence:async fn=>{fenced=true;try{return await fn(f.epoch);}finally{fenced=false;}},
    runTx:async fn=>{assert.equal(fenced,true);return fn(f.query);},
    participantFence:async()=>{assert.equal(fenced,true);participant=true;},
  }),{code:'REBATE_POOL_PRICING_SOURCE_UNAVAILABLE'});
  assert.equal(participant,true);assert.deepEqual(f.state.rows,[]);assert.equal(fenced,false);
});
