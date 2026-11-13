'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {reserveShipmentAccrual}=require('../services/rebate-shipment-reservation');

function fixture(){
  const epoch={environment:'uat',generation:1,resetId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',lastResetAtUtc:new Date('2026-11-13T12:00:00Z')};
  const shipment={evidenceId:1,sourceSOID:40,sourceListNo:1,couponId:30,goodId:20,quantityTon:'1.000',occurredAtUtc:new Date('2026-11-13T13:00:00Z')};
  const snapshot={bookingId:50,bookingLineNo:1,customerId:9,basePrice:'1500.00',sellingPrice:'1250.00',rebatePerTon:'250.00'};
  const accrual={Id:5,CustId:9,Generation:1,EvidenceId:1,SourceSOID:40,SourceListNo:1,CouponId:30,GoodId:20,
    PlanId:null,BookingSOID:50,BookingLineNo:1,QuantityTon:'1.000',ListPricePerTon:'1500.00',NetPricePerTon:'1250.00',RebatePerTon:'250.00',AmountBaht:'250.00',OccurredAtUtc:shipment.occurredAtUtc};
  const state={reservations:[],claimStatus:'TIER2_PENDING',conversionStatus:'ISSUED',badSource:false,lockResult:0};let queue=Promise.resolve();
  const query=async(text,p)=>{
    if (/SET ANSI_NULLS ON/.test(text)) return {};
    if (/SELECT a.CustId,e.RedemptionId/.test(text)) return {recordset:[{CustId:accrual.CustId,RedemptionId:10,RedemptionListNo:1}]};
    if (/sp_getapplock/.test(text)) return {recordset:[{LockResult:state.lockResult}]};
    if (/SELECT \* FROM wf.RebateShipmentAccrual/.test(text)) return {recordset:[accrual]};
    if (/SELECT Id,CustId,Status FROM wf.RebateClaim/.test(text)) return {recordset:[{Id:p.documentId,CustId:9,Status:state.claimStatus}]};
    if (/SELECT Id,CustId,Status FROM wf.FertilizerTicketConversion/.test(text)) return {recordset:[{Id:p.documentId,CustId:9,Status:state.conversionStatus}]};
    if (/SELECT Id,QuantityTon,AmountBaht,Status FROM wf.RebateShipmentReservation/.test(text)) {
      const field=/AND ClaimId=/.test(text)?'ClaimId':'ConversionId';return {recordset:state.reservations.filter(r=>r[field]===p.documentId)};
    }
    if (/SELECT COALESCE\(SUM\(QuantityTon\)/.test(text)) return {recordset:[{
      QuantityTon:state.reservations.filter(r=>r.Status==='ACTIVE').reduce((n,r)=>n+Number(r.QuantityTon),0).toFixed(3),
      AmountBaht:state.reservations.filter(r=>r.Status==='ACTIVE').reduce((n,r)=>n+Number(r.AmountBaht),0).toFixed(2)}]};
    if (/INSERT wf.RebateShipmentReservation/.test(text)) {const row={Id:state.reservations.length+1,ClaimId:p.claimId,ConversionId:p.conversionId,
      QuantityTon:p.quantity,AmountBaht:p.amount,Status:'ACTIVE'};state.reservations.push(row);return {recordset:[{Id:row.Id}]};}
    throw Error('Unexpected SQL');
  };
  const overrides={participantFence:async()=>{},lockShipment:async()=>{if(state.badSource) throw Object.assign(Error('changed'),{code:'REBATE_EVIDENCE_SOURCE_CHANGED'});return shipment;},lockSnapshot:async()=>snapshot};
  const run=input=>{const execute=async()=>{const before=structuredClone(state);try{return await reserveShipmentAccrual(query,epoch,input,overrides);}
    catch(e){Object.assign(state,before);throw e;}};const next=queue.then(execute,execute);queue=next.catch(()=>{});return next;};
  return {state,accrual,shipment,snapshot,run};
}
const input={accrualId:5,custId:9,documentId:1,documentType:'CLAIM',quantityTon:'0.600'};
test('claim and conversion share one quantity and cannot consume it twice',async()=>{
  const f=fixture();const result=await Promise.allSettled([f.run(input),f.run({...input,documentId:2,documentType:'CONVERSION',quantityTon:'0.500'})]);
  assert.deepEqual(result.map(r=>r.status),['fulfilled','rejected']);assert.equal(result[1].reason.code,'REBATE_RESERVATION_INSUFFICIENT');
  assert.equal(f.state.reservations.length,1);assert.equal(f.state.reservations[0].AmountBaht,'150.00');
});
test('replay is idempotent but changed request and released rows cannot be reused',async()=>{
  const f=fixture();assert.deepEqual(await f.run(input),{id:1,replayed:false});
  assert.deepEqual(await f.run(input),{id:1,replayed:true});
  await assert.rejects(f.run({...input,quantityTon:'0.500'}),{code:'REBATE_RESERVATION_RECEIPT_CONFLICT'});
  f.state.reservations[0].Status='RELEASED';await assert.rejects(f.run(input),{code:'REBATE_RESERVATION_RECEIPT_CONFLICT'});
});
test('a cancelled source, altered accrual or unavailable lock cannot reserve',async()=>{
  for(const mutate of [f=>f.state.badSource=true,f=>f.accrual.AmountBaht='501.00',f=>f.snapshot.bookingId=51,
    f=>f.snapshot.rebatePerTon='249.00',f=>f.state.lockResult=-1]){
    const f=fixture();mutate(f);await assert.rejects(f.run(input));assert.deepEqual(f.state.reservations,[]);
  }
});
test('completed or rejected claims cannot acquire a new reservation',async()=>{
  for(const status of ['APPROVED','REJECTED','CANCELLED','CN_ISSUED']){
    const f=fixture();f.state.claimStatus=status;await assert.rejects(f.run(input),{code:'REBATE_RESERVATION_DOCUMENT_INVALID'});
  }
});
test('rounding slices cannot reserve more baht than the verified accrual',async()=>{
  const f=fixture();f.shipment.quantityTon='0.002';f.accrual.QuantityTon='0.002';
  f.snapshot.basePrice='1015.00';f.snapshot.sellingPrice='1000.00';f.snapshot.rebatePerTon='15.00';
  f.accrual.ListPricePerTon='1015.00';f.accrual.NetPricePerTon='1000.00';f.accrual.RebatePerTon='15.00';f.accrual.AmountBaht='0.03';
  await f.run({...input,quantityTon:'0.001'});
  await assert.rejects(f.run({...input,documentId:2,documentType:'CONVERSION',quantityTon:'0.001'}),{code:'REBATE_RESERVATION_INSUFFICIENT'});
  assert.equal(f.state.reservations[0].AmountBaht,'0.02');
});
