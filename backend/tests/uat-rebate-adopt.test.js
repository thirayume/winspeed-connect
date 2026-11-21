'use strict';
// Owner, 21 Nov 2026: Rebate and every other function stay on in UAT after every nightly restore.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const sql = fs.readFileSync(path.join(root, 'docs', 'deploy', 'r740', 'sql', 'r740-uat-rebate-adopt.sql'), 'utf8').replace(/\r\n/g, '\n');
const ps = fs.readFileSync(path.join(root, 'docs', 'deploy', 'r740', 'host', 'Refresh-UAT.ps1'), 'utf8').replace(/\r\n/g, '\n');
const has = (text, part) => assert.ok(text.includes(part), part);
const BS = String.fromCharCode(92);

test('the relabel runs on the UAT copy only, in one transaction, with a checked UAT digest', () => {
  has(sql, "IF DB_NAME() <> 'dbwins_worldfert9_uat' OR @@SERVERNAME <> 'R740-SRV" + BS + "SQL2008'\n    RAISERROR('UAT_ADOPT_WRONG_DATABASE");
  has(sql, "LOWER('$(UatDigest)')");
  has(sql, "IF LEN(@digest) <> 64 OR @digest LIKE '%[^0-9a-f]%'");
  has(sql, 'SET XACT_ABORT ON');
  assert.equal(sql.split('\n').filter(l => l === 'BEGIN TRAN;').length, 1);
  assert.equal(sql.split('\n').filter(l => l === 'COMMIT TRAN;').length, 1);
  assert.ok(!sql.includes('dbo.'));
  assert.ok(!/\bDELETE\b/i.test(sql));
});

test('every table that carries the environment kind is relabelled, and the primary and digest follow UAT', () => {
  for (const t of ['RebateResetCoordinator', 'RebateResetParticipant', 'RebateResetBootstrap', 'RebateResetBootstrapTarget',
    'RebateResetAttempt', 'RebateResetAttemptTarget', 'RebateResetReceipt', 'RebateResetClaimCancellation',
    'RebateShipmentEvidence', 'RebateEvidenceDiscoveryCursor', 'RebateShipmentAccrual', 'RebateConversionApprovalRequest']) {
    const i = sql.indexOf(`UPDATE wf.${t} SET EnvironmentKind = 'uat'`);
    assert.ok(i >= 0, t);
    const stmt = sql.slice(i, sql.indexOf(';', i));
    assert.ok(stmt.includes("WHERE EnvironmentKind = 'production'"), t);
  }
  has(sql, "UPDATE wf.RebateResetCoordinator SET EnvironmentKind = 'uat', PrimaryDatabase = 'dbwins_worldfert9_uat', ManifestDigest = @digest");
  has(sql, "UPDATE wf.RebateResetParticipant SET EnvironmentKind = 'uat', ManifestDigest = @digest");
});

test('a copy already relabelled is left alone; both states at once is refused; the result is verified', () => {
  has(sql, "IF ISNULL(@prod, 0) > 0 AND ISNULL(@uat, 0) > 0\n    RAISERROR('UAT_ADOPT_BOTH_STATES");
  has(sql, "IF ISNULL(@prod, 0) = 0\nBEGIN\n    SELECT 'UAT_ADOPT_SKIPPED'");
  has(sql, "RAISERROR('UAT_ADOPT_VERIFY_FAILED'");
});

test('the accrual trigger and the two foreign keys are only suspended inside the transaction and come back checked', () => {
  has(sql, 'IF @accruals > 0 DISABLE TRIGGER wf.trg_RebateShipmentAccrual_Verified');
  has(sql, 'IF @accruals > 0 ENABLE TRIGGER wf.trg_RebateShipmentAccrual_Verified');
  has(sql, "RAISERROR('UAT_ADOPT_TRIGGER_LEFT_DISABLED'");
  for (const fk of ['FK_RebateResetAttemptTarget_Attempt', 'FK_RebateResetClaimCancellation_Receipt']) {
    has(sql, `NOCHECK CONSTRAINT ${fk}`);
    has(sql, `WITH CHECK CHECK CONSTRAINT ${fk}`);
  }
  for (const bad of ['CONCAT(', 'THROW', 'TRY_CAST', 'IIF(']) assert.ok(!sql.includes(bad), bad);
});

test('the nightly refresh keeps the UAT switches on, relabels after the deploy, and falls back to Rebate off', () => {
  assert.ok(!ps.includes('Rebate switches turned off for the restored copy'));
  has(ps, 'try { [void](Set-UatRebateSwitches $true) }');
  for (const k of ['REBATE_POOL_103_ENABLED', 'REBATE_CONVERSION_APPROVAL_ENABLED', 'REBATE_CONVERSION_ENABLED', 'REBATE_TICKET_PREVIEW_ENABLED',
    'REBATE_RESET_ADMIN_ENABLED', 'REBATE_RESET_FENCE_AUDIT_COMPLETE', 'REBATE_EVIDENCE_DISCOVERY_ENABLED']) has(ps, `${k} = $On`);
  has(ps, "'dbwins_worldfert9_uat:DISCOUNT'");
  has(ps, 'docker exec saleapp-uat-backend-1 node scripts/rebate-manifest-digest.js');
  has(ps, `'-v', "UatDigest=$digest"`);
  assert.ok(ps.indexOf('unattended deploy failed') < ps.indexOf("$adoptSql = Join-Path"), 'relabel runs after the deploy');
  has(ps, 'if (Set-UatRebateSwitches $false)');
  // only REBATE_* lines are rewritten; the file holds secrets
  has(ps, "$line -match '^(REBATE_[A-Z0-9_]+)=(.*)$' -and $want.Contains($Matches[1])");
});

test('the digest script prints the manifest digest and nothing else', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'rebate-manifest-digest.js'), 'utf8');
  has(js, 'digestTargets(resolvePhysicalResetTargets(process.env))');
  assert.ok(!js.includes("require('../db')"));
});
