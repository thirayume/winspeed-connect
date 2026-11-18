'use strict';
// Migration 251 (owner, 18 Nov 2026): giveaway quotas use only the 98 goods of group 1005; other lines go.
// 251 replaces 250 (excluded) with a guard for a company database that has no group-1005 goods.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const up = fs.readFileSync(path.join(__dirname, '..', 'migrations', '251_giveaway_budget_only_1005_guarded.sql'), 'utf8');
const down = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'down', '251_giveaway_budget_only_1005_guarded.down.sql'), 'utf8');

test('runs in one transaction and matches names letter for letter', () => {
  assert.match(up, /^-- @transaction/);
  assert.doesNotMatch(up.replace(/^--.*$/gm, ''), /\bLIKE\b/i, 'no partial-name matching');
  assert.match(up, /N'กระเป๋า สูตร ' \+ LTRIM\(RTRIM\(b\.ItemName\)\) \+ N' ตรา' \+ LTRIM\(RTRIM\(b\.Brand\)\)/);
  assert.match(up, /GoodGroupID = 1005[\s\S]*\) = 1;/, 'a line links only when exactly one good matches');
});

test('stops instead of merging duplicate lines, logs every row before changing it', () => {
  assert.match(up, /RAISERROR\(N'STOP 251/);
  const logLinked = up.indexOf("SELECT '251', 'LINKED'");
  const update = up.indexOf('UPDATE b SET b.GoodId = l.NewGoodId');
  const logRemoved = up.indexOf("SELECT '251', 'REMOVED'");
  const del = up.indexOf('DELETE b FROM wf.GiveawayBudget b');
  assert.ok(logLinked > 0 && logLinked < update, 'linked rows logged before the update');
  assert.ok(logRemoved > 0 && logRemoved < del, 'removed rows logged before the delete');
  assert.match(up, /INSERT wf\.ChangeEvent/);
  assert.doesNotMatch(up, /GiveawayWithdrawal\s+SET|DELETE[^;]*GiveawayWithdrawal/i, 'withdrawal history is not touched');
  assert.doesNotMatch(up, /\bCONCAT\s*\(/i, 'SQL Server 2008 compatibility 80');
});

test('a database without group-1005 goods is left alone and 250 is excluded', () => {
  assert.match(up, /IF NOT EXISTS \(SELECT 1 FROM dbo\.EMGood WHERE GoodGroupID = 1005\)[\s\S]*RETURN;/);
  assert.ok(up.indexOf('IF NOT EXISTS (SELECT 1 FROM dbo.EMGood WHERE GoodGroupID = 1005)') < up.indexOf('DECLARE @link'),
    'the guard runs before any change');
  assert.match(up, /Migration IN \('250', '251'\)/, 'a database that ran 250 is not cleaned twice');
  const policy = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'migration-policy.json'), 'utf8'));
  assert.ok(policy.excludedFiles.includes('250_giveaway_budget_only_1005.sql'));
});

test('rollback restores removed lines with their Id and unlinks linked lines', () => {
  assert.match(down, /SET IDENTITY_INSERT wf\.GiveawayBudget ON/);
  assert.match(down, /Kind = 'REMOVED'/);
  assert.match(down, /Kind = 'LINKED'[\s\S]*WHERE b\.GoodId = l\.NewGoodId/);
  assert.match(down, /DROP TABLE wf\.GiveawayBudgetCleanupLog/);
});
