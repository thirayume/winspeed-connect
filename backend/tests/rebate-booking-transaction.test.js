'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {stageBookingInvoicePrices,finalizeBookingPriceSnapshots}=require('../services/rebate-booking-transaction');
const draft={Id:51,DocumentRevision:3};
const lines=[{SoId:51,LineNum:1,GoodId:12,QtyTon:2,PricePerTon:9750,RebatePricingMode:'POOL'}];

function fixture() {
  const state={approval:true,writeOk:true,changed:false,updates:[],saved:[]};
  const query=async(text,p)=>{
    if(/FROM dbo\.EMSetPriceHD/.test(text)) return {recordset:[{SetPriceID:8,ListNo:1,GoodId:12,
      BeginDate:'2026-01-01',EndDate:'2026-12-31',BasePrice:10000,DatabaseName:'test_uat',ServerName:'test_server'}]};
    if(/FROM wf\.RebatePriceApprovalEvidence/.test(text))return {recordset:state.approval?[{Id:7,Decision:'APPROVED'}]:[]};
    if(/UPDATE wf\.SalesOrderLine/.test(text)){state.updates.push(p);return {rowsAffected:[state.writeOk?1:0]};}
    if(/FROM dbo\.SOHD h/.test(text))return {recordset:[{SOID:52,DocuType:'103',SaleDate:'2026-11-13',ListNo:1,
      GoodID:12,GoodQty2:2,GoodPrice2:state.changed?9750:10000,DatabaseName:'test_uat',ServerName:'test_server'}]};
    if(/SELECT DecisionFingerprint,ApprovalEvidenceId/.test(text))return {recordset:[]};
    if(/INSERT INTO wf\.RebateBookingPriceSnapshot/.test(text)){state.saved.push(p);return {rowsAffected:[1]};}
    throw new Error('unexpected SQL');
  };
  return {state,query};
}
const args={draft,lines,saleDate:'2026-11-13'};
test('stages the official invoice price and snapshots only an exact persisted 103',async()=>{
  const f=fixture(),decisions=await stageBookingInvoicePrices(f.query,args);
  assert.equal(f.state.updates[0].invoice,'10000');
  assert.equal(f.state.updates[0].selling,'9750.00');
  await finalizeBookingPriceSnapshots(f.query,{bookingId:52,decisions});
  assert.equal(f.state.saved.length,1);
});
test('missing approval prevents all price writes and a changed draft fails',async()=>{
  const f=fixture();f.state.approval=false;
  await assert.rejects(stageBookingInvoicePrices(f.query,args),{code:'REBATE_PRICE_APPROVAL_REQUIRED'});
  assert.equal(f.state.updates.length,0);
  f.state.approval=true;f.state.writeOk=false;
  await assert.rejects(stageBookingInvoicePrices(f.query,args),{code:'REBATE_BOOKING_DRAFT_CHANGED'});
});
test('a native booking with changed price is not snapshotted',async()=>{
  const f=fixture(),decisions=await stageBookingInvoicePrices(f.query,args);f.state.changed=true;
  await assert.rejects(finalizeBookingPriceSnapshots(f.query,{bookingId:52,decisions}),{code:'REBATE_BOOKING_PROOF_MISMATCH'});
  assert.equal(f.state.saved.length,0);
});
