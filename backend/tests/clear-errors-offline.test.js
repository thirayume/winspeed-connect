'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createErrorClearer } = require('../services/clear-errors');
function setup({ failure, actorColumn = true, addDuring = false } = {}) {
  const old = { at: 'old' }, state = { errors: 1, recentErrors: [old], byStatus: { 500: 1 }, lastErrorAt: 'old' };
  const db = { rows: 3, audit: [], calls: 0 };
  const tx = { request: () => ({ query: async q => {
    assert.match(q, /DELETE FROM wf\.ErrorLog/); if (failure === 'delete') throw Error('delete failed'); db.rows = 0;
    if (addDuring) { state.errors++; state.recentErrors.unshift({ at: 'new' }); state.byStatus[500]++; state.lastErrorAt = 'new'; }
    return { rowsAffected: [3] };
  } }) };
  const clear = createErrorClearer({ state, wfQuery: () => {}, hasColumn: async () => actorColumn,
    wfTransaction: async fn => { db.calls++; const before = structuredClone({ rows: db.rows, audit: db.audit });
      try { const result = await fn(tx); if (failure === 'commit') throw Error('commit failed'); return result; }
      catch (e) { db.rows = before.rows; db.audit = before.audit; throw e; } },
    logChangeEvent: async (actual, event) => { assert.equal(actual, tx); if (failure === 'audit') throw Error('audit failed'); db.audit.push(event); },
  });
  const user = { sub: 7, actorSub: 9, isImpersonating: true, identityMapping: {
    primaryEffectiveUserId: 7, primaryActorUserId: 9, businessEffectiveUserId: 17, businessActorUserId: 19,
  } };
  return { state, db, clear, user };
}
test('clear commits deletion and audit with mapped user before clearing old memory', async () => {
  const f = setup(); const result = await f.clear(f.user);
  assert.equal(result.deleted, 3); assert.equal(f.db.audit[0].userId, '17');
  assert.equal(f.state.errors, 0); assert.deepEqual(f.state.recentErrors, []);
});
for (const failure of ['delete', 'audit', 'commit']) test(`${failure} failure preserves database and memory`, async () => {
  const f = setup({ failure }); await assert.rejects(f.clear(f.user), /failed/);
  assert.equal(f.db.rows, 3); assert.deepEqual(f.db.audit, []); assert.equal(f.state.errors, 1); assert.equal(f.state.recentErrors.length, 1);
});
test('entries created while clear runs are retained in memory', async () => {
  const f = setup({ addDuring: true }); await f.clear(f.user);
  assert.equal(f.state.errors, 1); assert.deepEqual(f.state.recentErrors, [{ at: 'new' }]);
  assert.equal(f.state.byStatus[500], 1); assert.equal(f.state.lastErrorAt, 'new');
});
test('Access As cannot clear when actor audit is unavailable', async () => {
  const f = setup({ actorColumn: false }); await assert.rejects(f.clear(f.user), e => e.status === 503);
  assert.equal(f.db.calls, 0); assert.equal(f.state.errors, 1);
});
