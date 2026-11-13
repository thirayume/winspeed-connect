'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const { evaluateRebatePriceDecision }=require('../services/rebate-price-authority');
const { saveBookingPriceSnapshots, assertBookingSnapshotEditable }=require('../services/rebate-booking-snapshot');

test('native editing is refused when a price snapshot exists and lookup uses a transaction lock', async () => {
  let sqlText='';
  const query=async (text, params) => { sqlText=text; assert.equal(params.bookingId,52); return {recordset:[{BookingSOID:52}]}; };
  await assert.rejects(assertBookingSnapshotEditable(query,52), {code:'REBATE_BOOKING_RECONCILIATION_REQUIRED'});
  assert.match(sqlText,/UPDLOCK,HOLDLOCK/);
  await assertBookingSnapshotEditable(async()=>({recordset:[]}),52);
  await assert.rejects(assertBookingSnapshotEditable(query,'not-an-id'),{code:'REBATE_BOOKING_PROOF_INVALID'});
});

async function fixture({selling='17750.00',cash=false}={}) {
  const source={SetPriceID:9,ListNo:1,GoodId:17,BeginDate:'2026-01-01',EndDate:'2026-12-31',BasePrice:'18000.00',DatabaseName:'UAT',ServerName:'TEST\\SQL'};
  const d=await evaluateRebatePriceDecision(async()=>({recordset:[source]}),{draftId:23,lineNo:1,revision:3,goodId:17,saleDate:'2026-04-02',qtyTon:'1.000',sellingPrice:selling,isCashDiscount:cash});
  const state={approval:{Id:4,Decision:'APPROVED'}, snapshots:[],changed:false};
  const query=async(text,p)=>{
    if(/FROM dbo\.SOHD h/.test(text)) return {recordset:[{SOID:52,DocuType:'103',SaleDate:'2026-04-02',ListNo:1,GoodID:17,GoodQty2:'1.000',GoodPrice2:state.changed?'1.00':String(d.calculation.invoiceUnitPrice),DatabaseName:'UAT',ServerName:'TEST\\SQL'}]};
    if(/FROM wf\.RebatePriceApprovalEvidence/.test(text)) return {recordset:state.approval?[state.approval]:[]};
    if(/FROM wf\.RebateBookingPriceSnapshot/.test(text)) return {recordset:state.snapshots.map(s=>({DecisionFingerprint:s.fingerprint,ApprovalEvidenceId:s.approvalId,
      DraftId:s.draftId,DocumentRevision:s.revision,GoodId:s.goodId,SaleDate:s.saleDate,SourceServer:s.server,SourceDatabase:s.database,
      SetPriceId:s.setPriceId,SetPriceListNo:s.priceListNo,PriceBegin:s.priceBegin,PriceEnd:s.priceEnd,
      BasePrice:s.base,SellingPrice:s.selling,InvoicePrice:s.invoice,QuantityTon:s.quantity,IsCashDiscount:s.isCash,
      RebatePerTon:s.rebate,TotalRebate:s.total,RequiresManagerApproval:s.needsApproval}))};
    if(/INSERT INTO wf\.RebateBookingPriceSnapshot/.test(text)){state.snapshots.push(p);return {rowsAffected:[1]};}
    throw Error('unexpected SQL');
  };
  const run=async()=>{const before=structuredClone(state);try{return await saveBookingPriceSnapshots(query,{bookingId:52,decisions:[d]});}catch(e){Object.assign(state,before);throw e;}};
  return {state,d,run};
}
test('snapshot requires matching approval and is idempotent',async()=>{
  const f=await fixture();
  assert.deepEqual(await f.run(),{bookingId:52,lines:[{lineNo:1,replayed:false}]});
  assert.equal(f.state.snapshots[0].approvalId,4);assert.equal(f.state.snapshots[0].total,'250.00');
  assert.deepEqual(await f.run(),{bookingId:52,lines:[{lineNo:1,replayed:true}]});
  assert.equal(f.state.snapshots.length,1);
});
test('missing/rejected approval or changed 103 cannot create a snapshot',async()=>{
  for(const mutate of [f=>f.state.approval=null,f=>f.state.approval.Decision='REJECTED',f=>f.state.changed=true]){
    const f=await fixture();mutate(f);await assert.rejects(f.run());assert.deepEqual(f.state.snapshots,[]);
  }
});
test('standard or cash-discount decisions need no manager receipt and retain exact amounts',async()=>{
  const f=await fixture({selling:'17900.00'});f.state.approval=null;await f.run();
  assert.equal(f.state.snapshots[0].approvalId,null);assert.equal(f.state.snapshots[0].total,'100.00');
  const c=await fixture({selling:'17750.00',cash:true});c.state.approval=null;await c.run();
  assert.equal(c.state.snapshots[0].total,'0.00');assert.equal(c.state.snapshots[0].invoice,'17750');
});
test('conflicting prior snapshot fails closed',async()=>{
  const f=await fixture();await f.run();f.state.snapshots[0].fingerprint='b'.repeat(64);
  await assert.rejects(f.run(),{code:'REBATE_BOOKING_SNAPSHOT_CONFLICT'});assert.equal(f.state.snapshots.length,1);
});
test('replay fails if stored price or identity differs even when fingerprint is unchanged',async()=>{
  for (const mutate of [s=>s.selling='17749.00',s=>s.database='OTHER',s=>s.total='249.99']) {
    const f=await fixture();await f.run();mutate(f.state.snapshots[0]);
    await assert.rejects(f.run(),{code:'REBATE_BOOKING_SNAPSHOT_CONFLICT'});
  }
});
test('missing approval on a later line rolls back earlier snapshot in the caller transaction',async()=>{
  const first=await fixture({selling:'17900.00'}),second=await fixture();
  const d1=first.d;
  const { fingerprintRebateDecision }=require('../services/rebate-price-authority');
  const d2={...second.d,lineNo:2};d2.fingerprint=fingerprintRebateDecision(d2);
  const rows=[d1,d2].map(d=>({SOID:52,DocuType:'103',SaleDate:d.saleDate,ListNo:d.lineNo,GoodID:d.goodId,
    GoodQty2:d.quantity,GoodPrice2:String(d.calculation.invoiceUnitPrice),DatabaseName:'UAT',ServerName:'TEST\\SQL'}));
  const state={snapshots:[]};
  const query=async(text,p)=>{
    if(/FROM dbo\.SOHD h/.test(text))return {recordset:rows};
    if(/FROM wf\.RebatePriceApprovalEvidence/.test(text))return {recordset:[]};
    if(/FROM wf\.RebateBookingPriceSnapshot/.test(text))return {recordset:[]};
    if(/INSERT INTO wf\.RebateBookingPriceSnapshot/.test(text)){state.snapshots.push(p);return {rowsAffected:[1]};}
    throw Error('unexpected SQL');
  };
  const before=structuredClone(state);
  try {await saveBookingPriceSnapshots(query,{bookingId:52,decisions:[d1,d2]});assert.fail('expected missing approval');}
  catch(e){Object.assign(state,before);assert.equal(e.code,'REBATE_PRICE_APPROVAL_REQUIRED');}
  assert.deepEqual(state.snapshots,[]);
});
