'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {getShipmentCustomerQueue}=require('../services/rebate-shipment-queue');
const epoch={environment:'uat',generation:1,resetId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'};
const base={custId:7,asOfDate:'2026-11-14',cutoff:'2026-01-01',scope:{sql:'scope',inputs:{}},cycleMonths:12,epoch};
const row=(id,date)=>({AccrualId:id,EvidenceId:id,RedemptionId:id,RedemptionListNo:1,SourceSOID:id,SourceListNo:1,
  GoodId:2,BookingSOID:id,BookingLineNo:1,OriginalTon:'1.000',OriginalAmount:'100.00',RemainingTon:'1.000',
  RemainingAmountBaht:'100.00',RebatePerTon:'100.00',ListPricePerTon:'1000.00',NetPricePerTon:'900.00',
  EarnedDate:date,SourceDocuDate:date,SourceDocuNo:`DOC${id}`,OccurredAtUtc:new Date(date+'T01:00:00Z')});
function deps(rows){
  return {readLots:async()=>rows,lockShipment:async(_q,_epoch,key)=>{
    const r=rows.find(x=>x.RedemptionId===key.redemptionId);
    return {evidenceId:r.EvidenceId,sourceSOID:r.SourceSOID,sourceListNo:1,goodId:2,quantityTon:'1.000',occurredAtUtc:r.OccurredAtUtc};
  },lockSnapshot:async(_q,s)=>({bookingId:s.sourceSOID,bookingLineNo:1,customerId:7,rebatePerTon:'100.00',basePrice:'1000.00',sellingPrice:'900.00'})};
}
const query=async text=>({recordset:/sp_getapplock/.test(text)?[{LockResult:0}]:[]});
test('queue preserves opening balance while hiding old detail and verifies every source',async()=>{
  const rows=[row(1,'2025-12-01'),row(2,'2026-05-01')];
  const result=await getShipmentCustomerQueue(query,base,deps(rows));
  assert.equal(result.totalFifoEligibleBalance,200);assert.equal(result.openingEligibleBalance,100);
  assert.equal(result.openingEligibleCount,1);assert.deepEqual(result.eligibleLedgers.map(x=>x.docNo),['DOC2']);
  assert.equal(result.activeUnmaturedBalance,200);
});
test('old source document is hidden even when its shipment is within the window',async()=>{
  const r=row(2,'2026-05-01');r.SourceDocuDate='2025-12-01';
  const result=await getShipmentCustomerQueue(query,base,deps([r]));
  assert.equal(result.totalFifoEligibleBalance,100);assert.equal(result.eligibleLedgers[0].docNo,null);
});
test('changed source, excessive lots or an unavailable lock fail closed',async()=>{
  const r=row(1,'2026-05-01');r.RebatePerTon='101.00';
  await assert.rejects(getShipmentCustomerQueue(query,base,deps([r])),{code:'REBATE_RESERVATION_SOURCE_CHANGED'});
  const many=Array.from({length:501},(_,i)=>row(i+1,'2026-05-01'));
  await assert.rejects(getShipmentCustomerQueue(query,base,deps(many)),{code:'REBATE_QUEUE_TOO_MANY_LOTS'});
  await assert.rejects(getShipmentCustomerQueue(async()=>({recordset:[{LockResult:-1}]}),base,deps([r])),
    {code:'REBATE_RESERVATION_LOCK_UNAVAILABLE'});
});
test('an accrual dropped by an inner join makes the queue unavailable instead of lowering the total',async()=>{
  const r=row(1,'2026-05-01');
  const q=async text=>({recordset:/sp_getapplock/.test(text)?[{LockResult:0}]:[{Id:9}]});
  await assert.rejects(getShipmentCustomerQueue(q,base,deps([r])),{code:'REBATE_RESERVATION_SOURCE_CHANGED'});
});
