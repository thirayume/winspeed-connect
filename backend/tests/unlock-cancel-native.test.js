'use strict';

/**
 * UAT dry run 2026-11-03: approving a request to cancel a confirmed bill wrote a value nothing reads, so the bill
 * stayed live in the app and in the WinSpeed approval queue. It now cancels the same way as the Cancel button.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const bill = { Id: '289026', Status: 'PENDING_APPROVAL', SalesUserId: 43, WfRef: 'K69-03420', CustId: '1086', ImportedDocuNo: 'K69-03420' };
const requests = {
  1: { Id: 1, SoId: '289026', RequesterId: 43, Status: 'PENDING', ReqType: 'CANCEL', Reason: 'customer cancelled' },
  2: { Id: 2, SoId: '289026', RequesterId: 43, Status: 'PENDING', ReqType: 'EDIT', Reason: 'new date' },
};
let billStatus = bill.Status;
const db = h.installDbStub(({ text, inputs }) => {
  if (/FROM wf\.v_AllSalesOrders WHERE CAST\(Id AS INT\) = @id/.test(text)) return [{ ...bill, Status: billStatus }];
  if (/SELECT \* FROM wf\.UnlockRequest WHERE Id=@id/.test(text)) return [requests[inputs.id]];
  return [];
}, { activeUserIds: h.TEST_USERS });

let app;
test.before(async () => { app = await h.startApp([['/api/so', '../../routes/so']]); });
test.after(async () => { await app.close(); });

const approver = { sub: 12, role: 'ACCOUNTING' };

test('an approved cancel request cancels the bill in WinSpeed', async () => {
  const before = db.calls.length;
  const r = await app.call('PATCH', '/api/so/unlock-requests/1/resolve', { body: { approve: true, note: 'ok' }, user: approver });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const calls = db.calls.slice(before);
  assert.ok(calls.some(c => /UPDATE dbo\.SOHD SET DocuStatus='C'/.test(c.text)), 'the view reads DocuStatus');
  assert.ok(calls.some(c => c.proc === 'wf.usp_MarkCancelledBookingNotApproved'), 'it leaves the approval queue');
  assert.ok(calls.some(c => /UPDATE wf\.CouponReservation/.test(c.text)), 'coupon reservations are released');
  assert.ok(!calls.some(c => /PkgStatus='C'/.test(c.text)));
});

test('an approved edit request still only unlocks the bill', async () => {
  const before = db.calls.length;
  const r = await app.call('PATCH', '/api/so/unlock-requests/2/resolve', { body: { approve: true }, user: approver });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const calls = db.calls.slice(before);
  assert.ok(calls.some(c => /SET IsUnlocked=1/.test(c.text)));
  assert.ok(!calls.some(c => /DocuStatus='C'/.test(c.text)));
});

test('a shipped bill is not cancelled by an old request', async () => {
  billStatus = 'SHIPPED';
  try {
    const r = await app.call('PATCH', '/api/so/unlock-requests/1/resolve', { body: { approve: true }, user: approver });
    assert.equal(r.status, 400, JSON.stringify(r.body));
  } finally {
    billStatus = bill.Status;
  }
});
