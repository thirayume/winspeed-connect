'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const install = (name, exports) => { require.cache[require.resolve(path.join(root, name))] = { exports }; };
let events, collision, failMembership;
class Transaction {
  async begin() { events.push('begin'); }
  async commit() { events.push('commit'); }
  async rollback() { events.push('rollback'); }
  request() {
    const inputs = {};
    return {
      input(name, _type, value) { inputs[name] = value; return this; },
      async batch() { events.push('schema'); return {}; },
      async query(sqlText) {
        if (sqlText.includes('AS IsExact')) { events.push('identity-check'); return { recordset: collision ? [{ Id: 1, IsExact: 0 }] : [{ Id: 1, IsExact: 1 }] }; }
        if (sqlText.includes('DELETE FROM wf.RolePermission')) { assert.match(sqlText, /WHERE RoleCode = @rc/); events.push('delete-permissions'); }
        if (sqlText.includes('DELETE FROM wf.UserRole')) { assert.match(sqlText, /WHERE UserId = @uid/); events.push('delete-memberships'); if (failMembership) throw new Error('SIMULATED_DB_FAILURE'); }
        if (sqlText.includes('UPDATE wf.AppUser')) { events.push('update-user'); assert.match(sqlText, /WHERE Id = @id AND Username = @username/); }
        return { recordset: [] };
      },
    };
  }
}
const source = { request: () => ({ query: async sqlText => {
  if (sqlText.includes('FROM wf.RoleProfile')) return { recordset: [{ Code: 'SALES', Name: 'Sales', BaseRole: 'SALES', IsActive: 1 }] };
  if (sqlText.includes('FROM wf.RolePermission')) return { recordset: [{ RoleCode: 'SALES', PermissionCode: 'so.create' }] };
  if (sqlText.includes('FROM wf.AppUser')) return { recordset: [{ Id: 1, Username: 'fixture', PasswordHash: 'fixture', DisplayName: 'Fixture', Role: 'SALES', EmpId: 'EMP-01', IsActive: 1 }] };
  if (sqlText.includes('FROM wf.UserRole')) return { recordset: [{ UserId: 1, RoleCode: 'SALES' }] };
  throw new Error('Unexpected source query');
} }) };
install('db.js', { sql: { Transaction, Int: 'Int', Bit: 'Bit', NVarChar: () => 'NVarChar' }, pools: () => ({ ready: Promise.resolve(), ownerPool: {} }) });
install('services/active-database.js', { primaryDatabase: () => 'primary', primaryOwnerPool: async () => source, onpremEnabled: () => true });
install('onprem-target.js', { isSwitchableDb: () => true });
const { syncUsersToTarget } = require('../services/user-sync');

test('conflicting identities roll back before permissions or users are changed', async () => {
  events = []; collision = true; failMembership = false;
  await assert.rejects(syncUsersToTarget('secondary'), { code: 'SYNC_IDENTITY_CONFLICT', status: 409 });
  assert.deepEqual(events, ['begin', 'schema', 'schema', 'identity-check', 'rollback']);
});
test('a mid-sync error rolls back the whole transaction', async () => {
  events = []; collision = false; failMembership = true;
  await assert.rejects(syncUsersToTarget('secondary'), /SIMULATED_DB_FAILURE/);
  assert.ok(events.includes('delete-permissions'));
  assert.equal(events.at(-1), 'rollback');
  assert.ok(!events.includes('commit'));
});
test('matching identities sync under one transaction and commit', async () => {
  events = []; collision = false; failMembership = false;
  const result = await syncUsersToTarget('secondary');
  assert.equal(result.synced.users, 1);
  assert.ok(events.indexOf('identity-check') < events.indexOf('delete-permissions'));
  assert.equal(events.at(-1), 'commit');
  assert.ok(!events.includes('rollback'));
});
