'use strict';
// Owner, 21 Nov 2026: the discount limits are App Settings and change without a deploy. The bill's price check,
// the Rebate booking price, the shipment accrual and the incident check all follow the same values; a booking
// keeps the limits it was priced with.
const priceAuthority = require('../services/price-authority');
let current = { standard: 200, max: 300, step: 100 };
priceAuthority.readDiscountLimits = async () => ({ ...current });
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { evaluateRebatePriceDecision, fingerprintRebateDecision, readDecisionLimits } = require('../services/rebate-price-authority');
const { prepareRebateBookingDecisions } = require('../services/rebate-booking-decisions');
const { lockShipmentBookingSnapshot } = require('../services/rebate-shipment-booking-snapshot');
const { bookingLineIncident, detectBookingIncidents } = require('../services/rule-incidents');

const priceRow = { SetPriceID: 8, ListNo: 1, GoodId: 12, BeginDate: '2026-01-01', EndDate: '2026-12-31', BasePrice: 10000,
  DatabaseName: 'uat', ServerName: 'server' };
const priceQuery = async () => ({ recordset: [priceRow] });
const input = selling => ({ draftId: 51, lineNo: 1, revision: 3, goodId: 12, saleDate: '2026-11-13', qtyTon: 2, sellingPrice: selling, isCashDiscount: false });

// Prices are whole steps of 100 from the announced price (App Setting PRICE_STEP_PER_TON), so every case below is too.
test('the Rebate decision reads the App Settings limits through the bill price check reader', async () => {
  current = { standard: 300, max: 400, step: 100 };
  assert.deepEqual(await readDecisionLimits(), { standard: 300, max: 400 });
  const d = await evaluateRebatePriceDecision(priceQuery, input(9700));
  assert.deepEqual(d.limits, { standard: 300, max: 400 });
  assert.equal(d.calculation.rebatePerTon, 300); assert.equal(d.calculation.requiresManagerApproval, false);
  const approval = await evaluateRebatePriceDecision(priceQuery, input(9600));
  assert.equal(approval.calculation.requiresManagerApproval, true);
  await assert.rejects(evaluateRebatePriceDecision(priceQuery, input(9500)), { code: 'REBATE_EXCEEDS_MAX_LIMIT' });
  current = { standard: 200, max: 300, step: 100 };
  const old = await evaluateRebatePriceDecision(priceQuery, input(9700));
  assert.equal(old.calculation.requiresManagerApproval, true);
  await assert.rejects(evaluateRebatePriceDecision(priceQuery, input(9600)), { code: 'REBATE_EXCEEDS_MAX_LIMIT' });
});

test('the markup cap follows the standard limit, as in the Rebate calculator', async () => {
  current = { standard: 300, max: 400, step: 100 };
  const d = await evaluateRebatePriceDecision(priceQuery, input(10500));
  assert.equal(d.calculation.rebatePerTon, 300);
  current = { standard: 200, max: 300, step: 100 };
  assert.equal((await evaluateRebatePriceDecision(priceQuery, input(10500))).calculation.rebatePerTon, 200);
});

test('the limits are part of the fingerprint, and a decision without valid limits has none', async () => {
  current = { standard: 300, max: 400, step: 100 };
  const a = await evaluateRebatePriceDecision(priceQuery, input(9900));
  current = { standard: 200, max: 300, step: 100 };
  const b = await evaluateRebatePriceDecision(priceQuery, input(9900));
  assert.deepEqual([a.calculation.rebatePerTon, b.calculation.rebatePerTon], [100, 100]);
  assert.notEqual(a.fingerprint, b.fingerprint);
  for (const limits of [undefined, { standard: 300, max: 200 }, { standard: -1, max: 300 }, { standard: 200, max: 1600 }, { standard: 200.5, max: 300 }])
    assert.throws(() => fingerprintRebateDecision({ ...b, limits }), { code: 'REBATE_PRICE_INPUT_INVALID' });
  // settings that the bill could not have used are refused, not silently replaced
  current = { standard: 300, max: 200, step: 100 };
  await assert.rejects(evaluateRebatePriceDecision(priceQuery, input(9900)), { code: 'REBATE_LIMITS_INVALID' });
  current = { standard: 200, max: 300, step: 100 };
});

test('a booking reads the limits once, so every line of it is judged alike', async () => {
  let reads = 0;
  priceAuthority.readDiscountLimits = async () => { reads++; return { standard: 200, max: 300 }; };
  const line = n => ({ SoId: 9, LineNum: n, GoodId: 12, QtyTon: 1, PricePerTon: 9900, RebatePricingMode: 'POOL' });
  const decisions = await prepareRebateBookingDecisions(priceQuery, { draft: { Id: 9, DocumentRevision: 2 }, lines: [line(1), line(2), line(3)], saleDate: '2026-11-13' });
  assert.equal(decisions.length, 3); assert.equal(reads, 1);
  priceAuthority.readDiscountLimits = async () => ({ ...current });
});

function shipmentRow(d, extra = {}) {
  return { DeliveryId: 77, DeliveryCustId: 8, DeliveryLineNo: 1, DeliveryGoodId: 12, DeliveryQty: 2, DeliveryPrice: 10000, DeliveryUnitId: 3,
    BookingId: 52, BookingCustId: 8, BookingStatus: 'Y', BookingDate: '2026-11-13', BookingLineNo: 1, BookingGoodId: 12, BookingQty: 2, BookingPrice: 10000, BookingUnitId: 3,
    DatabaseName: 'uat', ServerName: 'server', DraftId: 51, DocumentRevision: 3, GoodId: 12, SaleDate: '2026-11-13', SourceServer: 'server', SourceDatabase: 'uat',
    SetPriceId: 8, SetPriceListNo: 1, PriceBegin: '2026-01-01', PriceEnd: '2026-12-31', BasePrice: 10000, SellingPrice: d.sellingPrice, InvoicePrice: 10000, QuantityTon: 2,
    IsCashDiscount: 0, RebatePerTon: d.calculation.rebatePerTon, TotalRebate: d.calculation.rebatePerTon * 2,
    RequiresManagerApproval: d.calculation.requiresManagerApproval ? 1 : 0, ApprovalEvidenceId: d.calculation.requiresManagerApproval ? 7 : null,
    DecisionFingerprint: d.fingerprint, StandardLimitPerTon: String(d.limits.standard), MaxLimitPerTon: String(d.limits.max),
    ApprovalDecision: d.calculation.requiresManagerApproval ? 'APPROVED' : null, ApprovalFingerprint: d.calculation.requiresManagerApproval ? d.fingerprint : null, ...extra };
}
const shipment = { sourceSOID: 77, sourceListNo: 1, goodId: 12, quantityTon: '1.000' };

test('the accrual checks a booking against the limits stored with it, never against the settings of today', async () => {
  current = { standard: 300, max: 400, step: 100 };
  const d = await evaluateRebatePriceDecision(priceQuery, input(9700));
  current = { standard: 200, max: 300, step: 100 };
  const r = await lockShipmentBookingSnapshot(async () => ({ recordset: [shipmentRow(d)] }), shipment);
  assert.equal(r.rebatePerTon, '300');
  // the same row with other stored limits no longer matches its decision
  await assert.rejects(lockShipmentBookingSnapshot(async () => ({ recordset: [shipmentRow(d, { StandardLimitPerTon: '200.00', MaxLimitPerTon: '300.00' })] }), shipment),
    { code: 'REBATE_BOOKING_SOURCE_CHANGED' });
  await assert.rejects(lockShipmentBookingSnapshot(async () => ({ recordset: [shipmentRow(d, { StandardLimitPerTon: null, MaxLimitPerTon: null })] }), shipment),
    { code: 'REBATE_BOOKING_SOURCE_CHANGED' });
});

test('the incident check uses the same App Settings limits as the bill', async () => {
  const line = o => ({ SOID: 1, DocuNo: 'BK-T', DocuDate: new Date('2026-11-21T00:00:00Z'), ListNo: 1, GoodID: 7, Price: 9600, Qty: 1,
    AppSnapshot: 0, AppBill: 0, BasePrice: 10000, Ties: 1, AppvFlag: 'Y', ...o });
  const L = { standard: 300, max: 400, step: 100 };
  assert.equal(bookingLineIncident(line(), L)?.type, 'BOOKING_PRICE_NEEDS_APPROVAL');
  assert.equal(bookingLineIncident(line({ Price: 9700 }), L), null);
  assert.equal(bookingLineIncident(line({ Price: 9500 }), L).type, 'BOOKING_PRICE_OVER_MAX');
  assert.match(bookingLineIncident(line({ Price: 9500 }), L).detail, /เกณฑ์ 300\/400 บาท\/ตัน/);
  const seen = [];
  const r = await detectBookingIncidents('2026-11-01', { query: async () => ({ recordset: [line({ Price: 9600 })] }), record: async i => seen.push(i),
    readLimits: async () => L });
  assert.deepEqual(r, { lines: 1, recorded: 1 }); assert.equal(seen[0].type, 'BOOKING_PRICE_NEEDS_APPROVAL');
});

test('migration 255 stores the limits with each booking price and lifts the fixed 200/300 checks; its rollback restores them', () => {
  const up = fs.readFileSync(path.join(__dirname, '..', 'migrations', '255_rebate_configurable_limits.sql'), 'utf8');
  const down = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'down', '255_rebate_configurable_limits.down.sql'), 'utf8');
  assert.match(up, /^-- @transaction/);
  assert.match(up, /ADD\s+StandardLimitPerTon decimal\(18,2\) NOT NULL CONSTRAINT DF_RebateBookingPriceSnapshot_StdLimit DEFAULT 200,\s+MaxLimitPerTon decimal\(18,2\) NOT NULL CONSTRAINT DF_RebateBookingPriceSnapshot_MaxLimit DEFAULT 300/);
  assert.match(up, /DROP CONSTRAINT DF_RebateBookingPriceSnapshot_StdLimit/);
  assert.match(up, /DROP CONSTRAINT CK_RebateBookingPriceSnapshot_Values/);
  const ck = up.slice(up.indexOf('CK_RebateBookingPriceSnapshot_LimitValues CHECK'));
  assert.match(ck, /RebatePerTon<=MaxLimitPerTon/);
  assert.match(ck, /RebatePerTon<=StandardLimitPerTon AND RequiresManagerApproval=0\) OR \(RebatePerTon>StandardLimitPerTon AND RequiresManagerApproval=1/);
  assert.match(ck, /WHEN SellingPrice-BasePrice>StandardLimitPerTon THEN StandardLimitPerTon/);
  assert.doesNotMatch(ck.slice(0, ck.indexOf('GO')), /<=300|<=200|>200/);
  assert.match(up, /definition LIKE '%<=\(300\)%'/);
  assert.match(up, /RebatePerTon>0 AND RebatePerTon<=1500/);
  assert.doesNotMatch(up, /\bdbo\./);
  for (const bad of ['CONCAT(', 'THROW', 'TRY_CAST', 'IIF(']) assert.ok(!up.includes(bad) && !down.includes(bad), bad);
  assert.match(down, /RCL_ROLLBACK_REFUSED: booking prices judged by limits other than 200\/300 exist/);
  assert.match(down, /RCL_ROLLBACK_REFUSED: accruals above 300 baht\/ton exist/);
  assert.match(down, /RebatePerTon<=300 AND \(\(RebatePerTon<=200 AND RequiresManagerApproval=0\)/);
  assert.match(down, /DROP COLUMN StandardLimitPerTon/);
});
