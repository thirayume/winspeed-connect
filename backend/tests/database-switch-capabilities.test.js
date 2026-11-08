'use strict';

// Owner 2026-10-25 & 2026-11-08: database switching capabilities, colors, and role restrictions.
const test = require('node:test');
const assert = require('node:assert/strict');
const { rolesFor, capabilitiesFor, userRoles } = require('../services/role-capabilities');
const { resolveTheme, DEFAULT_DATABASE_THEMES } = require('../services/active-database');

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

test('database theme resolution matches user requirements for PROD, RD, and UAT', () => {
  // 1. dbwins_worldfert9 is PROD_DB -> Red tone
  const prodTheme = resolveTheme('dbwins_worldfert9');
  assert.equal(prodTheme.color, 'red');
  assert.equal(prodTheme.label, 'PROD_DB');

  // 2. dbwins_worldfert2 is PROD_DB_RD -> Yellow tone, restricted to Accounting, C_Level, ADMIN
  const rdTheme = resolveTheme('dbwins_worldfert2');
  assert.equal(rdTheme.color, 'yellow');
  assert.equal(rdTheme.label, 'PROD_DB_RD');
  assert.deepEqual(rdTheme.restrictedRoles, ['ACCOUNTING', 'C_LEVEL', 'ADMIN']);

  // 3. dbwins_worldfert9_uat is UAT_DB -> Green tone
  const uatTheme = resolveTheme('dbwins_worldfert9_uat');
  assert.equal(uatTheme.color, 'green');
  assert.equal(uatTheme.label, 'UAT_DB');

  // Hyphen variant dbwins_worldfert9-uat also matches UAT green
  const uatHyphenTheme = resolveTheme('dbwins_worldfert9-uat');
  assert.equal(uatHyphenTheme.color, 'green');
  assert.equal(uatHyphenTheme.label, 'UAT_DB');
});

test('dbwins_worldfert2 (PROD_DB_RD) access restriction logic', () => {
  const rdTheme = resolveTheme('dbwins_worldfert2');
  const allowedRoles = rdTheme.restrictedRoles;

  // Accounting is permitted
  assert.ok(userRoles({ role: 'ACCOUNTING' }).some(r => allowedRoles.includes(r)));
  // C-Level is permitted
  assert.ok(userRoles({ role: 'C_LEVEL' }).some(r => allowedRoles.includes(r)));
  // Admin is permitted
  assert.ok(userRoles({ role: 'ADMIN' }).some(r => allowedRoles.includes(r)) || userRoles({ role: 'ADMIN' }).includes('ADMIN'));

  // Counter Sales has database.switch, but is NOT permitted to switch to dbwins_worldfert2
  assert.ok(!userRoles({ role: 'COUNTER_SALES' }).some(r => allowedRoles.includes(r)));
  // Sales is NOT permitted
  assert.ok(!userRoles({ role: 'SALES' }).some(r => allowedRoles.includes(r)));
});

test('custom database theme configuration overrides defaults', () => {
  const custom = {
    dbwins_worldfert9: { color: 'blue', label: 'PROD_CUSTOM' },
  };
  const overridden = resolveTheme('dbwins_worldfert9', custom);
  assert.equal(overridden.color, 'blue');
  assert.equal(overridden.label, 'PROD_CUSTOM');
});

