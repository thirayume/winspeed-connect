'use strict';
// Calls the actual Express handler without a listening socket. Authentication
// middleware and real SQL are deliberately outside this test's scope.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
let state, failAudit;
const db = h.installDbStub(({ kind, text, inputs }) => {
  if (/COL_LENGTH\('wf\.ChangeEvent'/.test(text)) return [{ HasCol: 1 }];
  if (/UPDATE i SET Status[\s\S]*FROM wf\.RuleIncident i/.test(text)) {
    assert.equal(kind, 'tx'); state.status = 'ACK'; state.by = inputs.by; return [{ Affected: 1 }];
  }
  if (/INSERT INTO wf\.ChangeEvent/.test(text)) {
    assert.equal(kind, 'tx'); if (failAudit) throw Error('audit failure'); state.event = inputs; return [];
  }
  return [];
});
db.stub.wfTransaction = async fn => { const old = structuredClone(state); try { return await fn(db.tx); }
  catch (e) { state = old; throw e; } };
const router = require('../routes/incidents');
const layer = router.stack.find(x => x.route?.path === '/:id/ack');
const handler = layer.route.stack.at(-1).handle;
const { runWithUser } = require('../services/request-context');
const user = { sub: 7, actorSub: 9, isImpersonating: true, identityMapping: {
  primaryEffectiveUserId: 7, primaryActorUserId: 9, businessEffectiveUserId: 17, businessActorUserId: 19,
} };
async function call() {
  const req = { params: { id: '8' }, body: { note: 'reviewed' }, user, ip: '127.0.0.1' };
  const res = { code: 200, status(n) { this.code = n; return this; }, json(body) { this.body = body; return this; } };
  await runWithUser(user, () => handler(req, res)); return res;
}
test.beforeEach(() => { state = { status: 'OPEN' }; failAudit = false; });
test('handler writes mapped actor and effective IDs within the same transaction', async () => {
  const res = await call(); assert.equal(res.code, 200); assert.equal(state.status, 'ACK');
  assert.equal(state.by, 17); assert.equal(state.event.userId, '17'); assert.equal(state.event.actorUserId, '19');
});
test('handler returns failure and rolls back status when audit insert fails', async () => {
  failAudit = true; const original = console.error; console.error = () => {};
  try { const res = await call(); assert.equal(res.code, 500); assert.equal(state.status, 'OPEN'); }
  finally { console.error = original; }
});
