'use strict';

// Internal transactional primitive. The caller must hold the global fence,
// authorize and scope both identities, and create the associated claim or
// conversion in this same business transaction. No HTTP route uses it yet.
const { acquireRebateParticipantFence } = require('./rebate-participant-fence');
const { lockVerifiedShipment } = require('./rebate-verified-shipment');
const { shipmentUnits, shipmentMoney } = require('./rebate-shipment-accrual');
function fail(code) { throw Object.assign(new Error(code), { code, status: 409 }); }
const positive = n => Number.isSafeInteger(n) && n > 0;

async function reserveShipmentAccrual(query, epoch, input = {}, overrides = {}) {
  const { accrualId, custId, documentId, documentType } = input;
  if (typeof query !== 'function' || !positive(accrualId) || !positive(custId) || custId>2147483647 || !positive(documentId) ||
      !['CLAIM','CONVERSION'].includes(documentType) || (documentType==='CLAIM' && documentId>2147483647)) fail('REBATE_RESERVATION_INPUT_INVALID');
  const requested = shipmentUnits(input.quantityTon,3);
  if (requested<=0n) fail('REBATE_RESERVATION_INPUT_INVALID');
  // SQL Server 2008 requires these options on every write to a table with
  // filtered indexes, not only when the indexes are created.
  await query(`SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON; SET ANSI_PADDING ON; SET ANSI_WARNINGS ON;
    SET ARITHABORT ON; SET CONCAT_NULL_YIELDS_NULL ON; SET NUMERIC_ROUNDABORT OFF;`,{});
  await (overrides.participantFence || acquireRebateParticipantFence)(query,epoch);
  // Pre-read is not trusted: all values are checked again after locking the
  // customer, native source, evidence and accrual, in that order.
  const p = { environment:epoch.environment, resetId:epoch.resetId, accrualId, custId, documentId };
  const initial = (await query(`SELECT a.CustId,e.RedemptionId,e.RedemptionListNo FROM wf.RebateShipmentAccrual a
    JOIN wf.RebateShipmentEvidence e ON e.Id=a.EvidenceId
    WHERE a.Id=@accrualId AND a.EnvironmentKind=@environment AND a.ResetId=@resetId`,p)).recordset?.[0];
  if (!initial || Number(initial.CustId)!==custId || !positive(Number(initial.RedemptionId)) || !positive(Number(initial.RedemptionListNo))) fail('REBATE_RESERVATION_NOT_FOUND');
  const lock = (await query(`DECLARE @result int; EXEC @result=sp_getapplock @Resource=@resource,
    @LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @result AS LockResult;`,
  {resource:`RebateCust_${custId}`})).recordset?.[0]?.LockResult;
  if (!Number.isInteger(lock) || lock<0) fail('REBATE_RESERVATION_LOCK_UNAVAILABLE');
  const shipment = await (overrides.lockShipment || lockVerifiedShipment)(query,epoch,
    {redemptionId:Number(initial.RedemptionId),listNo:Number(initial.RedemptionListNo)});
  const snapshot=await (overrides.lockSnapshot || require('./rebate-shipment-booking-snapshot').lockShipmentBookingSnapshot)(query,shipment);
  const a = (await query(`SELECT * FROM wf.RebateShipmentAccrual WITH(UPDLOCK,HOLDLOCK)
    WHERE Id=@accrualId AND EnvironmentKind=@environment AND ResetId=@resetId`,p)).recordset?.[0];
  if (!a || Number(a.CustId)!==custId || Number(a.Generation)!==epoch.generation || Number(a.EvidenceId)!==shipment.evidenceId ||
      Number(a.SourceSOID)!==shipment.sourceSOID || Number(a.SourceListNo)!==shipment.sourceListNo || Number(a.CouponId)!==shipment.couponId ||
      Number(a.GoodId)!==shipment.goodId || a.PlanId!=null || Number(a.BookingSOID)!==snapshot.bookingId ||
      Number(a.BookingLineNo)!==snapshot.bookingLineNo || Number(a.CustId)!==snapshot.customerId ||
      shipmentUnits(a.QuantityTon,3)!==shipmentUnits(shipment.quantityTon,3) ||
      new Date(a.OccurredAtUtc).getTime()!==new Date(shipment.occurredAtUtc).getTime()) fail('REBATE_RESERVATION_SOURCE_CHANGED');
  const rate=shipmentUnits(a.RebatePerTon,2), total=shipmentUnits(a.QuantityTon,3);
  const cents=(requested*rate+500n)/1000n;
  if (rate<=0n || rate>30000n || rate!==shipmentUnits(snapshot.rebatePerTon,2) ||
      shipmentUnits(a.ListPricePerTon,2)!==shipmentUnits(snapshot.basePrice,2) ||
      shipmentUnits(a.NetPricePerTon,2)!==shipmentUnits(snapshot.sellingPrice,2) ||
      shipmentUnits(a.AmountBaht,2)!==(total*rate+500n)/1000n || cents<=0n || cents>999999999999999999n)
    fail('REBATE_RESERVATION_AMOUNT_INVALID');
  const document = documentType==='CLAIM'
    ? (await query('SELECT Id,CustId,Status FROM wf.RebateClaim WITH(UPDLOCK,HOLDLOCK) WHERE Id=@documentId',p)).recordset?.[0]
    : (await query('SELECT Id,CustId,Status FROM wf.FertilizerTicketConversion WITH(UPDLOCK,HOLDLOCK) WHERE Id=@documentId',p)).recordset?.[0];
  if (!document || Number(document.Id)!==documentId || Number(document.CustId)!==custId) fail('REBATE_RESERVATION_DOCUMENT_INVALID');
  const field=documentType==='CLAIM'?'ClaimId':'ConversionId'; // fixed internal literals only
  const rows=(await query(`SELECT Id,QuantityTon,AmountBaht,Status FROM wf.RebateShipmentReservation WITH(UPDLOCK,HOLDLOCK)
    WHERE AccrualId=@accrualId AND ${field}=@documentId`,p)).recordset||[];
  if (rows.length>1) fail('REBATE_RESERVATION_RECEIPT_INVALID');
  if (rows.length===1) {
    const r=rows[0],id=Number(r.Id);
    if (!positive(id) || r.Status!=='ACTIVE' || shipmentUnits(r.QuantityTon,3)!==requested || shipmentUnits(r.AmountBaht,2)!==cents)
      fail('REBATE_RESERVATION_RECEIPT_CONFLICT');
    // An ACTIVE reservation on a rejected/cancelled or unknown document is
    // inconsistent. Never report a successful replay until it is reconciled.
    // Fully approved claims (including those with CN already issued) remain
    // valid, as do issued conversions.
    const replayClaimStatuses=['DRAFT','PENDING','TIER2_PENDING','TIER3_PENDING','TIER4_PENDING','APPROVED','CN_ISSUED'];
    if ((documentType==='CLAIM' && !replayClaimStatuses.includes(document.Status)) ||
        (documentType==='CONVERSION' && document.Status!=='ISSUED'))
      fail('REBATE_RESERVATION_DOCUMENT_INVALID');
    return {id,replayed:true};
  }
  if (documentType==='CLAIM' && !['DRAFT','PENDING','TIER2_PENDING','TIER3_PENDING','TIER4_PENDING'].includes(document.Status) ||
      documentType==='CONVERSION' && document.Status!=='ISSUED') fail('REBATE_RESERVATION_DOCUMENT_INVALID');
  const used=(await query(`SELECT COALESCE(SUM(QuantityTon),0) AS QuantityTon,COALESCE(SUM(AmountBaht),0) AS AmountBaht FROM wf.RebateShipmentReservation WITH(HOLDLOCK)
    WHERE AccrualId=@accrualId AND Status='ACTIVE'`,p)).recordset?.[0];
  // Rounding each slice independently can exceed the original monetary
  // balance even if the sum of tons fits (e.g. 0.001t at 15 baht/t twice).
  if (!used || shipmentUnits(used.QuantityTon,3)+requested>total ||
      shipmentUnits(used.AmountBaht,2)+cents>shipmentUnits(a.AmountBaht,2)) fail('REBATE_RESERVATION_INSUFFICIENT');
  const inserted=(await query(`INSERT wf.RebateShipmentReservation(AccrualId,ClaimId,ConversionId,QuantityTon,AmountBaht)
    OUTPUT INSERTED.Id VALUES(@accrualId,@claimId,@conversionId,CAST(@quantity AS decimal(18,3)),CAST(@amount AS decimal(18,2)))`,
  {...p,claimId:documentType==='CLAIM'?documentId:null,conversionId:documentType==='CONVERSION'?documentId:null,
    quantity:input.quantityTon,amount:shipmentMoney(cents)})).recordset?.[0];
  const id=Number(inserted?.Id);if(!positive(id)) fail('REBATE_RESERVATION_RECEIPT_INVALID');
  return {id,replayed:false};
}
module.exports={reserveShipmentAccrual};
