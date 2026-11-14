'use strict';
// Invoke real handlers with a fake transaction: no socket, middleware or SQL.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
let position, audits, failAudit, stale;
const db = h.installDbStub(({ kind, text, inputs }) => {
  if (/SELECT 1 FROM wf\.OrgPosition WHERE PositionCode = @code/.test(text)) return position ? [{ ok: 1 }] : [];
  if (/SELECT \* FROM wf\.OrgPosition WHERE PositionCode = @code/.test(text)) return position ? [{ ...position }] : [];
  if (/sp_getapplock/.test(text)) return [{ LockResult: 0 }];
  if (/SELECT \* FROM wf\.OrgPosition WITH \(UPDLOCK,HOLDLOCK\)/.test(text)) return position ? [{ ...position, PositionName: stale ? 'Changed elsewhere' : position.PositionName }] : [];
  if (/SELECT COUNT\(\*\) AS c FROM wf\.AppUser WITH \(UPDLOCK,HOLDLOCK\)/.test(text)) return [{ c: 0 }];
  if (/SELECT COUNT\(\*\) AS c FROM wf\.(AppUser|OrgPosition)/.test(text)) return [{ c: 0 }];
  if (/INSERT INTO wf\.AdminChangeAudit/.test(text)) { assert.equal(kind, 'tx'); if (failAudit) throw Error('AUDIT_FAILED'); audits.push(inputs); return { rowsAffected: [1] }; }
  if (/INSERT INTO wf\.OrgPosition/.test(text)) { assert.equal(kind, 'tx'); position = { PositionCode: inputs.code, PositionName: inputs.name }; return { rowsAffected: [1] }; }
  if (/UPDATE wf\.OrgPosition/.test(text)) { assert.equal(kind, 'tx'); position.PositionName = inputs.name; return { rowsAffected: [1] }; }
  if (/DELETE FROM wf\.OrgPosition/.test(text)) { assert.equal(kind, 'tx'); position = null; return { rowsAffected: [1] }; }
  return [];
});
db.stub.wfTransaction = async fn => { const old = structuredClone({ position, audits }); try { return await fn(db.tx); }
  catch (e) { position = old.position; audits = old.audits; throw e; } };
const router = require('../routes/auth');
const user = { id: 7, sub: 7, actorSub: 7, role: 'ADMIN' };
async function call(method, body = {}) {
  const route = method === 'post' ? '/org-positions' : '/org-positions/:code';
  const layer = router.stack.find(x => x.route?.path === route && x.route.methods[method]);
  const handler = layer.route.stack.at(-1).handle;
  const req = { params: { code: 'QA' }, body, user };
  const res = { code: 200, status(n) { this.code = n; return this; }, json(value) { this.body = value; return this; } };
  await handler(req, res); return res;
}
const base = () => ({ PositionCode: 'QA', PositionName: 'Old', OrgUnit: 'TEST', Tier: 1, CanApprove: false, IsActive: true, ReportsTo: null });
for (const [method, body, action] of [
  ['post', { positionCode: 'QA', positionName: 'New', orgUnit: 'TEST' }, 'POSITION_CREATE'],
  ['put', { positionName: 'New' }, 'POSITION_UPDATE'],
  ['delete', {}, 'POSITION_DELETE'],
]) {
  test(`${method} commits position and audit together`, async () => {
    position = method === 'post' ? null : base(); audits = []; failAudit = false; stale = false;
    const result = await call(method, body); assert.equal(result.code, method === 'post' ? 201 : 200);
    assert.equal(audits[0].action, action); assert.equal(audits[0].actor, 7);
  });
  test(`${method} rolls back position when audit fails`, async () => {
    position = method === 'post' ? null : base(); audits = []; failAudit = true; stale = false;
    const old = console.error; console.error = () => {};
    try { const result = await call(method, body); assert.equal(result.code, 500);
      assert.equal(position?.PositionName ?? null, method === 'post' ? null : 'Old'); assert.deepEqual(audits, []); }
    finally { console.error = old; }
  });
}
test('stale position update is rejected without a write or audit', async () => {
  position = base(); audits = []; failAudit = false; stale = true;
  const old = console.error; console.error = () => {};
  try { const result = await call('put', { positionName: 'New' });
    assert.equal(result.code, 409); assert.equal(position.PositionName, 'Old'); assert.deepEqual(audits, []); }
  finally { console.error = old; stale = false; }
});
