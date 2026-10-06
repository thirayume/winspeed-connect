'use strict';

/**
 * Pure Safety Validator for WorldFert WSSale-App.
 *
 * Provides:
 * 1. Remote Test Target Guard (`remote_b` on Hostinger SQL Server 2022)
 * 2. Localhost UAT Target Guard (`local_uat` on AMYOU-YOGA7\V2008R2)
 * 3. Localhost Rehearsal Target Guard (`local_rehearsal`)
 * 4. Dual Migration Provenance & Hash Drift Resolver (LU-01, LU-02, AR2-01, AR2-03, AR2-05)
 * 5. Physical Path Containment Validator (LU-02, LU-05, R2-7)
 * 6. Cross-DB Write Detection Guard
 */

const path = require('path');
const crypto = require('crypto');

const sha256 = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const splitBatches = sql => String(sql).split(/^\s*GO\s*$/im).filter(batch => batch.trim());

// ─────────────────────────────────────────────────────────────────────────────
// Remote Test Target Guard (Hostinger SQL Server 2022)
// ─────────────────────────────────────────────────────────────────────────────

const APPROVED_TARGET = {
  serverName: '21181f44f254',
  dbName: 'dbwins_worldfert9_test_v2',
  loginName: 'wf_test',
};

function validateTargetRecord(rawRow, env = process.env) {
  if (!rawRow || typeof rawRow !== 'object') {
    throw new Error('TEST SAFETY ERROR: Target query returned no record or invalid record');
  }

  const dbName = typeof rawRow.dbName === 'string' ? rawRow.dbName.trim().toLowerCase() : '';
  const serverName = typeof rawRow.serverName === 'string' ? rawRow.serverName.trim().toLowerCase() : '';
  const loginName = typeof rawRow.loginName === 'string' ? rawRow.loginName.trim().toLowerCase() : '';

  if (!dbName) {
    throw new Error('TEST SAFETY ERROR: Could not determine current DB_NAME()');
  }
  if (dbName === 'dbwins_worldfert9' || dbName.includes('prod')) {
    throw new Error('CRITICAL SAFETY VIOLATION: Refusing to run tests against production database!');
  }
  if (dbName !== APPROVED_TARGET.dbName.toLowerCase()) {
    throw new Error(`CRITICAL SAFETY VIOLATION: Database "${dbName}" is not the sanctioned test database "${APPROVED_TARGET.dbName}"`);
  }

  if (!serverName) {
    throw new Error('TEST SAFETY ERROR: Could not determine @@SERVERNAME');
  }
  if (serverName === '20.255.185.14') {
    throw new Error('CRITICAL SAFETY VIOLATION: Refusing to run tests against production server 20.255.185.14!');
  }
  if (serverName !== APPROVED_TARGET.serverName.toLowerCase()) {
    throw new Error(`CRITICAL SAFETY VIOLATION: Server "${serverName}" does not match sanctioned test server "${APPROVED_TARGET.serverName}"`);
  }

  if (!loginName) {
    throw new Error('TEST SAFETY ERROR: Could not determine current SUSER_SNAME()');
  }
  if (loginName !== APPROVED_TARGET.loginName.toLowerCase()) {
    throw new Error(`CRITICAL SAFETY VIOLATION: Login "${loginName}" does not match sanctioned test principal "${APPROVED_TARGET.loginName}"`);
  }

  if (rawRow.isSysadmin === null || rawRow.isSysadmin === undefined || rawRow.isSysadmin === '') {
    throw new Error('CRITICAL SAFETY VIOLATION: IS_SRVROLEMEMBER(\'sysadmin\') returned NULL or undefined (fail-closed)!');
  }
  const isSysadminNum = Number(rawRow.isSysadmin);
  if (isNaN(isSysadminNum) || isSysadminNum !== 0 || (rawRow.isSysadmin !== 0 && rawRow.isSysadmin !== '0')) {
    throw new Error(`CRITICAL SAFETY VIOLATION: Test connection has elevated sysadmin role (isSysadmin=${rawRow.isSysadmin})! Must use restricted principal.`);
  }

  // Accepts prodAccess or hasProdAccess (AR2-02)
  const rawProdAccess = rawRow.prodAccess !== undefined ? rawRow.prodAccess : rawRow.hasProdAccess;
  if (rawProdAccess === null || rawProdAccess === undefined || rawProdAccess === '') {
    throw new Error('CRITICAL SAFETY VIOLATION: HAS_DBACCESS(\'dbwins_worldfert9\') returned NULL or undefined (fail-closed)!');
  }
  const prodAccessNum = Number(rawProdAccess);
  if (isNaN(prodAccessNum) || prodAccessNum !== 0 || (rawProdAccess !== 0 && rawProdAccess !== '0')) {
    throw new Error(`CRITICAL SAFETY VIOLATION: Test principal "${loginName}" has direct access to production database "dbwins_worldfert9" (prodAccess=${rawProdAccess})!`);
  }

  const rawPostingFlag = env.COUPON_NATIVE_POSTING_ENABLED !== undefined ? String(env.COUPON_NATIVE_POSTING_ENABLED).trim() : 'false';
  const postingFlagLower = rawPostingFlag.toLowerCase();
  if (postingFlagLower !== 'true' && postingFlagLower !== 'false' && postingFlagLower !== '') {
    throw new Error(`CRITICAL SAFETY VIOLATION: Invalid COUPON_NATIVE_POSTING_ENABLED value "${rawPostingFlag}". Must be "true" or "false"!`);
  }
  const allowWriteback = String(env.ALLOW_TEST_NATIVE_WRITEBACK || '').toLowerCase().trim() === 'true';
  if (postingFlagLower === 'true' && !allowWriteback) {
    throw new Error('CRITICAL SAFETY VIOLATION: COUPON_NATIVE_POSTING_ENABLED=true requires explicit ALLOW_TEST_NATIVE_WRITEBACK=true!');
  }

  return {
    dbName,
    serverName,
    loginName,
    isSysadmin: 0,
    prodAccess: 0,
    postingFlag: postingFlagLower,
    allowTestWriteback: allowWriteback,
  };
}

const WRITE_KEYWORDS_RE = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|MERGE)\b/i;
const PROD_DB_REF_RE = /\bdbwins_worldfert9\b/i;

function stripComments(sql) {
  return sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function assertNoCrossDbWrite(sqlText) {
  if (typeof sqlText !== 'string') return;
  const cleanSql = stripComments(sqlText);
  if (PROD_DB_REF_RE.test(cleanSql) && WRITE_KEYWORDS_RE.test(cleanSql)) {
    throw new Error('CRITICAL SAFETY VIOLATION: Cross-database write targeting production "dbwins_worldfert9" blocked!');
  }
}

async function assertTargetWithQuery(queryFn) {
  if (typeof queryFn !== 'function') {
    throw new Error('assertTargetWithQuery requires a query function');
  }
  const res = await queryFn(`
    SELECT 
      DB_NAME() AS dbName, 
      @@SERVERNAME AS serverName,
      SUSER_SNAME() AS loginName,
      IS_SRVROLEMEMBER('sysadmin') AS isSysadmin,
      HAS_DBACCESS('dbwins_worldfert9') AS prodAccess,
      HAS_DBACCESS('dbwins_worldfert9') AS hasProdAccess
  `);
  return validateTargetRecord(res?.[0]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Localhost UAT Profile Guard & Path Validation (SQL Server 2008 R2)
// ─────────────────────────────────────────────────────────────────────────────

const APPROVED_LOCAL_TARGET = {
  serverName: 'AMYOU-YOGA7\\V2008R2',
  dbName: 'dbwins_worldfert9_local_uat',
  allowedLogins: ['wf_uat_app', 'wf_uat_migrator'],
  appLogin: 'wf_uat_app',
  migratorLogin: 'wf_uat_migrator',
  productVersionPrefix: '10.50.',
  allowedTransports: ['shared memory'],
  knownProtectedUserDatabases: ['dbwins_worldfert9'],
  allowedSystemDatabases: ['master', 'tempdb', 'model', 'msdb'],
};

const APPROVED_LOCAL_REHEARSAL_TARGET = {
  serverName: 'AMYOU-YOGA7\\V2008R2',
  dbName: 'dbwins_worldfert9_rehearsal',
  allowedLogins: ['wf_uat_migrator'],
  appLogin: null,
  migratorLogin: 'wf_uat_migrator',
  productVersionPrefix: '10.50.',
  allowedTransports: ['shared memory'],
  knownProtectedUserDatabases: ['dbwins_worldfert9'],
  allowedSystemDatabases: ['master', 'tempdb', 'model', 'msdb'],
};

/**
 * Validates local UAT database connection record strictly and fail-closed.
 *
 * AR2-04 requirements:
 * - Mandatory role metadata: isSysadmin, isSecurityadmin, isServeradmin, isDbcreator, hasControlServer.
 * - Mandatory originalLogin: non-empty string, must match allowed principal and not sa/elevated.
 * - Mandatory otherUserDbCount: strictly known-zero.
 * - Mandatory hasProdAccess: strictly known-zero.
 */
function validateLocalTargetRecord(rawRow, env = process.env, options = {}) {
  if (!rawRow || typeof rawRow !== 'object') {
    throw new Error('LOCAL TEST SAFETY ERROR: Target query returned no record or invalid record');
  }

  const isRehearsal = options.targetType === 'rehearsal';
  const restoredLocal = !isRehearsal && env.ALLOW_RESTORED_LOCAL_UAT === 'true';
  const approvedTarget = isRehearsal ? APPROVED_LOCAL_REHEARSAL_TARGET : restoredLocal ? { ...APPROVED_LOCAL_TARGET, dbName: 'dbwins_worldfert9' } : APPROVED_LOCAL_TARGET;

  const dbName = typeof rawRow.dbName === 'string' ? rawRow.dbName.trim().toLowerCase() : '';
  const serverName = typeof rawRow.serverName === 'string' ? rawRow.serverName.trim().toLowerCase() : '';
  const loginName = typeof rawRow.loginName === 'string' ? rawRow.loginName.trim().toLowerCase() : '';
  const productVersion = typeof rawRow.productVersion === 'string' ? rawRow.productVersion.trim() : '';
  const netTransport = typeof rawRow.netTransport === 'string' ? rawRow.netTransport.trim().toLowerCase() : '';

  // 1. Database name must match approved UAT DB name exactly
  if (!dbName) {
    throw new Error('LOCAL TEST SAFETY ERROR: Could not determine current DB_NAME()');
  }
  if ((!restoredLocal && dbName === 'dbwins_worldfert9') || dbName.includes('prod')) {
    throw new Error(`CRITICAL LOCAL SAFETY VIOLATION: Refusing execution against production database name "${dbName}"! Must use approved UAT target "${approvedTarget.dbName}".`);
  }
  if (dbName !== approvedTarget.dbName.toLowerCase()) {
    throw new Error(`CRITICAL LOCAL SAFETY VIOLATION: Database name "${dbName}" does not match approved local target "${approvedTarget.dbName}"!`);
  }

  // 2. Exact approved server name
  if (!serverName) {
    throw new Error('LOCAL TEST SAFETY ERROR: Could not determine @@SERVERNAME');
  }
  if (serverName !== approvedTarget.serverName.toLowerCase()) {
    throw new Error(`CRITICAL LOCAL SAFETY VIOLATION: @@SERVERNAME "${serverName}" does not match approved local UAT server "${approvedTarget.serverName}"!`);
  }

  // 3. Exact engine product version prefix (SQL Server 2008 R2: 10.50.%)
  if (!productVersion) {
    throw new Error('LOCAL TEST SAFETY ERROR: Could not determine SERVERPROPERTY(\'ProductVersion\')');
  }
  if (!productVersion.startsWith(approvedTarget.productVersionPrefix)) {
    throw new Error(`CRITICAL LOCAL SAFETY VIOLATION: Engine ProductVersion "${productVersion}" is not SQL Server 2008 R2 (expected prefix "${approvedTarget.productVersionPrefix}")!`);
  }

  // 4. Login principal allowlist & operation-specific binding
  if (!loginName) {
    throw new Error('LOCAL TEST SAFETY ERROR: Could not determine SUSER_SNAME()');
  }
  const normalizedAllowedLogins = approvedTarget.allowedLogins.map(l => l.toLowerCase());
  if (!normalizedAllowedLogins.includes(loginName)) {
    throw new Error(`CRITICAL LOCAL SAFETY VIOLATION: Login "${loginName}" is not an approved local principal (${approvedTarget.allowedLogins.join(' | ')})!`);
  }

  // Operation-specific check
  if (options.operation === 'migration' || options.operation === 'migrator') {
    if (loginName !== approvedTarget.migratorLogin.toLowerCase()) {
      throw new Error(`CRITICAL LOCAL SAFETY VIOLATION: Migration runner requires migrator principal "${approvedTarget.migratorLogin}", but active principal is "${loginName}"!`);
    }
  } else if (options.operation === 'app' || options.operation === 'runtime') {
    if (approvedTarget.appLogin && loginName !== approvedTarget.appLogin.toLowerCase()) {
      throw new Error(`CRITICAL LOCAL SAFETY VIOLATION: Application runtime requires app principal "${approvedTarget.appLogin}", but active principal is "${loginName}"!`);
    }
  }

  // Mandatory originalLogin check (AR2-04: cannot be omitted or defaulted)
  if (!rawRow.originalLogin || typeof rawRow.originalLogin !== 'string' || !rawRow.originalLogin.trim()) {
    throw new Error('CRITICAL LOCAL SAFETY VIOLATION: ORIGINAL_LOGIN() is missing, null, or empty (fail-closed)!');
  }
  const originalLogin = rawRow.originalLogin.trim().toLowerCase();
  if (originalLogin === 'sa' || originalLogin.includes('admin')) {
    throw new Error(`CRITICAL LOCAL SAFETY VIOLATION: ORIGINAL_LOGIN() "${originalLogin}" indicates elevated original principal! Must not originate from sa.`);
  }
  if (!normalizedAllowedLogins.includes(originalLogin)) {
    throw new Error(`CRITICAL LOCAL SAFETY VIOLATION: ORIGINAL_LOGIN() "${originalLogin}" is not an approved principal!`);
  }

  // 5. Fail-closed on all elevated server roles and permissions (Mandatory per AR2-04)
  function assertStrictZero(val, fieldName) {
    if (val === null || val === undefined || typeof val === 'boolean' || val === '') {
      throw new Error(`CRITICAL LOCAL SAFETY VIOLATION: ${fieldName} is missing, null, or boolean (fail-closed, got: ${val})!`);
    }
    const num = Number(val);
    if (isNaN(num) || num !== 0 || (val !== 0 && val !== '0')) {
      throw new Error(`CRITICAL LOCAL SAFETY VIOLATION: Elevated privilege detected on ${fieldName}=${val}! Must be strictly known-zero.`);
    }
  }

  assertStrictZero(rawRow.isSysadmin, 'IS_SRVROLEMEMBER(\'sysadmin\')');
  assertStrictZero(rawRow.isSecurityadmin, 'IS_SRVROLEMEMBER(\'securityadmin\')');
  assertStrictZero(rawRow.isServeradmin, 'IS_SRVROLEMEMBER(\'serveradmin\')');
  assertStrictZero(rawRow.isDbcreator, 'IS_SRVROLEMEMBER(\'dbcreator\')');
  assertStrictZero(rawRow.hasControlServer, 'HAS_PERMS_BY_NAME(null, null, \'CONTROL SERVER\')');

  // 6. System DB Separation vs Protected User Databases:
  // - System databases (master, tempdb, model, msdb) are NOT forbidden.
  // - Access to production database 'dbwins_worldfert9' must be strictly 0:
  const rawProdAccess = rawRow.hasProdAccess !== undefined ? rawRow.hasProdAccess : rawRow.prodAccess;
  if (restoredLocal) {
    if (rawProdAccess !== 1 && rawProdAccess !== '1') throw new Error('Restored local target must have explicit access to its own database');
  } else {
    assertStrictZero(rawProdAccess, 'HAS_DBACCESS(\'dbwins_worldfert9\')');
  }

  // otherUserDbCount must be explicitly provided and strictly 0
  assertStrictZero(rawRow.otherUserDbCount, 'otherUserDbCount');

  // 7. Transport Verification: must be Shared memory
  if (!netTransport) {
    throw new Error('LOCAL TEST SAFETY ERROR: Could not determine net_transport from connection metadata');
  }
  const normalizedTransports = approvedTarget.allowedTransports.map(t => t.toLowerCase());
  if (!normalizedTransports.includes(netTransport)) {
    throw new Error(`CRITICAL LOCAL SAFETY VIOLATION: net_transport "${netTransport}" is not approved (expected: ${approvedTarget.allowedTransports.join(', ')}). Network/TCP connections forbidden for local UAT!`);
  }

  // 8. Runtime posting flag validation:
  const rawPostingFlag = env.COUPON_NATIVE_POSTING_ENABLED !== undefined ? String(env.COUPON_NATIVE_POSTING_ENABLED).trim() : 'false';
  const postingFlagLower = rawPostingFlag.toLowerCase();

  // Validate finite allowed flag values
  if (postingFlagLower !== 'true' && postingFlagLower !== 'false' && postingFlagLower !== '') {
    throw new Error(`CRITICAL LOCAL SAFETY VIOLATION: Invalid COUPON_NATIVE_POSTING_ENABLED value "${rawPostingFlag}". Must be "true" or "false"!`);
  }

  const postingFlagEnabled = postingFlagLower === 'true';
  const allowLocalWriteback = String(env.ALLOW_LOCAL_TEST_NATIVE_WRITEBACK || '').toLowerCase().trim() === 'true';
  const allowRemoteWriteback = String(env.ALLOW_TEST_NATIVE_WRITEBACK || '').toLowerCase().trim() === 'true';

  if (postingFlagEnabled) {
    if (!allowLocalWriteback) {
      if (allowRemoteWriteback) {
        throw new Error('CRITICAL LOCAL SAFETY VIOLATION: COUPON_NATIVE_POSTING_ENABLED=true on local UAT strictly requires ALLOW_LOCAL_TEST_NATIVE_WRITEBACK=true! Remote flag ALLOW_TEST_NATIVE_WRITEBACK cannot unlock local target.');
      }
      throw new Error('CRITICAL LOCAL SAFETY VIOLATION: COUPON_NATIVE_POSTING_ENABLED=true requires explicit ALLOW_LOCAL_TEST_NATIVE_WRITEBACK=true!');
    }
  }

  return {
    dbName,
    serverName,
    loginName,
    originalLogin,
    productVersion,
    netTransport,
    isSysadmin: 0,
    isSecurityadmin: 0,
    isServeradmin: 0,
    isDbcreator: 0,
    hasControlServer: 0,
    hasProdAccess: 0,
    otherUserDbCount: 0,
    postingFlag: postingFlagEnabled ? 'true' : 'false',
    allowWriteback: allowLocalWriteback,
  };
}

/**
 * Validates that an override relative path stays strictly within baseDir.
 */
function validateCompatPath(baseDir, relativePath, options = {}) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new Error('Override path must be a non-empty string');
  }
  if (relativePath.includes('\0')) {
    throw new Error('Null byte injection detected in override path');
  }

  // Reject absolute paths upfront (including Windows drive letters and UNC paths)
  if (path.isAbsolute(relativePath) || /^[a-zA-Z]:[/\\]/.test(relativePath) || relativePath.startsWith('//') || relativePath.startsWith('\\\\')) {
    throw new Error(`Absolute path rejected: "${relativePath}". Only relative paths within compat directory are permitted.`);
  }

  const resolvedBase = path.resolve(baseDir);
  const resolved = path.resolve(resolvedBase, relativePath);
  const rel = path.relative(resolvedBase, resolved);

  if (rel.startsWith('..') || path.isAbsolute(rel) || rel === '') {
    throw new Error(`Path traversal escape detected: "${relativePath}" escapes "${baseDir}"`);
  }

  // Physical filesystem containment check
  const fs = options.fs || require('fs');
  if (fs.existsSync(resolvedBase)) {
    const realBase = fs.realpathSync(resolvedBase);
    if (fs.existsSync(resolved)) {
      const realTarget = fs.realpathSync(resolved);
      const relReal = path.relative(realBase, realTarget);
      if (relReal.startsWith('..') || path.isAbsolute(relReal) || relReal === '') {
        throw new Error(`Reparse/symlink traversal escape detected: "${relativePath}" resolves to "${realTarget}" outside "${realBase}"`);
      }
    } else {
      let current = path.dirname(resolved);
      while (current && !fs.existsSync(current) && current !== path.dirname(current)) {
        current = path.dirname(current);
      }
      if (fs.existsSync(current)) {
        const realAncestor = fs.realpathSync(current);
        const relAncestor = path.relative(realBase, realAncestor);
        if (relAncestor.startsWith('..') || path.isAbsolute(relAncestor)) {
          throw new Error(`Reparse/symlink directory escape detected in ancestor for "${relativePath}"`);
        }
      }
    }
  }

  return resolved;
}

/**
 * Resolves effective migration considering target profile exclusion and dialect overrides.
 *
 * AR2-01: Profile dialect check supports both local_uat and local_rehearsal (sql2008).
 * AR2-05: Returns full metadata for both original and executed artifacts.
 */
function resolveEffectiveMigration(fileName, fileContent, targetProfile, policy = {}, options = {}) {
  // Step 1: Global Exclusion Check (both files and patterns)
  const excludedPatterns = (policy.excludedPatterns || []).map(p => {
    try { return new RegExp(p, 'i'); }
    catch (_) { return null; }
  }).filter(Boolean);

  if (policy.excludedFiles?.includes(fileName) || excludedPatterns.some(p => p.test(fileName))) {
    return {
      status: 'EXCLUDED',
      reason: 'GLOBAL_EXCLUDED',
      fileName,
      targetProfile,
    };
  }

  // Step 2: Target Profile Exclusion Check (LU-01) - Takes precedence over dialect override!
  let profileDialect = null;
  if (targetProfile) {
    if (!policy || !policy.targetProfiles || !policy.targetProfiles[targetProfile]) {
      throw new Error(`UNKNOWN_TARGET_PROFILE: Target profile "${targetProfile}" is not configured in migration policy.`);
    }
    const profileConfig = policy.targetProfiles[targetProfile];
    profileDialect = profileConfig.dialect || null;

    if (profileConfig.excludedFiles?.includes(fileName)) {
      return {
        status: 'EXCLUDED',
        reason: 'PROFILE_EXCLUDED',
        fileName,
        targetProfile,
      };
    }

    // R3-03: Unconditional 074 deny on any local 2008 target profile even under malformed policy
    const isLocal2008 = profileDialect === 'sql2008' || targetProfile.startsWith('local_');
    if (isLocal2008 && fileName === '074_fix_winspeed_legacy_raiserror.sql') {
      return {
        status: 'EXCLUDED',
        reason: 'LOCAL_2008_SAFETY_EXCLUSION',
        fileName,
        targetProfile,
      };
    }
  }

  // Step 3: Dialect Override Resolution (AR2-01 & AR2-05)
  // Only apply dialect override if the target profile explicitly uses sql2008 dialect!
  if (profileDialect === 'sql2008' && policy.dialectOverrides && policy.dialectOverrides[fileName]) {
    const override = policy.dialectOverrides[fileName];
    const origHash = sha256(fileContent);
    if (origHash.toLowerCase() !== String(override.originalHash || '').toLowerCase()) {
      throw new Error(`ORIGINAL_HASH_DRIFT: Original checksum mismatch for ${fileName} (expected: ${override.originalHash}, actual: ${origHash})`);
    }

    const actualOrigBatches = splitBatches(fileContent);
    if (override.originalBatchCount !== undefined && Number(override.originalBatchCount) !== actualOrigBatches.length) {
      throw new Error(`ORIGINAL_BATCH_COUNT_MISMATCH: Declared batch count ${override.originalBatchCount} does not match actual split batches ${actualOrigBatches.length} for ${fileName}`);
    }

    const compatDir = options.compatDir || path.resolve(__dirname, 'migrations/compat/sql2008');
    const resolvedPath = validateCompatPath(compatDir, override.executedFile, options);

    const executedContent = options.readOverrideFn
      ? options.readOverrideFn(resolvedPath)
      : (options.fs || require('fs')).readFileSync(resolvedPath, 'utf8');

    const execHash = sha256(executedContent);
    if (execHash.toLowerCase() !== String(override.executedHash || '').toLowerCase()) {
      throw new Error(`EXECUTED_HASH_DRIFT: Executed checksum mismatch for ${override.executedFile} (expected: ${override.executedHash}, actual: ${execHash})`);
    }

    const actualExecBatches = splitBatches(executedContent);
    if (override.executedBatchCount !== undefined && Number(override.executedBatchCount) !== actualExecBatches.length) {
      throw new Error(`EXECUTED_BATCH_COUNT_MISMATCH: Declared batch count ${override.executedBatchCount} does not match actual split batches ${actualExecBatches.length} for ${override.executedFile}`);
    }

    return {
      status: 'OVERRIDE',
      fileName,
      targetProfile,
      original: {
        fileName,
        hash: origHash,
        batchCount: actualOrigBatches.length,
        batches: actualOrigBatches,
        content: fileContent,
      },
      executed: {
        fileName: override.executedFile,
        hash: execHash,
        batchCount: actualExecBatches.length,
        batches: actualExecBatches,
        content: executedContent,
        resolvedPath,
      },
      dialect: override.dialect || 'sql2008',
    };
  }

  // Step 4: Standard Migration Resolution with full metadata
  const standardBatches = splitBatches(fileContent);
  const contentHash = sha256(fileContent);
  return {
    status: 'STANDARD',
    fileName,
    targetProfile,
    original: {
      fileName,
      hash: contentHash,
      batchCount: standardBatches.length,
      batches: standardBatches,
      content: fileContent,
    },
    executed: {
      fileName,
      hash: contentHash,
      batchCount: standardBatches.length,
      batches: standardBatches,
      content: fileContent,
    },
    dialect: 'standard',
  };
}

/**
 * Asynchronously runs local target query using the provided queryFn and validates the record.
 */
async function assertLocalTargetWithQuery(queryFn, options = {}) {
  if (typeof queryFn !== 'function') {
    throw new Error('assertLocalTargetWithQuery requires a query function');
  }
  const res = await queryFn(`
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
      (SELECT TOP 1 net_transport FROM sys.dm_exec_connections WHERE session_id = @@SPID) AS netTransport
  `);
  return validateLocalTargetRecord(res?.[0], process.env, options);
}

module.exports = {
  APPROVED_TARGET,
  validateTargetRecord,
  assertNoCrossDbWrite,
  assertTargetWithQuery,
  APPROVED_LOCAL_TARGET,
  APPROVED_LOCAL_REHEARSAL_TARGET,
  validateLocalTargetRecord,
  validateCompatPath,
  resolveEffectiveMigration,
  assertLocalTargetWithQuery,
  sha256,
  splitBatches,
};
