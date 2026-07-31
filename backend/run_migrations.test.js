'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  sha256,
  splitBatches,
  validateMigrationPolicy,
  classifyMigration,
  buildPlan,
  STATUSES,
} = require('./run_migrations');
const { runMetadataProbe } = require('./migration-reconciliation');

const basePolicy = () => ({
  schemaVersion: 2,
  checksumPolicy: 'immutable-after-apply',
  excludedFiles: ['000_manual.sql'],
  excludedPatterns: ['^uat_'],
  legacyDuplicateSequences: { 2: ['002_a.sql', '002_b.sql'] },
  driftEvidence: {},
  legacyAliases: {},
  preflightMigrations: {},
});

function withMigrations(files, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-migrations-'));
  try {
    for (const [file, sql] of Object.entries(files)) fs.writeFileSync(path.join(directory, file), sql, 'utf8');
    return callback(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function inventory(activeFiles, excludedFiles = []) {
  return {
    allFiles: [...excludedFiles, ...activeFiles].sort(),
    activeFiles: [...activeFiles].sort(),
    excludedFiles: [...excludedFiles].sort(),
  };
}

function aliasSpec(currentSql) {
  return {
    currentChecksum: sha256(currentSql),
    historicalEvidence: 'git:test-fixture',
    legacyFiles: [{ file: '002_old.sql', checksum: 'a'.repeat(64), batchCount: 1 }],
    probes: [{ id: 'required table', kind: 'object', schema: 'wf', object: 'Required', types: ['U'] }],
  };
}

test('policy admits only the exact approved legacy duplicate group and excludes UAT SQL', () => {
  const result = validateMigrationPolicy([
    '000_manual.sql', '001_schema.sql', '002_a.sql', '002_b.sql', 'uat_create_admin.sql',
  ], basePolicy());
  assert.deepEqual(result.activeFiles, ['001_schema.sql', '002_a.sql', '002_b.sql']);
  assert.deepEqual(result.excludedFiles, ['000_manual.sql', 'uat_create_admin.sql']);
});

test('policy rejects an unexpected duplicate sequence and unsequenced active SQL', () => {
  assert.throws(() => validateMigrationPolicy([
    '000_manual.sql', '002_a.sql', '002_b.sql', '003_a.sql', '003_b.sql',
  ], basePolicy()), /sequence 3/);
  assert.throws(() => validateMigrationPolicy([
    '000_manual.sql', '002_a.sql', '002_b.sql', 'manual_fix.sql',
  ], basePolicy()), /must start with a numeric sequence/);
});

test('current applied migration is APPLIED_CURRENT', () => withMigrations({
  '001_schema.sql': 'SELECT 1;\nGO\nSELECT 2;',
}, directory => {
  const sql = fs.readFileSync(path.join(directory, '001_schema.sql'), 'utf8');
  const applied = new Map([['001_schema.sql', { checksum: sha256(sql), batchCount: splitBatches(sql).length }]]);
  const plan = buildPlan(inventory(['001_schema.sql']), applied, directory, basePolicy());
  assert.equal(plan.entries[0].status, STATUSES.APPLIED_CURRENT);
  assert.equal(classifyMigration(applied.get('001_schema.sql'), sha256(sql), 2), STATUSES.APPLIED_CURRENT);
}));

test('legacy alias complete requires exact old ledger and all object probes', () => withMigrations({
  '002_consolidated.sql': 'SELECT 2;',
}, directory => {
  const sql = fs.readFileSync(path.join(directory, '002_consolidated.sql'), 'utf8');
  const policy = { ...basePolicy(), legacyAliases: { '002_consolidated.sql': aliasSpec(sql) } };
  const applied = new Map([['002_old.sql', { checksum: 'a'.repeat(64), batchCount: 1 }]]);
  const probeState = { aliases: new Map([['002_consolidated.sql', new Map([['required table', { passed: true, state: 'PRESENT:U' }]])]]) };
  const plan = buildPlan(inventory(['002_consolidated.sql']), applied, directory, policy, probeState);
  assert.equal(plan.entries[0].status, STATUSES.APPLIED_VIA_LEGACY_ALIAS);
  assert.deepEqual(plan.ledgerOnly, []);
  assert.deepEqual(plan.legacyLedger, ['002_old.sql']);
}));

test('legacy alias object missing is PARTIALLY_APPLIED', () => withMigrations({
  '002_consolidated.sql': 'SELECT 2;',
}, directory => {
  const sql = fs.readFileSync(path.join(directory, '002_consolidated.sql'), 'utf8');
  const policy = { ...basePolicy(), legacyAliases: { '002_consolidated.sql': aliasSpec(sql) } };
  const applied = new Map([['002_old.sql', { checksum: 'a'.repeat(64), batchCount: 1 }]]);
  const probeState = { aliases: new Map([['002_consolidated.sql', new Map([['required table', { passed: false, state: 'MISSING' }]])]]) };
  const plan = buildPlan(inventory(['002_consolidated.sql']), applied, directory, policy, probeState);
  assert.equal(plan.entries[0].status, STATUSES.PARTIALLY_APPLIED);
  assert.equal(plan.entries[0].reason, 'LEGACY_OBJECT_PROBE_MISSING');
}));

test('checksum or batch-count mismatch is CHECKSUM_DRIFT', () => withMigrations({
  '011_seed.sql': 'SELECT 11;',
}, directory => {
  const applied = new Map([['011_seed.sql', { checksum: 'b'.repeat(64), batchCount: 1 }]]);
  const plan = buildPlan(inventory(['011_seed.sql']), applied, directory, basePolicy());
  assert.equal(plan.entries[0].status, STATUSES.CHECKSUM_DRIFT);
  assert.equal(classifyMigration({ checksum: sha256('SELECT 11;'), batchCount: 2 }, sha256('SELECT 11;'), 1), STATUSES.CHECKSUM_DRIFT);
}));

test('unknown ledger-only filename remains a safety blocker', () => withMigrations({
  '001_schema.sql': 'SELECT 1;',
}, directory => {
  const applied = new Map([['removed_unknown.sql', { checksum: 'c'.repeat(64), batchCount: 1 }]]);
  const plan = buildPlan(inventory(['001_schema.sql']), applied, directory, basePolicy());
  assert.deepEqual(plan.ledgerOnly, ['removed_unknown.sql']);
}));

test('database effect without ledger is PARTIALLY_APPLIED', () => withMigrations({
  '003_partial.sql': 'SELECT 3;',
}, directory => {
  const policy = {
    ...basePolicy(),
    preflightMigrations: {
      '003_partial.sql': { unsafe: false, probes: [{ id: 'new column', kind: 'column' }] },
    },
  };
  const probes = { preflight: new Map([['003_partial.sql', new Map([['new column', { passed: true, state: 'PRESENT' }]])]]) };
  const plan = buildPlan(inventory(['003_partial.sql']), new Map(), directory, policy, probes);
  assert.equal(plan.entries[0].status, STATUSES.PARTIALLY_APPLIED);
}));

test('excluded migration is reported separately as EXCLUDED', () => withMigrations({
  '000_manual.sql': 'SELECT 0;',
  '001_schema.sql': 'SELECT 1;',
}, directory => {
  const plan = buildPlan(inventory(['001_schema.sql'], ['000_manual.sql']), new Map(), directory, basePolicy());
  assert.deepEqual(plan.excludedEntries.map(item => [item.file, item.status]), [['000_manual.sql', STATUSES.EXCLUDED]]);
}));

test('unsafe migration is UNSAFE when no approved effect is present', () => withMigrations({
  '004_unsafe.sql': 'DROP TABLE wf.Example;',
}, directory => {
  const policy = {
    ...basePolicy(),
    preflightMigrations: {
      '004_unsafe.sql': { unsafe: true, riskReason: 'DESTRUCTIVE_FIXTURE', probes: [] },
    },
  };
  const plan = buildPlan(inventory(['004_unsafe.sql']), new Map(), directory, policy);
  assert.equal(plan.entries[0].status, STATUSES.UNSAFE);
  assert.equal(plan.entries[0].reason, 'DESTRUCTIVE_FIXTURE');
}));

test('new empty database planning keeps alias target PENDING and unsafe file UNSAFE', () => withMigrations({
  '002_consolidated.sql': 'SELECT 2;',
  '046_unsafe.sql': 'ALTER TABLE wf.Example DROP COLUMN Legacy;',
}, directory => {
  const consolidated = fs.readFileSync(path.join(directory, '002_consolidated.sql'), 'utf8');
  const policy = {
    ...basePolicy(),
    legacyAliases: { '002_consolidated.sql': aliasSpec(consolidated) },
    preflightMigrations: { '046_unsafe.sql': { unsafe: true, riskReason: 'EMPTY_DB_REVIEW', probes: [] } },
  };
  const plan = buildPlan(inventory(['002_consolidated.sql', '046_unsafe.sql']), new Map(), directory, policy);
  assert.deepEqual(plan.entries.map(item => [item.file, item.status]), [
    ['002_consolidated.sql', STATUSES.PENDING],
    ['046_unsafe.sql', STATUSES.UNSAFE],
  ]);
}));

test('object probe trims the fixed-width SQL Server object type', async () => {
  const fakePool = {
    request() {
      return {
        input() { return this; },
        async query() { return { recordset: [{ type: 'U ' }] }; },
      };
    },
  };
  const result = await runMetadataProbe(fakePool, {
    id: 'table',
    kind: 'object',
    schema: 'wf',
    object: 'Example',
    types: ['U'],
  });
  assert.deepEqual(result, { passed: true, state: 'PRESENT:U' });
});
test('new-install admin seed requires an explicit strong runtime credential before DB load', () => {
  const source = fs.readFileSync(path.join(__dirname, 'seed_admin.js'), 'utf8');
  assert.doesNotMatch(source, /DEFAULT_SEED_PASSWORD\s*\|\|\s*\[[^\]]+\]\.join/);
  assert.doesNotMatch(source, /DEFAULT_SEED_PASSWORD\s*\|\|\s*['"][^'"]+['"]/);
  assert.match(source, /process\.env\.DEFAULT_SEED_PASSWORD/);
  assert.match(source, /DEFAULT_SEED_PW\.length < 16/);
  assert.ok(source.indexOf('process.env.DEFAULT_SEED_PASSWORD') < source.indexOf("require('./db')"));
});
test('local recovery accepts credentials only from environment and validates reset length', () => {
  const source = fs.readFileSync(path.join(__dirname, 'scripts', 'local_user_recovery.js'), 'utf8');
  assert.doesNotMatch(source, /process\.argv\[4\]/);
  assert.match(source, /process\.env\.LOCAL_RECOVERY_PASSWORD/);
  assert.match(source, /mode === 'reset' && newPassword\.length < 16/);
});
test('coolify provisioning generates and injects a unique seed credential without logging it', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'coolify', 'provision-customer.ps1'), 'utf8');
  assert.match(source, /adminPassword\s*=\s*\("Ad"\s*\+\s*\(New-Secret 24\)\s*\+\s*"8z"\)/);
  assert.match(source, /"DEFAULT_SEED_PASSWORD=\$\(\$obj\.adminPassword\)"/);
  assert.doesNotMatch(source, /adminPassword\s*=\s*'[^']+'/);
  assert.doesNotMatch(source, /Ok\s+"[^"]*\$\(\$cfg\.adminPassword\)/);
  assert.doesNotMatch(source, /"\|[^"]*\$\(\$cfg\.adminPassword\)/);
});
test('auth middleware requires a strong runtime JWT secret without a literal fallback', () => {
  const source = fs.readFileSync(path.join(__dirname, 'middleware', 'auth.js'), 'utf8');
  assert.doesNotMatch(source, /process\.env\.JWT_SECRET\s*(?:\|\||\?\?)\s*['"][^'"]+['"]/);
  assert.match(source, /String\(process\.env\.JWT_SECRET \|\| ''\)\.trim\(\)/);
  assert.match(source, /SECRET\.length < 32/);
});
