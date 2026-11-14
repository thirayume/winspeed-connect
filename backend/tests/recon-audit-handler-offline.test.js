'use strict';
// Direct handler test: middleware, real SQL and concurrent MERGE are not exercised.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
let state, failAudit;
const db = h.installDbStub(({ kind, text, inputs }) => {
  if (/SELECT SOID FROM dbo\.SOHD/.test(text)) return [{ SOID: 2 }];
  if (/COL_LENGTH\('wf\.ChangeEvent'/.test(text)) return [{ HasCol: 1 }];
  if (/MERGE wf\.ReconResolution/.test(text)) { assert.equal(kind, 'tx'); state.status = inputs.st; state.by = inputs.uid; return []; }
  if (/INSERT INTO wf\.ChangeEvent/.test(text)) { assert.equal(kind, 'tx'); if (failAudit) throw Error('audit failure'); state.event = inputs; return []; }
  return [];
});
db.stub.wfTransaction = async fn => { const old = structuredClone(state); try { return await fn(db.tx); } catch (e) { state = old; throw e; } };
const router = require('../routes/recon');
const handler = router.stack.find(x => x.route?.path === '/:soId/resolve').route.stack.at(-1).handle;
const { runWithUser } = require('../services/request-context');
const user = { sub: 7, actorSub: 9, isImpersonating: true, identityMapping: {
  primaryEffectiveUserId: 7, primaryActorUserId: 9, businessEffectiveUserId: 17, businessActorUserId: 19,
} };
async function call() {
  const req = { params: { soId: '2' }, body: { checkType: 'INVOICE', note: 'reviewed' }, user, ip: '127.0.0.1' };
  const res = { code: 200, status(n) { this.code = n; return this; }, json(body) { this.body = body; return this; } };
  await runWithUser(user, () => handler(req, res)); return res;
}
test.beforeEach(() => { state = { status: 'OPEN' }; failAudit = false; });
test('recon resolution records mapped actor and effective identities in the transaction', async () => {
  const res = await call(); assert.equal(res.code, 200); assert.equal(state.status, 'RESOLVED');
  assert.equal(state.by, 17); assert.equal(state.event.userId, '17'); assert.equal(state.event.actorUserId, '19');
});
test('recon resolution rolls back if audit insertion fails', async () => {
  failAudit = true; const old = console.error; console.error = () => {};
  try { const res = await call(); assert.equal(res.code, 500); assert.equal(state.status, 'OPEN'); }
  finally { console.error = old; }
});
