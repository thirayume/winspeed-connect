'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sha256, splitBatches, validateMigrationPolicy, classifyMigration, buildPlan } = require('./run_migrations');

const basePolicy = () => ({
  schemaVersion: 1,
  checksumPolicy: 'immutable-after-apply',
  excludedFiles: ['000_manual.sql'],
  excludedPatterns: ['^uat_'],
  legacyDuplicateSequences: { 2: ['002_a.sql', '002_b.sql'] },
});

test('policy admits only the exact approved legacy duplicate group and excludes UAT SQL', () => {
  const result = validateMigrationPolicy([
    '000_manual.sql', '001_schema.sql', '002_a.sql', '002_b.sql', 'uat_create_admin.sql',
  ], basePolicy());
  assert.deepEqual(result.activeFiles, ['001_schema.sql', '002_a.sql', '002_b.sql']);
  assert.deepEqual(result.excludedFiles, ['000_manual.sql', 'uat_create_admin.sql']);
});

test('policy rejects an unexpected duplicate sequence', () => {
  assert.throws(() => validateMigrationPolicy([
    '000_manual.sql', '002_a.sql', '002_b.sql', '003_a.sql', '003_b.sql',
  ], basePolicy()), /sequence 3/);
});

test('policy rejects an unsequenced active SQL file', () => {
  assert.throws(() => validateMigrationPolicy([
    '000_manual.sql', '002_a.sql', '002_b.sql', 'manual_fix.sql',
  ], basePolicy()), /must start with a numeric sequence/);
});

test('migration classification is fail-closed for checksum and batch drift', () => {
  assert.equal(classifyMigration(null, 'abc', 2), 'PENDING');
  assert.equal(classifyMigration({ checksum: 'ABC', batchCount: 2 }, 'abc', 2), 'UNCHANGED');
  assert.equal(classifyMigration({ checksum: 'def', batchCount: 2 }, 'abc', 2), 'CHECKSUM_DRIFT');
  assert.equal(classifyMigration({ checksum: 'abc', batchCount: 1 }, 'abc', 2), 'BATCHCOUNT_DRIFT');
});

test('buildPlan identifies pending, excluded-applied, and ledger-only rows without database writes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-migrations-'));
  try {
    fs.writeFileSync(path.join(directory, '000_manual.sql'), 'SELECT 0;', 'utf8');
    fs.writeFileSync(path.join(directory, '001_a.sql'), 'SELECT 1;\nGO\nSELECT 2;', 'utf8');
    fs.writeFileSync(path.join(directory, '002_b.sql'), 'SELECT 3;', 'utf8');
    const inventory = {
      allFiles: ['000_manual.sql', '001_a.sql', '002_b.sql'],
      activeFiles: ['001_a.sql', '002_b.sql'],
      excludedFiles: ['000_manual.sql'],
    };
    const firstSql = fs.readFileSync(path.join(directory, '001_a.sql'), 'utf8');
    const applied = new Map([
      ['000_manual.sql', { checksum: 'legacy', batchCount: 1 }],
      ['001_a.sql', { checksum: sha256(firstSql), batchCount: splitBatches(firstSql).length }],
      ['removed.sql', { checksum: 'old', batchCount: 1 }],
    ]);
    const plan = buildPlan(inventory, applied, directory);
    assert.deepEqual(plan.entries.map(entry => [entry.file, entry.status]), [
      ['001_a.sql', 'UNCHANGED'],
      ['002_b.sql', 'PENDING'],
    ]);
    assert.deepEqual(plan.excludedApplied, ['000_manual.sql']);
    assert.deepEqual(plan.ledgerOnly, ['removed.sql']);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
