'use strict';
// No socket, middleware, SQL server, real deletions or export recipients are used.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
let state, failAudit;
const db = h.installDbStub(({ kind, text, inputs }) => {
  if (/COL_LENGTH\('wf\.ChangeEvent'/.test(text)) return [{ HasCol: 1 }];
  if (/FROM wf\.AppUser WHERE Id/.test(text)) return [{ Id: 5, Username: 'fixture' }];
  if (/SELECT DataClass, RetentionDays FROM wf.RetentionPolicy/.test(text)) return [{ DataClass: 'ERROR_LOG', RetentionDays: 30 }];
  if (/DELETE FROM wf.ErrorLog/.test(text)) { assert.equal(kind, 'tx'); state.deleted = 3; return { rowsAffected: [3] }; }
  if (/INSERT INTO wf.DsarLog/.test(text)) { assert.equal(kind, 'tx'); state.dsarUser = inputs.user; return []; }
  if (/INSERT INTO wf.ChangeEvent/.test(text)) { assert.equal(kind, 'tx'); if (failAudit) throw Error('audit failure'); state.event = inputs; return []; }
  return [];
});
db.stub.wfTransaction = async fn => { const old = structuredClone(state); try { return await fn(db.tx); } catch (e) { state = old; throw e; } };
const router = require('../routes/pdpa');
const { runWithUser } = require('../services/request-context');
const user = { sub: 7, actorSub: 9, isImpersonating: true, identityMapping: {
  primaryEffectiveUserId: 7, primaryActorUserId: 9, businessEffectiveUserId: 17, businessActorUserId: 19,
} };
async function call(route, body = {}) {
  const handler = router.stack.find(x => x.route?.path === route).route.stack.at(-1).handle;
  const req = { params: {}, body, user, ip: '127.0.0.1' };
  const res = { code: 200, status(n) { this.code = n; return this; }, json(body) { this.body = body; return this; } };
  await runWithUser(user, () => handler(req, res)); return res;
}
test.beforeEach(() => { state = {}; failAudit = false; });
test('retention handler records both mapped identities and count', async () => {
  const res = await call('/retention/run'); assert.equal(res.code, 200); assert.equal(state.deleted, 3);
  assert.equal(state.event.userId, '17'); assert.equal(state.event.actorUserId, '19'); assert.equal(res.body.result.errorLogDeleted, 3);
});
test('DSAR export returns no subject data when audit insertion fails', async () => {
  failAudit = true; const old = console.error; console.error = () => {};
  try { const res = await call('/dsar/export', { subjectType: 'USER', subjectId: 5 });
    assert.equal(res.code, 500); assert.equal(res.body.data, undefined); assert.equal(state.dsarUser, undefined); }
  finally { console.error = old; }
});
test('DSAR handler commits mapped requester and actor audit before returning data', async () => {
  const res = await call('/dsar/export', { subjectType: 'USER', subjectId: 5 });
  assert.equal(res.code, 200); assert.equal(state.dsarUser, 17); assert.equal(state.event.actorUserId, '19'); assert.equal(state.event.userId, '17');
});
