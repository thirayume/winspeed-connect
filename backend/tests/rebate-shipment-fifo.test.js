'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {allocateShipmentRebate}=require('../services/rebate-shipment-fifo');
const lots=[
  {AccrualId:2,EarnedDate:'2026-02-01',OccurredAtUtc:'2026-01-31T18:00:00Z',RemainingTon:'2.000',RebatePerTon:'200.00',RemainingAmountBaht:'400.00'},
  {AccrualId:1,EarnedDate:'2025-02-01',OccurredAtUtc:'2025-02-01T03:00:00Z',RemainingTon:'1.000',RebatePerTon:'100.00',RemainingAmountBaht:'100.00'},
];
test('FIFO consumes verified shipment balances including an opening balance',()=>{
  const r=allocateShipmentRebate(lots,{requestedAmountBaht:'250.00',asOfDate:'2026-06-01'});
  assert.deepEqual(r.allocations,[{accrualId:1,quantityTon:'1.000',amountBaht:'100.00'},
    {accrualId:2,quantityTon:'0.750',amountBaht:'150.00'}]);
  assert.equal(r.remainingBaht,'250.00');
});
test('same-day ordering uses the actual UTC event time, not ledger id',()=>{
  const rows=[{...lots[1],AccrualId:1,OccurredAtUtc:'2025-02-01T06:00:00Z'},
    {...lots[1],AccrualId:2,OccurredAtUtc:'2025-02-01T04:00:00Z'}];
  assert.equal(allocateShipmentRebate(rows,{requestedAmountBaht:'100.00',asOfDate:'2026-06-01'}).allocations[0].accrualId,2);
});
test('early conversion is supported and maturity is optional',()=>{
  assert.equal(allocateShipmentRebate(lots,{convertAll:true,asOfDate:'2026-06-01'}).convertedBaht,'500.00');
  assert.equal(allocateShipmentRebate(lots,{convertAll:true,maturedOnly:true,asOfDate:'2026-06-01'}).convertedBaht,'100.00');
});
test('remaining baht caps split rounding and cannot overdraw an accrual',()=>{
  const rows=[{...lots[0],RemainingTon:'0.001',RebatePerTon:'15.00',RemainingAmountBaht:'0.01'}];
  assert.throws(()=>allocateShipmentRebate(rows,{convertAll:true,asOfDate:'2026-06-01'}),{code:'INVALID_CONVERSION_AMOUNT'});
});
test('duplicates, inconsistent Bangkok dates, overdraw and unrepresentable amounts fail closed',()=>{
  assert.throws(()=>allocateShipmentRebate([lots[0],lots[0]],{convertAll:true,asOfDate:'2026-06-01'}),{code:'REBATE_SOURCE_INVALID'});
  assert.throws(()=>allocateShipmentRebate([{...lots[0],EarnedDate:'2026-01-31'}],{convertAll:true,asOfDate:'2026-06-01'}),{code:'REBATE_SOURCE_INVALID'});
  assert.throws(()=>allocateShipmentRebate(lots,{requestedAmountBaht:'501.00',asOfDate:'2026-06-01'}),{code:'INSUFFICIENT_REBATE_BALANCE'});
  assert.throws(()=>allocateShipmentRebate([{...lots[0],RebatePerTon:'1500.00'}],{requestedAmountBaht:'1.00',asOfDate:'2026-06-01'}),{code:'CONVERSION_AMOUNT_NOT_REPRESENTABLE'});
});
