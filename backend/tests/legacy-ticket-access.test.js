'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
const db = h.installDbStub(() => []);
const svc = require('../services/coupon-service');

test('unreserved legacy references cannot be saved for any bill or actor', async () => {
  const actor = { userId: 8, principal: { sub: 8, actorSub: 17, isImpersonating: true } };
  for (const target of [null, 123]) for (const line of [
    { isControlTicketDrawn: true, refControlTicketNo: 'C42', goodId: 7, qtyTon: 1 },
    { refControlTicketNo: 'C42', goodId: 7, qtyTon: 1 },
    { isControlTicketDrawn: true, goodId: 7, qtyTon: 1 },
  ]) {
    await assert.rejects(svc.validateAndLockCouponReservations(db.tx, [line], '10', target, actor, 'I'),
      { code: 'CONTROL_TICKET_RESERVATION_REQUIRED', status: 409 });
  }
});

test('the guard does not accept a forged reference on another ordinary line', async () => {
  await assert.rejects(svc.validateAndLockCouponReservations(db.tx, [
    { goodId: 7, qtyTon: 1 }, { refControlTicketNo: 'C42', goodId: 7, qtyTon: 1 },
  ], '10'), { code: 'CONTROL_TICKET_RESERVATION_REQUIRED' });
  assert.equal((await svc.validateAndLockCouponReservations(db.tx, [{ goodId: 7, qtyTon: 1 }], '10')).size, 0);
});
