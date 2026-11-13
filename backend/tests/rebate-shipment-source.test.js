'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { lockShipmentSource } = require('../services/rebate-shipment-source');
function row() { return { RedemtionID: 1, RedemptionListNo: 2, CouponID: 3, SourceSOID: 4, SourceListNo: 5,
  GoodID: 6, GoodUnitID: 7, CouponGoodID: 6, CouponGoodUnitID: 7, SaleGoodID: 6, SaleGoodUnitID: 7, SaleHeaderId: 4, SaleLineId: 4,
  RedemptionStatus: 'N', SaleStatus: 'Y', Quantity: '1.000',
  HeaderSnapshot: 'h', LineSnapshot: 'd', CouponSnapshot: 'c', SaleHeaderSnapshot: 'sh', SaleLineSnapshot: 'sd',
  UnitSnapshot: 'unit', ScaleSnapshot: '', AuditSnapshot: '' }; }
const load = item => async () => ({ recordset: item == null ? [] : [item] });
test('fingerprints the native documents without exposing their contents or inferring physical proof', async () => {
  const original = await lockShipmentSource(load(row()), { redemptionId: 1, listNo: 2 });
  assert.match(original.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(original.scaleRowsPresent, false);
  assert.deepEqual(original.issues, []);
  assert.equal(original.HeaderSnapshot, undefined);
  const changed = { ...row(), AuditSnapshot: 'changed' };
  assert.notEqual((await lockShipmentSource(load(changed), { redemptionId: 1, listNo: 2 })).fingerprint, original.fingerprint);
});
test('normal 116 N-to-Y lifecycle is separate from proof fingerprint, while cancellation is held', async () => {
  const before = await lockShipmentSource(load(row()), { redemptionId: 1, listNo: 2 });
  const after = await lockShipmentSource(load({ ...row(), RedemptionStatus: 'Y' }), { redemptionId: 1, listNo: 2 });
  assert.equal(after.fingerprint, before.fingerprint);
  assert.deepEqual(after.issues, []);
  const cancelled = await lockShipmentSource(load({ ...row(), RedemptionStatus: 'C' }), { redemptionId: 1, listNo: 2 });
  assert.ok(cancelled.issues.includes('REDEMPTION_STATUS_UNCONFIRMED'));
});
test('missing and conflicting linked documents can be held for review without minting balance', async () => {
  await assert.rejects(lockShipmentSource(load(null), { redemptionId: 1, listNo: 2 }), { code: 'REBATE_SHIPMENT_SOURCE_UNAVAILABLE' });
  for (const [changed, issue] of [[{ CouponGoodID: 8 }, 'GOOD_MISMATCH'], [{ CouponGoodUnitID: 8 }, 'UNIT_UNCONFIRMED'], [{ SaleGoodUnitID: 8 }, 'UNIT_UNCONFIRMED'],
    [{ Quantity: '0' }, 'QUANTITY_INVALID'], [{ SaleGoodID: 8 }, 'GOOD_MISMATCH'],
    [{ RedemptionStatus: 'C' }, 'REDEMPTION_STATUS_UNCONFIRMED'], [{ SaleStatus: 'P' }, 'SALE_STATUS_UNCONFIRMED'],
    [{ SourceSOID: null, SaleHeaderId: null, SaleHeaderSnapshot: '' }, 'SALE_HEADER_UNAVAILABLE']]) {
    const result = await lockShipmentSource(load({ ...row(), ...changed }), { redemptionId: 1, listNo: 2 });
    assert.ok(result.issues.includes(issue));
  }
  await assert.rejects(lockShipmentSource(load(row()), { redemptionId: 0, listNo: 2 }), { code: 'REBATE_SHIPMENT_SOURCE_INVALID' });
});
