'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
const users = new Map([
  [9001, { Id: 9001, Username: 'qa-admin', Role: 'ADMIN', IsActive: true }],
  [9002, { Id: 9002, Username: 'qa-sales', Role: 'SALES', IsActive: true }],
]);

h.installDbStub(({ text, inputs }) => {
  const id = Number(inputs.id);
  if (/DELETE FROM wf\.AppUser WHERE Id = @id/.test(text)) {
    return { recordset: [], rowsAffected: [users.delete(id) ? 1 : 0] };
  }
  if (/FROM wf\.AppUser\s+WHERE Id = @id/.test(text)) {
    return users.has(id) ? [users.get(id)] : [];
  }
  return [];
});

test('deleting an active user invalidates cached account status before its old token is reused', async () => {
  const app = await h.startApp([['/api/auth', '../../routes/auth']]);
  try {
    const sales = { user: { sub: 9002, role: 'SALES' } };
    const active = await app.call('GET', '/api/auth/me', sales);
    assert.equal(active.status, 200, 'prime the positive account-status cache');
    const removed = await app.call('DELETE', '/api/auth/users/9002', { user: { sub: 9001, role: 'ADMIN' } });
    assert.equal(removed.status, 200);
    const stale = await app.call('GET', '/api/auth/me', sales);
    assert.equal(stale.status, 401);
    assert.equal(stale.body.code, 'ACCOUNT_NOT_FOUND');
  } finally {
    await app.close();
  }
});
