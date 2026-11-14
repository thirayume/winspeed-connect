'use strict';
// Direct handler only: no listening socket, authorization middleware or SQL.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
let result, failAudit;
const db = h.installDbStub(({ kind, text, inputs }) => {
  if (/COL_LENGTH\('wf\.ChangeEvent'/.test(text)) return [{ HasCol: 1 }];
  if (/DELETE FROM wf\.ErrorLog/.test(text)) { assert.equal(kind, 'tx'); result.deleted = 4; return { rowsAffected: [4] }; }
  if (/INSERT INTO wf\.ChangeEvent/.test(text)) { assert.equal(kind, 'tx'); if (failAudit) throw Error('audit failed'); result.event = inputs; return []; }
  return [];
});
db.stub.wfTransaction = async fn => { const before = structuredClone(result); try { return await fn(db.tx); }
  catch (e) { result = before; throw e; } };
const obs = require('../services/observability');
const router = require('../routes/ops');
const handler = router.stack.find(x => x.route?.path === '/errors/clear').route.stack.at(-1).handle;
const { runWithUser } = require('../services/request-context');
const user = { sub: 7, actorSub: 9, isImpersonating: true, identityMapping: {
  primaryEffectiveUserId: 7, primaryActorUserId: 9, businessEffectiveUserId: 17, businessActorUserId: 19,
} };
async function call() {
  const req = { user, ip: '127.0.0.1' };
  const res = { code: 200, status(n) { this.code = n; return this; }, json(body) { this.body = body; return this; } };
  await runWithUser(user, () => handler(req, res)); return res;
}
test.beforeEach(() => { result = {}; failAudit = false; Object.assign(obs._state, { errors: 1, recentErrors: [{ at: 'old' }], byStatus: { 500: 1 }, lastErrorAt: 'old' }); });
test('clear handler records mapped actor and effective ID with deletion', async () => {
  const res = await call(); assert.equal(res.code, 200); assert.equal(res.body.deleted, 4);
  assert.equal(result.event.userId, '17'); assert.equal(result.event.actorUserId, '19'); assert.equal(obs._state.errors, 0);
});
test('clear handler reports failure and keeps memory if audit fails', async () => {
  failAudit = true; const res = await call(); assert.equal(res.code, 500); assert.equal(obs._state.errors, 1); assert.equal(result.deleted, undefined);
});
