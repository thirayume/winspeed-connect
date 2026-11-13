'use strict';

// Internal materialization primitive. Not mounted: do not enable it until the
// shared claim/conversion reservation and source reconciliation protocols are
// implemented. Call in one business transaction under the global fence.
const { lockVerifiedShipment } = require('./rebate-verified-shipment');
const { withRebateOperationFence } = require('./rebate-reset-fence');
const { transactionQuery } = require('./rebate-sql');
function fail(code, status = 409) { throw Object.assign(new Error(code), { code, status }); }
const positive = n => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;
function units(value, decimals) {
  const text = String(value ?? '');
  const pattern = decimals === 3 ? /^(?:0|[1-9]\d{0,14})(?:\.\d{1,3})?$/ : /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/;
  if (!pattern.test(text)) fail('REBATE_SHIPMENT_AMOUNT_INVALID');
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0'));
}
function money(cents) { return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`; }
function at(value) { const n = value instanceof Date ? value.getTime() : Date.parse(value); if (!Number.isFinite(n)) fail('REBATE_SHIPMENT_RECEIPT_INVALID'); return n; }

async function accrueVerifiedShipment(query, epoch, key, overrides = {}) {
  if (typeof query !== 'function') fail('REBATE_SHIPMENT_REQUEST_INVALID');
  // This call obtains the participant lock, then locks the native source 104
  // and evidence in the established order. It rechecks source fingerprints.
  const shipment = await (overrides.lockShipment || lockVerifiedShipment)(query, epoch, key);
  if (!shipment || !positive(shipment.sourceSOID) || !positive(shipment.sourceListNo) ||
      !positive(shipment.couponId) || !positive(shipment.goodId) || !Number.isSafeInteger(shipment.evidenceId) || shipment.evidenceId <= 0)
    fail('REBATE_SHIPMENT_SOURCE_INVALID');
  const qty = units(shipment.quantityTon, 3);
  if (qty <= 0n) fail('REBATE_SHIPMENT_AMOUNT_INVALID');
  // Lazy import avoids a circular initialization with the exact decimal
  // helpers exported by this module.
  const snapshot=await (overrides.lockSnapshot || require('./rebate-shipment-booking-snapshot').lockShipmentBookingSnapshot)(query,shipment);
  if (!snapshot || !positive(snapshot.bookingId) || !positive(snapshot.bookingLineNo) || !positive(snapshot.customerId))
    fail('REBATE_BOOKING_SNAPSHOT_UNAVAILABLE');
  const rate=units(snapshot.rebatePerTon,2);
  if(rate===0n) return {skipped:true,reason:'NO_REBATE'};
  if(rate>30000n) fail('REBATE_SHIPMENT_AMOUNT_INVALID');
  const p = { environment:epoch.environment, resetId:epoch.resetId, generation:epoch.generation,
    evidenceId:shipment.evidenceId, sourceSOID:shipment.sourceSOID, sourceListNo:shipment.sourceListNo,
    couponId:shipment.couponId, goodId:shipment.goodId,bookingId:snapshot.bookingId,bookingLineNo:snapshot.bookingLineNo };
  const existing = (await query(`SELECT * FROM wf.RebateShipmentAccrual WITH(UPDLOCK,HOLDLOCK)
    WHERE EnvironmentKind=@environment AND ResetId=@resetId AND EvidenceId=@evidenceId`, p)).recordset || [];
  if (existing.length > 1) fail('REBATE_SHIPMENT_RECEIPT_INVALID');
  if (existing.length === 1) {
    const r = existing[0], id = Number(r.Id);
    if (!Number.isSafeInteger(id) || id <= 0 || Number(r.Generation)!==epoch.generation ||
        Number(r.SourceSOID)!==shipment.sourceSOID || Number(r.SourceListNo)!==shipment.sourceListNo ||
        Number(r.CouponId)!==shipment.couponId || Number(r.GoodId)!==shipment.goodId ||
        Number(r.CustId)!==snapshot.customerId || r.PlanId!=null || Number(r.BookingSOID)!==snapshot.bookingId ||
        Number(r.BookingLineNo)!==snapshot.bookingLineNo || units(r.RebatePerTon,2)!==rate ||
        units(r.ListPricePerTon,2)!==units(snapshot.basePrice,2) || units(r.NetPricePerTon,2)!==units(snapshot.sellingPrice,2) ||
        units(r.AmountBaht,2)!==(qty*rate+500n)/1000n ||
        units(r.QuantityTon,3)!==qty || at(r.OccurredAtUtc)!==at(shipment.occurredAtUtc)) fail('REBATE_SHIPMENT_RECEIPT_INVALID');
    return { id, replayed:true };
  }
  // Snapshot 103 is locked by the resolver above. Check both the originating
  // delivery and the whole booking so split 104s cannot accrue the same tons.
  const accumulated = (await query(`SELECT
      COALESCE(SUM(CASE WHEN SourceSOID=@sourceSOID AND SourceListNo=@sourceListNo THEN QuantityTon ELSE 0 END),0) AS DeliveryTon,
      COALESCE(SUM(QuantityTon),0) AS BookingTon FROM wf.RebateShipmentAccrual WITH(HOLDLOCK)
    WHERE EnvironmentKind=@environment AND ResetId=@resetId AND BookingSOID=@bookingId AND BookingLineNo=@bookingLineNo`, p)).recordset?.[0];
  if (!accumulated || units(accumulated.DeliveryTon,3)+qty>units(snapshot.deliveryQty,3) ||
      units(accumulated.BookingTon,3)+qty>units(snapshot.bookingQty,3)) fail('REBATE_SHIPMENT_EXCEEDS_SALE');
  const cents = (qty*rate+500n)/1000n; // nonnegative DECIMAL rounding to baht cents
  if (cents <= 0n || cents > 999999999999999999n) fail('REBATE_SHIPMENT_AMOUNT_INVALID');
  const inserted = (await query(`INSERT wf.RebateShipmentAccrual(EnvironmentKind,ResetId,Generation,EvidenceId,SourceSOID,
      SourceListNo,CouponId,GoodId,CustId,PlanId,BookingSOID,BookingLineNo,QuantityTon,ListPricePerTon,NetPricePerTon,RebatePerTon,AmountBaht,OccurredAtUtc)
    OUTPUT INSERTED.Id VALUES(@environment,@resetId,@generation,@evidenceId,@sourceSOID,@sourceListNo,@couponId,@goodId,
      @custId,NULL,@bookingId,@bookingLineNo,CAST(@quantity AS decimal(18,3)),CAST(@listPrice AS decimal(18,2)),CAST(@netPrice AS decimal(18,2)),
      CAST(@rate AS decimal(18,2)),CAST(@amount AS decimal(18,2)),@occurred)`,
  { ...p, custId:snapshot.customerId, quantity:shipment.quantityTon, listPrice:snapshot.basePrice, netPrice:snapshot.sellingPrice,
    rate:snapshot.rebatePerTon, amount:money(cents), occurred:shipment.occurredAtUtc })).recordset?.[0];
  const id = Number(inserted?.Id);
  if (!Number.isSafeInteger(id) || id <= 0) fail('REBATE_SHIPMENT_RECEIPT_INVALID');
  return { id, replayed:false };
}

// Entry point for an eventual worker. Keep it internal until eligibility,
// shared reservations, source reconciliation and authorization are complete.
async function accrueReviewedShipment(key, overrides = {}) {
  const db = overrides.db || require('../db');
  const runFence = overrides.runFence || (fn => withRebateOperationFence(fn));
  const runTx = overrides.runTx || (fn => db.wfTransaction(tx => fn(transactionQuery(tx, db.sql))));
  return runFence(epoch => runTx(async query => {
    await (overrides.participantFence || require('./rebate-participant-fence').acquireRebateParticipantFence)(query, epoch);
    if(process.env.REBATE_POOL_103_ENABLED!=='true') fail('REBATE_POOL_PRICING_SOURCE_UNAVAILABLE', 503);
    return accrueVerifiedShipment(query,epoch,key,overrides);
  }));
}

module.exports = { accrueVerifiedShipment, accrueReviewedShipment, shipmentUnits: units, shipmentMoney: money };
