'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveEffectiveMigration } = require('../safety-validator');
const { classifyMigration } = require('../run_migrations');

const name = '157_initial_coupon_invoice_107.sql';
const original = fs.readFileSync(path.join(__dirname, '../migrations', name), 'utf8');
const policy = JSON.parse(fs.readFileSync(path.join(__dirname, '../migration-policy.json'), 'utf8'));
const resolve = (profile, serverName, customPolicy = policy) => resolveEffectiveMigration(name, original, profile,
  customPolicy, serverName ? { verifiedTarget: { serverName } } : {});

test('R740 metadata helper binds SELF while every existing writer guard stays byte-identical', () => {
  const result = resolve('onprem', 'R740-SRV\\SQL2008');
  assert.equal(result.status, 'OVERRIDE');
  assert.equal(result.executed.content.replace(/^-- R740 compatibility:.*\n-- All UAT2-only.*\n/, ''),
    original.replace("WITH EXECUTE AS 'wf_local_uat_migrator'", 'WITH EXECUTE AS SELF'));
  assert.equal(result.executed.batchCount, result.original.batchCount);
});

test('already-applied UAT2 onprem migration keeps its standard artifact and ledger identity', () => {
  const result = resolve('onprem', 'AMYOU-YOGA7\\V2008R2');
  assert.equal(result.status, 'STANDARD');
  assert.equal(result.executed.content, original);
  assert.equal(classifyMigration({ originalChecksum: result.original.hash,
    originalBatchCount: result.original.batchCount, executedChecksum: result.executed.hash,
    executedBatchCount: result.executed.batchCount, dialect: 'standard', executedFile: name }, result), 'UNCHANGED');
});

test('fixed local and SQL2022 profiles retain their original migration artifact', () => {
  for (const profile of ['local_uat', 'local_rehearsal', 'remote_b']) {
    assert.equal(resolve(profile).status, 'STANDARD');
  }
});

test('target-specific onprem compatibility requires a verified SQL server identity', () => {
  assert.throws(() => resolve('onprem'), /COMPAT_TARGET_IDENTITY_REQUIRED/);
  const invalid = structuredClone(policy);
  invalid.dialectOverrides[name].targetServerNames = [];
  assert.throws(() => resolve('onprem', 'R740-SRV\\SQL2008', invalid), /MIGRATION_POLICY_INVALID/);
});

test('modified original or compatibility artifact is rejected before execution', () => {
  assert.throws(() => resolveEffectiveMigration(name, original + '\n-- changed', 'onprem', policy,
    { verifiedTarget: { serverName: 'R740-SRV\\SQL2008' } }), /ORIGINAL_HASH_DRIFT/);
  assert.throws(() => resolveEffectiveMigration(name, original, 'onprem', policy,
    { verifiedTarget: { serverName: 'R740-SRV\\SQL2008' }, readOverrideFn: () => 'SELECT 1' }), /EXECUTED_HASH_DRIFT/);
});
