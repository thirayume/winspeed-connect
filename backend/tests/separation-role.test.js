'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  capabilitiesFor,
  hasPermission,
  roleRank,
  ROLES,
  ACTIONS,
} = require('../services/role-capabilities');
const {
  parseProfile,
  filteredCapabilities,
  sessionProfile,
} = require('../services/role-profiles');

test('SEPARATION: capabilities are completely stripped (0 menus, 0 actions)', () => {
  const caps = capabilitiesFor('SEPARATION');
  assert.deepEqual(caps.menus, []);
  assert.deepEqual(caps.actions, []);

  // hasPermission is false for every single action in the system
  for (const action of Object.keys(ACTIONS)) {
    assert.equal(
      hasPermission({ role: 'SEPARATION' }, action),
      false,
      `Action ${action} must be false for SEPARATION`,
    );
  }
});

test('SEPARATION: suppresses secondary roles and returns empty filteredCapabilities', () => {
  const user = {
    id: 99,
    role: 'SEPARATION',
    roles: ['SEPARATION', 'SALES', 'ACCOUNTING'],
    permissions: ['so.create', 'so.edit'],
  };

  // filteredCapabilities must return 0 menus and 0 actions
  const filtered = filteredCapabilities(user);
  assert.deepEqual(filtered.menus, []);
  assert.deepEqual(filtered.actions, []);

  // hasPermission returns false even if permissions array had values
  assert.equal(hasPermission(user, 'so.create'), false);
  assert.equal(hasPermission(user, 'database.switch'), false);
});

test('SEPARATION: role rank is 0 (lowest in hierarchy)', () => {
  assert.equal(roleRank('SEPARATION'), 0);
  assert.ok(roleRank('SALES') > roleRank('SEPARATION'));
  assert.ok(roleRank('ADMIN') > roleRank('SEPARATION'));
});

test('SEPARATION: parseProfile accepts baseRole NONE and SEPARATION', () => {
  const valid = parseProfile({
    code: 'SEPARATION',
    name: 'Separation',
    baseRole: 'NONE',
    permissions: [],
    expectedRevision: 1,
  });
  assert.ok(valid);
  assert.equal(valid.code, 'SEPARATION');
  assert.equal(valid.baseRole, 'NONE');
  assert.deepEqual(valid.permissions, []);

  // Non-SEPARATION roles cannot use baseRole NONE
  const invalid = parseProfile({
    code: 'CUSTOM_SALES',
    name: 'Custom',
    baseRole: 'NONE',
    permissions: [],
    expectedRevision: 1,
  });
  assert.equal(invalid, null);
});

