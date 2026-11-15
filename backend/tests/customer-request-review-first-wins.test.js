'use strict';
// Two reviewers on the same customer request: the first decision stands. The second is
// refused with 409 and writes nothing, instead of overwriting the first.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

let state;
let user = { sub: 8, actorSub: 8, role: 'MANAGER', actorRole: 'MANAGER', isImpersonating: false };
const auth = require.resolve('../middleware/auth');
require.cache[auth] = { id: auth, filename: auth, loaded: true, exports: {
  requireAuth: (req, _res, next) => { req.user = user; require('../services/request-context').runWithUser(user, next); },
  requireRole: () => (_req, _res, next) => next(), requireCapability: () => (_req, _res, next) => next(),
} };
const db = h.installDbStub(({ text, inputs }) => {
  if (text.includes("COL_LENGTH('wf.ChangeEvent'")) return [{ HasCol: 1 }];
  if (text.includes('SELECT * FROM wf.CustomerRequest WITH')) { assert.match(text, /UPDLOCK, HOLDLOCK/); return state.request ? [state.request] : []; }
  if (text.includes('UPDATE wf.CustomerRequest')) { state.updates++; state.request.Status = inputs.status; state.request.ReviewedBy = inputs.uid; return { rowsAffected: [1] }; }
  if (text.includes('MERGE wf.CreditMaster')) { state.synced++; return { rowsAffected: [1] }; }
  if (text.includes('INSERT INTO wf.ChangeEvent')) { state.audits.push(inputs); return { rowsAffected: [1] }; }
  return [];
});
db.stub.wfTransaction = async fn => { const before = structuredClone(state); try { return await fn(db.tx); } catch (e) { state = before; throw e; } };
let app;
test.before(async () => { app = await h.startApp([['/api/master', '../../routes/master']]); });
test.after(async () => app.close());
test.beforeEach(() => { state = { request: { Id: 42, Status: 'PENDING', WinspeedCustId: '12' }, updates: 0, synced: 0, audits: [] };
  user = { sub: 8, actorSub: 8, role: 'MANAGER', actorRole: 'MANAGER', isImpersonating: false }; });
const review = body => app.call('PATCH', '/api/master/customer-requests/42/review', { body });

test('a second, different decision is refused and changes nothing', async () => {
  assert.equal((await review({ status: 'APPROVED' })).status, 200);
  user = { sub: 9, actorSub: 9, role: 'ADMIN', actorRole: 'ADMIN', isImpersonating: false };
  const second = await review({ status: 'REJECTED', reviewNote: 'late' });
  assert.equal(second.status, 409);
  assert.match(second.body.message, /APPROVED/);
  assert.equal(state.request.Status, 'APPROVED'); assert.equal(state.request.ReviewedBy, 8);
  assert.equal(state.updates, 1); assert.equal(state.audits.length, 1);
});

test('the same decision sent twice is refused the second time, without a second audit row', async () => {
  assert.equal((await review({ status: 'REJECTED' })).status, 200);
  assert.equal((await review({ status: 'REJECTED' })).status, 409);
  assert.equal((await review({ status: 'APPROVED' })).status, 409);
  assert.equal((await review({ status: 'COMPLETED', winspeedCustId: '12' })).status, 409);
  assert.equal(state.request.Status, 'REJECTED'); assert.equal(state.updates, 1); assert.equal(state.audits.length, 1); assert.equal(state.synced, 0);
});

test('an approved request can still be completed once, and a completed one is final', async () => {
  assert.equal((await review({ status: 'APPROVED' })).status, 200);
  assert.equal((await review({ status: 'COMPLETED', winspeedCustId: '12' })).status, 200);
  assert.equal(state.request.Status, 'COMPLETED'); assert.equal(state.synced, 1); assert.equal(state.audits.length, 2);
  for (const status of ['APPROVED', 'REJECTED', 'COMPLETED']) assert.equal((await review({ status })).status, 409, status);
  assert.equal(state.updates, 2); assert.equal(state.synced, 1); assert.equal(state.audits.length, 2);
});

test('a pending request can be completed directly, as before', async () => {
  assert.equal((await review({ status: 'COMPLETED', winspeedCustId: '12' })).status, 200);
  assert.equal(state.request.Status, 'COMPLETED');
});

test('a client that says which status it was looking at is refused when that is stale', async () => {
  assert.equal((await review({ status: 'APPROVED', expectedStatus: 'PENDING' })).status, 200);
  const stale = await review({ status: 'COMPLETED', winspeedCustId: '12', expectedStatus: 'PENDING' });
  assert.equal(stale.status, 409); assert.equal(state.request.Status, 'APPROVED'); assert.equal(state.synced, 0);
  assert.equal((await review({ status: 'COMPLETED', winspeedCustId: '12', expectedStatus: 'approved' })).status, 200);
});
