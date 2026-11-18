'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluateRebatePriceDecision}=require('../services/rebate-price-authority');
const {lockShipmentBookingSnapshot}=require('../services/rebate-shipment-booking-snapshot');

async function fixture(){
  const d=await evaluateRebatePriceDecision(async()=>({recordset:[{SetPriceID:8,ListNo:1,GoodId:12,
    BeginDate:'2026-01-01',EndDate:'2026-12-31',BasePrice:10000,DatabaseName:'uat',ServerName:'server'}]}),
  {draftId:51,lineNo:1,revision:3,goodId:12,saleDate:'2026-11-13',qtyTon:2,sellingPrice:9750,isCashDiscount:false});
  const row={DeliveryId:77,DeliveryCustId:8,DeliveryLineNo:1,DeliveryGoodId:12,DeliveryQty:2,DeliveryPrice:10000,DeliveryUnitId:3,
    BookingId:52,BookingCustId:8,BookingStatus:'Y',BookingDate:'2026-11-13',BookingLineNo:1,BookingGoodId:12,BookingQty:2,BookingPrice:10000,BookingUnitId:3,
    DatabaseName:'uat',ServerName:'server',DraftId:51,DocumentRevision:3,GoodId:12,SaleDate:'2026-11-13',SourceServer:'server',SourceDatabase:'uat',
    SetPriceId:8,SetPriceListNo:1,PriceBegin:'2026-01-01',PriceEnd:'2026-12-31',BasePrice:10000,SellingPrice:9750,InvoicePrice:10000,QuantityTon:2,
    IsCashDiscount:0,RebatePerTon:250,TotalRebate:500,RequiresManagerApproval:1,ApprovalEvidenceId:7,DecisionFingerprint:d.fingerprint,
    ApprovalDecision:'APPROVED',ApprovalFingerprint:d.fingerprint};
  const shipment={sourceSOID:77,sourceListNo:1,goodId:12,quantityTon:'1.000'};
  let seen='';
  const query=async(text)=>{seen=text;return {recordset:[row]};};
  return {row,shipment,query,getSql:()=>seen};
}
test('verified shipment resolves the matching locked 103 snapshot and exact approval',async()=>{
  const f=await fixture();const r=await lockShipmentBookingSnapshot(f.query,f.shipment);
  assert.equal(r.bookingId,52);assert.equal(r.rebatePerTon,'250');assert.equal(r.quantityTon,'1.000');
  assert.match(f.getSql(),/bd\.SOID=b\.SOID AND bd\.ListNo=d\.RefListNo/);
  assert.match(f.getSql(),/UPDLOCK,HOLDLOCK/);
});
test('missing 103 or snapshot is held rather than credited',async()=>{
  const f=await fixture();f.row.DecisionFingerprint=null;
  await assert.rejects(lockShipmentBookingSnapshot(f.query,f.shipment),{code:'REBATE_BOOKING_SNAPSHOT_UNAVAILABLE'});
});
test('changed source, approval, tenant or quantity fails closed',async()=>{
  for(const [key,value] of [['DeliveryPrice',9999],['BookingQty',3],['BookingCustId',9],['DeliveryUnitId',4],
    ['ServerName','other'],['ApprovalDecision','REJECTED'],['DecisionFingerprint','a'.repeat(64)],['BookingStatus','C']]){
    const f=await fixture();f.row[key]=value;
    await assert.rejects(lockShipmentBookingSnapshot(f.query,f.shipment),{code:'REBATE_BOOKING_SOURCE_CHANGED'});
  }
  const f=await fixture();f.shipment.quantityTon='3.000';
  await assert.rejects(lockShipmentBookingSnapshot(f.query,f.shipment),{code:'REBATE_BOOKING_SOURCE_CHANGED'});
});
