'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
let currentRequest = false;
const db = h.installDbStub(({ text }) => {
  if (/SELECT RequesterId, LenderId, Status FROM wf\.GiveawayBorrowRequest/.test(text)) {
    return currentRequest ? [{ RequesterId: 19, LenderId: 12, Status: 'PENDING' }] : [];
  }
  if (/SELECT \* FROM wf\.GiveawayBorrowRequest WITH \(UPDLOCK, ROWLOCK\)/.test(text)) return [];
  if (/UPDATE wf\.GiveawayBorrowRequest/.test(text)) return { recordset: [], rowsAffected: [1] };
  return [];
}, { activeUserIds: h.TEST_USERS });
let app;
test.before(async () => { app = await h.startApp([['/api/giveaway', '../../routes/giveaway']]); });
test.after(async () => { await app.close(); });

test('borrow list and quota history use the UTC boundary', async () => {
  const user = { sub: 12, role: 'ADMIN' };
  const before = db.calls.length;
  assert.equal((await app.call('GET', '/api/giveaway/borrow-requests', { user })).status, 200);
  assert.equal((await app.call('GET', '/api/giveaway/budget-history?region=central&year=2026', { user })).status, 200);
  const calls = db.calls.slice(before).filter(call => /@globalStartUtc/.test(call.text));
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.inputs.globalStartUtc.toISOString() === '2025-12-31T17:00:00.000Z'));
});

test('old borrow request cannot be approved or rejected by direct ID', async () => {
  const user = { sub: 12, role: 'ADMIN' };
  for (const approve of [false, true]) {
    const before = db.calls.length;
    const response = await app.call('PATCH', '/api/giveaway/borrow-requests/1/resolve', { user, body: { approve } });
    assert.equal(response.status, 404, JSON.stringify(response.body));
    assert.ok(!db.calls.slice(before).some(call => /UPDATE wf\.GiveawayBorrowRequest/.test(call.text)));
  }
});

test('current request can be rejected by the lender', async () => {
  currentRequest = true;
  try {
    const result = await app.call('PATCH', '/api/giveaway/borrow-requests/1/resolve', { user: { sub: 12, role: 'ADMIN' }, body: { approve: false } });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const update = db.calls.find(call => /UPDATE wf\.GiveawayBorrowRequest/.test(call.text));
    assert.match(update.text, /RequestedAt >= @globalStartUtc/);
  } finally { currentRequest = false; }
});

test('borrow actions check both identities and all roles', () => {
  const { canResolveBorrow } = require('../routes/giveaway').__testing;
  const request = { RequesterId: 19, LenderId: 12 };
  assert.equal(canResolveBorrow({ sub: 12, role: 'SALES' }, request, true), true);
  assert.equal(canResolveBorrow({ sub: 19, role: 'SALES' }, request, true), false);
  assert.equal(canResolveBorrow({ sub: 19, role: 'SALES', roles: ['SALES', 'MANAGER'] }, request, true), true);
  const asOther = { sub: 12, role: 'SALES', actorSub: 19, actorRoles: ['SALES'], isImpersonating: true };
  assert.equal(canResolveBorrow(asOther, request, true), false);
  assert.equal(canResolveBorrow({ ...asOther, actorRoles: ['MANAGER'] }, request, true), true);
  assert.equal(canResolveBorrow(asOther, request, false), true);
});
