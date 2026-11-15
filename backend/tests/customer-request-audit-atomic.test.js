'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

let state, failure, withContext = true;
let user = { sub: 8, actorSub: 17, role: 'MANAGER', actorRole: 'ADMIN', isImpersonating: true };
const auth = require.resolve('../middleware/auth');
require.cache[auth] = { id: auth, filename: auth, loaded: true, exports: {
  requireAuth: (req, _res, next) => { req.user = user; if (withContext) require('../services/request-context').runWithUser(user, next); else next(); },
  requireRole: () => (_req, _res, next) => next(), requireCapability: () => (_req, _res, next) => next()
} };
const db = h.installDbStub(({ kind, text, inputs }) => {
  if (text.includes("COL_LENGTH('wf.ChangeEvent'")) return [{ HasCol: 1 }];
  if (text.includes('INSERT INTO wf.CustomerRequest')) {
    assert.equal(kind, 'tx'); state.request = { Id: 42, Status: 'PENDING', RequestedBy: inputs.uid }; return [{ Id: 42 }];
  }
  if (text.includes('SELECT * FROM wf.CustomerRequest WITH')) {
    assert.equal(kind, 'tx');
    assert.ok(text.includes('CreatedAt >= @globalStartUtc'));
    assert.equal(inputs.globalStartUtc.toISOString(), '2025-12-31T17:00:00.000Z');
    return state.request && !state.old ? [state.request] : [];
  }
  if (text.includes('UPDATE wf.CustomerRequest')) {
    assert.equal(kind, 'tx'); state.request.Status = inputs.status; state.request.ReviewedBy = inputs.uid; return { rowsAffected: [1] };
  }
  if (text.includes('MERGE wf.CreditMaster')) {
    assert.equal(kind, 'tx'); state.ext = true; if (failure === 'sync') throw Error('SYNC_FAILED'); state.credit = true; return { rowsAffected: [1] };
  }
  if (text.includes('INSERT INTO wf.ChangeEvent')) {
    assert.equal(kind, 'tx'); if (failure === 'audit') throw Error('AUDIT_FAILED'); state.audits.push(inputs); return { rowsAffected: [1] };
  }
  return [];
});
db.stub.wfTransaction = async fn => { const before = structuredClone(state); try { return await fn(db.tx); } catch (e) { state = before; throw e; } };
let app;
test.before(async () => { app = await h.startApp([['/api/master', '../../routes/master']]); });
test.after(async () => app.close());
test.beforeEach(() => { state = { request: { Id: 42, Status: 'PENDING', CustName: 'PRIVATE_NAME', Email: 'PRIVATE_EMAIL', WinspeedCustId: '12', CreditLimit: 20 }, ext: false, credit: false, audits: [] }; failure = null; withContext = true; user = { sub: 8, actorSub: 17, role: 'MANAGER', actorRole: 'ADMIN', isImpersonating: true }; });

test('create and audit roll back together; audit stores actor/effective without PII', async () => {
  failure = 'audit'; const original = structuredClone(state);
  let r = await app.call('POST', '/api/master/customer-requests', { body: { CustName: 'PRIVATE_NAME' } });
  assert.equal(r.status, 500); assert.deepEqual(state, original);
  failure = null; r = await app.call('POST', '/api/master/customer-requests', { body: { CustName: 'PRIVATE_NAME' } });
  assert.equal(r.status, 201); assert.equal(r.body.id, 42); assert.equal(state.request.RequestedBy, 8);
  assert.equal(state.audits[0].userId, '8'); assert.equal(state.audits[0].actorUserId, '17');
  assert.doesNotMatch(JSON.stringify(state.audits[0]), /PRIVATE_NAME|PRIVATE_EMAIL/);
});
test('review, customer/credit sync and audit roll back on sync or audit failure', async () => {
  const body = { status: 'COMPLETED', winspeedCustId: '12', reviewNote: 'PRIVATE_NOTE' };
  for (const error of ['sync', 'audit']) {
    failure = error; const before = structuredClone(state);
    const r = await app.call('PATCH', '/api/master/customer-requests/42/review', { body });
    assert.equal(r.status, 500); assert.deepEqual(state, before);
  }
  failure = null; const r = await app.call('PATCH', '/api/master/customer-requests/42/review', { body });
  assert.equal(r.status, 200); assert.equal(state.request.Status, 'COMPLETED'); assert.equal(state.request.ReviewedBy, 8);
  assert.equal(state.ext, true); assert.equal(state.credit, true); assert.equal(state.audits.length, 1);
  assert.equal(state.audits[0].actorUserId, '17'); assert.equal(state.audits[0].userId, '8');
  assert.doesNotMatch(JSON.stringify(state.audits[0]), /PRIVATE_NAME|PRIVATE_EMAIL|PRIVATE_NOTE/);
});
test('review hides records before cutoff and preserves optional WinSpeed customer ID behavior', async () => {
  state.old = true; let r = await app.call('PATCH', '/api/master/customer-requests/42/review', { body: { status: 'COMPLETED' } });
  assert.equal(r.status, 404); assert.equal(state.audits.length, 0);
  state.old = false; state.request.WinspeedCustId = null;
  r = await app.call('PATCH', '/api/master/customer-requests/42/review', { body: { status: 'COMPLETED' } });
  assert.equal(r.status, 200); assert.equal(state.ext, false); assert.equal(state.credit, false);
  assert.match(state.audits[0].afterJson, /"masterSynced":false/);
});
test('mapped business identities, not primary IDs, are used for actor and effective audit', async () => {
  user.identityMapping = { primaryEffectiveUserId: 8, primaryActorUserId: 17, businessEffectiveUserId: 28, businessActorUserId: 37 };
  const r = await app.call('PATCH', '/api/master/customer-requests/42/review', { body: { status: 'APPROVED' } });
  assert.equal(r.status, 200); assert.equal(state.request.ReviewedBy, 28);
  assert.equal(state.audits[0].userId, '28'); assert.equal(state.audits[0].actorUserId, '37');
});
test('Access As fails closed without the actor context before any write', async () => {
  withContext = false; const before = structuredClone(state);
  const r = await app.call('PATCH', '/api/master/customer-requests/42/review', { body: { status: 'APPROVED' } });
  assert.equal(r.status, 503); assert.deepEqual(state, before);
});
