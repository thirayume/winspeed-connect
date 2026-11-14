'use strict';

// While REBATE_POOL_103_ENABLED is off, the Rebate Pool must not appear on any screen:
// the client receives neither the Pool actions nor the Pool feature. Permissions on the
// server are unchanged, so every route keeps its own authorization and switch.
const test = require('node:test');
const assert = require('node:assert/strict');
const { featureEnabled, enabledFeatures, hasPermission } = require('../services/role-capabilities');
const { filteredCapabilities } = require('../services/role-profiles');

const POOL_ACTIONS = ['rebate.approve-over-limit', 'rebate.evidence.verify', 'rebate.convert',
  'rebate.ticket-redeem', 'rebate.ticket-extend', 'rebate.aging-override'];
const SWITCHES = ['REBATE_POOL_103_ENABLED', 'REBATE_CONVERSION_ENABLED'];

function withEnv(values, fn) {
  const saved = Object.fromEntries(SWITCHES.map(k => [k, process.env[k]]));
  for (const k of SWITCHES) { if (values[k] === undefined) delete process.env[k]; else process.env[k] = values[k]; }
  try { return fn(); } finally {
    for (const k of SWITCHES) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

test('Pool actions are hidden from the client until the Pool is switched on', () => {
  for (const off of [{}, { REBATE_POOL_103_ENABLED: 'false' }, { REBATE_POOL_103_ENABLED: 'TRUE' }, { REBATE_CONVERSION_ENABLED: 'true' }]) {
    for (const action of POOL_ACTIONS) assert.equal(featureEnabled(action, off), false, `${action} with ${JSON.stringify(off)}`);
    assert.deepEqual(enabledFeatures(off), []);
  }
  const poolOnly = { REBATE_POOL_103_ENABLED: 'true' };
  for (const action of POOL_ACTIONS.filter(a => a !== 'rebate.convert')) assert.equal(featureEnabled(action, poolOnly), true, action);
  assert.equal(featureEnabled('rebate.convert', poolOnly), false, 'conversion needs its own switch as well');
  assert.equal(featureEnabled('rebate.convert', { REBATE_POOL_103_ENABLED: 'true', REBATE_CONVERSION_ENABLED: 'true' }), true);
  assert.deepEqual(enabledFeatures(poolOnly), ['rebate-pool-103']);
});

test('actions outside the Pool are not affected by the Pool switch', () => {
  for (const action of ['so.create', 'quotation.create', 'giveaway.budget', 'pricing.view']) {
    assert.equal(featureEnabled(action, {}), true, action);
  }
  // the existing native switches keep their meaning
  assert.equal(featureEnabled('invoice.post-native', {}), false);
  assert.equal(featureEnabled('invoice.post-native', { NATIVE_INVOICE_107_ENABLED: 'true' }), true);
});

test('the capabilities sent to the client follow the switch, the server permission does not', () => {
  const admin = { id: 1, sub: 1, role: 'ADMIN', roles: ['ADMIN'] };
  const off = withEnv({}, () => filteredCapabilities(admin));
  for (const action of POOL_ACTIONS) assert.equal(off.actions.includes(action), false, `${action} must not reach the client`);
  assert.deepEqual(off.features, []);
  assert.equal(off.actions.includes('so.create'), true);

  const on = withEnv({ REBATE_POOL_103_ENABLED: 'true' }, () => filteredCapabilities(admin));
  assert.equal(on.actions.includes('rebate.approve-over-limit'), true);
  assert.equal(on.actions.includes('rebate.evidence.verify'), true);
  assert.equal(on.actions.includes('rebate.convert'), false);
  assert.deepEqual(on.features, ['rebate-pool-103']);

  // routes still authorize on the permission itself, whatever the switch says
  withEnv({}, () => { for (const action of POOL_ACTIONS) assert.equal(hasPermission(admin, action), true, action); });
});
