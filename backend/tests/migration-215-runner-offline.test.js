'use strict';
// Exercises the runner's parser/classifier only; no SQL is executed or applied.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { executionBatches, classifyMigration, sha256 } = require('../run_migrations');
const file = '215_giveaway_budget_revision.sql';
const text = fs.readFileSync(path.join(__dirname, '..', 'migrations', file), 'utf8');

test('215 splits into the intended SQL Server batches without changing database', () => {
  const batches = executionBatches(file, text, 'dbwins_worldfert9_uat_fz8');
  assert.equal(batches.length, 3);
  assert.match(batches[0], /ADD EditVersion rowversion/i);
  assert.match(batches[1], /CREATE TRIGGER/i);
  assert.match(batches[2], /AFTER INSERT, UPDATE, DELETE/i);
  assert.match(text, /^-- @transaction/m);
});
test('215 runner classifies missing ledger, unchanged checksum, and changed checksum', () => {
  const batches = executionBatches(file, text, 'dbwins_worldfert9_uat_fz8');
  const digest = sha256(text);
  assert.equal(classifyMigration(null, digest, batches.length), 'PENDING');
  assert.equal(classifyMigration({ dialect: 'LEGACY_UNKNOWN', checksum: digest, batchCount: batches.length }, digest, batches.length), 'UNCHANGED');
  assert.equal(classifyMigration({ dialect: 'LEGACY_UNKNOWN', checksum: '0'.repeat(64), batchCount: batches.length }, digest, batches.length), 'CHECKSUM_DRIFT');
});
