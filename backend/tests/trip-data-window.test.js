'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
let failPrimary = false;
let currentUser = { sub: 12, id: 12, role: 'ADMIN' };
const windowPath = require.resolve('../services/global-data-window-store');
require.cache[windowPath] = { id: windowPath, filename: windowPath, loaded: true, exports: {
  readGlobalDataWindow: async () => {
    if (failPrimary) throw new Error('PRIMARY_UNAVAILABLE');
    return require('../services/data-window').boundaries('2026-01-01');
  },
} };
const authPath = require.resolve('../middleware/auth');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  requireAuth: (req, _res, next) => { req.user = currentUser; next(); },
  requireRole: () => (_req, _res, next) => next(),
  requireCapability: () => (_req, _res, next) => next(),
  canViewAllRebateAmounts: () => true,
} };
const db = h.installDbStub(({ text, inputs }) => {
  // 1 is an old trip, 2 is a new trip with an old member, 3 is current.
  if (/SELECT 1 AS ok FROM wf\.SalesTrip t/.test(text))
    return Number(inputs.tid) === 3 ? [{ ok: 1 }] : [];
  if (/SELECT \* FROM wf\.SalesTrip st WHERE st\.TripId/.test(text))
    return Number(inputs.id) === 3 ? [{ TripId: 3, Status: 'DRAFT' }] : [];
  return [];
});
let app;
test.before(async () => { app = await h.startApp([['/api/trips', '../../routes/trips']]); });
test.after(async () => { await app.close(); });

function checkWindow(call) {
  assert.match(call.text, /\.CreatedAt >= @tripStartUtc/);
  assert.match(call.text, /draft\.CreatedAt < @tripStartUtc/);
  assert.match(call.text, /native\.DocuDate < @tripStartDate/);
  assert.match(call.text, /NOT EXISTS \(/);
  assert.equal(call.inputs.tripStartUtc.toISOString(), '2025-12-31T17:00:00.000Z');
  assert.equal(call.inputs.tripStartDate, '2026-01-01');
}

test('trip list and board enforce the central window, even for an administrator', async () => {
  const start = db.calls.length;
  assert.equal((await app.call('GET', '/api/trips')).status, 200);
  assert.equal((await app.call('GET', '/api/trips/board')).status, 200);
  const calls = db.calls.slice(start).filter(c => /FROM wf\.SalesTrip t/.test(c.text));
  assert.equal(calls.length, 2);
  for (const call of calls) checkWindow(call);
});

test('old and mixed trips cannot be opened or acknowledged by ID', async () => {
  const start = db.calls.length;
  assert.equal((await app.call('GET', '/api/trips/1')).status, 404);
  assert.equal((await app.call('POST', '/api/trips/2/load-plan/ack', { body: { expectedPlanRevision: 1 } })).status, 404);
  const calls = db.calls.slice(start);
  for (const call of calls.filter(c => /FROM wf\.SalesTrip (?:st|t) WHERE/.test(c.text))) checkWindow(call);
  assert.ok(!calls.some(c => /UPDATE wf\.SalesTrip/.test(c.text)));
});

test('Access As must satisfy the real actor trip scope as well as the effective scope', async () => {
  currentUser = { sub: 43, actorSub: 12, role: 'ADMIN', actorRole: 'SALES', isImpersonating: true,
    identityMapping: { primaryActorUserId: 12, primaryEffectiveUserId: 43,
      businessActorUserId: 102, businessEffectiveUserId: 103 } };
  try {
    const start = db.calls.length;
    assert.equal((await app.call('GET', '/api/trips/board')).status, 200);
    const query = db.calls.slice(start).find(c => /FROM wf\.SalesTrip t/.test(c.text));
    assert.equal(query.inputs.tacU0, 102);
    assert.equal(query.inputs.tamU0, 102);
    assert.match(query.text, /t\.CreatedBy IN \(@tacU0\)/);
    checkWindow(query);
  } finally { currentUser = { sub: 12, id: 12, role: 'ADMIN' }; }
});

test('failure to read the primary cutoff blocks trip reads and writes', async () => {
  failPrimary = true;
  try {
    const start = db.calls.length;
    assert.ok((await app.call('GET', '/api/trips/board')).status >= 500);
    assert.ok((await app.call('POST', '/api/trips/3/load-plan/ack', { body: { expectedPlanRevision: 1 } })).status >= 500);
    assert.ok(!db.calls.slice(start).some(c => /UPDATE wf\.SalesTrip/.test(c.text)));
  } finally { failPrimary = false; }
});
