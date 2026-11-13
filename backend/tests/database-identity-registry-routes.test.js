'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
const { stub: db } = h.installDbStub(() => [], { activeUserIds: h.TEST_USERS });
db.getDbName = () => 'primary';
const activePath = require.resolve('../services/active-database');
require.cache[activePath] = { id: activePath, filename: activePath, loaded: true, exports: {
  onpremEnabled: () => true, primaryDatabase: () => 'primary', systemActiveDatabase: async () => 'primary',
  getDatabaseThemes: async () => ({}), canAccessDatabase: () => true, DEFAULT_DATABASE_THEMES: {},
} };
const registryPath = require.resolve('../services/database-identity-registry');
let received;
require.cache[registryPath] = { id: registryPath, filename: registryPath, loaded: true, exports: {
  saveReviewedBinding: async input => { received = input; return { id: 1, revision: 1 }; },
  revokeReviewedBinding: async input => { received = input; return { id: input.bindingId, revision: 2, changed: true }; },
} };
let app;
test.before(async () => { app = await h.startApp([['/api/admin-management', '../../routes/admin-management']]); });
test.after(async () => app.close());

test('only a real ADMIN can review a pair, and primary database and reviewer come from the server session', async () => {
  const body = { primaryDatabase: 'attacker-db', reviewerId: 99, targetDatabase: 'secondary', primaryUserId: 8,
    targetUserId: 17, primaryUsername: 'person-a', targetUsername: 'person-b', expectedRevision: 0 };
  for (const user of [{ sub: 2, role: 'SALES' }, { sub: 2, role: 'ADMIN', actorSub: 1 }]) {
    received = null;
    const result = await app.call('POST', '/api/admin-management/database-identity-bindings', { user, body });
    assert.equal(result.status, 403);
    assert.equal(received, null);
  }
  const result = await app.call('POST', '/api/admin-management/database-identity-bindings', { user: { sub: 1, role: 'ADMIN' }, body });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(received.primaryDatabase, 'primary');
  assert.equal(received.reviewerId, 1);
  assert.equal(received.targetUserId, 17);
});

test('only ADMIN can revoke a reviewed binding, with actor from the session', async () => {
  const body = { reviewerId: 99, primaryDatabase: 'attacker-db', expectedRevision: 1 };
  received = null;
  const denied = await app.call('DELETE', '/api/admin-management/database-identity-bindings/4', { user: { sub: 2, role: 'SALES' }, body });
  assert.equal(denied.status, 403); assert.equal(received, null);
  const allowed = await app.call('DELETE', '/api/admin-management/database-identity-bindings/4', { user: { sub: 1, role: 'ADMIN' }, body });
  assert.equal(allowed.status, 200);
  assert.equal(received.bindingId, 4); assert.equal(received.primaryDatabase, 'primary'); assert.equal(received.reviewerId, 1);
});
