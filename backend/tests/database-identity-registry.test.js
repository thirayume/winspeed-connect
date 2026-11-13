'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AsyncLocalStorage } = require('node:async_hooks');
const { saveReviewedBinding, revokeReviewedBinding } = require('../services/database-identity-registry');

function fixture() {
  const context = new AsyncLocalStorage();
  const state = { binding: null, audit: [], failAudit: false, targetActive: true, actorAdmin: true, targetReads: 0, changeTargetOnSecondRead: false };
  const source = { Id: 8, Username: 'primary-user', EmpId: 'P8', IsActive: true };
  const target = { Id: 17, Username: 'target-user', EmpId: 'T17', IsActive: true };
  const db = {
    sql: { Int: 'int', NVarChar: n => `nvarchar(${n})` },
    runWithTarget: (_kind, fn, database) => context.run(database, fn),
    wfQuery: async (_sql, inputs) => {
      const which = context.getStore();
      if (which === 'secondary') {
        state.targetReads++;
        if (state.changeTargetOnSecondRead && state.targetReads === 2) state.targetActive = false;
      }
      const user = which === 'primary' ? source : { ...target, IsActive: state.targetActive };
      if (inputs.userId.value !== user.Id) return { recordset: [] };
      return { recordset: [{ ...user, ServerName: which === 'primary' ? 'SERVER-A' : 'SERVER-B', DatabaseName: which }] };
    },
    wfTransaction: async fn => {
      const before = structuredClone(state);
      const tx = { request() {
        const params = {};
        return { input(k, v) { params[k] = v; return this; }, async query(sql) {
          if (/SELECT u.Id FROM wf.AppUser/.test(sql)) return { recordset: state.actorAdmin ? [{ Id: 3 }] : [] };
          if (/SERVERPROPERTY/.test(sql)) return { recordset: [{ ...source, ServerName: 'SERVER-A', DatabaseName: 'primary' }] };
          if (/SELECT \* FROM wf.DatabaseIdentityBinding/.test(sql)) return { recordset: state.binding ? [state.binding] : [] };
          if (/INSERT wf.DatabaseIdentityBinding\s/.test(sql)) {
            state.binding = { Id: 1, Revision: 1, IsActive: true, PrimaryUserId: params.primary, TargetUserId: params.target };
            return { recordset: [state.binding] };
          }
          if (/UPDATE wf.DatabaseIdentityBinding SET/.test(sql)) {
            state.binding = { ...state.binding, Revision: state.binding.Revision + 1 };
            if (/SET IsActive=0/.test(sql)) state.binding.IsActive = false;
            return { recordset: [state.binding] };
          }
          if (/INSERT wf.DatabaseIdentityBindingAudit/.test(sql)) {
            if (state.failAudit) throw new Error('audit failed');
            state.audit.push({ ...params, action: params.action || 'REVOKE' }); return { recordset: [] };
          }
          throw new Error('Unexpected SQL');
        } };
      } };
      try { return await fn(tx); } catch (error) { Object.assign(state, before); throw error; }
    },
  };
  const deps = { db, isSwitchableDb: n => ['primary', 'secondary'].includes(n), lockPolicy: async () => {} };
  const input = { primaryDatabase: 'primary', targetDatabase: 'secondary', primaryUserId: 8,
    targetUserId: 17, reviewerId: 3, primaryUsername: 'primary-user', targetUsername: 'target-user', expectedRevision: 0 };
  return { state, deps, input };
}

test('review creates a binding and its audit atomically, including inactive target without enabling it', async () => {
  const f = fixture(); f.state.targetActive = false;
  const result = await saveReviewedBinding(f.input, f.deps);
  assert.equal(result.targetActive, false);
  assert.equal(f.state.binding.Revision, 1);
  assert.equal(f.state.audit[0].actor, 3);
  assert.equal(f.state.audit[0].action, 'CREATE');
  assert.equal(f.state.targetActive, false);
});

test('review rejects wrong reviewer, stale snapshots, collision and stale revision', async () => {
  for (const setup of [
    f => { f.state.actorAdmin = false; },
    f => { f.input.targetUsername = 'different-person'; },
    f => { f.state.binding = { Id: 1, PrimaryUserId: 8, TargetUserId: 18, Revision: 1 }; },
    f => { f.state.binding = { Id: 1, PrimaryUserId: 8, TargetUserId: 17, Revision: 1 }; },
  ]) {
    const f = fixture(); setup(f);
    await assert.rejects(saveReviewedBinding(f.input, f.deps));
    assert.equal(f.state.audit.length, 0);
  }
});

test('failed audit rolls back binding and explicit revision permits audited update', async () => {
  const f = fixture(); f.state.failAudit = true;
  await assert.rejects(saveReviewedBinding(f.input, f.deps), /audit failed/);
  assert.equal(f.state.binding, null);
  f.state.failAudit = false;
  await saveReviewedBinding(f.input, f.deps);
  await saveReviewedBinding({ ...f.input, expectedRevision: 1 }, f.deps);
  assert.equal(f.state.binding.Revision, 2);
  assert.equal(f.state.audit[1].action, 'UPDATE');
});

test('target state change while reviewing rolls back the binding', async () => {
  const f = fixture(); f.state.changeTargetOnSecondRead = true;
  await assert.rejects(saveReviewedBinding(f.input, f.deps), { code: 'IDENTITY_REVIEW_STALE' });
  assert.equal(f.state.binding, null);
  assert.equal(f.state.audit.length, 0);
});

test('revocation is audited, version checked and rolls back if audit fails', async () => {
  const f = fixture(); await saveReviewedBinding(f.input, f.deps);
  const input = { primaryDatabase: 'primary', bindingId: 1, reviewerId: 3, expectedRevision: 1 };
  f.state.failAudit = true;
  await assert.rejects(revokeReviewedBinding(input, f.deps), /audit failed/);
  assert.equal(f.state.binding.IsActive, true);
  f.state.failAudit = false;
  const result = await revokeReviewedBinding(input, f.deps);
  assert.equal(result.changed, true); assert.equal(result.revision, 2);
  assert.equal(f.state.binding.IsActive, false); assert.equal(f.state.audit[1].action, 'REVOKE');
  await assert.rejects(revokeReviewedBinding(input, f.deps), { code: 'IDENTITY_REVIEW_STALE' });
});
