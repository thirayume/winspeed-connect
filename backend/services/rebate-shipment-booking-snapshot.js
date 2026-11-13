'use strict';

// Resolve the verified 116 -> 104 source to the immutable 103 price evidence.
// Called under the existing shipment/participant locks in the same business
// transaction. This validates evidence only; it does not credit a balance.
const { shipmentUnits, shipmentMoney }=require('./rebate-shipment-accrual');
const { calculateOrderPricingAndRebate }=require('./rebate-calculator-service');
const { fingerprintRebateDecision }=require('./rebate-price-authority');
function fail(code){throw Object.assign(new Error(code),{code,status:409});}
const positive=n=>Number.isSafeInteger(n)&&n>0&&n<=2147483647;

async function lockShipmentBookingSnapshot(query,shipment) {
  if(typeof query!=='function' || ![shipment?.sourceSOID,shipment?.sourceListNo,shipment?.goodId].every(positive))
    fail('REBATE_SHIPMENT_SOURCE_INVALID');
  const rows=(await query(`SELECT h.SOID AS DeliveryId,h.CustID AS DeliveryCustId,d.ListNo AS DeliveryLineNo,
      d.GoodID AS DeliveryGoodId,d.GoodQty2 AS DeliveryQty,d.GoodPrice2 AS DeliveryPrice,d.GoodUnitID2 AS DeliveryUnitId,
      b.SOID AS BookingId,b.CustID AS BookingCustId,RTRIM(b.DocuStatus) AS BookingStatus,
      CONVERT(varchar(10),b.DocuDate,23) AS BookingDate,bd.ListNo AS BookingLineNo,bd.GoodID AS BookingGoodId,
      bd.GoodQty2 AS BookingQty,bd.GoodPrice2 AS BookingPrice,bd.GoodUnitID2 AS BookingUnitId,
      DB_NAME() AS DatabaseName,CONVERT(nvarchar(128),SERVERPROPERTY('ServerName')) AS ServerName,
      s.DraftId,s.DocumentRevision,s.GoodId,CONVERT(varchar(10),s.SaleDate,23) AS SaleDate,s.SourceServer,s.SourceDatabase,s.SetPriceId,s.SetPriceListNo,
      CONVERT(varchar(10),s.PriceBegin,23) AS PriceBegin,CONVERT(varchar(10),s.PriceEnd,23) AS PriceEnd,
      s.BasePrice,s.SellingPrice,s.InvoicePrice,s.QuantityTon,s.IsCashDiscount,s.RebatePerTon,s.TotalRebate,
      s.RequiresManagerApproval,s.ApprovalEvidenceId,s.DecisionFingerprint,a.Decision AS ApprovalDecision,
      a.DecisionFingerprint AS ApprovalFingerprint
    FROM dbo.SOHD h WITH(UPDLOCK,HOLDLOCK)
    JOIN dbo.SODT d WITH(UPDLOCK,HOLDLOCK) ON d.SOID=h.SOID AND d.DocuType=104 AND d.ListNo=@sourceListNo
    LEFT JOIN dbo.SOHD b WITH(UPDLOCK,HOLDLOCK) ON b.SOID=d.RefSOID AND b.DocuType=103
    LEFT JOIN dbo.SODT bd WITH(UPDLOCK,HOLDLOCK) ON bd.SOID=b.SOID AND bd.ListNo=d.RefListNo AND bd.DocuType=103
    LEFT JOIN wf.RebateBookingPriceSnapshot s WITH(UPDLOCK,HOLDLOCK) ON s.BookingSOID=b.SOID AND s.[LineNo]=bd.ListNo
    LEFT JOIN wf.RebatePriceApprovalEvidence a WITH(UPDLOCK,HOLDLOCK) ON a.Id=s.ApprovalEvidenceId
    WHERE h.SOID=@sourceSOID AND h.DocuType=104`,
  {sourceSOID:shipment.sourceSOID,sourceListNo:shipment.sourceListNo})).recordset || [];
  if(rows.length!==1) fail('REBATE_BOOKING_SOURCE_UNAVAILABLE');
  const r=rows[0];
  if(!positive(Number(r.BookingId)) || !positive(Number(r.BookingLineNo)) || !r.DecisionFingerprint)
    fail('REBATE_BOOKING_SNAPSHOT_UNAVAILABLE');
  try {
    const saleDate=r.SaleDate instanceof Date?r.SaleDate.toISOString().slice(0,10):String(r.SaleDate||'').slice(0,10);
    const cash=Number(r.IsCashDiscount)===1;
    const qty=shipmentUnits(r.QuantityTon,3);
    const quantity=`${qty/1000n}.${String(qty%1000n).padStart(3,'0')}`;
    const basePrice=shipmentMoney(shipmentUnits(r.BasePrice,2));
    const sellingPrice=shipmentMoney(shipmentUnits(r.SellingPrice,2));
    const calc=calculateOrderPricingAndRebate(basePrice,sellingPrice,quantity,cash);
    const decision={draftId:Number(r.DraftId),lineNo:Number(r.BookingLineNo),revision:Number(r.DocumentRevision),
      goodId:Number(r.GoodId),saleDate,source:{database:String(r.SourceDatabase||'').trim(),server:String(r.SourceServer||'').trim(),
        setPriceId:Number(r.SetPriceId),listNo:Number(r.SetPriceListNo),goodId:Number(r.GoodId),saleDate,
        beginDate:r.PriceBegin,endDate:r.PriceEnd||null,basePrice},quantity,
      sellingPrice,isCashDiscount:cash,calculation:calc};
    if(Number(r.DeliveryId)!==shipment.sourceSOID || Number(r.DeliveryLineNo)!==shipment.sourceListNo ||
       Number(r.DeliveryGoodId)!==shipment.goodId || Number(r.BookingGoodId)!==shipment.goodId || Number(r.GoodId)!==shipment.goodId ||
       !positive(Number(r.DeliveryCustId)) || Number(r.DeliveryCustId)!==Number(r.BookingCustId) ||
       !positive(Number(r.DeliveryUnitId)) || Number(r.DeliveryUnitId)!==Number(r.BookingUnitId) ||
       !['N','Y'].includes(String(r.BookingStatus||'').trim().toUpperCase()) || r.BookingDate!==saleDate ||
       String(r.DatabaseName||'').trim().toLowerCase()!==decision.source.database.toLowerCase() ||
       String(r.ServerName||'').trim().toLowerCase()!==decision.source.server.toLowerCase() ||
       shipmentUnits(r.DeliveryQty,3)<=0n || shipmentUnits(shipment.quantityTon,3)<=0n || shipmentUnits(shipment.quantityTon,3)>shipmentUnits(r.DeliveryQty,3) ||
       shipmentUnits(r.DeliveryQty,3)>shipmentUnits(r.BookingQty,3) || shipmentUnits(r.BookingQty,3)!==shipmentUnits(r.QuantityTon,3) ||
       shipmentUnits(r.DeliveryPrice,2)!==shipmentUnits(r.InvoicePrice,2) || shipmentUnits(r.BookingPrice,2)!==shipmentUnits(r.InvoicePrice,2) ||
       shipmentUnits(r.InvoicePrice,2)!==shipmentUnits(calc.invoiceUnitPrice,2) || shipmentUnits(r.RebatePerTon,2)!==shipmentUnits(calc.rebatePerTon,2) ||
       shipmentUnits(r.TotalRebate,2)!==shipmentUnits(calc.totalRebateEarned,2) || Number(r.RequiresManagerApproval)!==Number(calc.requiresManagerApproval) ||
       fingerprintRebateDecision(decision)!==String(r.DecisionFingerprint).trim() ||
       (calc.requiresManagerApproval && (r.ApprovalDecision!=='APPROVED' || String(r.ApprovalFingerprint||'').trim()!==String(r.DecisionFingerprint).trim())) ||
       (!calc.requiresManagerApproval && r.ApprovalEvidenceId!=null)) fail('REBATE_BOOKING_SOURCE_CHANGED');
  } catch (_) { fail('REBATE_BOOKING_SOURCE_CHANGED'); }
  return {bookingId:Number(r.BookingId),bookingLineNo:Number(r.BookingLineNo),customerId:Number(r.BookingCustId),
    quantityTon:String(shipment.quantityTon),bookingQty:String(r.BookingQty),deliveryQty:String(r.DeliveryQty),
    basePrice:String(r.BasePrice),sellingPrice:String(r.SellingPrice),rebatePerTon:String(r.RebatePerTon),
    fingerprint:String(r.DecisionFingerprint).trim()};
}
module.exports={lockShipmentBookingSnapshot};
