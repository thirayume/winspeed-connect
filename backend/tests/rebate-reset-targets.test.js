'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveResetTargets, configuredResetTargets, resolvePhysicalResetTargets } = require('../services/rebate-reset-targets');

const prod = { environment: 'production', primaryDatabase: 'dbwins_worldfert9',
  switchableTargets: ['dbwins_worldfert9', 'dbwins_worldfert2', 'dbwins_worldfert9_uat'],
  configuredTargets: ['dbwins_worldfert9', 'dbwins_worldfert2'] };

test('production resets only its reviewed targets, not every switchable database', () => {
  assert.deepEqual(resolveResetTargets(prod), ['dbwins_worldfert9', 'dbwins_worldfert2']);
  assert.throws(() => resolveResetTargets({ ...prod, configuredTargets: prod.switchableTargets }), { code: 'REBATE_RESET_CROSS_ENVIRONMENT' });
});

test('UAT targets its independently configured clone', () => {
  assert.deepEqual(resolveResetTargets({ environment: 'uat', primaryDatabase: 'dbwins_worldfert9_uat',
    switchableTargets: ['dbwins_worldfert9_uat'], configuredTargets: ['dbwins_worldfert9_uat'] }), ['dbwins_worldfert9_uat']);
});

test('reset rejects wildcard discovery, missing targets, unknown and duplicate databases', () => {
  assert.throws(() => resolveResetTargets({ ...prod, wildcard: true }), { code: 'REBATE_RESET_TARGETS_NOT_PINNED' });
  assert.throws(() => resolveResetTargets({ ...prod, configuredTargets: [] }), { code: 'REBATE_RESET_TARGETS_NOT_CONFIGURED' });
  assert.throws(() => resolveResetTargets({ ...prod, configuredTargets: ['dbwins_worldfert2'] }), { code: 'REBATE_RESET_PRIMARY_MISSING' });
  assert.throws(() => resolveResetTargets({ ...prod, configuredTargets: ['dbwins_worldfert9', 'dbwins_worldfert8'] }), { code: 'REBATE_RESET_TARGET_NOT_ALLOWED' });
  assert.throws(() => resolveResetTargets({ ...prod, configuredTargets: ['dbwins_worldfert9', 'DBWINS_WORLDFERT9'] }), { code: 'REBATE_RESET_TARGET_DUPLICATE' });
});

test('runtime configuration requires an explicit environment-specific manifest', () => {
  const env = { DB_MODE: 'onprem', ONPREM_TARGET_KIND: 'production', ONPREM_DB_NAME: 'dbwins_worldfert9',
    ONPREM_SWITCHABLE_DATABASES: prod.switchableTargets.join(','), REBATE_RESET_DATABASES: prod.configuredTargets.join(',') };
  assert.deepEqual(configuredResetTargets(env), prod.configuredTargets);
  assert.throws(() => configuredResetTargets({ ...env, REBATE_RESET_DATABASES: '' }), { code: 'REBATE_RESET_TARGETS_NOT_CONFIGURED' });
  assert.throws(() => configuredResetTargets({ ...env, REBATE_RESET_DATABASES: `${env.REBATE_RESET_DATABASES},dbwins_worldfert9_uat` }), { code: 'REBATE_RESET_CROSS_ENVIRONMENT' });
  assert.throws(() => configuredResetTargets({ ...env, ONPREM_SWITCHABLE_DATABASES: '*' }), { code: 'REBATE_RESET_TARGETS_NOT_PINNED' });
});

test('active connection profiles cannot redirect a production reset to UAT or the same physical database twice', () => {
  const env = { DB_MODE: 'onprem', ONPREM_TARGET_KIND: 'production', ONPREM_DB_NAME: 'dbwins_worldfert9',
    ONPREM_SWITCHABLE_DATABASES: prod.switchableTargets.join(','), REBATE_RESET_DATABASES: prod.configuredTargets.join(',') };
  const tuples = (_env, _operation, name) => ({ database: name, expectedServerName: 'R740-SRV\\SQL2008', password: 'do-not-return' });
  const result = resolvePhysicalResetTargets(env, tuples);
  assert.deepEqual(result.map(x => x.database), prod.configuredTargets);
  assert.ok(!JSON.stringify(result).includes('do-not-return'));
  assert.throws(() => resolvePhysicalResetTargets(env, (_e, _o, name) => ({
    expectedServerName: 'R740-SRV\\SQL2008', database: name.endsWith('2') ? 'dbwins_worldfert9_uat' : name,
  })), { code: 'REBATE_RESET_CROSS_ENVIRONMENT' });
  assert.throws(() => resolvePhysicalResetTargets(env, () => ({ expectedServerName: 'R740-SRV\\SQL2008',
    database: 'dbwins_worldfert9' })), { code: 'REBATE_RESET_PHYSICAL_TARGET_DUPLICATE' });
  const uat = { DB_MODE: 'onprem', ONPREM_TARGET_KIND: 'uat', ONPREM_DB_NAME: 'dbwins_worldfert9_uat',
    ONPREM_SWITCHABLE_DATABASES: 'dbwins_worldfert9_uat,dbwins_worldfert9', REBATE_RESET_DATABASES: 'dbwins_worldfert9_uat' };
  assert.throws(() => resolvePhysicalResetTargets(uat, () => ({ expectedServerName: 'R740-SRV\\SQL2008',
    database: 'dbwins_worldfert9' })), { code: 'REBATE_RESET_PHYSICAL_NAME_MISMATCH' });
});
