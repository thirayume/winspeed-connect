'use strict';

// Internal transaction bridge: the caller must already hold header and line
// locks, own the 103 transaction and run all existing cost/credit checks.
// It is deliberately not mounted until the complete shipment/claim path is ready.
const {prepareRebateBookingDecisions}=require('./rebate-booking-decisions');
const {saveBookingPriceSnapshots}=require('./rebate-booking-snapshot');
function fail(code) {throw Object.assign(new Error(code),{code,status:409});}

async function stageBookingInvoicePrices(query,{draft,lines,saleDate}={}) {
  const decisions=await prepareRebateBookingDecisions(query,{draft,lines,saleDate});
  // Check every required approval before writing any draft price. The outer
  // transaction is still responsible for rollback if any later step fails.
  for(const d of decisions) if(d.calculation.requiresManagerApproval) {
    const rows=(await query(`SELECT Id,Decision FROM wf.RebatePriceApprovalEvidence WITH(UPDLOCK,HOLDLOCK)
      WHERE DecisionFingerprint=@fingerprint AND DraftId=@draftId AND [LineNo]=@lineNo AND DocumentRevision=@revision`,
    {fingerprint:d.fingerprint,draftId:d.draftId,lineNo:d.lineNo,revision:d.revision})).recordset || [];
    if(rows.length!==1 || rows[0].Decision!=='APPROVED' || !Number.isSafeInteger(Number(rows[0].Id)) || Number(rows[0].Id)<=0)
      fail('REBATE_PRICE_APPROVAL_REQUIRED');
  }
  for(const d of decisions) {
    const r=await query(`UPDATE wf.SalesOrderLine SET PricePerTon=CAST(@invoice AS decimal(12,2))
      WHERE SoId=@draftId AND LineNum=@lineNo AND GoodId=@goodId AND QtyTon=CAST(@quantity AS decimal(18,3))
        AND PricePerTon=CAST(@selling AS decimal(12,2)) AND RebatePricingMode=@mode`,{
      invoice:String(d.calculation.invoiceUnitPrice),draftId:d.draftId,lineNo:d.lineNo,goodId:d.goodId,
      quantity:d.quantity,selling:d.sellingPrice,mode:d.isCashDiscount?'CASH':'POOL'});
    if(Number(r.rowsAffected?.[0])!==1) fail('REBATE_BOOKING_DRAFT_CHANGED');
  }
  return decisions;
}

async function finalizeBookingPriceSnapshots(query,{bookingId,decisions}={}) {
  return saveBookingPriceSnapshots(query,{bookingId:Number(bookingId),decisions});
}
module.exports={stageBookingInvoicePrices,finalizeBookingPriceSnapshots};
