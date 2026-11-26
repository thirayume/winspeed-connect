'use strict';

/**
 * UAT dry run 2026-11-03 & Owner decision 2026-11-25:
 * - A bill from a confirmed trip, unlocked for an edit, can be confirmed again via trip confirm.
 * - Users from SALES upwards confirm directly without waiting for Counter-Sales verification (FR-022).
 * - Non-sales operational roles still require VerifiedAt.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const ext = {
  900000901: { IsUnlocked: 1, VerifiedAt: null },
  900000902: { IsUnlocked: 0, VerifiedAt: null },
};
let warehouseCustomConfirm = false;
let tripCreatedBy = 43;
const db = h.installDbStub(({ text, inputs }) => {
  if (warehouseCustomConfirm && Number(inputs.id) === 91) {
    if (/SELECT Role,RoleCode,AuthVersion,MustChangePassword,IsActive FROM wf\.AppUser/.test(text)) {
      return [{ Role: 'WAREHOUSE', RoleCode: 'WH_CONFIRM', AuthVersion: 0, MustChangePassword: 0, IsActive: 1 }];
    }
    if (/FROM wf\.vUserRole u/.test(text)) {
      return [{ Code: 'WH_CONFIRM', BaseRole: 'WAREHOUSE', PermissionCode: 'so.confirm' }];
    }
  }
  if (/FROM wf\.SalesOrder WHERE Id IN/.test(text)) return [{ Id: 900000901, NoTruckRequired: 0, TruckPlate: 'TEST-TRUCK', SoPrefix: 'I' }];
  if (/FROM wf\.SalesTrip WITH \(UPDLOCK, ROWLOCK\)/.test(text)) return [{ TripId: 11, TripCode: 'TRIP-TEST-0005', Status: 'CONFIRMED', CreatedBy: tripCreatedBy, DocumentRevision: 2 }];
  if (/SELECT COUNT\(\*\) AS n FROM wf\.SalesOrderExt/.test(text)) {
    const ids = text.match(/IN \(([\d,]+)\)/)[1].split(',');
    return [{ n: ids.filter(id => ext[id] && ext[id].IsUnlocked).length }];
  }
  if (/FROM wf\.v_TripMember/.test(text)) {
    return [
      { TripId: 11, MemberKind: 'NATIVE', MemberId: 900000901, DocuNo: 'I99-TEST01', SOID: 900000901 },
      { TripId: 11, MemberKind: 'NATIVE', MemberId: 900000902, DocuNo: 'I99-TEST02', SOID: 900000902 },
    ];
  }
  if (/SELECT IsUnlocked, VerifiedAt FROM wf\.SalesOrderExt/.test(text)) return [ext[inputs.soid]];
  if (/sp_getapplock/.test(text)) return [{ LockResult: 0 }];
  return [];
}, { activeUserIds: [...h.TEST_USERS, 91] });

let app;
test.before(async () => { app = await h.startApp([['/api/trips', '../../routes/trips']]); });
test.after(async () => { await app.close(); });

const body = ids => ({ confirmedOrderIds: ids, transRegistration: 'TEST-TRUCK', pickupDueDate: '2099-12-31' });
const sales = { sub: 43, role: 'SALES' };
const counter = { sub: 64, role: 'COUNTER_SALES' };
const manager = { sub: 64, role: 'MANAGER' };

test('SALES, COUNTER_SALES and MANAGER lock an unlocked bill directly without Counter-Sales check and keep other bills on the trip', async () => {
  for (const user of [sales, counter, manager]) {
    const before = db.calls.length;
    const r = await app.call('POST', '/api/trips/11/confirm', { body: body([900000901]), user });
    assert.equal(r.status, 200, `${user.role}: ${JSON.stringify(r.body)}`);
    const calls = db.calls.slice(before);
    assert.ok(!calls.some(c => /INSERT INTO wf\.SalesTrip/.test(c.text)), 'no residual trip');
    const relocks = calls.filter(c => /UPDATE wf\.SalesOrderExt SET TripId = @tripId, UpdatedAt/.test(c.text));
    assert.deepEqual(relocks.map(c => c.inputs.soid), ['900000901']);
    assert.ok(!calls.some(c => /SET TripId = @resTripId/.test(c.text)), 'the confirmed bill stays where it is');
  }
});

test('non-sales operational role still needs Counter-Sales check before an unlocked bill is locked', async () => {
  warehouseCustomConfirm = true;
  tripCreatedBy = 91;
  try {
    const r = await app.call('POST', '/api/trips/11/confirm', {
      body: body([900000901]),
      user: { sub: 91, role: 'WAREHOUSE' },
    });
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.match(r.body.message, /FR-022/);
  } finally {
    warehouseCustomConfirm = false;
    tripCreatedBy = 43;
  }
});

test('a confirmed trip with no unlocked bill is still refused', async () => {
  const r = await app.call('POST', '/api/trips/11/confirm', { body: body([900000902]), user: sales });
  assert.equal(r.status, 409, JSON.stringify(r.body));
});
