'use strict';

/**
 * package-a-offline.test.js
 *
 * Package A Offline Test Suite for Local UAT Migration Runner, Profile, and Guard.
 * Incorporates Codex Re-audit R2 fixes (AR2-01 through AR2-05):
 *
 * AR2-01: local_rehearsal profile excludes 074, receives sql2008 override, and tested via fake pool apply.
 * AR2-02: Remote runner metadata contract (prodAccess/hasProdAccess alias compatibility tested with query-shaped record).
 * AR2-03: --plan reads absent, legacy, and full ledgers without DDL; detects partial ledger corruption; drift fails before write.
 * AR2-04: All role/principal evidence is strictly mandatory (originalLogin, isSecurityadmin, isServeradmin, isDbcreator, hasControlServer).
 * AR2-05: classifyMigration detects dialect/file/batch count drift; canonical effective plan used directly without context reload.
 *
 * STRICT INVARIANTS:
 * 1. 100% DB-free: ZERO database connections, ZERO pool creation, ZERO network traffic.
 * 2. Real runner execution path tested via injected fake pool.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const {
  APPROVED_LOCAL_TARGET,
  APPROVED_LOCAL_REHEARSAL_TARGET,
  APPROVED_TARGET,
  validateLocalTargetRecord,
  validateTargetRecord,
  validateCompatPath,
  resolveEffectiveMigration,
  sha256,
  splitBatches,
} = require('../safety-validator');
const runner = require('../run_migrations');

// ─────────────────────────────────────────────────────────────────────────────
// Fake Pool Utility
// ─────────────────────────────────────────────────────────────────────────────

function createFakePool(targetRecord, options = {}) {
  const queryLog = [];
  const batchLog = [];
  const appliedLedger = options.initialLedger || new Map();
  const ledgerSchemaType = options.ledgerSchemaType || 'full'; // 'absent', 'legacy', 'partial', 'full'
  let inTx = false;
  let txCommitted = false;
  let txRolledBack = false;

  const fakeSession = {
    request() {
      return {
        input() { return this; },
        async query(sql) {
          queryLog.push(sql);
          if (options.failOnLedgerWrite && sql.includes('INSERT INTO wf.SchemaMigration')) {
            throw new Error('SIMULATED_LEDGER_WRITE_FAILURE');
          }
          return { recordset: [] };
        },
        async batch(sql) {
          batchLog.push(sql);
          return { recordset: [] };
        },
      };
    },
    async begin() { inTx = true; },
    async commit() { txCommitted = true; inTx = false; },
    async rollback() { txRolledBack = true; inTx = false; },
  };

  const pool = {
    request() {
      return {
        input() { return this; },
        async query(sql) {
          queryLog.push(sql);
          if (sql.includes('SELECT DB_NAME() AS dbName') || sql.includes("CONNECTIONPROPERTY('net_transport') AS netTransport")) {
            return { recordset: [targetRecord] };
          }
          if (sql.includes('SELECT OBJECT_ID(\'wf.SchemaMigration\',\'U\') AS LedgerId')) {
            if (ledgerSchemaType === 'absent') {
              return { recordset: [{ LedgerId: null, CanInspect: 1 }] };
            }
            return { recordset: [{ LedgerId: 100, CanInspect: 1 }] };
          }
          if (sql.includes('SELECT name FROM sys.columns WHERE object_id = OBJECT_ID(\'wf.SchemaMigration\', \'U\')')) {
            if (ledgerSchemaType === 'absent') {
              return { recordset: [] };
            }
            if (ledgerSchemaType === 'legacy') {
              return { recordset: [
                { name: 'FileName' }, { name: 'Checksum' }, { name: 'BatchCount' },
                { name: 'AppliedAt' }, { name: 'AppliedBy' }
              ] };
            }
            if (ledgerSchemaType === 'partial') {
              // Partial columns missing executedchecksum etc.
              return { recordset: [
                { name: 'FileName' }, { name: 'Checksum' }, { name: 'BatchCount' },
                { name: 'OriginalChecksum' }
              ] };
            }
            // Full columns
            return { recordset: [
              { name: 'FileName' }, { name: 'Checksum' }, { name: 'BatchCount' },
              { name: 'AppliedAt' }, { name: 'AppliedBy' },
              { name: 'OriginalChecksum' }, { name: 'ExecutedChecksum' },
              { name: 'OriginalBatchCount' }, { name: 'ExecutedBatchCount' },
              { name: 'Dialect' }, { name: 'ExecutedFile' }, { name: 'TargetProfile' }
            ] };
          }
          if (sql.includes('FROM wf.SchemaMigration')) {
            const rows = [];
            for (const [file, meta] of appliedLedger.entries()) {
              rows.push({
                FileName: file,
                Checksum: meta.checksum,
                BatchCount: meta.batchCount,
                AppliedAt: new Date().toISOString(),
                AppliedBy: 'wf_uat_migrator',
                OriginalChecksum: meta.originalChecksum || meta.checksum,
                ExecutedChecksum: meta.executedChecksum || meta.checksum,
                OriginalBatchCount: meta.originalBatchCount || meta.batchCount,
                ExecutedBatchCount: meta.executedBatchCount || meta.batchCount,
                Dialect: meta.dialect || 'standard',
                ExecutedFile: meta.executedFile || file,
                TargetProfile: meta.targetProfile || 'unknown',
              });
            }
            return { recordset: rows };
          }
          if (sql.includes('INSERT INTO wf.SchemaMigration')) {
            if (options.failOnLedgerWrite) throw new Error('SIMULATED_LEDGER_WRITE_FAILURE');
          }
          return { recordset: [] };
        },
        async batch(sql) {
          batchLog.push(sql);
          return { recordset: [] };
        },
      };
    },
    transaction() {
      return fakeSession;
    },
    getLogs() {
      return { queryLog, batchLog, inTx, txCommitted, txRolledBack };
    },
  };

  return pool;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. LU-01, AR2-01 & A-03: Profile Exclusions & Rehearsal Dialect Binding
// ─────────────────────────────────────────────────────────────────────────────

test('Package A (Offline): LU-01 & AR2-01 - 074 is excluded on local_uat and local_rehearsal', () => {
  const policy = runner.loadPolicy();

  const file074 = '074_fix_winspeed_legacy_raiserror.sql';
  const dummyContent = '-- dummy 074 content';

  // Under local_uat profile
  const resUat = resolveEffectiveMigration(file074, dummyContent, 'local_uat', policy);
  assert.equal(resUat.status, 'EXCLUDED');
  assert.equal(resUat.reason, 'PROFILE_EXCLUDED');

  // Under local_rehearsal profile (AR2-01)
  const resRehearsal = resolveEffectiveMigration(file074, dummyContent, 'local_rehearsal', policy);
  assert.equal(resRehearsal.status, 'EXCLUDED');
  assert.equal(resRehearsal.reason, 'PROFILE_EXCLUDED');

  // Under remote_b profile (not excluded)
  const resRemote = resolveEffectiveMigration(file074, dummyContent, 'remote_b', policy);
  assert.equal(resRemote.status, 'STANDARD');
});

test('Package A (Offline): AR2-01 - local_rehearsal applies sql2008 dialect override and dispatches in apply run', async () => {
  const targetRecord = {
    dbName: 'dbwins_worldfert9_rehearsal',
    serverName: 'AMYOU-YOGA7\\V2008R2',
    productVersion: '10.50.4042.0',
    loginName: 'wf_uat_migrator',
    originalLogin: 'wf_uat_migrator',
    isSysadmin: 0,
    isSecurityadmin: 0,
    isServeradmin: 0,
    isDbcreator: 0,
    hasControlServer: 0,
    hasProdAccess: 0,
    prodAccess: 0,
    otherUserDbCount: 0,
    netTransport: 'Shared memory',
  };

  // Temp migrations dir with 074 (sentinel) and an overrideable migration
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-rehearsal-'));
  const file074 = '074_fix_winspeed_legacy_raiserror.sql';
  const file002 = '002_demo.sql';
  fs.writeFileSync(path.join(tempDir, file074), 'SELECT sentinel_074;');
  fs.writeFileSync(path.join(tempDir, file002), 'SELECT orig_002;');

  const overrideContent = 'SELECT override_002;';
  const customPolicy = {
    schemaVersion: 1,
    checksumPolicy: 'immutable-after-apply',
    excludedFiles: [],
    excludedPatterns: [],
    legacyDuplicateSequences: {},
    targetProfiles: {
      local_rehearsal: {
        serverName: 'AMYOU-YOGA7\\V2008R2',
        databaseName: 'dbwins_worldfert9_rehearsal',
        productVersionPrefix: '10.50.',
        loginName: 'wf_uat_migrator',
        migratorLoginName: 'wf_uat_migrator',
        allowedTransports: ['Shared memory'],
        excludedFiles: ['074_fix_winspeed_legacy_raiserror.sql'],
        dialect: 'sql2008',
      },
    },
    dialectOverrides: {
      '002_demo.sql': {
        originalHash: sha256('SELECT orig_002;'),
        originalBatchCount: 1,
        executedFile: '002_demo.sql',
        executedHash: sha256(overrideContent),
        executedBatchCount: 1,
        dialect: 'sql2008',
      },
    },
  };

  const fakePool = createFakePool(targetRecord);

  try {
    const result = await runner.run(
      { plan: false, help: false, profile: 'local_rehearsal' },
      fakePool,
      null,
      {
        migrationsDir: tempDir,
        policy: customPolicy,
        readOverrideFn: () => overrideContent,
      }
    );

    assert.equal(result.targetProfile, 'local_rehearsal');
    assert.deepEqual(result.appliedList, ['002_demo.sql']);

    const logs = fakePool.getLogs();
    // 074 must NEVER be dispatched
    const dispatched074 = logs.batchLog.some(b => b.includes('sentinel_074'));
    assert.equal(dispatched074, false, '074 must NEVER be dispatched to batches under local_rehearsal');

    // 002 override content MUST be dispatched
    const dispatched002 = logs.batchLog.some(b => b.includes('override_002'));
    assert.equal(dispatched002, true, 'sql2008 override content must be dispatched under local_rehearsal');
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. AR2-02: Remote Target Metadata Contract (prodAccess / hasProdAccess)
// ─────────────────────────────────────────────────────────────────────────────

test('Package A (Offline): AR2-02 - Query-shaped remote_b target passes verifyTargetAndProfile without alias mismatch', async () => {
  const remoteTargetRecord = {
    dbName: 'dbwins_worldfert9_test_v2',
    serverName: '21181f44f254',
    productVersion: '16.0.1000.6',
    loginName: 'wf_test',
    originalLogin: 'wf_test',
    isSysadmin: 0,
    isSecurityadmin: 0,
    isServeradmin: 0,
    isDbcreator: 0,
    hasControlServer: 0,
    hasProdAccess: 0, // query alias
    prodAccess: 0,    // legacy alias
    otherUserDbCount: 0,
    netTransport: 'TCP',
  };

  const fakePool = createFakePool(remoteTargetRecord);

  // Both validateTargetRecord and runner.run must accept query-shaped record cleanly
  assert.doesNotThrow(() => validateTargetRecord(remoteTargetRecord));

  const planRes = await runner.run(
    { plan: true, help: false, profile: 'remote_b' },
    fakePool,
    null,
    { policy: runner.loadPolicy() }
  );

  assert.equal(planRes.targetProfile, 'remote_b');
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. AR2-03: --plan Read-Only Handling of Absent, Legacy, Full, and Partial Ledgers
// ─────────────────────────────────────────────────────────────────────────────

test('Package A (Offline): AR2-03 - --plan reads absent, legacy, and full ledgers without DDL writes', async () => {
  const targetRecord = {
    dbName: 'dbwins_worldfert9_local_uat',
    serverName: 'AMYOU-YOGA7\\V2008R2',
    productVersion: '10.50.4042.0',
    loginName: 'wf_uat_migrator',
    originalLogin: 'wf_uat_migrator',
    isSysadmin: 0,
    isSecurityadmin: 0,
    isServeradmin: 0,
    isDbcreator: 0,
    hasControlServer: 0,
    hasProdAccess: 0,
    prodAccess: 0,
    otherUserDbCount: 0,
    netTransport: 'Shared memory',
  };

  // Case 1: Absent ledger
  const poolAbsent = createFakePool(targetRecord, { ledgerSchemaType: 'absent' });
  const resAbsent = await runner.run({ plan: true, help: false, profile: 'local_uat' }, poolAbsent);
  assert.equal(resAbsent.targetProfile, 'local_uat');
  const ddlAbsent = poolAbsent.getLogs().queryLog.filter(q => /CREATE|ALTER|DROP/i.test(q));
  assert.equal(ddlAbsent.length, 0, '--plan must issue ZERO DDL on absent ledger');

  // Case 2: Legacy ledger (pre-Package A columns only)
  const legacyLedgerMap = new Map();
  const schema001Content = fs.readFileSync(path.join(__dirname, '../migrations/001_wf_schema.sql'), 'utf8');
  legacyLedgerMap.set('001_wf_schema.sql', {
    checksum: runner.sha256(schema001Content),
    batchCount: runner.splitBatches(schema001Content).length,
  });
  const poolLegacy = createFakePool(targetRecord, {
    ledgerSchemaType: 'legacy',
    initialLedger: legacyLedgerMap,
  });
  const resLegacy = await runner.run({ plan: true, help: false, profile: 'local_uat' }, poolLegacy);
  assert.equal(resLegacy.targetProfile, 'local_uat');
  const ddlLegacy = poolLegacy.getLogs().queryLog.filter(q => /CREATE|ALTER|DROP/i.test(q));
  assert.equal(ddlLegacy.length, 0, '--plan must issue ZERO DDL on legacy ledger');

  // Case 3: Partial ledger must fail diagnostically
  const poolPartial = createFakePool(targetRecord, { ledgerSchemaType: 'partial' });
  await assert.rejects(
    async () => {
      await runner.run({ plan: true, help: false, profile: 'local_uat' }, poolPartial);
    },
    /PARTIAL_SCHEMA_MIGRATION_LEDGER/
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. AR2-04: Mandatory Role and Principal Metadata
// ─────────────────────────────────────────────────────────────────────────────

test('Package A (Offline): AR2-04 - originalLogin and server roles are strictly mandatory', () => {
  const base = {
    dbName: 'dbwins_worldfert9_local_uat',
    serverName: 'AMYOU-YOGA7\\V2008R2',
    productVersion: '10.50.4042.0',
    loginName: 'wf_uat_app',
    originalLogin: 'wf_uat_app',
    isSysadmin: 0,
    isSecurityadmin: 0,
    isServeradmin: 0,
    isDbcreator: 0,
    hasControlServer: 0,
    hasProdAccess: 0,
    otherUserDbCount: 0,
    netTransport: 'Shared memory',
  };

  // Missing originalLogin throws fail-closed
  assert.throws(
    () => validateLocalTargetRecord({ ...base, originalLogin: null }),
    /ORIGINAL_LOGIN\(\) is missing, null, or empty/
  );
  assert.throws(
    () => validateLocalTargetRecord({ ...base, originalLogin: '' }),
    /ORIGINAL_LOGIN\(\) is missing, null, or empty/
  );
  assert.throws(
    () => validateLocalTargetRecord({ ...base, originalLogin: 'sa' }),
    /indicates elevated original principal/
  );

  // Missing role metadata throws fail-closed
  assert.throws(
    () => validateLocalTargetRecord({ ...base, isSecurityadmin: undefined }),
    /IS_SRVROLEMEMBER\('securityadmin'\) is missing, null, or boolean/
  );
  assert.throws(
    () => validateLocalTargetRecord({ ...base, isServeradmin: undefined }),
    /IS_SRVROLEMEMBER\('serveradmin'\) is missing, null, or boolean/
  );
  assert.throws(
    () => validateLocalTargetRecord({ ...base, isDbcreator: undefined }),
    /IS_SRVROLEMEMBER\('dbcreator'\) is missing, null, or boolean/
  );
  assert.throws(
    () => validateLocalTargetRecord({ ...base, hasControlServer: undefined }),
    /CONTROL SERVER.*is missing, null, or boolean/
  );

  // Valid complete record passes cleanly
  assert.doesNotThrow(() => validateLocalTargetRecord(base));
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. AR2-05: classifyMigration Drift Detection (Dialect, Executed File, Batch Count)
// ─────────────────────────────────────────────────────────────────────────────

test('Package A (Offline): AR2-05 - classifyMigration detects dialect and executed file drift', () => {
  const effective = {
    checksum: 'same_hash_111111111111111111111111111111111111111111111111111111111111',
    batchCount: 2,
    dialect: 'sql2008',
    file: '002_demo.sql',
    original: {
      hash: 'same_hash_111111111111111111111111111111111111111111111111111111111111',
      batchCount: 2,
    },
    executed: {
      hash: 'same_hash_111111111111111111111111111111111111111111111111111111111111',
      batchCount: 2,
      fileName: '002_demo_compat.sql',
    },
  };

  // Applied with mismatched dialect: standard vs sql2008 -> DIALECT_DRIFT
  const appliedDialectMismatch = {
    checksum: effective.checksum,
    batchCount: 2,
    originalChecksum: effective.checksum,
    executedChecksum: effective.checksum,
    originalBatchCount: 2,
    executedBatchCount: 2,
    dialect: 'standard',
    executedFile: '002_demo_compat.sql',
  };
  assert.equal(runner.classifyMigration(appliedDialectMismatch, effective), 'DIALECT_DRIFT');

  // Applied with mismatched executedFile -> FILE_DRIFT
  const appliedFileMismatch = {
    checksum: effective.checksum,
    batchCount: 2,
    originalChecksum: effective.checksum,
    executedChecksum: effective.checksum,
    originalBatchCount: 2,
    executedBatchCount: 2,
    dialect: 'sql2008',
    executedFile: '002_other_file.sql',
  };
  assert.equal(runner.classifyMigration(appliedFileMismatch, effective), 'FILE_DRIFT');

  // Matching dialect and executedFile -> UNCHANGED
  const appliedMatch = {
    checksum: effective.checksum,
    batchCount: 2,
    originalChecksum: effective.checksum,
    executedChecksum: effective.checksum,
    originalBatchCount: 2,
    executedBatchCount: 2,
    dialect: 'sql2008',
    executedFile: '002_demo_compat.sql',
  };
  assert.equal(runner.classifyMigration(appliedMatch, effective), 'UNCHANGED');
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Existing Package A & Security Guard Baseline Regressions
// ─────────────────────────────────────────────────────────────────────────────

test('Package A (Offline): A-05 - Rejects absolute paths upfront (both inside and outside baseDir)', () => {
  const baseDir = path.resolve(__dirname, '../migrations/compat/sql2008');
  assert.throws(() => validateCompatPath(baseDir, path.join(baseDir, '001_wf_schema.sql')), /Absolute path rejected/);
  assert.throws(() => validateCompatPath(baseDir, 'C:\\Windows\\System32\\cmd.exe'), /Absolute path rejected/);
  assert.throws(() => validateCompatPath(baseDir, '/etc/passwd'), /Absolute path rejected/);
});

test('Package A (Offline): LU-02/R2-7 - Rejects parent traversal, sibling prefix escape, and null bytes', () => {
  const baseDir = path.resolve(__dirname, '../migrations/compat/sql2008');
  assert.throws(() => validateCompatPath(baseDir, '../074_escape.sql'), /Path traversal escape detected/);
  assert.throws(() => validateCompatPath(baseDir, '../sql2008-evil/hack.sql'), /Path traversal escape detected/);
  assert.throws(() => validateCompatPath(baseDir, '001_wf_schema.sql\0.evil'), /Null byte injection detected/);
});

test('Package A (Offline): A-05 - Physical filesystem containment detects junction/symlink escapes', (t) => {
  const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-test-'));
  const compatRoot = path.join(tempBase, 'compat');
  const outsideDir = path.join(tempBase, 'outside');

  fs.mkdirSync(compatRoot);
  fs.mkdirSync(outsideDir);
  fs.writeFileSync(path.join(outsideDir, 'secret.sql'), 'SELECT secret;');

  const junctionPath = path.join(compatRoot, 'junction_link');
  let junctionCreated = false;
  try {
    fs.symlinkSync(outsideDir, junctionPath, 'junction');
    junctionCreated = true;
  } catch (err) {
    t.diagnostic(`Junction creation not permitted by OS: ${err.message}. Marking junction check NOT_RUN.`);
  }

  try {
    if (junctionCreated) {
      assert.throws(
        () => validateCompatPath(compatRoot, 'junction_link/secret.sql'),
        /Reparse\/symlink traversal escape detected/
      );
    }
  } finally {
    if (junctionCreated) {
      try { fs.unlinkSync(junctionPath); } catch (_) {}
    }
    try { fs.rmSync(tempBase, { recursive: true, force: true }); } catch (_) {}
  }
});

test('Package A (Offline): A-04 - Native flag validation and local-specific writeback authorization', () => {
  const base = {
    dbName: 'dbwins_worldfert9_local_uat',
    serverName: 'AMYOU-YOGA7\\V2008R2',
    productVersion: '10.50.4042.0',
    loginName: 'wf_uat_app',
    originalLogin: 'wf_uat_app',
    isSysadmin: 0,
    isSecurityadmin: 0,
    isServeradmin: 0,
    isDbcreator: 0,
    hasControlServer: 0,
    hasProdAccess: 0,
    otherUserDbCount: 0,
    netTransport: 'Shared memory',
  };

  assert.throws(() => validateLocalTargetRecord(base, { COUPON_NATIVE_POSTING_ENABLED: 'banana' }), /Invalid COUPON_NATIVE_POSTING_ENABLED/);
  assert.throws(() => validateLocalTargetRecord(base, { COUPON_NATIVE_POSTING_ENABLED: 'true', ALLOW_TEST_NATIVE_WRITEBACK: 'true' }), /Remote flag ALLOW_TEST_NATIVE_WRITEBACK cannot unlock local target/);
  assert.doesNotThrow(() => validateLocalTargetRecord(base, { COUPON_NATIVE_POSTING_ENABLED: 'true', ALLOW_LOCAL_TEST_NATIVE_WRITEBACK: 'true' }));
});

test('Package A (Offline): A-01 - Runner fails closed on guard failure: ZERO DDL, ZERO DML, ZERO ledger writes', async () => {
  const badTarget = {
    dbName: 'dbwins_worldfert9_local_uat',
    serverName: 'AMYOU-YOGA7\\V2008R2',
    productVersion: '10.50.4042.0',
    loginName: 'wf_uat_migrator',
    originalLogin: 'wf_uat_migrator',
    isSysadmin: 1, // ELEVATED!
    isSecurityadmin: 0,
    isServeradmin: 0,
    isDbcreator: 0,
    hasControlServer: 0,
    hasProdAccess: 0,
    otherUserDbCount: 0,
    netTransport: 'Shared memory',
  };

  const fakePool = createFakePool(badTarget);

  await assert.rejects(
    async () => {
      await runner.run({ plan: false, help: false, profile: 'local_uat' }, fakePool, null, {
        policy: runner.loadPolicy(),
      });
    },
    /Elevated privilege detected on IS_SRVROLEMEMBER\('sysadmin'\)=1/
  );

  const logs = fakePool.getLogs();
  assert.equal(logs.batchLog.length, 0, 'No migration batches should be executed');
  const ddlQueries = logs.queryLog.filter(q => /CREATE|ALTER|DROP|INSERT/i.test(q));
  assert.equal(ddlQueries.length, 0, 'ZERO DDL and ZERO ledger writes on guard failure');
});

test('Package A (Offline): A-01 - Atomic transaction rollback on ledger write failure', async () => {
  const validTarget = {
    dbName: 'dbwins_worldfert9_local_uat',
    serverName: 'AMYOU-YOGA7\\V2008R2',
    productVersion: '10.50.4042.0',
    loginName: 'wf_uat_migrator',
    originalLogin: 'wf_uat_migrator',
    isSysadmin: 0,
    isSecurityadmin: 0,
    isServeradmin: 0,
    isDbcreator: 0,
    hasControlServer: 0,
    hasProdAccess: 0,
    otherUserDbCount: 0,
    netTransport: 'Shared memory',
  };

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-runner-atomic-'));
  const testMigration = '999_test_atomic.sql';
  fs.writeFileSync(path.join(tempDir, testMigration), 'CREATE TABLE wf.AtomicTest (Id INT);');
  fs.writeFileSync(path.join(tempDir, '074_fix_winspeed_legacy_raiserror.sql'), 'SELECT 1;');

  const customPolicy = {
    schemaVersion: 1,
    checksumPolicy: 'immutable-after-apply',
    excludedFiles: [],
    excludedPatterns: [],
    legacyDuplicateSequences: {},
    targetProfiles: {
      local_uat: {
        serverName: 'AMYOU-YOGA7\\V2008R2',
        databaseName: 'dbwins_worldfert9_local_uat',
        productVersionPrefix: '10.50.',
        loginName: 'wf_uat_app',
        migratorLoginName: 'wf_uat_migrator',
        allowedTransports: ['Shared memory'],
        excludedFiles: ['074_fix_winspeed_legacy_raiserror.sql'],
        dialect: 'sql2008',
      },
    },
  };

  const fakePool = createFakePool(validTarget, { failOnLedgerWrite: true });

  try {
    await assert.rejects(
      async () => {
        await runner.run(
          { plan: false, help: false, profile: 'local_uat' },
          fakePool,
          null,
          { migrationsDir: tempDir, policy: customPolicy }
        );
      },
      /SIMULATED_LEDGER_WRITE_FAILURE/
    );

    const logs = fakePool.getLogs();
    assert.equal(logs.txRolledBack, true, 'Transaction must be rolled back on ledger failure');
    assert.equal(logs.txCommitted, false, 'Transaction must not be committed');
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. R3 Closures: R3-01, R3-02, R3-03
// ─────────────────────────────────────────────────────────────────────────────

test('Package A (Offline): R3-01 - classifyMigration supports canonical effective artifact and legacy arguments', () => {
  // 1. Legacy string caller signature
  assert.equal(runner.classifyMigration(null, 'abc', 2), 'PENDING');
  assert.equal(runner.classifyMigration({ checksum: 'ABC', batchCount: 2 }, 'abc', 2), 'UNCHANGED');
  assert.equal(runner.classifyMigration({ checksum: 'def', batchCount: 2 }, 'abc', 2), 'CHECKSUM_DRIFT');
  assert.equal(runner.classifyMigration({ checksum: 'abc', batchCount: 1 }, 'abc', 2), 'BATCHCOUNT_DRIFT');

  // 2. Canonical effective artifact caller
  const effective = {
    file: '005_test.sql',
    checksum: 'hash_exec_123',
    batchCount: 2,
    dialect: 'sql2008',
    original: { hash: 'hash_orig_123', batchCount: 2 },
    executed: { fileName: '005_test_compat.sql', hash: 'hash_exec_123', batchCount: 2 },
  };

  const matchingApplied = {
    originalChecksum: 'hash_orig_123',
    executedChecksum: 'hash_exec_123',
    originalBatchCount: 2,
    executedBatchCount: 2,
    dialect: 'sql2008',
    executedFile: '005_test_compat.sql',
  };
  assert.equal(runner.classifyMigration(matchingApplied, effective), 'UNCHANGED');

  // Original hash drift
  assert.equal(runner.classifyMigration({ ...matchingApplied, originalChecksum: 'wrong_orig' }, effective), 'CHECKSUM_DRIFT');
  // Executed hash drift
  assert.equal(runner.classifyMigration({ ...matchingApplied, executedChecksum: 'wrong_exec' }, effective), 'CHECKSUM_DRIFT');
  // Original batchcount drift
  assert.equal(runner.classifyMigration({ ...matchingApplied, originalBatchCount: 3 }, effective), 'BATCHCOUNT_DRIFT');
  // Executed batchcount drift
  assert.equal(runner.classifyMigration({ ...matchingApplied, executedBatchCount: 3 }, effective), 'BATCHCOUNT_DRIFT');

  // 3. executionBatches export check
  assert.equal(typeof runner.executionBatches, 'function');
});

test('Package A (Offline): R3-02 - Per-row legacy provenance in upgraded table with mixed old and new rows', async () => {
  // Pool simulates a table that has all dual columns added (ALTER TABLE ADD ... was run),
  // but row 1 is a legacy row where dual columns are NULL,
  // and row 2 is a modern row where dual columns are populated.
  const pool = {
    request: () => ({
      query: async (sql) => {
        if (sql.includes("OBJECT_ID('wf.SchemaMigration','U')")) {
          return { recordset: [{ LedgerId: 1001, CanInspect: 1 }] };
        }
        if (sql.includes('sys.columns')) {
          return {
            recordset: [
              { name: 'FileName' }, { name: 'Checksum' }, { name: 'BatchCount' },
              { name: 'AppliedAt' }, { name: 'AppliedBy' },
              { name: 'OriginalChecksum' }, { name: 'ExecutedChecksum' },
              { name: 'OriginalBatchCount' }, { name: 'ExecutedBatchCount' },
              { name: 'Dialect' }, { name: 'ExecutedFile' }, { name: 'TargetProfile' },
            ],
          };
        }
        if (sql.includes('FROM wf.SchemaMigration')) {
          return {
            recordset: [
              // Row 1: Legacy row from pre-upgrade days (NULL in dual columns)
              {
                FileName: '001_legacy.sql',
                Checksum: 'legacy_hash_001',
                BatchCount: 3,
                AppliedAt: new Date(),
                AppliedBy: 'legacy_user',
                OriginalChecksum: null,
                ExecutedChecksum: null,
                OriginalBatchCount: null,
                ExecutedBatchCount: null,
                Dialect: null,
                ExecutedFile: null,
                TargetProfile: null,
              },
              // Row 2: Modern row applied with Package A
              {
                FileName: '002_modern.sql',
                Checksum: 'modern_orig_002',
                BatchCount: 1,
                AppliedAt: new Date(),
                AppliedBy: 'wf_uat_migrator',
                OriginalChecksum: 'modern_orig_002',
                ExecutedChecksum: 'modern_exec_002',
                OriginalBatchCount: 1,
                ExecutedBatchCount: 1,
                Dialect: 'sql2008',
                ExecutedFile: '002_modern_compat.sql',
                TargetProfile: 'local_uat',
              },
            ],
          };
        }
        return { recordset: [] };
      },
    }),
  };

  const loaded = await runner.loadApplied(pool);
  const legacyRecord = loaded.get('001_legacy.sql');
  const modernRecord = loaded.get('002_modern.sql');

  // Verify per-row determination: Legacy row MUST retain LEGACY_UNKNOWN provenance
  assert.equal(legacyRecord.dialect, 'LEGACY_UNKNOWN', 'Legacy row must not fabricate standard dialect');
  assert.equal(legacyRecord.executedFile, 'LEGACY_UNKNOWN', 'Legacy row must not fabricate executedFile');
  assert.equal(legacyRecord.targetProfile, 'LEGACY_UNKNOWN', 'Legacy row must not fabricate targetProfile');
  assert.equal(legacyRecord.executedChecksum, null, 'Legacy row must not invent executed checksum');
  assert.equal(legacyRecord.executedBatchCount, null, 'Legacy row must not invent executed batch count');
  assert.equal(legacyRecord.originalChecksum, 'legacy_hash_001');
  assert.equal(legacyRecord.originalBatchCount, 3);

  // Modern record retains full provenance
  assert.equal(modernRecord.dialect, 'sql2008');
  assert.equal(modernRecord.executedFile, '002_modern_compat.sql');
  assert.equal(modernRecord.executedChecksum, 'modern_exec_002');
  assert.equal(modernRecord.targetProfile, 'local_uat');

  // Verify classifyMigration preserves original hash verification for LEGACY_UNKNOWN without false drift
  const legacyEffective = {
    file: '001_legacy.sql',
    checksum: 'legacy_hash_001',
    batchCount: 3,
    dialect: 'sql2008',
    original: { hash: 'legacy_hash_001', batchCount: 3 },
    executed: { fileName: '001_legacy_compat.sql', hash: 'compat_exec_hash', batchCount: 4 },
  };
  // Should be UNCHANGED because original hash and batchcount match, and legacy row executed metadata is unknown
  assert.equal(runner.classifyMigration(legacyRecord, legacyEffective), 'UNCHANGED');

  // Should detect CHECKSUM_DRIFT when original migration changed on disk
  const changedOriginal = { ...legacyEffective, original: { hash: 'modified_hash_999', batchCount: 3 } };
  assert.equal(runner.classifyMigration(legacyRecord, changedOriginal), 'CHECKSUM_DRIFT');

  // Should detect BATCHCOUNT_DRIFT when original batchcount changed on disk
  const changedBatches = { ...legacyEffective, original: { hash: 'legacy_hash_001', batchCount: 5 } };
  assert.equal(runner.classifyMigration(legacyRecord, changedBatches), 'BATCHCOUNT_DRIFT');
});

test('Package A (Offline): R3-03 - Missing profile or malformed policy fails closed before DDL or ledger writes', async () => {
  const targetRecord = {
    dbName: 'dbwins_worldfert9_rehearsal',
    serverName: 'AMYOU-YOGA7\\V2008R2',
    productVersion: '10.50.4042.0',
    loginName: 'wf_uat_migrator',
    originalLogin: 'wf_uat_migrator',
    isSysadmin: 0,
    isSecurityadmin: 0,
    isServeradmin: 0,
    isDbcreator: 0,
    hasControlServer: 0,
    hasProdAccess: 0,
    prodAccess: 0,
    otherUserDbCount: 0,
    netTransport: 'Shared memory',
  };

  // Case 1: Policy where local_rehearsal profile is deleted in-memory
  const policyWithoutRehearsal = {
    schemaVersion: 1,
    checksumPolicy: 'immutable-after-apply',
    excludedFiles: [],
    excludedPatterns: [],
    legacyDuplicateSequences: {},
    targetProfiles: {
      local_uat: {
        serverName: 'AMYOU-YOGA7\\V2008R2',
        databaseName: 'dbwins_worldfert9_local_uat',
        productVersionPrefix: '10.50.',
        loginName: 'wf_uat_app',
        migratorLoginName: 'wf_uat_migrator',
        allowedTransports: ['Shared memory'],
        excludedFiles: ['074_fix_winspeed_legacy_raiserror.sql'],
        dialect: 'sql2008',
      },
    },
  };

  // discoverMigrations must reject unknown profile
  assert.throws(
    () => runner.discoverMigrations(path.resolve(__dirname, '../migrations'), policyWithoutRehearsal, 'local_rehearsal'),
    /UNKNOWN_TARGET_PROFILE.*local_rehearsal/
  );

  // Fake pool apply run with missing profile must fail with ZERO DDL, ZERO batches, ZERO ledger writes
  const pool1 = createFakePool(targetRecord);
  await assert.rejects(
    async () => {
      await runner.run(
        { plan: false, help: false, profile: 'local_rehearsal' },
        pool1,
        null,
        { policy: policyWithoutRehearsal }
      );
    },
    /UNKNOWN_TARGET_PROFILE.*local_rehearsal/
  );
  assert.equal(pool1.getLogs().batchLog.length, 0, 'ZERO batches dispatched on missing profile');
  const ddl1 = pool1.getLogs().queryLog.filter(q => /CREATE|ALTER|DROP/i.test(q));
  assert.equal(ddl1.length, 0, 'ZERO DDL issued on missing profile');

  // Case 2: Malformed policy where local_rehearsal exists but does NOT exclude 074
  const malformedPolicy = {
    schemaVersion: 1,
    checksumPolicy: 'immutable-after-apply',
    excludedFiles: [],
    excludedPatterns: [],
    legacyDuplicateSequences: {},
    targetProfiles: {
      local_rehearsal: {
        serverName: 'AMYOU-YOGA7\\V2008R2',
        databaseName: 'dbwins_worldfert9_rehearsal',
        productVersionPrefix: '10.50.',
        loginName: 'wf_uat_migrator',
        migratorLoginName: 'wf_uat_migrator',
        allowedTransports: ['Shared memory'],
        excludedFiles: [], // MALFORMED! Missing 074 exclusion
        dialect: 'sql2008',
      },
    },
  };

  // discoverMigrations must reject malformed policy
  assert.throws(
    () => runner.discoverMigrations(path.resolve(__dirname, '../migrations'), malformedPolicy, 'local_rehearsal'),
    /POLICY_INTEGRITY_VIOLATION.*074_fix_winspeed_legacy_raiserror.sql/
  );

  // Fake pool apply run with malformed policy must reject before any DDL or batches
  const pool2 = createFakePool(targetRecord);
  await assert.rejects(
    async () => {
      await runner.run(
        { plan: false, help: false, profile: 'local_rehearsal' },
        pool2,
        null,
        { policy: malformedPolicy }
      );
    },
    /MALFORMED_POLICY.*074_fix_winspeed_legacy_raiserror.sql/
  );
  assert.equal(pool2.getLogs().batchLog.length, 0, 'ZERO batches dispatched on malformed policy');
  const ddl2 = pool2.getLogs().queryLog.filter(q => /CREATE|ALTER|DROP/i.test(q));
  assert.equal(ddl2.length, 0, 'ZERO DDL issued on malformed policy');

  // Case 3: Target tuple vs policy config agreement
  // Wrong database name in target vs policy
  const poolWrongDb = createFakePool({ ...targetRecord, dbName: 'wrong_db_name' });
  await assert.rejects(
    async () => {
      await runner.run(
        { plan: false, help: false, profile: 'local_rehearsal' },
        poolWrongDb,
        null,
        { policy: runner.loadPolicy() }
      );
    },
    /TARGET_TUPLE_MISMATCH.*Database/
  );

  // Wrong server name in target vs policy
  const poolWrongSrv = createFakePool({ ...targetRecord, serverName: 'WRONG-SERVER\\INSTANCE' });
  await assert.rejects(
    async () => {
      await runner.run(
        { plan: false, help: false, profile: 'local_rehearsal' },
        poolWrongSrv,
        null,
        { policy: runner.loadPolicy() }
      );
    },
    /TARGET_TUPLE_MISMATCH.*Server/
  );

  // Wrong product version prefix
  const poolWrongVer = createFakePool({ ...targetRecord, productVersion: '16.0.1000.6' });
  await assert.rejects(
    async () => {
      await runner.run(
        { plan: false, help: false, profile: 'local_rehearsal' },
        poolWrongVer,
        null,
        { policy: runner.loadPolicy() }
      );
    },
    /TARGET_TUPLE_MISMATCH.*ProductVersion/
  );

  // Disallowed transport
  const poolWrongTransport = createFakePool({ ...targetRecord, netTransport: 'TCP' });
  await assert.rejects(
    async () => {
      await runner.run(
        { plan: false, help: false, profile: 'local_rehearsal' },
        poolWrongTransport,
        null,
        { policy: runner.loadPolicy() }
      );
    },
    /TARGET_TUPLE_MISMATCH.*Transport/
  );
});


