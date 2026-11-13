'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
let scenario = 'draft-ok';
let persistedTrips = 0;
const user = { sub: 43, id: 43, actorSub: 12, role: 'ADMIN', actorRole: 'SALES', isImpersonating: true,
  identityMapping: { primaryActorUserId: 12, primaryEffectiveUserId: 43,
    businessActorUserId: 102, businessEffectiveUserId: 103 } };
const authPath = require.resolve('../middleware/auth');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  requireAuth: (req, _res, next) => { req.user = user; next(); },
  requireRole: () => (_req, _res, next) => next(),
  requireCapability: () => (_req, _res, next) => next(),
  canViewAllRebateAmounts: () => true,
} };
const policyPath = require.resolve('../services/so-pickup-policy');
const policy = require(policyPath);
require.cache[policyPath] = { id: policyPath, filename: policyPath, loaded: true,
  exports: { ...policy, resolvePickupPolicy: async () => ({ leadTimeDays: 1, strictMode: false }) } };
const db = h.installDbStub(({ text }) => {
  if (/INSERT INTO wf\.SalesTrip/.test(text)) { persistedTrips++; return [{ TripId: 99 }]; }
  if (/AS DraftCount/.test(text)) {
    if (scenario === 'ambiguous') return [{ DraftCount: 1, NativeCount: 1 }];
    return scenario.startsWith('native') ? [{ DraftCount: 0, NativeCount: 1 }] : [{ DraftCount: 1, NativeCount: 0 }];
  }
  if (/UPDATE o SET TripId/.test(text)) return { recordset: [], rowsAffected: [scenario === 'draft-ok' ? 1 : 0] };
  if (/UPDATE e SET TripId/.test(text)) return { recordset: [], rowsAffected: [scenario === 'native-ok' ? 1 : 0] };
  return [];
});
const underlyingTransaction = db.stub.wfTransaction;
db.stub.wfTransaction = async fn => {
  const before = persistedTrips;
  try { return await underlyingTransaction(fn); }
  catch (e) { persistedTrips = before; throw e; }
};
let app;
test.before(async () => { app = await h.startApp([['/api/trips', '../../routes/trips']]); });
test.after(async () => { await app.close(); });
const create = ids => app.call('POST', '/api/trips', { body: { tripCode: 'UAT-TEST', orderIds: ids } });

test('new draft and native members are bound to cutoff and real actor scope', async () => {
  for (const s of ['draft-ok', 'native-ok']) {
    scenario = s;
    const start = db.calls.length;
    const response = await create([501]);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const calls = db.calls.slice(start);
    const insert = calls.find(c => /INSERT INTO wf\.SalesTrip/.test(c.text));
    assert.equal(insert.inputs.createdBy, 103);
    const member = calls.find(c => /UPDATE [oe] SET TripId/.test(c.text));
    assert.equal(member.kind, 'tx');
    if (s === 'draft-ok') {
      assert.match(member.text, /o\.CreatedAt>=@startUtc/);
      assert.match(member.text, /o\.TripId IS NULL/);
      assert.equal(member.inputs.startUtc.toISOString(), '2025-12-31T17:00:00.000Z');
      assert.equal(member.inputs.newDraftActorU0, 102);
    } else {
      assert.match(member.text, /h\.DocuType=103/);
      assert.match(member.text, /h\.DocuDate>=@startDate/);
      assert.match(member.text, /e\.TripId IS NULL/);
      assert.equal(member.inputs.startDate, '2026-01-01');
      assert.equal(member.inputs.newNativeActorU0, 102);
    }
  }
});

test('old, out-of-scope, already-linked or ambiguous members roll back the new trip', async () => {
  for (const s of ['draft-old-or-denied', 'native-old-or-denied', 'ambiguous']) {
    scenario = s;
    const before = persistedTrips;
    assert.equal((await create([501])).status, 409);
    assert.equal(persistedTrips, before);
  }
});

test('duplicate and malformed member IDs are rejected before writing', async () => {
  const before = persistedTrips;
  assert.equal((await create([501, '501'])).status, 400);
  assert.equal((await create(['1;DROP'])).status, 400);
  assert.equal(persistedTrips, before);
});
