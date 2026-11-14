'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRetentionService } = require('../services/retention-audit');

function fixture({ failAudit = false, actorColumn = true, badDays = false } = {}) {
  let state = { policy: { Id: 1, DataClass: 'ERROR_LOG', RetentionDays: badDays ? -1 : 90, Note: null },
    errors: 10, outbox: 7, dsar: [], events: [], transactions: 0 };
  const sql = { Int: 'int', NVarChar: n => `nvarchar(${n})`, ISOLATION_LEVEL: { SERIALIZABLE: 'serializable' } };
  const tx = { request() { const input = {}; return { input(k, _t, v) { input[k] = v; return this; }, async query(q) {
    if (/SELECT Id, DataClass/.test(q)) return { recordset: [{ ...state.policy }] };
    if (/SELECT DataClass, RetentionDays/.test(q)) return { recordset: [state.policy, { DataClass: 'OUTBOX_DONE', RetentionDays: 30 }] };
    if (/UPDATE wf.RetentionPolicy/.test(q)) { state.policy.RetentionDays = input.days; state.policy.Note = input.note; return { rowsAffected: [1] }; }
    if (/DELETE FROM wf.ErrorLog/.test(q)) { state.errors = 0; return { rowsAffected: [10] }; }
    if (/DELETE FROM wf.OutboxEvent/.test(q)) { state.outbox = 0; return { rowsAffected: [7] }; }
    if (/INSERT INTO wf.DsarLog/.test(q)) { state.dsar.push({ ...input }); return { rowsAffected: [1] }; }
    throw Error(`unexpected query: ${q}`);
  } }; } };
  const service = createRetentionService({ sql, wfQuery: async () => {}, hasColumn: async () => actorColumn,
    wfTransaction: async fn => { state.transactions++; const before = structuredClone(state); try { return await fn(tx); }
      catch (e) { state = before; throw e; } },
    logChangeEvent: async (t, event) => { assert.equal(t, tx); if (failAudit) throw Error('audit failed'); state.events.push(event); },
  });
  const user = { sub: 1, actorSub: 2, isImpersonating: true, identityMapping: {
    primaryEffectiveUserId: 1, primaryActorUserId: 2, businessEffectiveUserId: 11, businessActorUserId: 12,
  } };
  return { service, user, get state() { return state; } };
}
test('policy update and its audit are transactional with mapped effective identity', async () => {
  const f = fixture(); assert.equal(await f.service.updateRetentionPolicy({ id: 1, retentionDays: 60, note: null, user: f.user }), true);
  assert.equal(f.state.policy.RetentionDays, 60); assert.equal(f.state.events[0].userId, '11'); assert.equal(f.state.events[0].beforeJson.retentionDays, 90);
});
test('policy change rolls back on audit failure', async () => {
  const f = fixture({ failAudit: true }); await assert.rejects(f.service.updateRetentionPolicy({ id: 1, retentionDays: 60, user: f.user }), /audit failed/);
  assert.equal(f.state.policy.RetentionDays, 90);
});
test('retention records counts and deletes both classes in one transaction', async () => {
  const f = fixture(); const result = await f.service.runRetention({ user: f.user });
  assert.deepEqual(result, { errorLogDeleted: 10, outboxDeleted: 7 }); assert.equal(f.state.events[0].action, 'RUN');
});
test('retention deletes roll back if audit insertion fails', async () => {
  const f = fixture({ failAudit: true }); await assert.rejects(f.service.runRetention({ user: f.user }), /audit failed/);
  assert.equal(f.state.errors, 10); assert.equal(f.state.outbox, 7);
});
test('negative existing policy fails closed without deletion', async () => {
  const f = fixture({ badDays: true }); await assert.rejects(f.service.runRetention({ user: f.user }), e => e.status === 409);
  assert.equal(f.state.errors, 10); assert.equal(f.state.outbox, 7);
});
test('invalid update and missing actor audit are rejected before a transaction', async () => {
  const f = fixture({ actorColumn: false });
  await assert.rejects(f.service.updateRetentionPolicy({ id: 1, retentionDays: -1, user: f.user }), e => e.status === 400);
  await assert.rejects(f.service.runRetention({ user: f.user }), e => e.status === 503);
  assert.equal(f.state.transactions, 0);
});
test('DSAR export log and audit record mapped effective identity together', async () => {
  const f = fixture(); await f.service.recordDsarExport({ subjectType: 'USER', subjectId: 5, user: f.user });
  assert.equal(f.state.dsar[0].user, 11); assert.equal(f.state.events[0].userId, '11'); assert.equal(f.state.events[0].entityType, 'DSAR_EXPORT');
});
test('DSAR log rolls back when its audit cannot be written', async () => {
  const f = fixture({ failAudit: true }); await assert.rejects(f.service.recordDsarExport({ subjectType: 'USER', subjectId: 5, user: f.user }), /audit failed/);
  assert.deepEqual(f.state.dsar, []);
});
