'use strict';

/**
 * R11 A — security (U-1 master-data writes, U-2 user management, U-13).
 * Drives the real routers over HTTP with real JWTs; the DB is a recording stub.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const users = {
  10: { Id: 10, Username: 'mgr', DisplayName: 'Manager', Role: 'MANAGER', IsActive: 1 },
  20: { Id: 20, Username: 'sales', DisplayName: 'Sales', Role: 'SALES', IsActive: 1 },
  30: { Id: 30, Username: 'admin', DisplayName: 'Admin', Role: 'ADMIN', IsActive: 1 },
  40: { Id: 40, Username: 'acc', DisplayName: 'Accounting', Role: 'ACCOUNTING', IsActive: 1 },
};

const db = h.installDbStub(({ text, inputs }) => {
  if (/FROM wf\.AppUser\s+WHERE Id = @id/i.test(text)) return users[inputs.id] ? [users[inputs.id]] : [];
  if (/^\s*UPDATE wf\.AppUser/i.test(text)) return { recordset: [], rowsAffected: [1] };
  if (/INSERT INTO wf\.AppUser/i.test(text)) return [{ Id: 99, Username: 'new', DisplayName: 'New', Role: 'SALES' }];
  return [];
});

let app;
test.before(async () => {
  app = await h.startApp([['/api/master', '../../routes/master'], ['/api/auth', '../../routes/auth']]);
});
test.after(async () => { await app.close(); });

const masterWrites = [
  ['PATCH', '/api/master/customers/1001', { CustName: 'x' }],
  ['DELETE', '/api/master/customers/1001', undefined],
  ['PATCH', '/api/master/goods/2001', { GoodName1: 'x' }],
  ['DELETE', '/api/master/goods/2001', undefined],
  ['PATCH', '/api/master/prices', { SetPriceID: 1, ListNo: 1, GoodPriceNet: 1 }],
  ['POST', '/api/master/prices', { GoodID: 2001, GoodPriceNet: 15000, BeginDate: '2026-10-01', EndDate: '2026-10-31' }],
  ['POST', '/api/master/prices/bulk-extend', { items: [] }],
];

for (const role of ['SALES', 'MANAGER', 'ACCOUNTING']) {
  test(`U-1: ${role} gets 403 on every master-data write and nothing is written`, async () => {
    const before = db.calls.length;
    for (const [method, url, body] of masterWrites) {
      const r = await app.call(method, url, { body, user: { sub: 20, role } });
      assert.equal(r.status, 403, `${role} ${method} ${url}`);
    }
    const writes = db.calls.slice(before).filter(c => /INSERT|UPDATE|DELETE/i.test(c.text));
    assert.equal(writes.length, 0);
  });
}

test('U-1: ADMIN POST /master/prices with an empty body gets 400 before reading MAX(SetPriceID)', async () => {
  const before = db.calls.length;
  const r = await app.call('POST', '/api/master/prices', { body: {}, user: { sub: 30, role: 'ADMIN' } });
  assert.equal(r.status, 400);
  assert.equal(db.calls.slice(before).filter(c => /SetPriceID|INSERT/i.test(c.text)).length, 0);
});

test('U-1: ADMIN POST /master/prices rejects price <= 0 and BeginDate > EndDate', async () => {
  const admin = { sub: 30, role: 'ADMIN' };
  const r1 = await app.call('POST', '/api/master/prices', { body: { GoodID: 2001, GoodPriceNet: 0, BeginDate: '2026-10-01', EndDate: '2026-10-31' }, user: admin });
  assert.equal(r1.status, 400);
  const r2 = await app.call('POST', '/api/master/prices', { body: { GoodID: 2001, GoodPriceNet: 100, BeginDate: '2026-11-01', EndDate: '2026-10-31' }, user: admin });
  assert.equal(r2.status, 400);
});

test('U-2: MANAGER cannot promote someone to ADMIN', async () => {
  const r = await app.call('PATCH', '/api/auth/users/20', { body: { role: 'ADMIN' }, user: { sub: 10, role: 'MANAGER' } });
  assert.equal(r.status, 403);
});

test('U-2: MANAGER cannot change their own role', async () => {
  const r = await app.call('PATCH', '/api/auth/users/10', { body: { role: 'ADMIN' }, user: { sub: 10, role: 'MANAGER' } });
  assert.equal(r.status, 403);
});

test('U-2: MANAGER cannot reset an ADMIN password', async () => {
  const r = await app.call('PATCH', '/api/auth/users/30', { body: { password: 'Temp#12345' }, user: { sub: 10, role: 'MANAGER' } });
  assert.equal(r.status, 403);
});

test('U-2: MANAGER cannot create an ADMIN or an equal-rank user', async () => {
  const r1 = await app.call('POST', '/api/auth/users', { body: { username: 'x', password: 'Temp#12345', displayName: 'X', role: 'ADMIN' }, user: { sub: 10, role: 'MANAGER' } });
  assert.equal(r1.status, 403);
  const r2 = await app.call('POST', '/api/auth/users', { body: { username: 'x', password: 'Temp#12345', displayName: 'X', role: 'MANAGER' }, user: { sub: 10, role: 'MANAGER' } });
  assert.equal(r2.status, 403);
});

test('U-2: ADMIN may change another user role (UPDATE issued)', async () => {
  const before = db.calls.length;
  const r = await app.call('PATCH', '/api/auth/users/20', { body: { role: 'COUNTER_SALES' }, user: { sub: 30, role: 'ADMIN' } });
  assert.equal(r.status, 200);
  const upd = db.calls.slice(before).find(c => /UPDATE wf\.AppUser SET/i.test(c.text));
  assert.ok(upd, 'UPDATE wf.AppUser issued');
  assert.equal(upd.inputs.role, 'COUNTER_SALES');
});
