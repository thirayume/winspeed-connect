'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('./helpers/route-harness.cjs').installDbStub(() => []);
const { splitBatches } = require('../run_migrations');
const { assertNoCrossDbWrite } = require('../safety-validator');

// Migration 164: the Sale-App print log is a wf table only (WinSpeed keeps its own SMAudit rows)
const text = fs.readFileSync(path.join(__dirname, '../migrations/164_native_print_log.sql'), 'utf8');

test('migration 164 creates only wf.NativePrintLog, idempotently and portable to SQL Server 2008', () => {
  assert.doesNotMatch(text, /\bdbo\./i);
  assert.doesNotMatch(text, /CREATE\s+OR\s+ALTER|\bTHROW\b|\bIIF\s*\(|TRY_CONVERT|\bCONCAT\s*\(|\bOFFSET\b|dbwins_worldfert/i);
  assert.match(text, /IF OBJECT_ID\(N'wf\.NativePrintLog', N'U'\) IS NULL/);
  assert.match(text, /CHECK \(DocType IN \(104, 116, 107\)\)/);
  assert.match(text, /DEFAULT SYSUTCDATETIME\(\)/);
  const batches = splitBatches(text);
  assert.equal(batches.length, 3);
  for (const batch of batches) assert.doesNotThrow(() => assertNoCrossDbWrite(batch));
  for (const index of ['IX_NativePrintLog_Doc', 'IX_NativePrintLog_PrintedAt'])
    assert.ok(text.includes(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'${index}'`), index);
});
