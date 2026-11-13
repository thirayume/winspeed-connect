'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveReviewedIdentity, resolveReviewedActorAndEffective, sqlRepository } = require('../services/database-identity-resolver');

function fixture() {
  const primary = { Id: 8, Username: 'person', EmpId: 'P8', IsActive: 1 };
  const target = { Id: 17, Username: 'person', EmpId: 'T17', IsActive: 1 };
  const binding = { PrimaryUserId: 8, PrimaryServerName: 'SERVER-A', PrimaryDatabaseName: 'primary',
    PrimaryUsername: 'person', PrimaryEmployeeId: 'P8', TargetServerName: 'SERVER-B',
    TargetDatabaseName: 'secondary', TargetUserId: 17, TargetUsername: 'person',
    TargetEmployeeId: 'T17', IsActive: 1, ReviewedBy: 3, ReviewedAt: '2026-11-13T00:00:00Z', Revision: 1 };
  const primaryRead = { server: 'SERVER-A', database: 'primary', primary, binding };
  const targetRead = { server: 'SERVER-B', database: 'secondary', user: target };
  const args = { primaryUserId: 8, primaryDatabase: 'primary', targetDatabase: 'secondary' };
  let reads = 0;
  const repo = { readPrimary: async () => { reads++; return structuredClone(primaryRead); }, readTarget: async () => structuredClone(targetRead) };
  return { args, primaryRead, targetRead, repo, reads: () => reads };
}

test('resolves explicitly reviewed identities on separate servers with a fresh recheck', async () => {
  const f = fixture();
  assert.deepEqual(await resolveReviewedIdentity(f.args, f.repo), { primaryUserId: 8, targetUserId: 17, revision: 1, primaryServer: 'SERVER-A', targetServer: 'SERVER-B' });
  assert.equal(f.reads(), 2);
});

test('refuses absent review, inactive users, stale snapshots and a redirected database', async () => {
  const mutate = [
    f => { f.primaryRead.binding = null; },
    f => { f.primaryRead.primary.IsActive = 0; },
    f => { f.targetRead.user.IsActive = 0; },
    f => { f.targetRead.user.Username = 'other'; },
    f => { f.targetRead.server = 'SERVER-C'; },
    f => { f.targetRead.database = 'production'; },
    f => { f.primaryRead.primary.Id = 17; },
    f => { f.args.primaryUserId = 0; },
  ];
  for (const change of mutate) {
    const f = fixture(); change(f);
    await assert.rejects(resolveReviewedIdentity(f.args, f.repo), { code: 'IDENTITY_BINDING_INVALID' });
  }
});

test('refuses a binding revoked or revised during cross-server lookup', async () => {
  for (const change of [r => { r.binding.IsActive = 0; }, r => { r.binding.Revision++; }]) {
    const f = fixture();
    f.repo.readTarget = async () => { change(f.primaryRead); return structuredClone(f.targetRead); };
    await assert.rejects(resolveReviewedIdentity(f.args, f.repo), { code: 'IDENTITY_BINDING_INVALID' });
  }
});

test('SQL repository uses the explicit allowlist, database context and bound parameters', async () => {
  const f = fixture();
  const calls = [];
  let currentDb;
  const db = {
    sql: { Int: 'int', NVarChar: n => `nvarchar(${n})` },
    runWithTarget: async (target, fn, database) => {
      assert.equal(target, 'onprem'); currentDb = database;
      try { return await fn(); } finally { currentDb = null; }
    },
    wfQuery: async (sql, inputs) => {
      calls.push({ database: currentDb, sql, inputs });
      if (sql.includes('FROM wf.DatabaseIdentityBinding')) return { recordset: [f.primaryRead.binding] };
      const record = currentDb === 'primary' ? f.primaryRead : f.targetRead;
      const user = record.primary || record.user;
      return { recordset: [{ ...user, ServerName: record.server, DatabaseName: record.database }] };
    },
  };
  const repo = sqlRepository(db, name => ['primary', 'secondary'].includes(name));
  const result = await resolveReviewedIdentity(f.args, repo);
  assert.equal(result.targetUserId, 17);
  assert.deepEqual(calls.map(c => c.database), ['primary', 'primary', 'secondary', 'primary', 'primary']);
  assert.equal(calls[1].inputs.userId.value, 8);
  assert.equal(calls[1].inputs.targetDatabase.value, 'secondary');
  assert.match(calls[1].sql, /TargetDatabaseName=@targetDatabase/);
  await assert.rejects(repo.readTarget('not-allowed', 17), { code: 'IDENTITY_BINDING_INVALID' });
  assert.equal(calls.length, 5);
});

test('Access As resolves actor and effective independently and rejects a revoked actor', async () => {
  const f = fixture();
  const actor = structuredClone(f.primaryRead);
  actor.primary = { Id: 11, Username: 'admin', EmpId: null, IsActive: 1 };
  Object.assign(actor.binding, { PrimaryUserId: 11, PrimaryUsername: 'admin', PrimaryEmployeeId: null,
    TargetUserId: 31, TargetUsername: 'admin', TargetEmployeeId: null, Revision: 4 });
  let revoked = false;
  const repository = {
    readPrimary: async (_db, _target, id) => {
      const row = structuredClone(id === 11 ? actor : f.primaryRead);
      if (id === 11 && revoked) row.binding.IsActive = 0;
      return row;
    },
    readTarget: async (_db, id) => id === 31
      ? { server: 'SERVER-B', database: 'secondary', user: { Id: 31, Username: 'admin', EmpId: null, IsActive: 1 } }
      : structuredClone(f.targetRead),
  };
  const args = { actorUserId: 11, effectiveUserId: 8, primaryDatabase: 'primary', targetDatabase: 'secondary' };
  assert.deepEqual(await resolveReviewedActorAndEffective(args, repository), {
    primaryActorUserId: 11, primaryEffectiveUserId: 8, businessActorUserId: 31,
    businessEffectiveUserId: 17, actorRevision: 4, effectiveRevision: 1, identityServer: 'SERVER-A', businessServer: 'SERVER-B',
  });
  revoked = true;
  await assert.rejects(resolveReviewedActorAndEffective(args, repository), { code: 'IDENTITY_BINDING_INVALID' });
});
