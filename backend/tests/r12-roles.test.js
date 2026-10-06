'use strict';

/**
 * R12 items 1–5 — roles complete, one role-capability map, Access As (O-5) pairing,
 * MustChangePassword on admin-created users. Real routers over HTTP, recording DB stub.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const users = {
  1: { Id: 1, Username: 'admin', DisplayName: 'Admin', Role: 'ADMIN', IsActive: 1, MustChangePassword: 0 },
  2: { Id: 2, Username: 'wh', DisplayName: 'Warehouse', Role: 'WAREHOUSE', IsActive: 1, MustChangePassword: 0 },
  3: { Id: 3, Username: 'wb', DisplayName: 'Weighbridge', Role: 'WEIGHBRIDGE', IsActive: 1, MustChangePassword: 0 },
  4: { Id: 4, Username: 'mgr', DisplayName: 'Manager', Role: 'MANAGER', IsActive: 1, MustChangePassword: 0 },
  5: { Id: 5, Username: 'sales', DisplayName: 'Sales', Role: 'SALES', IsActive: 1, MustChangePassword: 0 },
};
let lastAccessAs = null;

const db = h.installDbStub(({ text, inputs }) => {
  if (/FROM wf\.AppUser\s+WHERE Id = @id/i.test(text)) return users[inputs.id] ? [users[inputs.id]] : [];
  if (/FROM wf\.AppUser u\s+LEFT JOIN dbo\.EMEmp e WITH \(NOLOCK\) ON e\.EmpID = u\.EmpId\s+WHERE u\.IsActive = 1/i.test(text)) return Object.values(users);
  if (/INSERT INTO wf\.AccessAsAudit/i.test(text)) return { recordset: [], rowsAffected: [1] };
  if (/SELECT TOP 1 EffectiveUserId, Action FROM wf\.AccessAsAudit/i.test(text)) return lastAccessAs ? [lastAccessAs] : [];
  if (/WHERE Username = @u/i.test(text)) return [users[1]];
  if (/INSERT INTO wf\.AppUser/i.test(text)) return [{ Id: 99, Username: 'n', DisplayName: 'N', Role: 'WEIGHBRIDGE' }];
  return [];
});

const { capabilitiesFor, ROLE_RANK, MENUS, ACTIONS } = require('../services/role-capabilities');

let app;
test.before(async () => { app = await h.startApp([['/api/auth', '../../routes/auth'], ['/api/quotation', '../../routes/quotation'], ['/api/coupons', '../../routes/coupons']]); });
test.after(async () => { await app.close(); });

test('R12-1: WAREHOUSE and WEIGHBRIDGE have a rank below ACCOUNTING', () => {
  assert.ok(ROLE_RANK.WAREHOUSE > 0 && ROLE_RANK.WAREHOUSE < ROLE_RANK.ACCOUNTING);
  assert.ok(ROLE_RANK.WEIGHBRIDGE > 0 && ROLE_RANK.WEIGHBRIDGE < ROLE_RANK.ACCOUNTING);
});

test('R12-1: ADMIN can Access As WAREHOUSE and WEIGHBRIDGE; both appear in the candidate list', async () => {
  const cands = await app.call('GET', '/api/auth/access-as/candidates', { user: { sub: 1, role: 'ADMIN' } });
  const roles = cands.body.map(u => u.Role);
  assert.ok(roles.includes('WAREHOUSE') && roles.includes('WEIGHBRIDGE'));
  const r = await app.call('POST', '/api/auth/access-as', { body: { userId: 3 }, user: { sub: 1, role: 'ADMIN' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.role, 'WEIGHBRIDGE');
});

test('R12-3: one capability map — every menu and action lists only known roles; /auth/me serves the capabilities', async () => {
  const known = new Set(Object.keys(ROLE_RANK));
  for (const roles of [...Object.values(MENUS), ...Object.values(ACTIONS)]) for (const r of roles) assert.ok(known.has(r), r);
  assert.deepEqual(capabilitiesFor('WEIGHBRIDGE').menus.sort(), ['dashboard', 'papertrail', 'scale-reports']);
  // a MANAGER keeps reports only until placed on the org chart (then team-scoped)
  assert.ok(capabilitiesFor('MANAGER').menus.includes('reports'));
  assert.ok(!capabilitiesFor('MANAGER', { positionCode: 'MGR-03' }).menus.includes('reports'));
  assert.ok(!capabilitiesFor('SALES').menus.includes('reports'));
  assert.ok(!capabilitiesFor('APPROVER').menus.includes('trip-board'), 'APPROVER no longer sees a Sale Trip menu it cannot open');
  assert.ok(capabilitiesFor('COUNTER_SALES').menus.includes('quotation'), 'COUNTER_SALES gets the quotation menu its API allows');
  assert.ok(capabilitiesFor('COUNTER_SALES').menus.includes('edit-requests'));
  assert.ok(!capabilitiesFor('WAREHOUSE').actions.includes('so.edit') && !capabilitiesFor('WAREHOUSE').actions.includes('so.cancel'));
  const me = await app.call('GET', '/api/auth/me', { user: { sub: 4, role: 'MANAGER' } });
  assert.equal(me.status, 200);
  assert.ok(me.body.capabilities.actions.includes('quotation.create'));
  assert.ok(me.body.capabilities.actions.includes('coupon.settle'));
});

test('R12-3: routes guarded by the same capability (COUNTER_SALES may create quotations, WAREHOUSE may not)', async () => {
  const w = await app.call('POST', '/api/quotation', { body: {}, user: { sub: 2, role: 'WAREHOUSE' } });
  assert.equal(w.status, 403);
  const c = await app.call('POST', '/api/quotation', { body: {}, user: { sub: 6, role: 'COUNTER_SALES' } });
  assert.notEqual(c.status, 403);
  const acc = await app.call('POST', '/api/coupons/settle-cuts', { body: { couponId: 999999999 }, user: { sub: 7, role: 'ACCOUNTING' } });
  assert.notEqual(acc.status, 403, 'O-3: ACCOUNTING may run Settle Cuts');
  const sales = await app.call('POST', '/api/coupons/settle-cuts', { body: { couponId: 999999999 }, user: { sub: 5, role: 'SALES' } });
  assert.equal(sales.status, 403);
});

test('R12-4: MANAGER cannot Access As a higher rank', async () => {
  const r = await app.call('POST', '/api/auth/access-as', { body: { userId: 1 }, user: { sub: 4, role: 'MANAGER' } });
  assert.equal(r.status, 403);
});

test('R12-4: switching directly from one target to another writes STOP for the first, then START', async () => {
  const before = db.calls.length;
  // actor 1 (ADMIN) is currently impersonating user 2 and switches to user 3
  const r = await app.call('POST', '/api/auth/access-as', { body: { userId: 3 }, user: { sub: 2, role: 'WAREHOUSE', actorSub: 1, actorRole: 'ADMIN' } });
  assert.equal(r.status, 200);
  const audits = db.calls.slice(before).filter(c => /INSERT INTO wf\.AccessAsAudit/.test(c.text)).map(c => [c.inputs.action, c.inputs.effectiveUserId]);
  assert.deepEqual(audits, [['STOP', 2], ['START', 3]]);
});

test('R12-4: a login closes a session that ended without STOP (expiry / closed browser)', async () => {
  const bcrypt = require('bcrypt');
  users[1].PasswordHash = await bcrypt.hash('Temp#12345', 4);
  lastAccessAs = { EffectiveUserId: 5, Action: 'START' };
  const before = db.calls.length;
  const r = await app.call('POST', '/api/auth/login', { body: { username: 'admin', password: 'Temp#12345' } });
  assert.equal(r.status, 200);
  const stops = db.calls.slice(before).filter(c => /INSERT INTO wf\.AccessAsAudit/.test(c.text) && c.inputs.action === 'STOP');
  assert.equal(stops.length, 1, 'open START closed with a STOP');
  assert.equal(stops[0].inputs.effectiveUserId, 5);
  lastAccessAs = null;
});

test('R12-5: admin-created users must change their password (MustChangePassword = 1)', async () => {
  const before = db.calls.length;
  const r = await app.call('POST', '/api/auth/users', { body: { username: 'wb2', password: 'Temp#12345', displayName: 'WB', role: 'WEIGHBRIDGE' }, user: { sub: 1, role: 'ADMIN' } });
  assert.equal(r.status, 200);
  const ins = db.calls.slice(before).find(c => /INSERT INTO wf\.AppUser/.test(c.text));
  assert.match(ins.text, /MustChangePassword\)\s+OUTPUT[\s\S]*VALUES \(@u, @h, @d, @r, @e, 1\)/);
});
