'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const install = (name, exports) => { require.cache[require.resolve(path.join(root, name))] = { exports }; };
let events, collision, failMembership, failAudit, failRoleAudit, wrongTarget, missingSchema, targetAllowed = true, auditInputs, accountAudits, roleAudits, failSource;
let lockStatements = [], lockFailure = null;
const operator = { actorPrimaryId: 11, effectivePrimaryId: 12 };
class Transaction {
  constructor(pool) { this.source = pool === source; }
  async begin(level) { assert.equal(level, 'serializable'); events.push(this.source ? 'source-begin' : 'begin'); }
  async commit() { events.push(this.source ? 'source-commit' : 'commit'); }
  async rollback() { events.push(this.source ? 'source-rollback' : 'rollback'); }
  request() {
    if (this.source) return source.request();
    const inputs = {};
    return {
      input(name, _type, value) { inputs[name] = value; return this; },
      async batch(sqlText) { if (sqlText.startsWith('SET LOCK_TIMEOUT')) { lockStatements.push(`target:${sqlText}`); return {recordset:[]}; } events.push('schema'); return {}; },
      async query(sqlText) {
        if (sqlText.startsWith('SET LOCK_TIMEOUT')) { lockStatements.push(`target:${sqlText}`); return { recordset: [] }; }
        if (sqlText.includes('DB_NAME()')) { events.push('target-check'); if (lockFailure === 'target') throw Object.assign(Error('lock'), { number: 1222 }); return { recordset: [{ DatabaseName: wrongTarget ? 'other' : 'secondary', ServerName: 'TARGET' }] }; }
        if (sqlText.includes("OBJECT_ID('wf.RoleProfile'")) { events.push('schema-check'); return { recordset: [{ IsReady: missingSchema ? 0 : 1 }] }; }
        if (sqlText.includes('SELECT Code, Name, BaseRole, DisabledActions, Revision FROM wf.RoleProfile')) return { recordset: [{ Code: 'SALES', Name: 'Old Sales', BaseRole: 'SALES', DisabledActions: '["so.old"]', Revision: 1 }] };
        if (sqlText.includes('SELECT RoleCode, PermissionCode FROM wf.RolePermission')) return { recordset: [{ RoleCode: 'SALES', PermissionCode: 'so.old' }] };
        if (sqlText.includes('SELECT Id, Username, Role, RoleCode FROM wf.AppUser')) return { recordset: [{ Id: 99, Username: 'target-only', Role: 'SALES', RoleCode: 'SALES' }] };
        if (sqlText.includes('SELECT UserId, RoleCode FROM wf.UserRole')) return { recordset: [{ UserId: 99, RoleCode: 'SALES' }] };
        if (sqlText.includes('AS IsExact')) { events.push('identity-check'); return { recordset: collision === 'duplicate' ? [{ Id: inputs.id, IsExact: 1 }, { Id: 2, IsExact: 0 }] : collision ? [{ Id: inputs.id, IsExact: 0 }] : [{ Id: inputs.id, IsExact: 1, Username: inputs.username, Role: 'OLD', IsActive: 1 }] }; }
        if (sqlText.includes('SELECT RoleCode FROM wf.UserRole')) return { recordset: [{ RoleCode: 'OLD' }] };
        if (sqlText.includes('DELETE FROM wf.RolePermission')) { assert.match(sqlText, /WHERE RoleCode = @rc/); events.push('delete-permissions'); }
        if (sqlText.includes('DELETE FROM wf.UserRole')) { assert.match(sqlText, /WHERE UserId = @uid/); events.push('delete-memberships'); if (failMembership) throw new Error('SIMULATED_DB_FAILURE'); }
        if (sqlText.includes('UPDATE wf.AppUser')) { events.push('update-user'); assert.match(sqlText, /WHERE Id = @id AND Username = @username/); }
        if (sqlText.includes('UPDATE wf.RoleProfile')) { assert.match(sqlText, /DisabledActions = @disabled/); assert.doesNotMatch(sqlText, /Description|IsActive/); assert.equal(inputs.disabled, '["so.cancel"]'); }
        if (sqlText.includes('INSERT INTO wf.AdminChangeAudit')) { events.push('audit'); if (failAudit || (failRoleAudit && sqlText.includes('USER_SYNC_ROLE_EFFECT'))) throw new Error('SIMULATED_AUDIT_FAILURE');
          if (sqlText.includes('USER_SYNC_ACCOUNT')) accountAudits.push({ ...inputs });
          else if (sqlText.includes('USER_SYNC_ROLE_EFFECT')) roleAudits.push({ ...inputs }); else auditInputs = { ...inputs }; }
        return { recordset: [] };
      },
    };
  }
}
const source = { request: () => ({ batch: async sqlText => { lockStatements.push(`source:${sqlText}`); return {recordset:[]}; }, query: async sqlText => {
  if (sqlText.startsWith('SET LOCK_TIMEOUT')) { lockStatements.push(`source:${sqlText}`); return { recordset: [] }; }
  if (lockFailure === 'source' && sqlText.includes('FROM wf.RolePermission')) throw Object.assign(Error('deadlock'), { number: 1205 });
  if (failSource && sqlText.includes('FROM wf.RolePermission')) throw new Error('SIMULATED_SOURCE_FAILURE');
  if (sqlText.includes('DB_NAME()')) return { recordset: [{ DatabaseName: 'primary', ServerName: 'SOURCE' }] };
  if (sqlText.includes('FROM wf.RoleProfile')) return { recordset: [{ Code: 'SALES', Name: 'Sales', BaseRole: 'SALES', DisabledActions: '["so.cancel"]' }] };
  if (sqlText.includes('FROM wf.RolePermission')) return { recordset: [{ RoleCode: 'SALES', PermissionCode: 'so.create' }] };
  if (sqlText.includes('FROM wf.AppUser')) return { recordset: [1, 11, 12].map(Id => ({ Id, Username: `fixture-${Id}`, PasswordHash: 'fixture-secret-never-log', DisplayName: 'Fixture', Role: 'SALES', EmpId: `EMP-${Id}`, IsActive: 1 })) };
  if (sqlText.includes('FROM wf.UserRole')) return { recordset: [{ UserId: 1, RoleCode: 'SALES' }] };
  throw new Error('Unexpected source query');
} }) };
install('db.js', { sql: { Transaction, Int: 'Int', Bit: 'Bit', NVarChar: () => 'NVarChar', ISOLATION_LEVEL: { SERIALIZABLE: 'serializable' } }, pools: () => ({ ready: Promise.resolve(), ownerPool: {} }) });
install('services/active-database.js', { primaryDatabase: () => 'primary', primaryOwnerPool: async () => source, onpremEnabled: () => true });
install('onprem-target.js', { isSwitchableDb: () => targetAllowed });
const { syncUsersToTarget } = require('../services/user-sync');

test('conflicting identities roll back before permissions or users are changed', async () => {
  events = []; accountAudits = []; roleAudits = []; collision = true; failMembership = false; failAudit = false;
  await assert.rejects(syncUsersToTarget('secondary', operator), { code: 'SYNC_IDENTITY_CONFLICT', status: 409 });
  assert.deepEqual(events, ['source-begin', 'source-commit', 'begin', 'target-check', 'schema-check', 'identity-check', 'rollback']);
});
test('a mid-sync error rolls back the whole transaction', async () => {
  events = []; collision = false; failMembership = true;
  await assert.rejects(syncUsersToTarget('secondary', operator), /SIMULATED_DB_FAILURE/);
  assert.ok(events.includes('delete-permissions'));
  assert.equal(events.at(-1), 'rollback');
  assert.ok(!events.includes('commit'));
});
test('matching identities sync under one transaction and commit', async () => {
  events = []; accountAudits = []; roleAudits = []; collision = false; failMembership = false;
  const result = await syncUsersToTarget('secondary', operator);
  assert.equal(result.synced.users, 3);
  assert.ok(events.indexOf('identity-check') < events.indexOf('delete-permissions'));
  assert.equal(events.at(-1), 'commit');
  assert.ok(events.indexOf('audit') < events.indexOf('commit'));
  assert.equal(auditInputs.actor, 11); const detail = JSON.parse(auditInputs.detail);
  assert.equal(detail.effectivePrimaryId, 12); assert.equal(detail.identityDatabase, 'primary');
  assert.equal(detail.identityServer, 'SOURCE'); assert.equal(detail.targetServer, 'TARGET');
  assert.equal(detail.sourceSnapshotConsistent, true);
  assert.ok(events.indexOf('source-commit') < events.indexOf('begin'));
  const account = JSON.parse(accountAudits[0].detail); assert.equal(account.before.role, 'OLD');
  assert.deepEqual(account.before.memberships, ['OLD']); assert.deepEqual(account.after.memberships, ['SALES']);
  assert.equal(account.syncId, detail.syncId); assert.doesNotMatch(accountAudits[0].detail, /fixture-secret-never-log/);
  const affected = JSON.parse(roleAudits[0].detail); assert.equal(affected.targetUserId, 99);
  assert.deepEqual(affected.rolePolicyEffects[0].before.permissions, ['so.old']);
  assert.deepEqual(affected.rolePolicyEffects[0].after.permissions, ['so.create']);
  assert.equal(affected.rolePolicyEffects[0].after.disabledActions, '["so.cancel"]');
  assert.doesNotMatch(auditInputs.detail, /PasswordHash|fixture/);
  assert.ok(!events.includes('rollback'));
});
test('duplicate identity matches fail before changes', async () => {
  events = []; accountAudits = []; collision = 'duplicate'; failMembership = false;
  await assert.rejects(syncUsersToTarget('secondary', operator), { code: 'SYNC_IDENTITY_CONFLICT', status: 409 });
  assert.ok(!events.includes('update-user')); assert.equal(events.at(-1), 'rollback');
});
test('disallowed target fails before connecting or writing', async () => {
  events = []; targetAllowed = false;
  try { await assert.rejects(syncUsersToTarget('secondary', operator), { code: 'DB_NOT_ALLOWED', status: 403 }); assert.deepEqual(events, []); }
  finally { targetAllowed = true; }
});
test('primary target is a no-op', async () => {
  events = []; const result = await syncUsersToTarget('primary', operator);
  assert.equal(result.affected, 0); assert.deepEqual(events, []);
});
test('audit failure rolls back all target mutations', async () => {
  events = []; accountAudits = []; collision = false; failMembership = false; failAudit = true;
  try { await assert.rejects(syncUsersToTarget('secondary', operator), /SIMULATED_AUDIT_FAILURE/);
    assert.ok(events.includes('update-user')); assert.equal(events.at(-1), 'rollback'); assert.ok(!events.includes('commit')); }
  finally { failAudit = false; }
});
test('missing primary identity fails before opening a target transaction', async () => {
  events = []; await assert.rejects(syncUsersToTarget('secondary'), { code: 'SYNC_AUDIT_IDENTITY_REQUIRED', status: 403 });
  assert.deepEqual(events, []);
});
test('wrong target context rolls back before schema or user writes', async () => {
  events = []; wrongTarget = true;
  try { await assert.rejects(syncUsersToTarget('secondary', operator), { code: 'SYNC_TARGET_CONTEXT_MISMATCH', status: 409 });
    assert.deepEqual(events, ['source-begin', 'source-commit', 'begin', 'target-check', 'rollback']); }
  finally { wrongTarget = false; }
});
test('source read failure rolls back source before opening target', async () => {
  events = []; failSource = true;
  try { await assert.rejects(syncUsersToTarget('secondary', operator), /SIMULATED_SOURCE_FAILURE/);
    assert.deepEqual(events, ['source-begin', 'source-rollback']); }
  finally { failSource = false; }
});
test('failure auditing a target-only role impact rolls back all target changes', async () => {
  events = []; accountAudits = []; roleAudits = []; collision = false; failMembership = false; failRoleAudit = true;
  try { await assert.rejects(syncUsersToTarget('secondary', operator), /SIMULATED_AUDIT_FAILURE/);
    assert.equal(accountAudits.length, 3); assert.equal(events.at(-1), 'rollback'); assert.ok(!events.includes('commit')); }
  finally { failRoleAudit = false; }
});
test('unmigrated target is rejected before any target mutation', async () => {
  events = []; missingSchema = true;
  try { await assert.rejects(syncUsersToTarget('secondary', operator), { code: 'SYNC_SCHEMA_NOT_READY', status: 409 });
    assert.deepEqual(events, ['source-begin', 'source-commit', 'begin', 'target-check', 'schema-check', 'rollback']); }
  finally { missingSchema = false; }
});
test('both serializable transactions set and restore bounded lock waits on success', async () => {
  events=[]; lockStatements=[]; collision=false; failMembership=false; accountAudits=[]; roleAudits=[];
  await syncUsersToTarget('secondary', operator);
  assert.deepEqual(lockStatements, ['source:SET LOCK_TIMEOUT 10000','source:SET LOCK_TIMEOUT -1','target:SET LOCK_TIMEOUT 10000','target:SET LOCK_TIMEOUT -1']);
});
test('lock conflict restores timeout and rolls back in source and target', async () => {
  for (const where of ['source','target']) {
    events=[]; lockStatements=[]; lockFailure=where; collision=false;
    try {
      await assert.rejects(syncUsersToTarget('secondary', operator), { status:409, code: where === 'source' ? 'DEADLOCK_RETRY' : 'LOCK_TIMEOUT' });
      assert.equal(events.at(-1), where === 'source' ? 'source-rollback' : 'rollback');
      assert.ok(lockStatements.includes(`${where}:SET LOCK_TIMEOUT 10000`));
      assert.ok(lockStatements.includes(`${where}:SET LOCK_TIMEOUT -1`));
      if (where === 'source') assert.ok(!events.includes('begin'));
    } finally { lockFailure=null; }
  }
});
