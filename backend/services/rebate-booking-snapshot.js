'use strict';

// Internal 103 transaction primitive. The caller must obtain the locked draft,
// derive decisions on the server, authorize the confirmation, and call this
// after 103 is created but before the same transaction commits. This is not a
// route and does not make decisions or approvals supplied by a browser trusted.
const { verifyBookingPricing } = require('./rebate-booking-proof');
const { shipmentUnits, shipmentMoney } = require('./rebate-shipment-accrual');
function fail(code) { throw Object.assign(new Error(code), { code, status: 409 }); }
const positive = n => Number.isSafeInteger(n) && n > 0;

// The native editor rewrites 103 lines; refuse edits until a reconciliation
// contract is implemented. This cannot prevent direct edits in WinSpeed.
async function assertBookingSnapshotEditable(query, bookingId) {
  const id=Number(bookingId);
  if(typeof query!=='function' || !positive(id) || id>2147483647) fail('REBATE_BOOKING_PROOF_INVALID');
  const rows=(await query(`SELECT TOP 1 BookingSOID FROM wf.RebateBookingPriceSnapshot WITH(UPDLOCK,HOLDLOCK)
    WHERE BookingSOID=@bookingId`, {bookingId:id})).recordset || [];
  if(rows.length) throw Object.assign(new Error('ใบจองนี้มีราคาที่ตรึงแล้ว กรุณาให้ผู้มีสิทธิ์ตรวจสอบก่อนแก้ไข'),
    {code:'REBATE_BOOKING_RECONCILIATION_REQUIRED',status:409});
}

async function saveBookingPriceSnapshots(query, { bookingId, decisions } = {}) {
  await verifyBookingPricing(query, { bookingId, decisions });
  const saved = [];
  for (const d of decisions) {
    const params = { bookingId, lineNo:d.lineNo, draftId:d.draftId, revision:d.revision, fingerprint:d.fingerprint };
    let approvalId = null;
    if (d.calculation.requiresManagerApproval) {
      const approvals = (await query(`SELECT Id,Decision FROM wf.RebatePriceApprovalEvidence WITH(UPDLOCK,HOLDLOCK)
        WHERE DecisionFingerprint=@fingerprint AND DraftId=@draftId AND [LineNo]=@lineNo AND DocumentRevision=@revision`,params)).recordset || [];
      if (approvals.length!==1 || approvals[0].Decision!=='APPROVED' || !positive(Number(approvals[0].Id))) fail('REBATE_PRICE_APPROVAL_REQUIRED');
      approvalId=Number(approvals[0].Id);
    }
    const existing = (await query(`SELECT DecisionFingerprint,ApprovalEvidenceId,DraftId,DocumentRevision,GoodId,
        CONVERT(varchar(10),SaleDate,23) AS SaleDate,SourceServer,SourceDatabase,SetPriceId,SetPriceListNo,
        CONVERT(varchar(10),PriceBegin,23) AS PriceBegin,CONVERT(varchar(10),PriceEnd,23) AS PriceEnd,
        BasePrice,SellingPrice,InvoicePrice,QuantityTon,IsCashDiscount,RebatePerTon,TotalRebate,RequiresManagerApproval
      FROM wf.RebateBookingPriceSnapshot WITH(UPDLOCK,HOLDLOCK)
      WHERE BookingSOID=@bookingId AND [LineNo]=@lineNo`,params)).recordset || [];
    const qty=shipmentUnits(d.quantity,3), rate=shipmentUnits(d.calculation.rebatePerTon,2);
    const total=shipmentMoney((qty*rate+500n)/1000n);
    if (existing.length>1) fail('REBATE_BOOKING_SNAPSHOT_CONFLICT');
    if (existing.length===1) {
      const currentApproval=existing[0].ApprovalEvidenceId==null ? null : Number(existing[0].ApprovalEvidenceId);
      const e=existing[0];
      if (String(e.DecisionFingerprint||'').trim()!==d.fingerprint || currentApproval!==approvalId ||
          Number(e.DraftId)!==d.draftId || Number(e.DocumentRevision)!==d.revision || Number(e.GoodId)!==d.goodId ||
          e.SaleDate!==d.saleDate || String(e.SourceServer).toLowerCase()!==d.source.server.toLowerCase() ||
          String(e.SourceDatabase).toLowerCase()!==d.source.database.toLowerCase() || Number(e.SetPriceId)!==d.source.setPriceId ||
          Number(e.SetPriceListNo)!==d.source.listNo || e.PriceBegin!==d.source.beginDate || (e.PriceEnd||null)!==d.source.endDate ||
          shipmentUnits(e.BasePrice,2)!==shipmentUnits(d.source.basePrice,2) || shipmentUnits(e.SellingPrice,2)!==shipmentUnits(d.sellingPrice,2) ||
          shipmentUnits(e.InvoicePrice,2)!==shipmentUnits(d.calculation.invoiceUnitPrice,2) || shipmentUnits(e.QuantityTon,3)!==qty ||
          Number(e.IsCashDiscount)!==Number(d.isCashDiscount) || shipmentUnits(e.RebatePerTon,2)!==rate ||
          shipmentUnits(e.TotalRebate,2)!==shipmentUnits(total,2) || Number(e.RequiresManagerApproval)!==Number(d.calculation.requiresManagerApproval)) fail('REBATE_BOOKING_SNAPSHOT_CONFLICT');
      saved.push({ lineNo:d.lineNo, replayed:true });
      continue;
    }
    const inserted=await query(`INSERT INTO wf.RebateBookingPriceSnapshot
      (BookingSOID,[LineNo],DraftId,DocumentRevision,GoodId,SaleDate,SourceServer,SourceDatabase,
       SetPriceId,SetPriceListNo,PriceBegin,PriceEnd,BasePrice,SellingPrice,InvoicePrice,QuantityTon,
       IsCashDiscount,RebatePerTon,TotalRebate,RequiresManagerApproval,ApprovalEvidenceId,DecisionFingerprint)
      VALUES(@bookingId,@lineNo,@draftId,@revision,@goodId,CAST(@saleDate AS date),@server,@database,
       @setPriceId,@priceListNo,CAST(@priceBegin AS date),CAST(@priceEnd AS date),CAST(@base AS decimal(18,2)),
       CAST(@selling AS decimal(18,2)),CAST(@invoice AS decimal(18,2)),CAST(@quantity AS decimal(18,3)),
       @isCash,CAST(@rebate AS decimal(18,2)),CAST(@total AS decimal(18,2)),@needsApproval,@approvalId,@fingerprint)`, {
      ...params, goodId:d.goodId,saleDate:d.saleDate,server:d.source.server,database:d.source.database,
      setPriceId:d.source.setPriceId,priceListNo:d.source.listNo,priceBegin:d.source.beginDate,priceEnd:d.source.endDate,
      base:d.source.basePrice,selling:d.sellingPrice,invoice:String(d.calculation.invoiceUnitPrice),quantity:d.quantity,
      isCash:d.isCashDiscount,rebate:String(d.calculation.rebatePerTon),total,needsApproval:d.calculation.requiresManagerApproval,approvalId,
    });
    if (Number(inserted.rowsAffected?.[0])!==1) fail('REBATE_BOOKING_SNAPSHOT_CONFLICT');
    saved.push({ lineNo:d.lineNo,replayed:false });
  }
  return { bookingId, lines:saved };
}
module.exports={saveBookingPriceSnapshots,assertBookingSnapshotEditable};
