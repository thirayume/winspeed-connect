'use strict';

/**
 * UAT round trip 2026-11-03: a bill read CONFIRMED after WinSpeed had issued its 104, ticket, 116 and 107, so it could
 * still be cancelled or rewritten from the app with all of those left standing. Once a 104 exists, WinSpeed owns it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const bill = { Id: '289030', Status: 'CONFIRMED', SalesUserId: 43, WfRef: 'I69-05286', CustId: '1086', ImportedDocuNo: 'I69-05286', AppvDocuNo: 'AI69-08940' };
const unlocked = { ...bill, Status: 'DRAFT' };
let issued = 'I69-04747';
let current = bill;
const requests = {
  1: { Id: 1, SoId: '289030', RequesterId: 43, Status: 'PENDING', ReqType: 'CANCEL', Reason: 'customer cancelled' },
  2: { Id: 2, SoId: '289030', RequesterId: 43, Status: 'PENDING', ReqType: 'EDIT', Reason: 'new date' },
};
const db = h.installDbStub(({ text, inputs }) => {
  if (/FROM wf\.v_AllSalesOrders WHERE CAST\(Id AS INT\) = @id/.test(text)) return [current];
  if (/FROM wf\.EditReason/.test(text)) return [{ ReasonCode: 'X', ReasonText: 'customer cancelled', AppliesTo: 'SO_CANCEL,SO_DELETE', IsActive: 1 }];
  if (/JOIN dbo\.SOHD d WITH \(NOLOCK\) ON d\.DocuType = 104/.test(text)) return issued ? [{ DocuNo: issued }] : [];
  if (/SELECT \* FROM wf\.UnlockRequest WHERE Id=@id/.test(text)) return [requests[inputs.id]];
  if (/FROM\s+dbo\.SOHD s\s/.test(text) && /s\.SOID = @soid AND s\.DocuType = 103/.test(text)) return [{ SOID: '289030', DocuNo: 'I69-05286', CustId: '1086' }];
  if (/SELECT \* FROM wf\.EditRequest WHERE Id = @id/.test(text)) return [{ Id: 7, SOID: '289030', Status: 'PENDING', RequestedBy: 43 }];
  return [];
}, { activeUserIds: h.TEST_USERS });

let app;
test.before(async () => { app = await h.startApp([['/api/so', '../../routes/so'], ['/api/edit-requests', '../../routes/edit-requests']]); });
test.after(async () => { await app.close(); });

const sales = { sub: 43, role: 'SALES' };
const approver = { sub: 12, role: 'ACCOUNTING' };
const admin = { sub: 1, role: 'ADMIN' };
const refused = (r) => {
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.match(r.body.message, /I69-04747/);
};
const noWinSpeedWrite = (before) => {
  assert.ok(!db.calls.slice(before).some(c => /UPDATE dbo\.SOHD|DELETE FROM dbo\.SO|usp_ResetBookingApproval/.test(c.text + (c.proc || ''))));
};

test('the Cancel button refuses a bill with a 104', async () => {
  const before = db.calls.length;
  refused(await app.call('PATCH', '/api/so/289030/cancel', { body: { reasonCode: 'X', reason: 'customer cancelled' }, user: sales }));
  noWinSpeedWrite(before);
});

test('a request to edit or cancel is refused', async () => {
  refused(await app.call('POST', '/api/so/289030/unlock-request', { body: { reason: 'customer cancelled', reqType: 'CANCEL' }, user: sales }));
  refused(await app.call('POST', '/api/so/289030/unlock-request', { body: { reason: 'change the date', reqType: 'EDIT' }, user: sales }));
});

test('a request filed before the 104 cannot be approved after it', async () => {
  const before = db.calls.length;
  refused(await app.call('PATCH', '/api/so/unlock-requests/1/resolve', { body: { approve: true }, user: approver }));
  refused(await app.call('PATCH', '/api/so/unlock-requests/2/resolve', { body: { approve: true }, user: approver }));
  noWinSpeedWrite(before);
});

test('saving a bill unlocked before the 104 is refused', async () => {
  current = unlocked;
  try {
    const before = db.calls.length;
    refused(await app.call('PUT', '/api/so/289030', {
      body: { custId: '1086', soPrefix: 'I', deliveryDate: '2026-11-03', truckPlate: 'UAT2-QA31', lines: [{ goodId: '1118', qtyTon: 1, pricePerTon: 18200 }] },
      user: sales,
    }));
    noWinSpeedWrite(before);
  } finally { current = bill; }
});

test('bulk cancel and delete refuse it', async () => {
  refused(await app.call('POST', '/api/so/bulk-cancel-delete', { body: { soIds: ['289030'], action: 'CANCEL', reasonCode: 'X', reasonText: 'customer cancelled' }, user: sales }));
  current = unlocked;
  try {
    refused(await app.call('DELETE', '/api/so/289030', { body: { reasonCode: 'X', reason: 'customer cancelled' }, user: sales }));
  } finally { current = bill; }
});

test('the edit request path refuses it at both ends', async () => {
  refused(await app.call('POST', '/api/edit-requests', { body: { soid: '289030', reasonCode: 'OTHER', reasonDetail: 'change the date' }, user: sales }));
  refused(await app.call('PATCH', '/api/edit-requests/7/approve', { body: { note: 'ok' }, user: admin }));
});

test('without a 104 the same cancel goes through', async () => {
  issued = null;
  try {
    const r = await app.call('PATCH', '/api/so/unlock-requests/1/resolve', { body: { approve: true }, user: approver });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(db.calls.some(c => /UPDATE dbo\.SOHD SET DocuStatus='C'/.test(c.text)));
  } finally { issued = 'I69-04747'; }
});

test('cancelling an approved booking with no 104 takes it out of the WinSpeed lookup', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { splitBatches } = require('../run_migrations');
  const { assertNoCrossDbWrite } = require('../safety-validator');
  const text = fs.readFileSync(path.join(__dirname, '../migrations/166_cancelled_booking_leaves_winspeed.sql'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(text, /^-- @transaction/m);
  assert.doesNotMatch(text, /\b(CREATE|ALTER|DROP)\s+(TABLE|VIEW|PROCEDURE|FUNCTION|TRIGGER|INDEX)\s+(\[?dbo\]?\.)/i);
  assert.doesNotMatch(text, /CREATE\s+OR\s+ALTER|\bTHROW\b|dbwins_worldfert/i);
  for (const batch of splitBatches(text)) assert.doesNotThrow(() => assertNoCrossDbWrite(batch));
  assert.match(text, /b\.AppvFlag = 'W' AND b\.AppvDocuNo IS NULL/, 'waiting bookings as before');
  assert.match(text, /b\.AppvFlag = 'Y' AND NOT EXISTS/, 'approved bookings only with no 104');
  assert.match(text, /d\.DocuType = 104 AND d\.RefNo = b\.AppvDocuNo/);
});
