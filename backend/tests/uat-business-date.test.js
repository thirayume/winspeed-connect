'use strict';

/**
 * UAT batch 8, F-01 — business dates (effective from/to of shared-coupon rights) are Bangkok dates.
 * Comparing them with GETUTCDATE() hid a right granted "from today" until 07:00 Bangkok. Guard every
 * such comparison in the coupon and rebate code against coming back.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const FILES = ['services/coupon-service.js', 'routes/rebate.js'];
const BAD = /Effective(From|To)\s*[<>]=?\s*GETUTCDATE\(\)/;

test('F-01: shared-coupon effective dates are compared with the Bangkok business date', () => {
  for (const f of FILES) {
    const text = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.ok(!BAD.test(text), `${f} compares an effective date with UTC now`);
    assert.match(text, /EffectiveFrom <= CAST\(DATEADD\(hour, 7, GETUTCDATE\(\)\) AS DATE\)/);
  }
});

// UAT batch 8, F-03 — ticket expiry obeys the O-4 scope (route level)
const h = require('./helpers/route-harness.cjs');
const db = h.installDbStub(({ text, inputs }) => {
  if (/SELECT Id, EmpId, PositionCode FROM wf\.AppUser WHERE Id = @id/.test(text)) return [{ Id: inputs.id, EmpId: String(7000 + inputs.id), PositionCode: null }];
  if (/FROM dbo\.WFCoupon c WITH \(NOLOCK\) JOIN dbo\.SOHD s/.test(text)) return inputs.no === 'C6906911' ? [{ EmpID: '7036' }] : [];
  return [];
});
let app;
test.before(async () => { app = await h.startApp([['/api/master', '../../routes/master']]); });
test.after(async () => { await app.close(); });

test('F-03: another salesperson cannot change a ticket expiry (404); the owner reaches the service', async () => {
  const other = await app.call('PATCH', '/api/master/control-tickets/C6906911/expiry', { body: { expiryDate: '2026-10-27', reasonCode: 'OTHER', reasonText: 'x' }, user: { sub: 19, role: 'SALES' } });
  assert.equal(other.status, 404);
  const before = db.calls.length;
  const owner = await app.call('PATCH', '/api/master/control-tickets/C6906911/expiry', { body: { expiryDate: '2026-10-27', reasonCode: 'OTHER', reasonText: 'x' }, user: { sub: 36, role: 'SALES' } });
  assert.notEqual(owner.status, 404);
  assert.ok(db.calls.length > before);
});
