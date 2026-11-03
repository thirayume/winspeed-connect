'use strict';

/**
 * UAT dry run 2026-11-03: a bill from a confirmed trip, unlocked for an edit, could never be confirmed again.
 * The trip answered "already confirmed" and the bill alone answered "confirm it with its trip".
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const ext = {
  289030: { IsUnlocked: 1, VerifiedAt: '2026-11-03T06:30:00Z' },
  289031: { IsUnlocked: 0, VerifiedAt: null },
};
const db = h.installDbStub(({ text, inputs }) => {
  if (/FROM wf\.SalesOrder WHERE Id IN/.test(text)) return [{ Id: 289030, NoTruckRequired: 0, TruckPlate: 'UAT2-QA31', SoPrefix: 'I' }];
  if (/FROM wf\.SalesTrip WITH \(UPDLOCK, ROWLOCK\)/.test(text)) return [{ TripId: 11, TripCode: 'TRIP6911-0005', Status: 'CONFIRMED', CreatedBy: 43, DocumentRevision: 2 }];
  if (/SELECT COUNT\(\*\) AS n FROM wf\.SalesOrderExt/.test(text)) {
    const ids = text.match(/IN \(([\d,]+)\)/)[1].split(',');
    return [{ n: ids.filter(id => ext[id] && ext[id].IsUnlocked).length }];
  }
  if (/FROM wf\.v_TripMember/.test(text)) {
    return [
      { TripId: 11, MemberKind: 'NATIVE', MemberId: 289030, DocuNo: 'I69-05286', SOID: 289030 },
      { TripId: 11, MemberKind: 'NATIVE', MemberId: 289031, DocuNo: 'I69-05287', SOID: 289031 },
    ];
  }
  if (/SELECT IsUnlocked, VerifiedAt FROM wf\.SalesOrderExt/.test(text)) return [ext[inputs.soid]];
  if (/sp_getapplock/.test(text)) return [{ LockResult: 0 }];
  return [];
}, { activeUserIds: h.TEST_USERS });

let app;
test.before(async () => { app = await h.startApp([['/api/trips', '../../routes/trips']]); });
test.after(async () => { await app.close(); });

const body = ids => ({ confirmedOrderIds: ids, transRegistration: 'UAT2-QA31', pickupDueDate: '2099-12-31' });
const sales = { sub: 43, role: 'SALES' };

test('a checked unlocked bill is locked again and the other bills keep their trip', async () => {
  const before = db.calls.length;
  const r = await app.call('POST', '/api/trips/11/confirm', { body: body([289030]), user: sales });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const calls = db.calls.slice(before);
  assert.ok(!calls.some(c => /INSERT INTO wf\.SalesTrip/.test(c.text)), 'no residual trip');
  const relocks = calls.filter(c => /UPDATE wf\.SalesOrderExt SET TripId = @tripId, UpdatedAt/.test(c.text));
  assert.deepEqual(relocks.map(c => c.inputs.soid), ['289030']);
  assert.ok(!calls.some(c => /SET TripId = @resTripId/.test(c.text)), 'the confirmed bill stays where it is');
});

test('an unlocked bill still needs the check before it is locked', async () => {
  ext[289030].VerifiedAt = null;
  try {
    const r = await app.call('POST', '/api/trips/11/confirm', { body: body([289030]), user: sales });
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.match(r.body.message, /FR-022/);
  } finally {
    ext[289030].VerifiedAt = '2026-11-03T06:30:00Z';
  }
});

test('a confirmed trip with no unlocked bill is still refused', async () => {
  const r = await app.call('POST', '/api/trips/11/confirm', { body: body([289031]), user: sales });
  assert.equal(r.status, 409, JSON.stringify(r.body));
});
