'use strict';

// Internal materialization primitive. Not mounted: do not enable it until the
// shared claim/conversion reservation and source reconciliation protocols are
// implemented. Call in one business transaction under the global fence.
const { lockVerifiedShipment } = require('./rebate-verified-shipment');
const { withRebateOperationFence } = require('./rebate-reset-fence');
const { transactionQuery } = require('./rebate-sql');
function fail(code) { throw Object.assign(new Error(code), { code, status: 409 }); }
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
  const p = { environment:epoch.environment, resetId:epoch.resetId, generation:epoch.generation,
    evidenceId:shipment.evidenceId, sourceSOID:shipment.sourceSOID, sourceListNo:shipment.sourceListNo,
    couponId:shipment.couponId, goodId:shipment.goodId };
  const existing = (await query(`SELECT * FROM wf.RebateShipmentAccrual WITH(UPDLOCK,HOLDLOCK)
    WHERE EnvironmentKind=@environment AND ResetId=@resetId AND EvidenceId=@evidenceId`, p)).recordset || [];
  if (existing.length > 1) fail('REBATE_SHIPMENT_RECEIPT_INVALID');
  if (existing.length === 1) {
    const r = existing[0], id = Number(r.Id);
    if (!Number.isSafeInteger(id) || id <= 0 || Number(r.Generation)!==epoch.generation ||
        Number(r.SourceSOID)!==shipment.sourceSOID || Number(r.SourceListNo)!==shipment.sourceListNo ||
        Number(r.CouponId)!==shipment.couponId || Number(r.GoodId)!==shipment.goodId ||
        !positive(Number(r.CustId)) || !positive(Number(r.PlanId)) || units(r.RebatePerTon,2)<=0n ||
        units(r.ListPricePerTon,2)-units(r.NetPricePerTon,2)!==units(r.RebatePerTon,2) ||
        units(r.AmountBaht,2)!==(qty*units(r.RebatePerTon,2)+500n)/1000n ||
        units(r.QuantityTon,3)!==qty || at(r.OccurredAtUtc)!==at(shipment.occurredAtUtc)) fail('REBATE_SHIPMENT_RECEIPT_INVALID');
    return { id, replayed:true };
  }
  // The current view selects a plan dynamically. A serializable plan scan
  // prevents a concurrent plan edit/insert changing the chosen rate before
  // this transaction commits. Performance and UAT lock behavior must be
  // verified before exposing this primitive.
  await query("SELECT PlanId FROM wf.RebatePlan WITH(UPDLOCK,HOLDLOCK) WHERE Status IN ('ACTIVE','APPROVED')", {});
  const lots = (await query(`SELECT SourceSOID,SourceListNo,CouponID,GoodID,CustId,PlanId,QtyTon,ListPricePerTon,NetPricePerTon,RebatePerTon
    FROM wf.v_RebateAccrualLot WHERE SourceSOID=@sourceSOID AND SourceListNo=@sourceListNo AND CouponID=@couponId`, p)).recordset || [];
  if (lots.length !== 1) fail('REBATE_SHIPMENT_LOT_UNAVAILABLE');
  const lot = lots[0], custId = Number(lot.CustId), planId = Number(lot.PlanId);
  if (Number(lot.SourceSOID)!==shipment.sourceSOID || Number(lot.SourceListNo)!==shipment.sourceListNo ||
      Number(lot.CouponID)!==shipment.couponId || Number(lot.GoodID)!==shipment.goodId || !positive(custId) || !positive(planId))
    fail('REBATE_SHIPMENT_LOT_UNAVAILABLE');
  const sold = units(lot.QtyTon,3), rate = units(lot.RebatePerTon,2);
  if (sold <= 0n || rate <= 0n || units(lot.ListPricePerTon,2)-units(lot.NetPricePerTon,2)!==rate) fail('REBATE_SHIPMENT_PLAN_UNAVAILABLE');
  const accumulated = (await query(`SELECT COALESCE(SUM(QuantityTon),0) AS QuantityTon FROM wf.RebateShipmentAccrual WITH(HOLDLOCK)
    WHERE EnvironmentKind=@environment AND ResetId=@resetId AND SourceSOID=@sourceSOID AND SourceListNo=@sourceListNo`, p)).recordset?.[0];
  if (!accumulated || units(accumulated.QuantityTon,3)+qty > sold) fail('REBATE_SHIPMENT_EXCEEDS_SALE');
  const cents = (qty*rate+500n)/1000n; // nonnegative DECIMAL rounding to baht cents
  if (cents <= 0n || cents > 999999999999999999n) fail('REBATE_SHIPMENT_AMOUNT_INVALID');
  const inserted = (await query(`INSERT wf.RebateShipmentAccrual(EnvironmentKind,ResetId,Generation,EvidenceId,SourceSOID,
      SourceListNo,CouponId,GoodId,CustId,PlanId,QuantityTon,ListPricePerTon,NetPricePerTon,RebatePerTon,AmountBaht,OccurredAtUtc)
    OUTPUT INSERTED.Id VALUES(@environment,@resetId,@generation,@evidenceId,@sourceSOID,@sourceListNo,@couponId,@goodId,
      @custId,@planId,CAST(@quantity AS decimal(18,3)),CAST(@listPrice AS decimal(18,2)),CAST(@netPrice AS decimal(18,2)),
      CAST(@rate AS decimal(18,2)),CAST(@amount AS decimal(18,2)),@occurred)`,
  { ...p, custId, planId, quantity:shipment.quantityTon, listPrice:String(lot.ListPricePerTon), netPrice:String(lot.NetPricePerTon),
    rate:String(lot.RebatePerTon), amount:money(cents), occurred:shipment.occurredAtUtc })).recordset?.[0];
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
  return runFence(epoch => runTx(query => accrueVerifiedShipment(query, epoch, key, overrides)));
}

module.exports = { accrueVerifiedShipment, accrueReviewedShipment, shipmentUnits: units, shipmentMoney: money };
