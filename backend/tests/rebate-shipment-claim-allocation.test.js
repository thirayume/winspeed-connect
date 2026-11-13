'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {allocateShipmentClaim}=require('../services/rebate-shipment-claim-allocation');
const lot=(id,doc,date,occurred)=>({AccrualId:id,SourceSOID:id+10,SourceListNo:1,SourceDocuNo:doc,SourceDocuDate:date,
  CouponNo:'C',GoodCode:'F',GoodName:'FERT',PlanId:4,ListPricePerTon:'1500.00',NetPricePerTon:'1000.00',RebatePerTon:'500.00',
  RemainingTon:'1.000',RemainingAmountBaht:'500.00',OccurredAtUtc:occurred});
const rows=[lot(2,'NEW','2026-03-01','2026-03-01T00:00:00Z'),lot(1,'OLD','2025-12-01','2026-02-01T00:00:00Z')];
test('opening and current claim lines reserve the same shipment lots in FIFO order',()=>{
  const r=allocateShipmentClaim(rows,[{goodCode:'F',openingBalance:true,qtyTon:'0.500'},
    {goodCode:'F',qtyTon:'0.250'}],{startDate:'2026-01-01'});
  assert.equal(r.totalAmount,'375.00');assert.deepEqual(r.allocations.map(a=>[a.accrualId,a.quantityTon,a.amountBaht,a.isOpeningBalance]),
    [[1,'0.500','250.00',true],[2,'0.250','125.00',false]]);
});
test('multiple lines from one shipment share one reservation and one rounding calculation',()=>{
  const r=allocateShipmentClaim([rows[1]],[{goodCode:'F',openingBalance:true,qtyTon:'0.100'},
    {goodCode:'F',openingBalance:true,qtyTon:'0.200'}],{startDate:'2026-01-01'});
  assert.equal(r.allocations.length,1);assert.equal(r.allocations[0].quantityTon,'0.300');assert.equal(r.totalAmount,'150.00');
});
test('specific 104 source is selected only within the correct window',()=>{
  const r=allocateShipmentClaim(rows,[{goodCode:'F',sourceSOID:12,sourceListNo:1,qtyTon:'0.100'}],{startDate:'2026-01-01'});
  assert.equal(r.allocations[0].accrualId,2);
  assert.throws(()=>allocateShipmentClaim(rows,[{goodCode:'F',sourceSOID:11,sourceListNo:1,qtyTon:'0.100'}],{startDate:'2026-01-01'}),{code:'REBATE_CLAIM_INSUFFICIENT'});
});
test('cannot overspend quantity or money or silently process a price-difference claim',()=>{
  assert.throws(()=>allocateShipmentClaim(rows,[{goodCode:'F',qtyTon:'1.001'}],{startDate:'2026-01-01'}),{code:'REBATE_CLAIM_INSUFFICIENT'});
  assert.throws(()=>allocateShipmentClaim(rows,[{goodCode:'F',qtyTon:'0.001',lineType:'DIFF'}],{startDate:'2026-01-01'}),{code:'REBATE_CLAIM_DIFFERENCE_UNAVAILABLE'});
  const tiny={...rows[0],RemainingTon:'0.001',RemainingAmountBaht:'0.01',ListPricePerTon:'1015.00',RebatePerTon:'15.00'};
  assert.throws(()=>allocateShipmentClaim([tiny],[{goodCode:'F',qtyTon:'0.001'}],{startDate:'2026-01-01'}),{code:'REBATE_CLAIM_INSUFFICIENT'});
});
test('duplicate shipment or inconsistent price snapshot fails closed',()=>{
  assert.throws(()=>allocateShipmentClaim([rows[0],rows[0]],[{goodCode:'F',qtyTon:'0.1'}],{startDate:'2026-01-01'}),{code:'REBATE_SOURCE_INVALID'});
  assert.throws(()=>allocateShipmentClaim([{...rows[0],NetPricePerTon:'999.00'}],[{goodCode:'F',qtyTon:'0.1'}],{startDate:'2026-01-01'}),{code:'REBATE_SOURCE_INVALID'});
});
