'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requireRole, requireCapability } = require('../middleware/auth');

function check(user, ...roles) {
  let status = 200;
  let allowed = false;
  const res = { status(value) { status = value; return this; }, json() { return this; } };
  requireRole(...roles)({ user }, res, () => { allowed = true; });
  return { status, allowed };
}

test('role guards use all assigned roles for ordinary sessions', () => {
  assert.equal(check({ role: 'SALES', roles: ['SALES', 'ACCOUNTING'] }, 'ACCOUNTING').allowed, true);
  assert.equal(check({ role: 'SALES', roles: ['SALES'] }, 'ACCOUNTING').status, 403);
});

test('Access As requires both actual and effective roles to qualify', () => {
  const as = { isImpersonating: true, role: 'ACCOUNTING', roles: ['ACCOUNTING'], actorRole: 'SALES', actorRoles: ['SALES'] };
  assert.equal(check(as, 'ACCOUNTING').status, 403);
  assert.equal(check({ ...as, actorRoles: ['SALES', 'ACCOUNTING'] }, 'ACCOUNTING').allowed, true);
  assert.equal(check({ ...as, roles: ['SALES'], actorRoles: ['ACCOUNTING'] }, 'ACCOUNTING').status, 403);
  assert.equal(check({ ...as, actorRoles: [] }, 'ACCOUNTING').status, 403);
});

test('Access As capability requires the actor and effective user even without profile permission arrays', () => {
  function checkCapability(user, action) {
    let status = 200;
    let allowed = false;
    const res = { status(value) { status = value; return this; }, json() { return this; } };
    requireCapability(action)({ user }, res, () => { allowed = true; });
    return { status, allowed };
  }
  const asAccounting = { isImpersonating: true, role: 'ACCOUNTING', roles: ['ACCOUNTING'], actorRole: 'ADMIN', actorRoles: ['ADMIN'] };
  assert.equal(checkCapability(asAccounting, 'invoice.post-native').allowed, true);
  assert.equal(checkCapability(asAccounting, 'credit.approve-native').allowed, true);
  assert.equal(checkCapability({ ...asAccounting, actorRole: 'MANAGER', actorRoles: ['MANAGER'] }, 'invoice.post-native').status, 403);
  assert.equal(checkCapability({ ...asAccounting, actorPermissions: [] }, 'invoice.post-native').status, 403);
  assert.equal(checkCapability({ ...asAccounting, actorRoles: ['ADMIN', 'ACCOUNTING'] }, 'invoice.post-native').allowed, true);
  assert.equal(checkCapability({ ...asAccounting, actorRoles: ['ACCOUNTING'], actorDisabledActions: ['invoice.post-native'] }, 'invoice.post-native').status, 403);
  assert.equal(checkCapability({ ...asAccounting, actorRoles: ['ACCOUNTING'], permissions: [] }, 'invoice.post-native').status, 403);
});
