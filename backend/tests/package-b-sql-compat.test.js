'use strict';

/**
 * package-b-sql-compat.test.js
 *
 * Package B Offline Test Suite for SQL 2008 R2 Compatibility.
 * 100% DB-free: ZERO database connections, ZERO pool creation.
 *
 * Validates:
 * 1. All 47 dialect overrides in backend/migrations/compat/sql2008/ exist and have ZERO SQL 2008 syntax issues.
 * 2. All 47 overrides match backend/migration-policy.json pinned original/executed hashes & batch counts.
 * 3. 074 remains excluded on local_uat and local_rehearsal across all policy contexts.
 * 4. D3 dbo index blocks are omitted in 002, 013, 044 while wf.* objects/indexes are strictly preserved.
 * 5. remote_b target profile uses standard migrations with ZERO dialect overrides.
 * 6. All 7 runtime route files have ZERO SQL 2008 incompatibilities (OFFSET/FETCH, CONCAT, TRY_CAST, THROW).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const { resolveEffectiveMigration, sha256, splitBatches } = require('../safety-validator');

const repoRoot = path.resolve(__dirname, '../..');
const backendDir = path.join(repoRoot, 'backend');
const migrationsDir = path.join(backendDir, 'migrations');
const compatDir = path.join(migrationsDir, 'compat', 'sql2008');
const policyPath = path.join(backendDir, 'migration-policy.json');

const INCOMPATIBLE_PATTERNS = [
  { name: 'CREATE_OR_ALTER', regex: /\bCREATE\s+OR\s+ALTER\s+(PROCEDURE|PROC|VIEW|FUNCTION|TRIGGER)\b/gi },
  { name: 'SQL_THROW', regex: /(?:^|[;\s])THROW(?:\s*;|\s+\d+|\s+@\w+)/gi },
  { name: 'TRY_CAST', regex: /\bTRY_CAST\s*\(/gi },
  { name: 'TRY_CONVERT', regex: /\bTRY_CONVERT\s*\(/gi },
  { name: 'OFFSET_FETCH', regex: /\bOFFSET\s+[^\r\n;]+FETCH\s+NEXT\b/gi },
  { name: 'SEQUENCE_NEXT_VAL', regex: /\bNEXT\s+VALUE\s+FOR\b/gi },
  { name: 'CREATE_SEQUENCE', regex: /\bCREATE\s+SEQUENCE\b/gi },
  { name: 'STRING_AGG', regex: /\bSTRING_AGG\s*\(/gi },
  { name: 'CONCAT_FUNC', regex: /\bCONCAT\s*\(/gi },
  { name: 'DROP_IF_EXISTS', regex: /\bDROP\s+(TABLE|VIEW|PROCEDURE|PROC|FUNCTION|TRIGGER|INDEX)\s+IF\s+EXISTS\b/gi },
];

test('Package B (Offline): Dialect overrides directory contains all 47 files with zero SQL 2008 incompatibilities', () => {
  assert.ok(fs.existsSync(compatDir), 'compatDir must exist');
  const files = fs.readdirSync(compatDir).filter(f => f.endsWith('.sql')).sort();
  assert.equal(files.length, 47, `Expected exactly 47 dialect overrides, found ${files.length}`);

  for (const f of files) {
    const filePath = path.join(compatDir, f);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);

    lines.forEach((line, idx) => {
      const cleanLine = line.replace(/--.*$/, '');
      for (const p of INCOMPATIBLE_PATTERNS) {
        p.regex.lastIndex = 0;
        const match = p.regex.test(cleanLine);
        assert.equal(
          match,
          false,
          `File ${f}:${idx + 1} contains incompatible pattern ${p.name}: "${line.trim()}"`
        );
      }
    });
  }
});

test('Package B (Offline): Migration policy pins all 47 overrides with exact hashes and batch counts', () => {
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  const overrides = policy.dialectOverrides || {};
  const overrideKeys = Object.keys(overrides).sort();

  assert.equal(overrideKeys.length, 47, 'Policy must declare exactly 47 dialect overrides');

  for (const fileName of overrideKeys) {
    const meta = overrides[fileName];
    assert.equal(meta.dialect, 'sql2008', `Dialect must be sql2008 for ${fileName}`);
    assert.equal(meta.executedFile, fileName, `Executed file name must match for ${fileName}`);

    // Check original file hash & batch count
    const origPath = path.join(migrationsDir, fileName);
    assert.ok(fs.existsSync(origPath), `Original file must exist: ${origPath}`);
    const origContent = fs.readFileSync(origPath, 'utf8');
    const actualOrigHash = sha256(origContent);
    const actualOrigBatches = splitBatches(origContent);

    assert.equal(actualOrigHash, meta.originalHash, `Original hash drift for ${fileName}`);
    assert.equal(actualOrigBatches.length, meta.originalBatchCount, `Original batch count mismatch for ${fileName}`);

    // Check executed file hash & batch count
    const execPath = path.join(compatDir, meta.executedFile);
    assert.ok(fs.existsSync(execPath), `Executed override must exist: ${execPath}`);
    const execContent = fs.readFileSync(execPath, 'utf8');
    const actualExecHash = sha256(execContent);
    const actualExecBatches = splitBatches(execContent);

    assert.equal(actualExecHash, meta.executedHash, `Executed hash drift for ${fileName}`);
    assert.equal(actualExecBatches.length, meta.executedBatchCount, `Executed batch count mismatch for ${fileName}`);
  }
});

test('Package B (Offline): Profile resolution parity — local_uat and local_rehearsal receive identical overrides, 074 excluded', () => {
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql') && !f.startsWith('uat_')).sort();

  for (const profile of ['local_uat', 'local_rehearsal']) {
    let overrideCount = 0;
    let excludedCount = 0;

    for (const f of files) {
      const content = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
      const res = resolveEffectiveMigration(f, content, profile, policy);

      if (f === '000_logins.sql' || f === '074_fix_winspeed_legacy_raiserror.sql') {
        assert.equal(res.status, 'EXCLUDED', `${f} must be excluded on ${profile}`);
        excludedCount++;
      } else if (policy.dialectOverrides[f]) {
        assert.equal(res.status, 'OVERRIDE', `${f} must resolve to OVERRIDE on ${profile}`);
        assert.equal(res.executed.fileName, f);
        overrideCount++;
      } else {
        assert.equal(res.status, 'STANDARD', `${f} must resolve to STANDARD on ${profile}`);
      }
    }

    assert.equal(overrideCount, 47, `Profile ${profile} must have 47 overrides`);
    assert.equal(excludedCount, 2, `Profile ${profile} must exclude exactly 2 files (000 and 074)`);
  }
});

test('Package B (Offline): remote_b profile strictly executes standard migrations without overrides', () => {
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql') && !f.startsWith('uat_')).sort();

  let overrideCount = 0;
  let standardCount = 0;

  for (const f of files) {
    const content = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
    const res = resolveEffectiveMigration(f, content, 'remote_b', policy);

    if (f === '000_logins.sql') {
      assert.equal(res.status, 'EXCLUDED');
    } else {
      assert.equal(res.status, 'STANDARD', `remote_b must use STANDARD migration for ${f}`);
      standardCount++;
    }
    if (res.status === 'OVERRIDE') overrideCount++;
  }

  assert.equal(overrideCount, 0, 'remote_b must never use dialect overrides');
  assert.equal(standardCount, files.length - 1, 'remote_b must resolve all standard migrations without overrides');
});

test('Package B (Offline): D3 dbo index blocks are omitted in 002, 013, 044 while wf objects are preserved', () => {
  // 1. Migration 002
  const c002 = fs.readFileSync(path.join(compatDir, '002_schema_v2_and_indexes.sql'), 'utf8');
  assert.ok(!c002.includes('IX_SOHD_ControlTicket'), '002 must omit IX_SOHD_ControlTicket');
  assert.ok(!c002.includes('IX_SOHD_DeliveryByRefNo'), '002 must omit IX_SOHD_DeliveryByRefNo');
  assert.ok(!c002.includes('IX_SODT_SOID_Qty'), '002 must omit IX_SODT_SOID_Qty');
  assert.ok(c002.includes('IX_SOLine_SoId_LineNum_RefCtrl'), '002 must retain wf.SalesOrderLine index');
  assert.ok(c002.includes('IX_RebateLedger_CustBalance'), '002 must retain wf.RebateLedger index');
  assert.ok(c002.includes('wf.SequenceCounter'), '002 must retain QuoteRefSeq counter row initialization');

  // 2. Migration 013
  const c013 = fs.readFileSync(path.join(compatDir, '013_comprehensive_indexes.sql'), 'utf8');
  assert.ok(!c013.includes('IX_EMSetPrice_HeaderLookup'), '013 must omit dbo.EMSetPriceDT index');
  assert.ok(!c013.includes('IX_EMCust_CustName'), '013 must omit dbo.EMCust index');
  assert.ok(!c013.includes('IX_SOHD_CustId_DocuType'), '013 must omit dbo.SOHD index');
  assert.ok(c013.includes('IX_AppUser_Role_Active'), '013 must retain wf.AppUser index');
  assert.ok(c013.includes('IX_RebateClaim_PoolId'), '013 must retain wf.RebateClaim index');
  assert.ok(c013.includes('IX_RebatePool_Period'), '013 must retain wf.RebatePool index');

  // 3. Migration 044
  const c044 = fs.readFileSync(path.join(compatDir, '044_winspeed_native_quotation_link.sql'), 'utf8');
  assert.ok(!c044.includes('CREATE NONCLUSTERED INDEX IX_SOHD_Quotation_DocuNo'), '044 must omit dbo.SOHD index');
  assert.ok(!c044.includes('CREATE NONCLUSTERED INDEX IX_SOHD_ConfirmQuotation_RefNo'), '044 must omit dbo.SOHD confirm index');
  assert.ok(c044.includes('UX_Quotation_WinspeedQuoteSOID'), '044 must retain wf.Quotation index');
  assert.ok(c044.includes('WinspeedQuoteSOID'), '044 must retain wf.Quotation columns');
});

test('Package B (Offline): All 7 runtime route files have zero SQL 2008 syntax incompatibilities', () => {
  const targetRoutes = [
    'edit-requests.js',
    'master.js',
    'quotation.js',
    'rebate.js',
    'reports.js',
    'so.js',
    'trips.js',
  ];

  for (const rFile of targetRoutes) {
    const routePath = path.join(backendDir, 'routes', rFile);
    assert.ok(fs.existsSync(routePath), `Route file must exist: ${rFile}`);
    const content = fs.readFileSync(routePath, 'utf8');

    // Extract SQL literals (including locks, errors, and batches)
    const regex = /`([\s\S]*?)`|'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const str = match[1] || match[2] || match[3] || '';
      if (/\b(SELECT|INSERT|UPDATE|DELETE|EXEC|WITH|MERGE|sp_getapplock|RAISERROR|THROW)\b/i.test(str)) {
        for (const p of INCOMPATIBLE_PATTERNS) {
          p.regex.lastIndex = 0;
          const hasIncompat = p.regex.test(str);
          assert.equal(
            hasIncompat,
            false,
            `Runtime route ${rFile} contains ${p.name} in query: "${str.substring(0, 80)}..."`
          );
        }
      }
    }
  }
});

test('Package B (Offline): BR2-02 Zero SQL THROW in runtime routes and negative fixture validation', () => {
  const throwRegex = /(?:^|[;\s])THROW(?:\s*;|\s+\d+|\s+@\w+)/i;

  // 1. Negative fixture verification: scanner MUST detect THROW when present
  const negativeFixtureSO = `
    DECLARE @res INT;
    EXEC @res = sp_getapplock @Resource = @rname, @LockMode = 'Exclusive', @LockOwner = 'Session', @LockTimeout = 10000;
    IF @res < 0 THROW 50002, 'Unable to acquire lock for SO confirmation', 1;
  `;
  const negativeFixtureRebate = `
    DECLARE @lockRes INT;
    EXEC @lockRes = sp_getapplock @Resource = @rname, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 5000;
    IF @lockRes < 0
    BEGIN
      THROW 50001, 'Unable to acquire lock on rebate claim for decision (timeout/conflict)', 1;
    END;
  `;

  assert.ok(throwRegex.test(negativeFixtureSO), 'Scanner must detect THROW 50002 in negative fixture');
  assert.ok(throwRegex.test(negativeFixtureRebate), 'Scanner must detect THROW 50001 in negative fixture');

  // 2. Verified absence in actual source files:
  const soContent = fs.readFileSync(path.join(backendDir, 'routes', 'so.js'), 'utf8');
  assert.ok(!soContent.includes('THROW 50002'), 'so.js must not contain THROW 50002');
  assert.ok(soContent.includes('lockConfirmationResource'), 'SO route must use transaction-owned shared lock helper');
  const lockContent = fs.readFileSync(path.join(backendDir,'services','confirmation-lock.js'),'utf8');
  assert.ok(!throwRegex.test(lockContent), 'lock helper must be SQL2008 compatible');
  assert.ok(lockContent.includes('[ERR:50002] Unable to acquire lock for SO confirmation'), 'lock helper retains numbered RAISERROR');

  const rebateContent = fs.readFileSync(path.join(backendDir, 'routes', 'rebate.js'), 'utf8');
  assert.ok(!rebateContent.includes('THROW 50001'), 'rebate.js must not contain THROW 50001');
  assert.ok(rebateContent.includes('[ERR:50001] Unable to acquire lock on rebate claim'), 'rebate.js must use RAISERROR [ERR:50001]');
});

test('Package B (Offline): Target policy wiring supports local_uat and local_rehearsal without silent fallback', () => {
  const { VALID_TARGETS, validateTarget, requestTarget } = require('../db-target-policy');
  assert.ok(VALID_TARGETS.includes('local_uat'), 'VALID_TARGETS must include local_uat');
  assert.ok(VALID_TARGETS.includes('local_rehearsal'), 'VALID_TARGETS must include local_rehearsal');

  assert.equal(validateTarget('local_uat'), 'local_uat');
  assert.equal(validateTarget('LOCAL_REHEARSAL'), 'local_rehearsal');

  // Rejects invalid targets
  assert.throws(() => validateTarget('invalid_target'), /Unsupported DB target/);
  assert.throws(() => validateTarget('production'), /Unsupported DB target/);

  // Switching blocked in production
  assert.throws(() => requestTarget('local_uat', 'remote_b', true), /Database switching is disabled in production/);
});

test('Package B (Offline): B-02 allocateWorkflowRef derived-table structure is intact', () => {
  const soRoutePath = path.join(backendDir, 'services', 'draft-confirmation.js');
  const soContent = fs.readFileSync(soRoutePath, 'utf8');

  // Verify FROM ( clause is present between SELECT ISNULL(MAX(RefSuffix), 0) and derived SELECT
  assert.ok(
    /SELECT ISNULL\(MAX\(RefSuffix\), 0\) AS MaxSuffix\s+FROM \(\s+SELECT CASE/m.test(soContent),
    'allocateWorkflowRef query must contain FROM ( after MAX(RefSuffix)'
  );
  assert.ok(
    /\) refs\s+WHERE RefSuffix IS NOT NULL/m.test(soContent),
    'allocateWorkflowRef query must close derived table with ) refs WHERE RefSuffix IS NOT NULL'
  );
});

test('Package B (Offline): B-01 Rehearsal scripts pass plan: true and profile to runner', async () => {
  const result = await require('../scripts/rehearsal-migration-lifecycle.cjs').main({ mode: 'mock', step: 'plan' });
  assert.equal(result.report.plan, true);
  assert.equal(result.report.activeProfile, 'local_rehearsal');

  const regressionScript = fs.readFileSync(path.join(backendDir, 'scripts', 'rehearsal-sql2022-regression.cjs'), 'utf8');
  assert.ok(
    regressionScript.includes("plan: true") && regressionScript.includes("profile: 'remote_b'"),
    'rehearsal-sql2022-regression.cjs must pass plan: true and profile: remote_b'
  );
});

test('Package B (Offline): BR2-01 Local connection security fails closed without implicit Windows auth and isolates driver', () => {
  const { CONFIG_BY_TARGET, parseConnectionString, validateLocalConnectionString } = require('../db');

  // 1. Connection sentinel: verify that CONFIG_BY_TARGET functions are pure configuration builders
  const savedUatPwd = process.env.LOCAL_UAT_PASSWORD;
  const savedRehearsalPwd = process.env.LOCAL_REHEARSAL_PASSWORD;
  const savedUatConn = process.env.LOCAL_UAT_CONNECTION_STRING;
  const savedRehearsalConn = process.env.LOCAL_REHEARSAL_CONNECTION_STRING;

  try {
    delete process.env.LOCAL_UAT_PASSWORD;
    delete process.env.LOCAL_REHEARSAL_PASSWORD;
    delete process.env.LOCAL_UAT_CONNECTION_STRING;
    delete process.env.LOCAL_REHEARSAL_CONNECTION_STRING;

    // Must fail closed with SECURITY_ERROR when password is missing (no fallback to Windows auth)
    assert.throws(
      () => CONFIG_BY_TARGET.local_uat(),
      /SECURITY_ERROR.*implicit Windows authentication fallback is prohibited/
    );

    assert.throws(
      () => CONFIG_BY_TARGET.local_rehearsal(),
      /SECURITY_ERROR.*implicit Windows authentication fallback is prohibited/
    );

    // 2. Connection string parser and validator: reject duplicate/contradictory keys
    assert.throws(
      () => parseConnectionString('Server=localhost\\v2008r2;Database=dbwins_worldfert9_local_uat;Database=dbwins_worldfert9;Uid=wf_uat_app;Pwd=secret;'),
      /SECURITY_ERROR: Duplicate connection string parameters are prohibited: database/
    );

    // 3. Reject Windows authentication / SSPI in connection string
    assert.throws(
      () => validateLocalConnectionString('Server=AMYOU-YOGA7\\V2008R2;Database=dbwins_worldfert9_local_uat;Uid=wf_uat_app;Pwd=secret;Trusted_Connection=Yes;', 'local_uat'),
      /SECURITY_ERROR.*cannot use Windows authentication/
    );

    assert.throws(
      () => validateLocalConnectionString('Server=AMYOU-YOGA7\\V2008R2;Database=dbwins_worldfert9_local_uat;Uid=wf_uat_app;Pwd=secret;Integrated Security=SSPI;', 'local_uat'),
      /SECURITY_ERROR.*cannot use Windows authentication/
    );

    // 4. Reject wrong database name
    assert.throws(
      () => validateLocalConnectionString('Server=AMYOU-YOGA7\\V2008R2;Database=dbwins_worldfert9;Uid=wf_uat_app;Pwd=secret;', 'local_uat'),
      /SECURITY_ERROR.*must target database "dbwins_worldfert9_local_uat"/
    );

    // 5. Reject wrong principal
    assert.throws(
      () => validateLocalConnectionString('Server=AMYOU-YOGA7\\V2008R2;Database=dbwins_worldfert9_local_uat;Uid=sa;Pwd=secret;', 'local_uat'),
      /SECURITY_ERROR.*must use principal "wf_uat_app"/
    );

    // 6. Valid connection string passes
    assert.doesNotThrow(() => {
      validateLocalConnectionString('Server=AMYOU-YOGA7\\V2008R2;Database=dbwins_worldfert9_local_uat;Uid=wf_uat_app;Pwd=secret;', 'local_uat');
    });

  } finally {
    if (savedUatPwd !== undefined) process.env.LOCAL_UAT_PASSWORD = savedUatPwd;
    if (savedRehearsalPwd !== undefined) process.env.LOCAL_REHEARSAL_PASSWORD = savedRehearsalPwd;
    if (savedUatConn !== undefined) process.env.LOCAL_UAT_CONNECTION_STRING = savedUatConn;
    if (savedRehearsalConn !== undefined) process.env.LOCAL_REHEARSAL_CONNECTION_STRING = savedRehearsalConn;
  }
});




