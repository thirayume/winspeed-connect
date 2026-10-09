'use strict';

/**
 * WinSpeed migration runner.
 *
 * Safety properties:
 * - selection and legacy duplicate sequences are governed by migration-policy.json;
 * - target profile is verified against fail-closed safety guard before any DDL or ledger write;
 * - UAT/manual SQL and profile exclusions are excluded from the execution path;
 * - dialect overrides and dual provenance are tracked in wf.SchemaMigration;
 * - an applied file is immutable: checksum, batch-count, dialect, or file drift stops the run;
 * - ledger read/write failures are fatal rather than treated as an empty ledger;
 * - --plan is read-only and can inspect legacy, absent, or full ledgers without DDL.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  validateTargetRecord,
  validateLocalTargetRecord,
  resolveEffectiveMigration,
  assertNoCrossDbWrite,
  APPROVED_LOCAL_TARGET,
  APPROVED_LOCAL_REHEARSAL_TARGET,
  APPROVED_TARGET,
} = require('./safety-validator');
const { validateOnpremTargetRecord } = require('./onprem-target');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const POLICY_PATH = path.join(__dirname, 'migration-policy.json');
const sha256 = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const splitBatches = sql => String(sql).split(/^\s*GO\s*$/im).filter(batch => batch.trim());

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function loadPolicy(file = POLICY_PATH) {
  const policy = readJson(file);
  if (policy.schemaVersion !== 1) throw new Error(`Unsupported migration policy schemaVersion: ${policy.schemaVersion}`);
  if (!Array.isArray(policy.excludedFiles) || !Array.isArray(policy.excludedPatterns)) {
    throw new Error('migration-policy.json must define excludedFiles and excludedPatterns arrays.');
  }
  if (!policy.legacyDuplicateSequences || typeof policy.legacyDuplicateSequences !== 'object') {
    throw new Error('migration-policy.json must define legacyDuplicateSequences.');
  }
  if (policy.checksumPolicy !== 'immutable-after-apply') {
    throw new Error('Only checksumPolicy=immutable-after-apply is supported.');
  }
  return policy;
}

function migrationSequence(fileName) {
  const match = path.basename(fileName).match(/^(\d+)_/);
  return match ? Number(match[1]) : null;
}

function compileExcludedPatterns(policy) {
  return (policy.excludedPatterns || []).map(pattern => {
    try { return new RegExp(pattern, 'i'); }
    catch (error) { throw new Error(`Invalid migration exclusion pattern ${pattern}: ${error.message}`); }
  });
}

function getProfileExcludedFiles(policy, targetProfile) {
  if (!targetProfile) {
    return [];
  }
  if (!policy || !policy.targetProfiles || !policy.targetProfiles[targetProfile]) {
    throw new Error(`UNKNOWN_TARGET_PROFILE: Target profile "${targetProfile}" is not defined in migration policy.`);
  }
  const prof = policy.targetProfiles[targetProfile];
  const excluded = [...(prof.excludedFiles || [])];
  const isLocal2008 = prof.dialect === 'sql2008' || targetProfile.startsWith('local_');
  if (isLocal2008 && !excluded.includes('074_fix_winspeed_legacy_raiserror.sql')) {
    throw new Error(`POLICY_INTEGRITY_VIOLATION: Profile "${targetProfile}" targets sql2008/local but does not exclude 074_fix_winspeed_legacy_raiserror.sql`);
  }
  return excluded;
}

function validateMigrationPolicy(fileNames, policy, targetProfile) {
  const files = [...fileNames].filter(file => file.toLowerCase().endsWith('.sql')).sort();
  const fileSet = new Set(files);
  const excludedPatterns = compileExcludedPatterns(policy);
  const profileExcluded = getProfileExcludedFiles(policy, targetProfile);
  const errors = [];

  for (const file of policy.excludedFiles) {
    if (!fileSet.has(file)) errors.push(`Configured excluded migration is missing: ${file}`);
  }
  for (const file of profileExcluded) {
    if (!fileSet.has(file)) errors.push(`Configured profile-excluded migration is missing: ${file}`);
  }

  const excludedFiles = files.filter(file =>
    policy.excludedFiles.includes(file) ||
    profileExcluded.includes(file) ||
    excludedPatterns.some(pattern => pattern.test(file))
  );
  const excludedSet = new Set(excludedFiles);
  const activeFiles = files.filter(file => !excludedSet.has(file));
  const activeUnsequenced = activeFiles.filter(file => migrationSequence(file) === null);
  if (activeUnsequenced.length) errors.push(`Active migration filename(s) must start with a numeric sequence: ${activeUnsequenced.join(', ')}`);

  const bySequence = new Map();
  for (const file of files) {
    const sequence = migrationSequence(file);
    if (sequence === null) continue;
    const group = bySequence.get(sequence) || [];
    group.push(file);
    bySequence.set(sequence, group);
  }
  const actualDuplicates = new Map([...bySequence].filter(([, group]) => group.length > 1));
  const expectedDuplicates = new Map(Object.entries(policy.legacyDuplicateSequences).map(([sequence, group]) => [Number(sequence), [...group].sort()]));
  const duplicateSequences = new Set([...actualDuplicates.keys(), ...expectedDuplicates.keys()]);
  for (const sequence of [...duplicateSequences].sort((a, b) => a - b)) {
    const actual = [...(actualDuplicates.get(sequence) || [])].sort();
    const expected = [...(expectedDuplicates.get(sequence) || [])].sort();
    if (actual.join('\n') !== expected.join('\n')) {
      errors.push(`Migration sequence ${sequence} does not match the approved legacy group (actual: ${actual.join(', ') || 'none'}; expected: ${expected.join(', ') || 'none'}).`);
    }
  }

  if (errors.length) throw new Error(`Migration policy validation failed:\n- ${errors.join('\n- ')}`);
  return {
    allFiles: files,
    activeFiles,
    excludedFiles,
    legacyDuplicateSequences: [...actualDuplicates].map(([sequence, group]) => ({ sequence, files: [...group] })),
  };
}

function discoverMigrations(directory = MIGRATIONS_DIR, policy = loadPolicy(), targetProfile = (process.env.MIGRATION_PROFILE || process.env.DB_MODE)) {
  const files = fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.sql'))
    .map(entry => entry.name);
  return validateMigrationPolicy(files, policy, targetProfile);
}

/**
 * Classifies migration status against applied ledger record.
 * AR2-05 & R3-01 & R3-02:
 * Supports canonical effective artifact object as well as legacy (applied, checksum, batchCount).
 * Determines provenance per-row: preserves original hash verification for LEGACY_UNKNOWN without inventing executed metadata.
 */
function classifyMigration(applied, effective, legacyBatchCount) {
  if (!applied) return 'PENDING';
  let eff = effective;
  if (typeof effective === 'string') {
    eff = {
      checksum: effective,
      batchCount: legacyBatchCount,
      original: { hash: effective, batchCount: legacyBatchCount },
      executed: { hash: effective, batchCount: legacyBatchCount },
      dialect: 'standard',
    };
  }

  const origHash = eff.original?.hash || eff.checksum;
  const execHash = eff.executed?.hash || eff.checksum;
  const origBatches = eff.original?.batchCount ?? eff.batchCount;
  const execBatches = eff.executed?.batchCount ?? eff.batchCount;
  const effectiveDialect = eff.dialect || 'standard';
  const effectiveExecFile = eff.executed?.fileName || eff.file;

  const appliedOrig = applied.originalChecksum || applied.checksum;
  const appliedOrigBatches = applied.originalBatchCount ?? applied.batchCount;

  // R3-02: Legacy rows with unproven/null provenance
  // Determine provenance per-row: preserve original hash verification without inventing executed metadata
  if (applied.dialect === 'LEGACY_UNKNOWN') {
    if (String(appliedOrig).toLowerCase() !== String(origHash).toLowerCase()) {
      return 'CHECKSUM_DRIFT';
    }
    if (Number(appliedOrigBatches) !== Number(origBatches)) {
      return 'BATCHCOUNT_DRIFT';
    }
    return 'UNCHANGED';
  }

  // Modern dual provenance verification
  const appliedExec = applied.executedChecksum;
  const appliedExecBatches = applied.executedBatchCount;

  if (String(appliedOrig).toLowerCase() !== String(origHash).toLowerCase()) {
    return 'CHECKSUM_DRIFT';
  }
  if (appliedExec != null && execHash != null && String(appliedExec).toLowerCase() !== String(execHash).toLowerCase()) {
    return 'CHECKSUM_DRIFT';
  }
  if (Number(appliedOrigBatches) !== Number(origBatches)) {
    return 'BATCHCOUNT_DRIFT';
  }
  if (appliedExecBatches != null && execBatches != null && Number(appliedExecBatches) !== Number(execBatches)) {
    return 'BATCHCOUNT_DRIFT';
  }
  if (applied.dialect && applied.dialect !== effectiveDialect) {
    return 'DIALECT_DRIFT';
  }
  if (applied.executedFile && effectiveExecFile && applied.executedFile !== effectiveExecFile) {
    return 'FILE_DRIFT';
  }

  return 'UNCHANGED';
}

async function ensureLedger(pool) {
  await pool.request().query(`
    IF SCHEMA_ID('wf') IS NULL EXEC('CREATE SCHEMA wf AUTHORIZATION dbo');
    IF OBJECT_ID('wf.SchemaMigration','U') IS NULL
    BEGIN
      CREATE TABLE wf.SchemaMigration (
        FileName NVARCHAR(255) NOT NULL PRIMARY KEY,
        Checksum CHAR(64) NOT NULL,
        BatchCount INT NOT NULL,
        AppliedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        AppliedBy NVARCHAR(128) NULL DEFAULT SUSER_SNAME(),
        OriginalChecksum CHAR(64) NULL,
        ExecutedChecksum CHAR(64) NULL,
        OriginalBatchCount INT NULL,
        ExecutedBatchCount INT NULL,
        Dialect NVARCHAR(32) NULL,
        ExecutedFile NVARCHAR(255) NULL,
        TargetProfile NVARCHAR(64) NULL
      );
    END
    ELSE
    BEGIN
      IF COL_LENGTH('wf.SchemaMigration', 'OriginalChecksum') IS NULL ALTER TABLE wf.SchemaMigration ADD OriginalChecksum CHAR(64) NULL;
      IF COL_LENGTH('wf.SchemaMigration', 'ExecutedChecksum') IS NULL ALTER TABLE wf.SchemaMigration ADD ExecutedChecksum CHAR(64) NULL;
      IF COL_LENGTH('wf.SchemaMigration', 'OriginalBatchCount') IS NULL ALTER TABLE wf.SchemaMigration ADD OriginalBatchCount INT NULL;
      IF COL_LENGTH('wf.SchemaMigration', 'ExecutedBatchCount') IS NULL ALTER TABLE wf.SchemaMigration ADD ExecutedBatchCount INT NULL;
      IF COL_LENGTH('wf.SchemaMigration', 'Dialect') IS NULL ALTER TABLE wf.SchemaMigration ADD Dialect NVARCHAR(32) NULL;
      IF COL_LENGTH('wf.SchemaMigration', 'ExecutedFile') IS NULL ALTER TABLE wf.SchemaMigration ADD ExecutedFile NVARCHAR(255) NULL;
      IF COL_LENGTH('wf.SchemaMigration', 'TargetProfile') IS NULL ALTER TABLE wf.SchemaMigration ADD TargetProfile NVARCHAR(64) NULL;
    END
  `);
}

/**
 * Loads applied migrations from wf.SchemaMigration without DDL.
 * AR2-03: Inspects column existence dynamically. Seamlessly handles absent, legacy, or full schemas.
 * Throws diagnostic error on partial schemas.
 */
async function loadApplied(pool) {
  const metadata = (await pool.request().query("SELECT OBJECT_ID('wf.SchemaMigration','U') AS LedgerId, HAS_PERMS_BY_NAME(DB_NAME(),'DATABASE','VIEW DEFINITION') AS CanInspect")).recordset?.[0];
  if (!metadata) throw new Error('Cannot inspect migration ledger metadata');
  if (metadata.LedgerId == null) {
    if (Number(metadata.CanInspect) !== 1) throw new Error('Cannot prove migration ledger is absent: VIEW DEFINITION required');
    return new Map();
  }

  // Inspect existing columns in wf.SchemaMigration dynamically
  const colRows = (await pool.request().query(`
    SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('wf.SchemaMigration', 'U')
  `)).recordset || [];
  const colNames = new Set(colRows.map(r => r.name.toLowerCase()));

  const dualColumns = ['originalchecksum', 'executedchecksum', 'originalbatchcount', 'executedbatchcount', 'dialect', 'executedfile'];
  const hasAllDual = dualColumns.every(col => colNames.has(col));
  const hasAnyDual = dualColumns.some(col => colNames.has(col));

  if (!hasAllDual && hasAnyDual) {
    throw new Error('PARTIAL_SCHEMA_MIGRATION_LEDGER: Table wf.SchemaMigration has incomplete columns (partial upgrade detected). Repair ledger schema before proceeding.');
  }

  let querySql;
  if (hasAllDual) {
    querySql = `
      SELECT 
        FileName, Checksum, BatchCount, AppliedAt, AppliedBy,
        OriginalChecksum, ExecutedChecksum, OriginalBatchCount, ExecutedBatchCount,
        Dialect, ExecutedFile,
        ${colNames.has('targetprofile') ? 'TargetProfile' : 'NULL AS TargetProfile'}
      FROM wf.SchemaMigration
    `;
  } else {
    // Legacy pre-Package A ledger
    querySql = 'SELECT FileName, Checksum, BatchCount, AppliedAt, AppliedBy FROM wf.SchemaMigration';
  }

  const result = await pool.request().query(querySql);
  return new Map((result.recordset || []).map(row => {
    // R3-02: Determine provenance PER-ROW, not table shape!
    // A legacy row has null dual provenance columns even if the table has dual columns.
    const isLegacyRow = !hasAllDual || (
      row.OriginalChecksum == null &&
      row.ExecutedChecksum == null &&
      row.Dialect == null &&
      row.ExecutedFile == null
    );

    if (isLegacyRow) {
      return [row.FileName, {
        checksum: row.Checksum,
        batchCount: Number(row.BatchCount),
        appliedAt: row.AppliedAt,
        appliedBy: row.AppliedBy,
        originalChecksum: row.Checksum,
        executedChecksum: null,
        originalBatchCount: Number(row.BatchCount),
        executedBatchCount: null,
        dialect: 'LEGACY_UNKNOWN',
        executedFile: 'LEGACY_UNKNOWN',
        targetProfile: 'LEGACY_UNKNOWN',
      }];
    }

    return [row.FileName, {
      checksum: row.Checksum,
      batchCount: Number(row.BatchCount),
      appliedAt: row.AppliedAt,
      appliedBy: row.AppliedBy,
      originalChecksum: row.OriginalChecksum || row.Checksum,
      executedChecksum: row.ExecutedChecksum || row.Checksum,
      originalBatchCount: row.OriginalBatchCount != null ? Number(row.OriginalBatchCount) : Number(row.BatchCount),
      executedBatchCount: row.ExecutedBatchCount != null ? Number(row.ExecutedBatchCount) : Number(row.BatchCount),
      dialect: row.Dialect || 'standard',
      executedFile: row.ExecutedFile || row.FileName,
      targetProfile: row.TargetProfile || 'unknown',
    }];
  }));
}

let targetDatabase = null;

async function resolveTargetDatabase(pool) {
  const r = await pool.request().query('SELECT DB_NAME() AS n');
  targetDatabase = r.recordset[0].n;
  return targetDatabase;
}

/**
 * Records applied migration into wf.SchemaMigration.
 * AR2-05: Maintains legacy contract (Checksum & BatchCount store canonical original values)
 * while recording complete dual provenance in separate columns.
 */
async function recordApplied(poolOrSession, entry, dbName = targetDatabase, targetProfile = 'unknown') {
  if (dbName) {
    await poolOrSession.request().query(`USE [${dbName.replace(/]/g, ']]')}];`);
  }
  const orig = entry.effective?.original || {};
  const exec = entry.effective?.executed || {};
  const fileName = entry.file;

  const legacyChecksum = orig.hash || entry.checksum;
  const legacyBatchCount = orig.batchCount || entry.batchCount;
  const origChecksum = orig.hash || entry.checksum;
  const execChecksum = exec.hash || entry.checksum;
  const origBatchCount = orig.batchCount || entry.batchCount;
  const execBatchCount = exec.batchCount || entry.batchCount;
  const dialect = entry.effective?.dialect || 'standard';
  const execFile = exec.fileName || fileName;

  await poolOrSession.request()
    .input('f', fileName)
    .input('c', legacyChecksum)
    .input('b', legacyBatchCount)
    .input('origChecksum', origChecksum)
    .input('execChecksum', execChecksum)
    .input('origBatchCount', origBatchCount)
    .input('execBatchCount', execBatchCount)
    .input('dialect', dialect)
    .input('execFile', execFile)
    .input('targetProfile', targetProfile)
    .query(`
      INSERT INTO wf.SchemaMigration (
        FileName, Checksum, BatchCount,
        OriginalChecksum, ExecutedChecksum, OriginalBatchCount, ExecutedBatchCount,
        Dialect, ExecutedFile, TargetProfile
      ) VALUES (
        @f, @c, @b,
        @origChecksum, @execChecksum, @origBatchCount, @execBatchCount,
        @dialect, @execFile, @targetProfile
      );
    `);
}

function sqlErrorCode(error) {
  return error?.originalError?.info?.number
    ?? error?.originalError?.number
    ?? error?.number
    ?? error?.originalError?.code;
}

function assertNoDatabaseSwitch(fileName, batches, database) {
  if (!database) return;
  const re = /^[ \t]*USE\s+\[?([A-Za-z0-9_]+)\]?[ \t]*;?[ \t]*(?:--.*)?$/gim;
  for (const batch of batches) {
    for (const m of batch.matchAll(re)) {
      if (m[1].toLowerCase() !== database.toLowerCase()) {
        throw new Error(
          `${fileName} มีคำสั่ง "USE ${m[1]}" อยู่ข้างใน แต่กำลังรันกับฐาน "${database}" — ` +
          `ถ้าปล่อยไป คำสั่งที่เหลือจะไปลงฐาน ${m[1]} แทน ` +
          `แก้ที่ไฟล์ migration ให้ไม่ต้องสลับฐาน แล้วค่อยรันใหม่`);
      }
    }
  }
}

function executionBatches(fileName, text, database, overrides = {}) {
  const override = overrides[fileName];
  let executable = text;
  if (override) {
    if (sha256(text) !== override.checksum) throw new Error('Database-context override checksum mismatch: ' + fileName);
    executable = text.replace(/^[ \t]*USE\s+\[?([A-Za-z0-9_]+)\]?[ \t]*;?[ \t]*(?:--.*)?$/gim, (line, name) => {
      if (name.toLowerCase() !== override.database.toLowerCase()) throw new Error('Unexpected database directive: ' + name);
      return '-- Database context remains pinned by migration runner.';
    });
  }
  const batches = splitBatches(executable);
  assertNoDatabaseSwitch(fileName, batches, database);
  return batches;
}

/**
 * Runs batches of a single migration file.
 * AR2-05: Uses canonical effective artifact batches directly. No silent swallowing of errors.
 */
async function runFile(pool, fileName, batches, customSession = null) {
  assertNoDatabaseSwitch(fileName, batches, targetDatabase);

  // Validate cross-db write on all batches
  for (const batch of batches) {
    assertNoCrossDbWrite(batch);
  }

  // Session handling
  const policy = loadPolicy();
  const transactionalFiles = policy.transactionalFiles || [];
  const isExplicitTransactional = transactionalFiles.includes(fileName) || batches.some(text => /^\s*--\s*@transaction\b/im.test(text));
  const requiresTempTableSession = batches.some(text => /\bCREATE\s+TABLE\s+#/i.test(text));

  const shouldManageSession = !customSession && (requiresTempTableSession || isExplicitTransactional);
  const session = customSession || (shouldManageSession ? pool.transaction() : null);

  if (shouldManageSession && session) await session.begin();
  let successCount = 0;
  try {
    for (let index = 0; index < batches.length; index += 1) {
      if (session) await session.request().batch(batches[index]);
      else await pool.request().query(batches[index]);
      successCount += 1;
    }
    if (shouldManageSession && session) await session.commit();
  } catch (error) {
    if (shouldManageSession && session) await session.rollback().catch(() => {});
    const code = sqlErrorCode(error);
    const wrapped = new Error(`${fileName} batch execution failed${code ? ` (SQL ${code})` : ''}: ${error.message}`);
    wrapped.cause = error;
    throw wrapped;
  }
  return { successCount, ignoredCount: 0, batchCount: batches.length };
}

function buildPlan(inventory, applied, directory = MIGRATIONS_DIR, targetProfile = null, policy = loadPolicy(), options = {}) {
  const entries = [];
  for (const file of inventory.activeFiles) {
    const sql = fs.readFileSync(path.join(directory, file), 'utf8');
    const effective = resolveEffectiveMigration(file, sql, targetProfile, policy, options);

    if (effective.status === 'EXCLUDED') {
      continue;
    }

    const batches = effective.executed.batches;
    const checksum = effective.executed.hash;
    const batchCount = effective.executed.batchCount;

    entries.push({
      file,
      batches,
      checksum,
      batchCount,
      effective,
      status: classifyMigration(applied.get(file), effective),
      applied: applied.get(file) || null,
    });
  }

  const diskSet = new Set(inventory.allFiles);
  return {
    entries,
    ledgerOnly: [...applied.keys()].filter(file => !diskSet.has(file)).sort(),
    excludedApplied: inventory.excludedFiles.filter(file => applied.has(file)).sort(),
  };
}

function parseArgs(argv) {
  const options = { plan: false, help: false, profile: null };
  for (const arg of argv.slice(2)) {
    if (arg === '--plan' || arg === '--verify-only') options.plan = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--profile=')) options.profile = arg.split('=')[1];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printPlan(plan, inventory, target, readOnly) {
  const counts = plan.entries.reduce((acc, entry) => {
    acc[entry.status] = (acc[entry.status] || 0) + 1;
    return acc;
  }, {});
  console.log(`\nMigration ${readOnly ? 'read-only plan' : 'preflight'} for ${String(target).toUpperCase()}`);
  console.log(`  active: ${inventory.activeFiles.length}; excluded: ${inventory.excludedFiles.length}`);
  console.log(`  unchanged: ${counts.UNCHANGED || 0}; pending: ${counts.PENDING || 0}; drift: ${(counts.CHECKSUM_DRIFT || 0) + (counts.BATCHCOUNT_DRIFT || 0) + (counts.DIALECT_DRIFT || 0) + (counts.FILE_DRIFT || 0)}`);
  for (const entry of plan.entries.filter(item => item.status !== 'UNCHANGED')) console.log(`  ${entry.status.padEnd(16)} ${entry.file}`);
  for (const file of plan.excludedApplied) console.log(`  EXCLUDED_APPLIED ${file}`);
  for (const file of plan.ledgerOnly) console.log(`  LEDGER_ONLY      ${file}`);
  return counts;
}

/**
 * Validates target database and binds active profile before any DDL or ledger modification.
 * AR2-01, AR2-02, AR2-04, R3-03.
 */
async function verifyTargetAndProfile(pool, requestedProfile, options = {}) {
  const policy = options.policy || loadPolicy();
  const targetInfo = (await pool.request().query(`
    SELECT 
      DB_NAME() AS dbName, 
      @@SERVERNAME AS serverName,
      SERVERPROPERTY('ProductVersion') AS productVersion,
      SUSER_SNAME() AS loginName,
      ORIGINAL_LOGIN() AS originalLogin,
      IS_SRVROLEMEMBER('sysadmin') AS isSysadmin,
      IS_SRVROLEMEMBER('securityadmin') AS isSecurityadmin,
      IS_SRVROLEMEMBER('serveradmin') AS isServeradmin,
      IS_SRVROLEMEMBER('dbcreator') AS isDbcreator,
      HAS_PERMS_BY_NAME(null, null, 'CONTROL SERVER') AS hasControlServer,
      HAS_DBACCESS('dbwins_worldfert9') AS hasProdAccess,
      HAS_DBACCESS('dbwins_worldfert9') AS prodAccess,
      (SELECT COUNT(*) FROM sys.databases WHERE database_id > 4 AND name != DB_NAME() AND HAS_DBACCESS(name) = 1) AS otherUserDbCount,
      CONNECTIONPROPERTY('net_transport') AS netTransport
  `)).recordset?.[0];

  if (!targetInfo) throw new Error('Cannot query target database information');

  const dbName = String(targetInfo.dbName || '').toLowerCase();
  const srvName = String(targetInfo.serverName || '').toLowerCase();

  let profile = requestedProfile;
  if (!profile) {
    if (srvName === APPROVED_LOCAL_TARGET.serverName.toLowerCase() && dbName === APPROVED_LOCAL_TARGET.dbName.toLowerCase()) {
      profile = 'local_uat';
    } else if (srvName === APPROVED_LOCAL_REHEARSAL_TARGET.serverName.toLowerCase() && dbName === APPROVED_LOCAL_REHEARSAL_TARGET.dbName.toLowerCase()) {
      profile = 'local_rehearsal';
    } else if (srvName === APPROVED_TARGET.serverName.toLowerCase() && dbName === APPROVED_TARGET.dbName.toLowerCase()) {
      profile = 'remote_b';
    } else {
      throw new Error(`Unrecognized target: server "${targetInfo.serverName}", db "${targetInfo.dbName}". Explicit approved target profile required.`);
    }
  }

  // R3-03: Validate active profile exists in policy
  if (!policy || !policy.targetProfiles || !policy.targetProfiles[profile]) {
    throw new Error(`UNKNOWN_TARGET_PROFILE: Target profile "${profile}" is not defined in migration policy.`);
  }

  const restoredLocal = profile === 'local_uat' && process.env.ALLOW_RESTORED_LOCAL_UAT === 'true';
  const profConfig = restoredLocal ? { ...policy.targetProfiles[profile], databaseName: 'dbwins_worldfert9' } : policy.targetProfiles[profile];

  // R3-03: Validate config tuple vs actual target tuple agreement
  if (profConfig.databaseName && dbName !== profConfig.databaseName.toLowerCase()) {
    throw new Error(`TARGET_TUPLE_MISMATCH: Database "${targetInfo.dbName}" does not match policy database "${profConfig.databaseName}" for profile "${profile}".`);
  }
  if (profConfig.serverName && srvName !== profConfig.serverName.toLowerCase()) {
    throw new Error(`TARGET_TUPLE_MISMATCH: Server "${targetInfo.serverName}" does not match policy server "${profConfig.serverName}" for profile "${profile}".`);
  }
  if (profConfig.productVersionPrefix && !String(targetInfo.productVersion || '').startsWith(profConfig.productVersionPrefix)) {
    throw new Error(`TARGET_TUPLE_MISMATCH: ProductVersion "${targetInfo.productVersion}" does not start with prefix "${profConfig.productVersionPrefix}" for profile "${profile}".`);
  }
  if (profConfig.allowedTransports && Array.isArray(profConfig.allowedTransports)) {
    const allowed = profConfig.allowedTransports.map(t => t.toLowerCase());
    const actualTransport = String(targetInfo.netTransport || '').toLowerCase();
    if (!allowed.includes(actualTransport)) {
      throw new Error(`TARGET_TUPLE_MISMATCH: Transport "${targetInfo.netTransport}" is not in allowedTransports [${profConfig.allowedTransports.join(', ')}] for profile "${profile}".`);
    }
  }

  // R3-03: Enforce 074 exclusion & dialect contract for local 2008 even under malformed policy
  const isLocal2008 = profConfig.dialect === 'sql2008' || profile.startsWith('local_');
  if (isLocal2008) {
    if (profConfig.dialect !== 'sql2008') {
      throw new Error(`MALFORMED_POLICY: Profile "${profile}" on local target must have dialect 'sql2008'.`);
    }
    if (!Array.isArray(profConfig.excludedFiles) || !profConfig.excludedFiles.includes('074_fix_winspeed_legacy_raiserror.sql')) {
      throw new Error(`MALFORMED_POLICY: Profile "${profile}" on local 2008 must explicitly configure excludedFiles containing 074_fix_winspeed_legacy_raiserror.sql.`);
    }
  }

  // Execute guard validation according to profile
  if (profile === 'local_uat') {
    validateLocalTargetRecord(targetInfo, process.env, { operation: 'migration', targetType: 'uat' });
  } else if (profile === 'local_rehearsal') {
    validateLocalTargetRecord(targetInfo, process.env, { operation: 'migration', targetType: 'rehearsal' });
  } else if (profile === 'remote_b') {
    validateTargetRecord(targetInfo, process.env);
  } else if (profile === 'onprem') {
    // the approved server, database, migrator login and engine version come from the server's .env
    validateOnpremTargetRecord(targetInfo, process.env, { operation: 'migration' });
  } else {
    throw new Error(`Unsupported or unapproved migration profile: "${profile}"`);
  }

  return { profile, targetInfo, targetDatabase: targetInfo.dbName };
}

async function run(options = parseArgs(process.argv), customPool = null, customTarget = null, runnerOptions = {}) {
  const prevOp = process.env.DB_OPERATION;
  process.env.DB_OPERATION = 'migration';
  try {
    return await runInternal(options, customPool, customTarget, runnerOptions);
  } finally {
    process.env.DB_OPERATION = prevOp;
  }
}

async function runInternal(options = parseArgs(process.argv), customPool = null, customTarget = null, runnerOptions = {}) {
  if (options.help) {
    console.log('Usage: node run_migrations.js [--plan|--verify-only] [--profile=local_uat|local_rehearsal|remote_b|onprem]');
    return;
  }

  const isPlan = Boolean(options.plan || options.planOnly || options.verifyOnly);
  const requestedProfile = options.profile || options.targetProfile || process.env.MIGRATION_PROFILE || process.env.DB_MODE;

  if (customTarget && requestedProfile && customTarget !== requestedProfile) {
    throw new Error(`TARGET_MISMATCH: customTarget "${customTarget}" does not match requested profile "${requestedProfile}".`);
  }

  const policy = runnerOptions.policy || loadPolicy();
  let pool;
  const effectivePool = customPool || options.pool;
  if (effectivePool) {
    pool = effectivePool;
  } else {
    const db = require('./db');
    const target = customTarget || requestedProfile || db.getTarget();
    const targetPools = db.pools(target);
    await targetPools.ready;
    pool = targetPools.ownerPool;
  }

  // Step 1: Verify target against guard before ANY DDL, ledger write, or table creation
  const verified = await verifyTargetAndProfile(pool, requestedProfile, runnerOptions);
  const activeProfile = verified.profile;
  targetDatabase = verified.targetDatabase;

  // Step 2: Discover migrations honoring active profile exclusions
  const inventory = discoverMigrations(runnerOptions.migrationsDir || MIGRATIONS_DIR, policy, activeProfile);

  // Step 3: Load existing applied ledger (strictly read-only, handles absent/legacy/full)
  const applied = await loadApplied(pool);
  const plan = buildPlan(inventory, applied, runnerOptions.migrationsDir || MIGRATIONS_DIR, activeProfile, policy, runnerOptions);
  const counts = printPlan(plan, inventory, targetDatabase, isPlan);

  if (plan.ledgerOnly.length) {
    throw new Error(`Applied migration file(s) are missing from disk: ${plan.ledgerOnly.join(', ')}`);
  }
  const drifted = plan.entries.filter(entry => entry.status.endsWith('_DRIFT'));
  if (drifted.length) {
    throw new Error(`Applied migrations are immutable. Create a new migration instead of editing: ${drifted.map(entry => entry.file).join(', ')}`);
  }

  options.plan = isPlan;
  if (options.plan) {
    console.log('  read-only: no schema, data, or ledger changes were made.');
    return { plan, counts, inventory, targetProfile: activeProfile };
  }

  // Step 4: Ensure ledger table/columns only when ready to apply approved migrations
  await ensureLedger(pool);

  // Step 5: Apply pending migrations atomically with dual provenance
  const appliedList = [];
  for (const entry of plan.entries.filter(item => item.status === 'PENDING')) {
    console.log(`\nApplying ${entry.file}`);
    if (typeof pool.transaction !== 'function') {
      throw new Error('ATOMICITY_VIOLATION: Database pool does not support transactions; cannot apply migrations safely.');
    }
    const session = pool.transaction();
    await session.begin();
    try {
      const result = await runFile(pool, entry.file, entry.batches, session);
      await recordApplied(session, entry, targetDatabase, activeProfile);
      await session.commit();
      console.log(`  ${result.successCount} OK; ledger recorded with provenance`);
      appliedList.push(entry.file);
    } catch (err) {
      await session.rollback().catch(() => {});
      throw err;
    }
  }

  // Post-migration bootstrap phase: synchronize sequence counters above existing documents on local dialect
  if (activeProfile && (activeProfile === 'local_uat' || activeProfile === 'local_rehearsal' || activeProfile === 'onprem')) {
    const bootstrapFn = runnerOptions.bootstrapSequenceHighWater || require('./services/sequence-service').bootstrapSequenceHighWater;
    for (const seqName of ['WfRefSeq', 'QuoteRefSeq']) {
      try {
        await bootstrapFn(sqlText => pool.request().query(sqlText), seqName);
      } catch (bootErr) {
        const error = new Error(`Post-migration sequence bootstrap failed for ${seqName} on ${activeProfile} (${targetDatabase}): ${bootErr.message}`);
        error.code = 'SEQUENCE_BOOTSTRAP_FAILURE';
        error.sequence = seqName;
        error.targetDatabase = targetDatabase;
        error.activeProfile = activeProfile;
        error.appliedList = appliedList;
        error.incomplete = true;
        error.cause = bootErr;
        throw error;
      }
    }
  }

  console.log(`\nMigration complete: ${counts.UNCHANGED || 0} unchanged; ${counts.PENDING || 0} applied; ${inventory.excludedFiles.length} excluded.`);
  return { plan, counts, inventory, appliedList, targetProfile: activeProfile };
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(`Migration failed: ${error.message}`);
      process.exit(1);
    });
}

module.exports = {
  run,
  ensureLedger,
  recordApplied,
  sha256,
  splitBatches,
  loadPolicy,
  migrationSequence,
  validateMigrationPolicy,
  discoverMigrations,
  classifyMigration,
  buildPlan,
  parseArgs,
  runFile,
  loadApplied,
  verifyTargetAndProfile,
  executionBatches,
};
