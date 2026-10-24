'use strict';

// Owner 2026-10-25: who may switch their session database, and who may set the system default.
const test = require('node:test');
const assert = require('node:assert/strict');
const { rolesFor, capabilitiesFor } = require('../services/role-capabilities');

test('database.switch is limited to the four named roles', () => {
  const roles = rolesFor('database.switch');
  for (const r of ['ACCOUNTING', 'COUNTER_SALES', 'C_LEVEL', 'ADMIN']) assert.ok(roles.includes(r), r);
  for (const r of ['SALES', 'WAREHOUSE', 'MANAGER']) assert.ok(!roles.includes(r), r + ' must not switch');
});

test('only ADMIN may set the system-wide default database', () => {
  assert.deepEqual(rolesFor('database.set-system'), ['ADMIN']);
  assert.ok(capabilitiesFor('ADMIN').actions.includes('database.set-system'));
  assert.ok(!capabilitiesFor('ACCOUNTING').actions.includes('database.set-system'));
  assert.ok(capabilitiesFor('ACCOUNTING').actions.includes('database.switch'));
  assert.ok(!capabilitiesFor('SALES').actions.includes('database.switch'));
});
