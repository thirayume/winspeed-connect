'use strict';

/**
 * UAT batch 5, SHP-04 — Paper Trail:
 *  - printing again returns the same 4-colour set (same QR, scan history kept); it used to delete the copies and
 *    scans every time the print preview opened;
 *  - the paper set of a bill is visible/printable only inside the user's own + team scope;
 *  - scanning is for the roles that handle the paper.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const copies = [];
const db = h.installDbStub(({ text, inputs }) => {
  if (/SELECT Id, EmpId, PositionCode FROM wf\.AppUser WHERE Id = @id/.test(text)) return [{ Id: inputs.id, EmpId: String(7000 + inputs.id), PositionCode: null }];
  if (/SELECT TOP 1 so\.SalesUserId, CAST\(h\.EmpID AS VARCHAR\(20\)\) AS EmpID/.test(text)) return inputs.id === '900' ? [{ SalesUserId: 43, EmpID: '7043' }] : [];
  if (/SELECT TOP 1 WfRef FROM wf\.v_AllSalesOrders WHERE Id = @id/.test(text)) return [{ WfRef: 'I69-09000' }];
  if (/SELECT CopyColor, CopyLabel, QrNonce FROM wf\.PaperCopy WHERE SoId=@id AND DocType=@dt/.test(text)) return copies.map(c => ({ CopyColor: c.color, CopyLabel: c.label, QrNonce: c.nonce }));
  if (/INSERT INTO wf\.PaperCopy/.test(text)) { copies.push({ color: inputs.col, label: inputs.lbl, nonce: inputs.nonce }); return []; }
  return [];
});

let app;
test.before(async () => { app = await h.startApp([['/api/papertrail', '../../routes/papertrail']]); });
test.after(async () => { await app.close(); });

test('SHP-04: a second print returns the same set and deletes nothing', async () => {
  const first = await app.call('POST', '/api/papertrail/900/print', { body: { docType: 'ISSUE' }, user: { sub: 43, role: 'SALES' } });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.copies.length, 4);
  const before = db.calls.length;
  const again = await app.call('POST', '/api/papertrail/900/print', { body: { docType: 'ISSUE' }, user: { sub: 64, role: 'COUNTER_SALES' } });
  assert.equal(again.status, 200);
  assert.equal(again.body.reused, true);
  assert.deepEqual(again.body.copies.map(c => c.qrNonce), first.body.copies.map(c => c.qrNonce));
  assert.ok(!db.calls.slice(before).some(c => /DELETE FROM wf\.Paper/.test(c.text)), 'no copy or scan deleted');
});

test('SHP-04: another salesperson cannot open or print the set (404); SALES cannot scan (403)', async () => {
  assert.equal((await app.call('POST', '/api/papertrail/900/print', { body: {}, user: { sub: 19, role: 'SALES' } })).status, 404);
  assert.equal((await app.call('GET', '/api/papertrail/document/900', { user: { sub: 19, role: 'SALES' } })).status, 404);
  assert.equal((await app.call('POST', '/api/papertrail/scan', { body: { qrNonce: 'x', action: 'LOST' }, user: { sub: 43, role: 'SALES' } })).status, 403);
});

test('SHP-04: a reissue by SALES is refused once a set exists', async () => {
  const r = await app.call('POST', '/api/papertrail/900/print', { body: { docType: 'ISSUE', reissue: true }, user: { sub: 43, role: 'SALES' } });
  assert.equal(r.status, 403);
});

// UAT batch 5, SO-11 — a reservation made by the person saving, or by the bill's salesperson, may be drawn
test('SO-11: the counter keying a bill for a salesperson can draw the coupon it reserved', async () => {
  const { validateAndLockCouponReservations } = require('../services/coupon-service');
  const row = { Id: 1, CouponId: 9, CouponNo: 'C6906911', GoodId: 1156, GoodUnit: 'ตัน', ReservedQty: 1, Status: 'RESERVED', BeneficiaryCustId: '1158', OwnerCustId: '1158', CarrierSoId: null, ExpiresAt: null, CreatedBy: 64 };
  const tx = { request: () => ({ input() { return this; }, query: async () => ({ recordset: [row] }) }) };
  const lines = [{ couponReservationId: 1, goodId: '1156', qtyTon: 1, goodUnit: 'ตัน' }];
  await validateAndLockCouponReservations(tx, lines, '1158', null, { userId: 64, altUserIds: [36], role: 'COUNTER_SALES' }, 'I');
  await assert.rejects(validateAndLockCouponReservations(tx, lines, '1158', null, { userId: 36, altUserIds: [], role: 'SALES' }, 'I'), /ถูกสร้างโดยผู้ใช้อื่น/);
  row.CreatedBy = 36;
  await validateAndLockCouponReservations(tx, lines, '1158', null, { userId: 64, altUserIds: [36], role: 'COUNTER_SALES' }, 'I');
});
