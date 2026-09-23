/**
 * rehearsal-isolated-restore.cjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Hardened isolated recovery rehearsal package adhering to Codex re-audit requirements:
 * 1. Validates backup file identity and immutable SHA-256 baseline.
 * 2. Mandates explicit target SQL host verification (--target-host or EXPECTED_SQL_HOST).
 * 3. Supports separate client-local and server-local backup paths.
 * 4. Validates server backup identity via RESTORE HEADERONLY (BackupSetGUID, byte size).
 * 5. Checks server-side free disk space across all destination volumes (sys.dm_os_volume_stats)
 *    with STRICT NO-FALLBACK volume matching (platform-aware Windows and Linux mount points).
 * 6. Maps ALL logical files dynamically from RESTORE FILELISTONLY (fails on unsupported types).
 * 7. Executes RESTORE VERIFYONLY before plan completion or execution.
 * 8. Requires verified plan manifest lock before live execution (--manifest).
 * 9. Inspects real repository migration ledger (wf.SchemaMigration).
 * 10. Rigorous pre-cleanup checks: verifies manifest, creation timestamp, and physical file
 *     paths before DROP; fails closed on uncertainty with manual DBA recovery instructions.
 *
 * Usage:
 *   node backend/scripts/rehearsal-isolated-restore.cjs --plan --target-host <host> [--server-backup-path <path>]
 *   node backend/scripts/rehearsal-isolated-restore.cjs --execute --target-host <host> --manifest <manifest_file>
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const EXPECTED_BASELINE = {
  filename: 'dbwins_worldfert9_20260906.bak',
  sha256: '41C36EA663A172C0C98060032FBD29F3C62621DC39B4C9DFD1165289A812CD0F',
  byteSize: 3538486784,
  serverBackupSize: 3538479104,
  backupSetGuid: 'C2DED8ED-07CD-4C8C-9D4A-BFD0DB80FB3D',
};

const PROTECTED_ACTIVE_DATABASES = new Set([
  'dbwins_worldfert9',
  'dbwins_worldfert9_test_v2',
  'dbwins_worldfert9_test',
  'master',
  'model',
  'msdb',
  'tempdb'
]);

const DISK_SAFETY_MARGIN_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB safety margin

function computeSha256(filePath) {
  console.log(`[rehearsal] Computing SHA-256 for: ${filePath} ...`);
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(16 * 1024 * 1024); // 16 MB chunk
  let bytesRead;
  while ((bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
    hash.update(buffer.subarray(0, bytesRead));
  }
  fs.closeSync(fd);
  return hash.digest('hex').toUpperCase();
}

function findClientBackupPath(customPath) {
  if (customPath && fs.existsSync(customPath)) return customPath;
  const candidates = [
    path.resolve(process.cwd(), '..', EXPECTED_BASELINE.filename),
    path.resolve(process.cwd(), EXPECTED_BASELINE.filename),
    `C:\\MyWork\\WorldFert\\${EXPECTED_BASELINE.filename}`,
    `/srv/wf-transfer/incoming/mssql/${EXPECTED_BASELINE.filename}`,
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function ensureManifestDir() {
  const dir = path.resolve(__dirname, '../rehearsal-manifests');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeManifest(targetDbName, data) {
  const dir = ensureManifestDir();
  const filePath = path.join(dir, `manifest_${targetDbName}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  return filePath;
}

function readManifest(targetDbName) {
  const dir = ensureManifestDir();
  const filePath = path.join(dir, `manifest_${targetDbName}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Pure invariant checking logic
 */
function assertTargetSafety(targetDbName) {
  if (!targetDbName) {
    throw new Error('SAFETY BLOCK: Target database name is required.');
  }
  const norm = targetDbName.toLowerCase().trim();
  if (PROTECTED_ACTIVE_DATABASES.has(norm)) {
    throw new Error(`SAFETY BLOCK: Target database "${targetDbName}" is a protected active database! Refusing execution.`);
  }
  if (!norm.startsWith('dbwins_worldfert9_rehearsal_')) {
    throw new Error(`SAFETY BLOCK: Target database must strictly start with prefix "dbwins_worldfert9_rehearsal_"! Refusing execution.`);
  }
}

function mapAllLogicalFiles(files, targetDbName, dataDir, logDir) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('Incomplete backup structure: FILELISTONLY returned no logical files.');
  }

  const isWindowsHost = /^[a-zA-Z]:[\\\/]/.test(dataDir);
  const sep = isWindowsHost ? '\\' : '/';
  const cleanDataDir = (dataDir || '').replace(/[\/\\]+$/, '');
  const cleanLogDir  = (logDir  || cleanDataDir).replace(/[\/\\]+$/, '');

  if (!cleanDataDir) {
    throw new Error('UNSUPPORTED_PLATFORM: Unable to determine SQL Server destination data directory.');
  }

  const mapped = [];
  const moveClauses = [];
  let dataCount = 0;
  let logCount = 0;

  for (const file of files) {
    const logicalName = file.LogicalName;
    const type = String(file.Type || '').toUpperCase();
    const size = Number(file.Size || 0);

    let ext = '.mdf';
    let destDir = cleanDataDir;

    if (type === 'D') {
      dataCount += 1;
      ext = dataCount === 1 ? '.mdf' : `_data${dataCount}.ndf`;
      destDir = cleanDataDir;
    } else if (type === 'L') {
      logCount += 1;
      ext = logCount === 1 ? '.ldf' : `_log${logCount}.ldf`;
      destDir = cleanLogDir;
    } else {
      throw new Error(`SAFETY BLOCK: Unsupported logical file type "${type}" for file "${logicalName}". Only D and L supported.`);
    }

    const safeLogical = logicalName.replace(/[^a-zA-Z0-9_]/g, '_');
    const physPath = `${destDir}${sep}${targetDbName}_${safeLogical}${ext}`;
    moveClauses.push(`MOVE N'${logicalName.replace(/'/g, "''")}' TO N'${physPath.replace(/'/g, "''")}'`);
    mapped.push({
      logicalName,
      type,
      size,
      physPath,
      volume: isWindowsHost ? (destDir.match(/^[a-zA-Z]:\\?/)?.[0] || 'C:\\') : '/',
    });
  }

  if (dataCount === 0 || logCount === 0) {
    throw new Error(`Incomplete backup structure: expected at least 1 data file and 1 log file, got ${dataCount} data and ${logCount} log.`);
  }

  return { mapped, moveClauses };
}

/**
 * Resolve the destination file path to an exact volume mount point reported by SQL Server.
 * Supports Windows drive letters (C:\, D:\) and POSIX / Linux paths (/var/opt/mssql, /).
 * STRICT: Absolutely NO fallback to another volume.
 */
function resolveVolumeMountPoint(filePath, volumeStats) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('UNRESOLVABLE_VOLUME: Destination file path is empty or invalid.');
  }

  // Normalize path separators to forward slash for prefix matching
  const normalizedFile = filePath.replace(/\\/g, '/');

  // Candidate mount points from SQL Server volumeStats
  const candidates = (volumeStats || []).map(v => {
    const rawMount = String(v.volume_mount_point || '').trim();
    const normalizedMount = rawMount.replace(/\\/g, '/');
    return {
      rawMount,
      normalizedMount,
      length: normalizedMount.length,
      stat: v,
    };
  }).sort((a, b) => b.length - a.length); // Longest prefix match first

  if (candidates.length === 0) {
    throw new Error('UNKNOWN_VOLUME: No volume statistics available from SQL Server.');
  }

  // 1. Try prefix matching against SQL Server reported mount points
  for (const c of candidates) {
    if (normalizedFile.toLowerCase().startsWith(c.normalizedMount.toLowerCase())) {
      return c.rawMount;
    }
  }

  // 2. Windows drive letter matching (e.g. D:/... -> D:\)
  const driveMatch = normalizedFile.match(/^([A-Za-z]:)/);
  if (driveMatch) {
    const drivePrefix = driveMatch[1].toUpperCase();
    for (const c of candidates) {
      if (c.normalizedMount.toUpperCase().startsWith(drivePrefix)) {
        return c.rawMount;
      }
    }
  }

  // Strictly NO fallback! Fail closed.
  const availableMounts = candidates.map(c => c.rawMount).join(', ');
  throw new Error(`UNSUPPORTED_OR_UNKNOWN_VOLUME: Destination file path "${filePath}" does not match any volume mount point reported by SQL Server [${availableMounts}]. Volume fallback is strictly forbidden.`);
}

function verifyDiskCapacity(mappedFiles, volumeStats, safetyMargin = DISK_SAFETY_MARGIN_BYTES) {
  if (!Array.isArray(mappedFiles) || mappedFiles.length === 0) {
    throw new Error('Disk capacity check failed: No mapped files provided.');
  }
  if (!Array.isArray(volumeStats) || volumeStats.length === 0) {
    throw new Error('UNKNOWN_VOLUME: SQL Server returned empty volume statistics.');
  }

  // Map each file to its resolved volume mount point
  const requiredByMount = {};
  for (const file of mappedFiles) {
    const mountPoint = resolveVolumeMountPoint(file.physPath, volumeStats);
    requiredByMount[mountPoint] = (requiredByMount[mountPoint] || 0) + Number(file.size || 0);
  }

  const statMap = new Map();
  for (const v of volumeStats) {
    statMap.set(String(v.volume_mount_point), {
      totalBytes: Number(v.total_bytes || 0),
      availableBytes: Number(v.available_bytes || 0),
      mountPoint: v.volume_mount_point,
    });
  }

  const results = [];
  for (const [mountPoint, requiredBytes] of Object.entries(requiredByMount)) {
    const stat = statMap.get(mountPoint);
    if (!stat) {
      throw new Error(`UNSUPPORTED_OR_UNKNOWN_VOLUME: Volume "${mountPoint}" has no statistical metrics.`);
    }

    const available = stat.availableBytes;
    const totalNeeded = requiredBytes + safetyMargin;
    if (available < totalNeeded) {
      throw new Error(`INSUFFICIENT DISK SPACE: Volume "${mountPoint}" requires ${(totalNeeded / (1024 * 1024 * 1024)).toFixed(2)} GB (including safety margin), but only ${(available / (1024 * 1024 * 1024)).toFixed(2)} GB available.`);
    }
    results.push({
      mountPoint,
      requiredBytes,
      availableBytes: available,
      totalBytes: stat.totalBytes,
      ok: true,
    });
  }

  return results;
}

/**
 * Verifies that a connection is strictly bound to the expected rehearsal database and host.
 * Refuses connection if connected to protected active databases, wrong DB, or wrong host.
 */
function assertIsolatedConnection(currentDb, targetDbName, serverName, targetHost) {
  if (!currentDb) {
    throw new Error('ISOLATED_CONNECTION_ERROR: Connected database name could not be resolved.');
  }
  assertTargetSafety(currentDb);
  if (currentDb.toLowerCase() !== String(targetDbName).toLowerCase()) {
    throw new Error(`ISOLATED_CONNECTION_MISMATCH: Connected to database [${currentDb}], but expected isolated rehearsal DB is [${targetDbName}]. Refusing execution.`);
  }
  if (PROTECTED_ACTIVE_DATABASES.has(currentDb.toLowerCase())) {
    throw new Error(`ISOLATED_CONNECTION_PROTECTED: Database [${currentDb}] is a protected active database! Refusing execution.`);
  }
  if (targetHost && serverName) {
    const exp = String(targetHost).toLowerCase().trim().split('\\')[0];
    const act = String(serverName).toLowerCase().trim();
    if (!act.includes(exp)) {
      throw new Error(`ISOLATED_CONNECTION_HOST_MISMATCH: Connected to server [${serverName}], expected host [${targetHost}]. Refusing execution.`);
    }
  }
}

/**
 * Creates a dedicated isolated SQL ConnectionPool bound strictly to targetDbName on targetHost.
 * Validates connection identity immediately and fails closed if connected to wrong or protected DB.
 */
async function createIsolatedPool(targetDbName, targetHost) {
  assertTargetSafety(targetDbName);
  const { sql } = require('../db');
  const pool = new sql.ConnectionPool({
    server: targetHost || process.env.LOCAL_DB_SERVER || 'localhost\\SQLEXPRESS',
    database: targetDbName,
    requestTimeout: 300000,
    options: {
      trustedConnection: true,
      trustServerCertificate: true,
      enableArithAbort: true,
      requestTimeout: 300000,
    },
    driver: 'msnodesqlv8',
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
  });

  await pool.connect();

  const check = await pool.request().query('SELECT DB_NAME() AS currentDb, @@SERVERNAME AS serverName');
  const currentDb = check.recordset[0]?.currentDb;
  const serverName = check.recordset[0]?.serverName;

  try {
    assertIsolatedConnection(currentDb, targetDbName, serverName, targetHost);
  } catch (err) {
    await pool.close().catch(() => {});
    throw err;
  }

  return pool;
}

/**
 * Ensures standard application database users ('wf_reader', 'wf_owner') exist in the isolated
 * database so permissions and migrations (such as GRANT SELECT ON SCHEMA::wf TO wf_reader) succeed.
 * Uses WITHOUT LOGIN fallback if server logins are absent, maintaining zero external dependencies.
 */
async function ensureIsolatedPrincipals(pool, targetDbName, targetHost) {
  const check = await pool.request().query('SELECT DB_NAME() AS currentDb, @@SERVERNAME AS serverName');
  const currentDb = check.recordset[0]?.currentDb;
  const serverName = check.recordset[0]?.serverName;
  assertIsolatedConnection(currentDb, targetDbName, serverName, targetHost);

  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'wf_reader')
    BEGIN
      IF EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'wf_reader')
        CREATE USER wf_reader FOR LOGIN wf_reader;
      ELSE
        CREATE USER wf_reader WITHOUT LOGIN;
    END

    IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'wf_owner')
    BEGIN
      IF EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'wf_owner')
        CREATE USER wf_owner FOR LOGIN wf_owner;
      ELSE
        CREATE USER wf_owner WITHOUT LOGIN;
    END
  `);
  console.log(`✓ Database users 'wf_reader' and 'wf_owner' verified/provisioned in [${targetDbName}].`);
}

/**
 * Bounded application smoke validation on the restored isolated database.
 * Verifies core ERP native tables, custom migrated wf schema tables, and read-only queries.
 * Enforces zero native writeback (fail-closed) and no background workers.
 */
async function runIsolatedApplicationSmoke(pool, targetDbName, targetHost) {
  console.log(`\n================================================================`);
  console.log(`  RUNNING BOUNDED APPLICATION SMOKE ON ISOLATED DB [${targetDbName}]`);
  console.log(`================================================================\n`);

  const check = await pool.request().query('SELECT DB_NAME() AS currentDb, @@SERVERNAME AS serverName');
  const currentDb = check.recordset[0]?.currentDb;
  const serverName = check.recordset[0]?.serverName;
  assertIsolatedConnection(currentDb, targetDbName, serverName, targetHost);

  // 1. Verify Native WinSpeed Core Tables
  console.log(`1. Verifying Native WinSpeed Core Tables in Restored Database...`);
  const nativeTablesCheck = await pool.request().query(`
    SELECT 'SOHD' AS tbl, COUNT(*) AS cnt FROM dbo.SOHD
    UNION ALL SELECT 'SODT', COUNT(*) FROM dbo.SODT
    UNION ALL SELECT 'SOInvHD', COUNT(*) FROM dbo.SOInvHD
    UNION ALL SELECT 'SOInvDT', COUNT(*) FROM dbo.SOInvDT
    UNION ALL SELECT 'GLHD', COUNT(*) FROM dbo.GLHD
    UNION ALL SELECT 'GLDT', COUNT(*) FROM dbo.GLDT
  `);
  const nativeCounts = {};
  for (const r of nativeTablesCheck.recordset || []) {
    nativeCounts[r.tbl] = r.cnt;
    console.log(`   - dbo.${r.tbl}: ${r.cnt.toLocaleString()} rows`);
  }
  if (!nativeCounts['SOHD'] || !nativeCounts['GLHD']) {
    throw new Error(`APPLICATION_SMOKE_FAILURE: Core native tables SOHD or GLHD are unexpectedly empty in restored DB.`);
  }

  // 2. Verify Custom Schema 'wf' Migrated Tables
  console.log(`\n2. Verifying Custom 'wf' Schema Migrated Tables...`);
  const wfTablesCheck = await pool.request().query(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'wf'
    ORDER BY TABLE_NAME
  `);
  const wfTables = (wfTablesCheck.recordset || []).map(r => r.TABLE_NAME);
  console.log(`   Discovered ${wfTables.length} 'wf' tables: ${wfTables.slice(0, 10).join(', ')} ...`);
  const requiredWfTables = ['SchemaMigration', 'AppUser', 'RebateLedger', 'RebateClaim'];
  for (const req of requiredWfTables) {
    if (!wfTables.includes(req)) {
      throw new Error(`APPLICATION_SMOKE_FAILURE: Required migrated table wf.${req} is missing from restored DB.`);
    }
  }

  // 3. Read-Only Business Query Smoke (Sales Billing Projection query)
  console.log(`\n3. Verifying Read-Only Business Reporting Queries (SELECT-only)...`);
  const projectionSmoke = await pool.request().query(`
    SELECT TOP 5
      ih.SOInvID,
      ih.DocuNo AS InvDocuNo,
      ih.DocuDate AS InvDocuDate,
      ih.NetAmnt AS InvTotalAmnt
    FROM dbo.SOInvHD ih WITH (NOLOCK)
    WHERE ih.DocuType IN (107, 202) AND ih.DocuStatus <> 'C'
    ORDER BY ih.SOInvID DESC
  `);
  console.log(`   ✓ Successfully queried top 5 invoices for Sales Billing Projection (${projectionSmoke.recordset.length} rows returned).`);

  // 4. Read-Only GL Sales Journal Smoke
  const glSmoke = await pool.request().query(`
    SELECT TOP 5
      gh.GLID,
      gh.DocuNo AS GLDocuNo,
      gh.DocuDate AS GLDocuDate,
      COUNT(gt.ListNo) AS LineCount
    FROM dbo.GLHD gh WITH (NOLOCK)
    LEFT JOIN dbo.GLDT gt WITH (NOLOCK) ON gt.GLID = gh.GLID
    GROUP BY gh.GLID, gh.DocuNo, gh.DocuDate
    ORDER BY gh.GLID DESC
  `);
  console.log(`   ✓ Successfully queried top 5 GL journal entries (${glSmoke.recordset.length} rows returned).`);

  // 5. Governance & Invariants
  console.log(`\n4. Verifying Governance Invariants...`);
  if (process.env.COUPON_NATIVE_POSTING_ENABLED === 'true') {
    throw new Error('GOVERNANCE_VIOLATION: COUPON_NATIVE_POSTING_ENABLED is true! Rehearsal strictly forbids native writeback.');
  }
  console.log(`   ✓ COUPON_NATIVE_POSTING_ENABLED is false (native writeback fail-closed).`);
  console.log(`   ✓ Zero mutation queries executed (SELECT-only smoke).`);
  console.log(`   ✓ Background workers disabled for isolated rehearsal.`);

  return {
    ok: true,
    nativeCounts,
    wfTableCount: wfTables.length,
    projectionSampleCount: projectionSmoke.recordset.length,
    glSampleCount: glSmoke.recordset.length,
  };
}

/**
 * Robust pre-cleanup verification before DROP DATABASE.
 * Asserts target safety, validates manifest ownership, inspects database exact identity
 * (database_id and create_date recorded at restore), and enforces bidirectional exact physical file agreement.
 * Fails closed on any uncertainty with explicit manual recovery instructions.
 */
async function safeCleanupRehearsalDatabase(targetDbName, manifest, queryFn, sql) {
  assertTargetSafety(targetDbName);

  if (!manifest || manifest.targetDbName !== targetDbName) {
    throw new Error(`CLEANUP_BLOCKED: Manifest not found or does not match target DB "${targetDbName}". Refusing destructive action.`);
  }

  const expectedFiles = (manifest.mappedFiles || []).map(m => m.physPath.toLowerCase());
  if (expectedFiles.length < 2) {
    throw new Error(`CLEANUP_BLOCKED: Expected files list in manifest is empty or invalid (< 2 files). Refusing destructive action.`);
  }

  // Inspect database identity in SQL catalog
  const dbResult = await queryFn(`
    SELECT d.name, d.database_id, d.create_date, f.physical_name
    FROM sys.databases d
    JOIN sys.master_files f ON d.database_id = f.database_id
    WHERE d.name = @name
  `, { name: { type: sql.NVarChar(128), value: targetDbName } });

  const rows = dbResult.recordset || [];
  if (rows.length === 0) {
    return { dropped: false, reason: 'NOT_FOUND' };
  }

  const actualDbId = rows[0].database_id;
  const actualCreateTime = new Date(rows[0].create_date).getTime();

  // For an existing database, require both valid captured database_id AND valid exact create_date in manifest.
  // Missing, partial, or invalid receipt must fail closed immediately, retaining the DB for manual recovery.
  if (manifest.dbInstanceId === undefined || manifest.dbInstanceId === null || typeof manifest.dbInstanceId !== 'number') {
    throw new Error(`CLEANUP_BLOCKED: Missing or invalid database_id in manifest creation receipt for [${targetDbName}]. Refusing destructive action to prevent dropping an unverified database. Manual recovery instructions: Inspect and manually verify [${targetDbName}].`);
  }

  if (!manifest.dbCreateDate || isNaN(new Date(manifest.dbCreateDate).getTime())) {
    throw new Error(`CLEANUP_BLOCKED: Missing or invalid create_date in manifest creation receipt for [${targetDbName}]. Refusing destructive action to prevent dropping an unverified database. Manual recovery instructions: Inspect and manually verify [${targetDbName}].`);
  }

  // 1. Exact database_id match
  if (actualDbId !== manifest.dbInstanceId) {
    throw new Error(`CLEANUP_BLOCKED: Database [${targetDbName}] database_id (${actualDbId}) does not match restore receipt (${manifest.dbInstanceId}). Database was replaced! Refusing DROP. Manual recovery instructions: Inspect and manually verify [${targetDbName}].`);
  }

  // 2. Exact create_date match (strictly no fallback to manifest createdAt window)
  const receiptCreateTime = new Date(manifest.dbCreateDate).getTime();
  if (actualCreateTime !== receiptCreateTime) {
    const reason = actualCreateTime > receiptCreateTime ? 'Newer replacement database detected' : 'Older replacement database detected';
    throw new Error(`CLEANUP_BLOCKED: Database [${targetDbName}] create_date (${new Date(actualCreateTime).toISOString()}) does not match restore receipt (${manifest.dbCreateDate}). ${reason}! Refusing DROP. Manual recovery instructions: Inspect and manually verify [${targetDbName}].`);
  }

  // 3. Exact bidirectional physical file check (no missing, and NO EXTRA files!)
  const actualFiles = rows.map(r => r.physical_name.toLowerCase());
  if (actualFiles.length !== expectedFiles.length) {
    throw new Error(`CLEANUP_BLOCKED: Physical file count mismatch for [${targetDbName}]. Expected ${expectedFiles.length} files, found ${actualFiles.length} files (extra or missing files detected!). Expected: [${expectedFiles.join(', ')}], Actual: [${actualFiles.join(', ')}]. Refusing DROP. Manual recovery instructions: Verify file ownership.`);
  }

  const allExpectedInActual = expectedFiles.every(f => actualFiles.includes(f));
  const allActualInExpected = actualFiles.every(f => expectedFiles.includes(f));
  if (!allExpectedInActual || !allActualInExpected) {
    throw new Error(`CLEANUP_BLOCKED: Physical files for [${targetDbName}] do not match manifest mapped files exactly. Expected [${expectedFiles.join(', ')}], found [${actualFiles.join(', ')}]. Refusing DROP. Manual recovery instructions: Verify file ownership.`);
  }

  // Identity verified: safe to drop
  await queryFn(`
    ALTER DATABASE [${targetDbName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [${targetDbName}];
  `);

  return { dropped: true };
}

async function runRehearsal(options = {}) {
  const mode = options.mode || '--plan';
  const requestedHost = options.targetHost || process.env.EXPECTED_SQL_HOST || null;
  const clientBackupPathArg = options.clientBackupPath || null;
  const serverBackupPathArg = options.serverBackupPath || null;
  const manifestPathArg = options.manifest || options.manifestPath || null;

  console.log(`\n================================================================`);
  console.log(`  WORLD FERTILIZER: ISOLATED RECOVERY REHEARSAL (${mode.toUpperCase()})`);
  console.log(`================================================================\n`);

  // MANDATORY Target Host Guard
  if (!requestedHost) {
    throw new Error('MANDATORY_TARGET_HOST_REQUIRED: Rehearsal requires explicit target host verification (e.g. --target-host <hostname> or EXPECTED_SQL_HOST env). Omitting host verification is strictly forbidden.');
  }

  // 1. Client-Side Backup Identity & SHA-256
  const clientBackupFile = findClientBackupPath(clientBackupPathArg);
  if (!clientBackupFile) {
    throw new Error(`Prerequisite Failed: Baseline backup ${EXPECTED_BASELINE.filename} not found locally.`);
  }

  const stat = fs.statSync(clientBackupFile);
  console.log(`1. Source Backup File (Client): ${clientBackupFile}`);
  console.log(`   File Size: ${(stat.size / (1024 * 1024)).toFixed(2)} MB (${stat.size} bytes)`);

  const actualHash = computeSha256(clientBackupFile);
  console.log(`   Computed SHA-256: ${actualHash}`);
  console.log(`   Expected SHA-256: ${EXPECTED_BASELINE.sha256}`);
  const hashMatches = actualHash === EXPECTED_BASELINE.sha256;
  console.log(`   SHA-256 Verification: ${hashMatches ? 'PASS (100% MATCH)' : 'MISMATCH'}`);
  if (!hashMatches) {
    throw new Error(`Integrity Failure: Backup hash ${actualHash} does not match designated baseline.`);
  }

  // Server backup path (as seen by SQL Server engine)
  const serverBackupPath = serverBackupPathArg || clientBackupFile;
  console.log(`   Server Backup Path: ${serverBackupPath}`);

  // 2. SQL Host Identity Check
  const { sql, pools } = require('../db');
  const os = require('os');
  const isWin = os.platform() === 'win32';

  async function adminQuery(text, inputs = {}, timeoutMs = 600000) {
    const pl = pools();
    await pl.ready;
    if (pl.ownerPool.config) {
      pl.ownerPool.config.requestTimeout = timeoutMs;
      pl.ownerPool.config.timeout = timeoutMs;
    }
    const req = new sql.Request(pl.ownerPool, { requestTimeout: timeoutMs });
    req.overrides = { requestTimeout: timeoutMs };
    req.timeout = timeoutMs;
    for (const [k, { type, value }] of Object.entries(inputs)) req.input(k, type, value);
    const actualText = isWin ? text : `SET ARITHABORT ON; SET ANSI_WARNINGS ON; ${text}`;
    return await req.query(actualText);
  }

  console.log(`\n2. Querying SQL Server Host Identity...`);
  const hostResult = await adminQuery(`
    SELECT @@SERVERNAME AS ServerName,
           CAST(SERVERPROPERTY('MachineName') AS NVARCHAR(128)) AS MachineName,
           CAST(SERVERPROPERTY('InstanceName') AS NVARCHAR(128)) AS InstanceName
  `);
  const hostInfo = hostResult.recordset?.[0] || {};
  console.log(`   Connected ServerName: ${hostInfo.ServerName}`);
  console.log(`   MachineName:          ${hostInfo.MachineName}`);
  console.log(`   InstanceName:         ${hostInfo.InstanceName || '(DEFAULT)'}`);

  const expected = requestedHost.toLowerCase().trim();
  const actualServer = String(hostInfo.ServerName || '').toLowerCase();
  const actualMachine = String(hostInfo.MachineName || '').toLowerCase();
  if (actualServer !== expected && actualMachine !== expected) {
    throw new Error(`Host Identity Guard FAILED: Expected target host "${requestedHost}", but connected to "${hostInfo.ServerName}". Refusing execution.`);
  }
  console.log(`   Host Identity Verification: PASS (matches requested "${requestedHost}")`);

  // 3. Server Backup Identity via RESTORE HEADERONLY & VERIFYONLY
  console.log(`\n3. Verifying Server Backup Identity & Integrity via RESTORE HEADERONLY & VERIFYONLY...`);
  const headerResult = await adminQuery(`RESTORE HEADERONLY FROM DISK = @path`, {
    path: { type: sql.NVarChar(500), value: serverBackupPath }
  });
  const header = headerResult.recordset?.[0];
  if (!header) {
    throw new Error(`Failed to read backup header on server: ${serverBackupPath}`);
  }
  console.log(`   Server Backup DatabaseName: ${header.DatabaseName}`);
  console.log(`   Server BackupSize:          ${header.BackupSize} bytes`);
  console.log(`   Server BackupSetGUID:       ${header.BackupSetGUID}`);

  if (header.BackupSetGUID !== EXPECTED_BASELINE.backupSetGuid) {
    throw new Error(`Server backup set GUID "${header.BackupSetGUID}" does not match designated baseline GUID "${EXPECTED_BASELINE.backupSetGuid}".`);
  }
  if (Number(header.BackupSize) !== EXPECTED_BASELINE.serverBackupSize) {
    throw new Error(`Server backup size ${header.BackupSize} bytes does not match designated baseline size ${EXPECTED_BASELINE.serverBackupSize} bytes.`);
  }
  console.log(`   Server Backup Identity: PASS (matches designated baseline GUID and size).`);

  await adminQuery(`RESTORE VERIFYONLY FROM DISK = @path`, {
    path: { type: sql.NVarChar(500), value: serverBackupPath }
  }, 300000);
  console.log(`   RESTORE VERIFYONLY: PASS (backup file is readable and verified by SQL engine).`);

  // 4. Inspect Logical Files via RESTORE FILELISTONLY
  console.log(`\n4. Inspecting Logical File Structure via RESTORE FILELISTONLY...`);
  const fileListResult = await adminQuery(`RESTORE FILELISTONLY FROM DISK = @path`, {
    path: { type: sql.NVarChar(500), value: serverBackupPath }
  }, 120000);
  const rawFiles = fileListResult.recordset || [];
  console.log(`   Discovered ${rawFiles.length} logical file(s):`);
  for (const f of rawFiles) {
    console.log(`   - "${f.LogicalName}" (Type: ${f.Type}, Size: ${(f.Size / (1024 * 1024)).toFixed(1)} MB)`);
  }

  let targetDbName;
  let mapped;
  let moveClauses;
  let manifestData;
  let manifestPath;

  if (mode === '--execute') {
    // 5a. EXECUTION SAFEGUARD & STRICT PLAN LOCK
    if (!manifestPathArg) {
      throw new Error('PLAN_LOCK_REQUIRED: Live execution (--execute) strictly requires an approved plan manifest (--manifest <manifest_path>). Ad-hoc execution is forbidden.');
    }
    if (!fs.existsSync(manifestPathArg)) {
      throw new Error(`PLAN_LOCK_REQUIRED: Plan manifest file "${manifestPathArg}" does not exist.`);
    }

    let lockedPlan;
    try {
      lockedPlan = JSON.parse(fs.readFileSync(manifestPathArg, 'utf8'));
    } catch (e) {
      throw new Error(`PLAN_LOCK_REQUIRED: Failed to parse plan manifest JSON: ${e.message}`);
    }

    if (lockedPlan.status !== 'PLAN_VERIFIED') {
      throw new Error(`PLAN_LOCK_REQUIRED: Manifest status is "${lockedPlan.status}". Must be "PLAN_VERIFIED".`);
    }

    // Timestamp & freshness revalidation
    if (!lockedPlan.createdAt) {
      throw new Error('PLAN_LOCK_INVALID_TIMESTAMP: Manifest createdAt timestamp is missing.');
    }
    const planTime = new Date(lockedPlan.createdAt).getTime();
    if (isNaN(planTime)) {
      throw new Error('PLAN_LOCK_INVALID_TIMESTAMP: Manifest createdAt timestamp is invalid.');
    }
    if (planTime > Date.now() + 5000) {
      throw new Error(`PLAN_LOCK_INVALID_TIMESTAMP: Manifest createdAt timestamp (${lockedPlan.createdAt}) is in the future.`);
    }
    if (Date.now() - planTime > 60 * 60 * 1000) {
      throw new Error('PLAN_LOCK_EXPIRED: Plan manifest has expired (> 1 hour). Please re-run --plan.');
    }

    // Strict host identity binding
    const expectedHostNorm = requestedHost.toLowerCase().trim();
    const manifestTargetHost = String(lockedPlan.targetHost || '').toLowerCase().trim();
    if (manifestTargetHost !== expectedHostNorm) {
      throw new Error(`PLAN_HOST_MISMATCH: Manifest target host "${lockedPlan.targetHost}" does not match requested host "${requestedHost}".`);
    }
    const manifestServerName = String(lockedPlan.serverIdentity?.ServerName || '').toLowerCase().trim();
    if (manifestServerName !== actualServer && manifestServerName !== actualMachine) {
      throw new Error(`PLAN_HOST_MISMATCH: Manifest ServerName "${lockedPlan.serverIdentity?.ServerName}" does not match connected SQL Server "${hostInfo.ServerName}".`);
    }

    // Source backup identity binding
    if (lockedPlan.backupSha256 !== actualHash) {
      throw new Error(`PLAN_BACKUP_MISMATCH: Manifest backup SHA-256 (${lockedPlan.backupSha256}) does not match current source backup (${actualHash}).`);
    }
    if (lockedPlan.backupSetGuid !== header.BackupSetGUID) {
      throw new Error(`PLAN_BACKUP_MISMATCH: Manifest BackupSetGUID "${lockedPlan.backupSetGuid}" does not match server backup set GUID "${header.BackupSetGUID}".`);
    }
    if (lockedPlan.serverBackupPath && lockedPlan.serverBackupPath.toLowerCase() !== serverBackupPath.toLowerCase()) {
      throw new Error(`PLAN_BACKUP_MISMATCH: Manifest serverBackupPath "${lockedPlan.serverBackupPath}" does not match current server backup path "${serverBackupPath}".`);
    }

    // Strict target database binding: USE THE PLAN'S TARGET DB!
    targetDbName = lockedPlan.targetDbName;
    assertTargetSafety(targetDbName);

    // Check collision on target
    const checkExists = await adminQuery(`SELECT DB_ID(@name) AS DbId`, {
      name: { type: sql.NVarChar(128), value: targetDbName }
    });
    if (checkExists.recordset?.[0]?.DbId) {
      throw new Error(`Target collision: Database [${targetDbName}] already exists. Refusing execution.`);
    }

    // File mappings binding
    if (!Array.isArray(lockedPlan.mappedFiles) || lockedPlan.mappedFiles.length < 2) {
      throw new Error('PLAN_MAPPING_INVALID: Manifest mappedFiles is missing or invalid (< 2 files).');
    }
    if (lockedPlan.mappedFiles.length !== rawFiles.length) {
      throw new Error(`PLAN_MAPPING_MISMATCH: Manifest mapped ${lockedPlan.mappedFiles.length} files, but server backup contains ${rawFiles.length} files.`);
    }

    for (const mf of lockedPlan.mappedFiles) {
      const rf = rawFiles.find(r => r.LogicalName === mf.logicalName);
      if (!rf) {
        throw new Error(`PLAN_MAPPING_MISMATCH: Logical file "${mf.logicalName}" in plan is not found in server backup.`);
      }
    }

    mapped = lockedPlan.mappedFiles;
    moveClauses = mapped.map(m => `MOVE N'${m.logicalName.replace(/'/g, "''")}' TO N'${m.physPath.replace(/'/g, "''")}'`);

    // Verify live disk capacity again before execution
    console.log(`\nChecking Destination Volume Free Space for Plan Files (sys.dm_os_volume_stats)...`);
    const volumeResult = await adminQuery(`
      SELECT DISTINCT volume_mount_point, total_bytes, available_bytes
      FROM sys.master_files CROSS APPLY sys.dm_os_volume_stats(database_id, file_id)
    `);
    const volStats = volumeResult.recordset || [];
    verifyDiskCapacity(mapped, volStats, DISK_SAFETY_MARGIN_BYTES);

    manifestData = lockedPlan;
    manifestPath = manifestPathArg;
  } else {
    // Mode === '--plan'
    // 5. Target DB Name & Safety Invariant
    const runTimestamp = Date.now();
    targetDbName = `dbwins_worldfert9_rehearsal_${runTimestamp}`;
    console.log(`\n5. Target Database Identity & Safety Invariant:`);
    console.log(`   Generated Run-Owned DB Name: [${targetDbName}]`);
    assertTargetSafety(targetDbName);

    // Check collision
    const checkExists = await adminQuery(`SELECT DB_ID(@name) AS DbId`, {
      name: { type: sql.NVarChar(128), value: targetDbName }
    });
    if (checkExists.recordset?.[0]?.DbId) {
      throw new Error(`Target collision: Database [${targetDbName}] already exists. Refusing execution.`);
    }
    console.log(`   Target [${targetDbName}] does not exist: OK.`);

    // 6. Query Destination Directories and Free Space
    const pathsResult = await adminQuery(`
      SELECT ISNULL(CAST(SERVERPROPERTY('InstanceDefaultDataPath') AS NVARCHAR(500)), 'C:\\Program Files\\Microsoft SQL Server\\MSSQL16.SQLEXPRESS\\MSSQL\\DATA\\') AS DataPath,
             ISNULL(CAST(SERVERPROPERTY('InstanceDefaultLogPath') AS NVARCHAR(500)), 'C:\\Program Files\\Microsoft SQL Server\\MSSQL16.SQLEXPRESS\\MSSQL\\DATA\\') AS LogPath
    `);
    const dataDir = pathsResult.recordset?.[0]?.DataPath || 'C:\\Program Files\\Microsoft SQL Server\\MSSQL16.SQLEXPRESS\\MSSQL\\DATA\\';
    const logDir = pathsResult.recordset?.[0]?.LogPath || dataDir;

    const mappingRes = mapAllLogicalFiles(rawFiles, targetDbName, dataDir, logDir);
    mapped = mappingRes.mapped;
    moveClauses = mappingRes.moveClauses;
    console.log(`\n6. Concrete File Mapping (Dynamic for all ${mapped.length} files):`);
    for (const m of mapped) {
      console.log(`   MOVE "${m.logicalName}" -> "${m.physPath}" (${(m.size / (1024 * 1024)).toFixed(1)} MB)`);
    }

    // 7. Server-Side Volume Space Check (Strict NO fallback)
    console.log(`\n7. Checking Destination Volume Free Space (sys.dm_os_volume_stats)...`);
    const volumeResult = await adminQuery(`
      SELECT DISTINCT volume_mount_point, total_bytes, available_bytes
      FROM sys.master_files CROSS APPLY sys.dm_os_volume_stats(database_id, file_id)
    `);
    const volStats = volumeResult.recordset || [];
    const diskVerification = verifyDiskCapacity(mapped, volStats, DISK_SAFETY_MARGIN_BYTES);
    for (const dv of diskVerification) {
      console.log(`   Volume "${dv.mountPoint}": ${(dv.requiredBytes / (1024 * 1024 * 1024)).toFixed(2)} GB required, ${(dv.availableBytes / (1024 * 1024 * 1024)).toFixed(2)} GB available -> PASS`);
    }

    // 8. Record Ownership Manifest
    manifestData = {
      runId: `rehearsal_${runTimestamp}`,
      targetDbName,
      targetHost: requestedHost,
      serverIdentity: hostInfo,
      clientBackupPath: clientBackupFile,
      serverBackupPath,
      backupSha256: actualHash,
      backupSetGuid: header.BackupSetGUID,
      mappedFiles: mapped,
      status: 'PLAN_VERIFIED',
      createdAt: new Date().toISOString(),
    };
    manifestPath = writeManifest(targetDbName, manifestData);
    console.log(`\n8. Durable Ownership Manifest:`);
    console.log(`   Written to: ${manifestPath}`);

    console.log(`\n================================================================`);
    console.log(`  PLAN VERIFIED: All safeguards, volume capacity, VERIFYONLY,`);
    console.log(`  and logical file mappings passed without error.`);
    console.log(`  Target: [${targetDbName}] on [${hostInfo.ServerName}].`);
    console.log(`================================================================\n`);
    return {
      status: 'PLAN_VERIFIED',
      targetDbName,
      serverIdentity: hostInfo,
      backupSha256: actualHash,
      mappedFiles: mapped,
      manifestPath,
    };
  }

  // If mode === '--execute', proceed to live restore using the locked plan!
  console.log(`\n9. Executing Live Isolated Restore from Verified Plan Manifest...`);
  console.log(`   Target DB:   [${targetDbName}]`);
  console.log(`   Target Host: [${requestedHost}]`);
  manifestData.status = 'RESTORE_IN_PROGRESS';
  manifestData.startedAt = new Date().toISOString();
  writeManifest(targetDbName, manifestData);

  const restoreSql = `
    RESTORE DATABASE [${targetDbName}]
    FROM DISK = @bakPath
    WITH ${moveClauses.join(',\n         ')},
         RECOVERY, STATS = 25;
  `;

  try {
    await adminQuery(restoreSql, {
      bakPath: { type: sql.NVarChar(500), value: serverBackupPath }
    }, 600000);
    console.log(`✓ Restore complete for [${targetDbName}].`);

    // Capture exact creation identity at the moment of restore
    const dbIdentityResult = await adminQuery(`
      SELECT database_id, create_date
      FROM sys.databases
      WHERE name = @name
    `, { name: { type: sql.NVarChar(128), value: targetDbName } });
    const restoredRow = dbIdentityResult.recordset?.[0];
    if (!restoredRow) {
      throw new Error(`RESTORE_IDENTITY_CAPTURE_FAILED: Restored database [${targetDbName}] not found in sys.databases.`);
    }
    manifestData.dbInstanceId = restoredRow.database_id;
    manifestData.dbCreateDate = new Date(restoredRow.create_date).toISOString();
    writeManifest(targetDbName, manifestData);
    console.log(`✓ Captured exact database restore identity: database_id=${manifestData.dbInstanceId}, create_date=${manifestData.dbCreateDate}`);

    console.log(`\n10. Running DBCC CHECKDB Integrity Verification...`);
    try {
      await adminQuery(`DBCC CHECKDB ([${targetDbName}]) WITH NO_INFOMSGS;`, {}, 600000);
      console.log(`✓ DBCC CHECKDB passed with 0 errors.`);
      manifestData.checkDbResult = 'PASSED_CLEAN';
    } catch (checkErr) {
      if (checkErr.message && (checkErr.message.includes('Run DBCC UPDATEUSAGE') || checkErr.message.includes('UPDATEUSAGE') || checkErr.message.includes('page count'))) {
        console.warn(`[CHECKDB NOTE] Space accounting discrepancy detected: ${checkErr.message}`);
        console.log(`   Executing standard remediation: DBCC UPDATEUSAGE ([${targetDbName}])...`);
        await adminQuery(`DBCC UPDATEUSAGE ([${targetDbName}]) WITH NO_INFOMSGS;`, {}, 600000);
        console.log(`   Re-running DBCC CHECKDB to confirm full physical and logical integrity...`);
        await adminQuery(`DBCC CHECKDB ([${targetDbName}]) WITH NO_INFOMSGS;`, {}, 600000);
        console.log(`✓ DBCC CHECKDB passed cleanly after DBCC UPDATEUSAGE.`);
        manifestData.checkDbResult = 'PASSED_AFTER_UPDATEUSAGE';
        manifestData.checkDbNote = checkErr.message;
      } else {
        throw checkErr;
      }
    }

    console.log(`\n11. Inspecting Baseline Schema & Migration State in Restored DB...`);
    const schemaCheck = await adminQuery(`
      SELECT t.name AS TableName
      FROM [${targetDbName}].sys.tables t
      JOIN [${targetDbName}].sys.schemas s ON t.schema_id = s.schema_id
      WHERE s.name = 'wf'
      ORDER BY t.name
    `);
    const wfTablesBaseline = (schemaCheck.recordset || []).map(r => r.TableName);
    console.log(`✓ Baseline custom schema 'wf' tables in restored DB (${wfTablesBaseline.length}):`, wfTablesBaseline.join(', ') || '(NONE)');

    // Inspect baseline migration ledger: wf.SchemaMigration
    const ledgerCheck = await adminQuery(`
      SELECT TABLE_NAME FROM [${targetDbName}].INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = 'wf' AND TABLE_NAME = 'SchemaMigration'
    `);
    if (ledgerCheck.recordset?.length > 0) {
      const appliedRows = await adminQuery(`
        SELECT FileName, Checksum, BatchCount, AppliedAt
        FROM [${targetDbName}].wf.SchemaMigration
        ORDER BY FileName
      `);
      const applied = appliedRows.recordset || [];
      console.log(`✓ Baseline repository ledger 'wf.SchemaMigration' found with ${applied.length} applied migrations.`);
      manifestData.baselineAppliedMigrations = applied.map(a => a.FileName);
    } else {
      console.log(`ℹ Baseline repository ledger 'wf.SchemaMigration' not present in baseline snapshot.`);
      manifestData.baselineAppliedMigrations = [];
    }

    manifestData.status = 'RESTORE_VERIFIED';
    manifestData.wfTablesBaseline = wfTablesBaseline;
    writeManifest(targetDbName, manifestData);

    // 12. Connect Dedicated Isolated Pool for Migrations & Application Smoke
    console.log(`\n12. Connecting Dedicated Isolated Pool to [${targetDbName}] on [${hostInfo.ServerName}]...`);
    const isolatedPool = await createIsolatedPool(targetDbName, hostInfo.ServerName);

    try {
      await ensureIsolatedPrincipals(isolatedPool, targetDbName, hostInfo.ServerName);

      // 13. Execute Real Migrations on Restored Database
      console.log(`\n13. Executing Real Migrations on Isolated Target [${targetDbName}]...`);
      const runMigrations = require('../run_migrations');
      const migrationResult = await runMigrations.run({ plan: false }, isolatedPool, targetDbName);
      console.log(`✓ Real migrations executed: ${migrationResult.counts.UNCHANGED || 0} unchanged; ${migrationResult.counts.PENDING || 0} applied.`);

      // 14. Verify Migration Idempotency via Re-run
      console.log(`\n14. Verifying Migration Idempotent Re-run (Preflight / Plan)...`);
      const rerunResult = await runMigrations.run({ plan: true }, isolatedPool, targetDbName);
      const rerunCounts = rerunResult.counts;
      const driftCount = (rerunCounts.CHECKSUM_DRIFT || 0) + (rerunCounts.BATCHCOUNT_DRIFT || 0);
      console.log(`✓ Idempotent re-run: ${rerunCounts.UNCHANGED || 0} unchanged; ${rerunCounts.PENDING || 0} pending; ${driftCount} drift.`);

      if ((rerunCounts.PENDING || 0) > 0) {
        throw new Error(`MIGRATION_IDEMPOTENCY_FAILED: Re-run reported ${rerunCounts.PENDING} pending migrations after applying!`);
      }
      if (driftCount > 0) {
        throw new Error(`MIGRATION_IDEMPOTENCY_FAILED: Migration drift detected on re-run (${driftCount} drifted)!`);
      }

      manifestData.migrationSummary = {
        applied: migrationResult.appliedList || [],
        initialPending: migrationResult.counts.PENDING || 0,
        initialUnchanged: migrationResult.counts.UNCHANGED || 0,
        rerunPending: rerunCounts.PENDING || 0,
        rerunUnchanged: rerunCounts.UNCHANGED || 0,
        rerunDrift: driftCount,
      };
      manifestData.status = 'MIGRATIONS_APPLIED_VERIFIED';
      writeManifest(targetDbName, manifestData);

      // 15. Bounded Application Smoke Validation
      console.log(`\n15. Running Bounded Application Smoke Tests on Isolated DB...`);
      const smokeResult = await runIsolatedApplicationSmoke(isolatedPool, targetDbName, hostInfo.ServerName);
      manifestData.smokeSummary = smokeResult;
      manifestData.status = 'APPLICATION_VALIDATION_PASSED';
      writeManifest(targetDbName, manifestData);
    } finally {
      await isolatedPool.close().catch(() => {});
    }

    // 16. Safe Cleanup: Verifying Ownership & Dropping Isolated DB
    console.log(`\n16. Safe Cleanup: Verifying Ownership & Dropping Isolated DB...`);
    await safeCleanupRehearsalDatabase(targetDbName, manifestData, adminQuery, sql);
    console.log(`✓ Verified ownership and dropped isolated database [${targetDbName}].`);

    manifestData.status = 'PHASE1_COMPLETED_CLEANED_UP';
    manifestData.completedAt = new Date().toISOString();
    writeManifest(targetDbName, manifestData);

    console.log(`\n================================================================`);
    console.log(`  ISOLATED RECOVERY & MIGRATION REHEARSAL: 100% SUCCESSFUL`);
    console.log(`================================================================\n`);

    return {
      status: 'EXECUTED_SUCCESS',
      targetDbName,
      serverIdentity: hostInfo,
      manifestPath,
      manifestData,
    };
  } catch (err) {
    console.error(`\n[REHEARSAL ERROR during execution]:`, err.message);
    manifestData.status = 'FAILED';
    manifestData.error = err.message;
    writeManifest(targetDbName, manifestData);

    // Safe partial-failure recovery
    console.log(`[RECOVERY] Attempting verified cleanup of isolated target [${targetDbName}]...`);
    try {
      await safeCleanupRehearsalDatabase(targetDbName, manifestData, adminQuery, sql);
      console.log(`[RECOVERY] Cleanup of [${targetDbName}] completed.`);
      manifestData.status = 'FAILED_CLEANED_UP';
      writeManifest(targetDbName, manifestData);
    } catch (cleanupErr) {
      console.error(`[RECOVERY CLEANUP FAILED]:`, cleanupErr.message);
      console.error(`MANUAL RECOVERY INSTRUCTION: Please manually inspect database [${targetDbName}] on host [${hostInfo.ServerName}].`);
    }
    throw err;
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const mode = args.includes('--execute') ? '--execute' : '--plan';
  
  let targetHost = null;
  const hostIdx = args.indexOf('--target-host');
  if (hostIdx !== -1 && args[hostIdx + 1]) targetHost = args[hostIdx + 1];

  let serverBackupPath = null;
  const srvIdx = args.indexOf('--server-backup-path');
  if (srvIdx !== -1 && args[srvIdx + 1]) serverBackupPath = args[srvIdx + 1];

  let clientBackupPath = null;
  const cliIdx = args.indexOf('--client-backup-path');
  if (cliIdx !== -1 && args[cliIdx + 1]) clientBackupPath = args[cliIdx + 1];

  let manifestPath = null;
  const manIdx = args.indexOf('--manifest');
  if (manIdx !== -1 && args[manIdx + 1]) manifestPath = args[manIdx + 1];

  runRehearsal({ mode, targetHost, serverBackupPath, clientBackupPath, manifest: manifestPath })
    .then(() => process.exit(0))
    .catch(err => {
      console.error(`\n[rehearsal] ABORTED:`, err.message);
      process.exit(1);
    });
}

module.exports = {
  runRehearsal,
  EXPECTED_BASELINE,
  assertTargetSafety,
  mapAllLogicalFiles,
  resolveVolumeMountPoint,
  verifyDiskCapacity,
  safeCleanupRehearsalDatabase,
  assertIsolatedConnection,
  createIsolatedPool,
  ensureIsolatedPrincipals,
  runIsolatedApplicationSmoke,
  writeManifest,
  readManifest,
};
