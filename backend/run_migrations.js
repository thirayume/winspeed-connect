/**
 * run_migrations.js
 * -----------------------------------------------------------
 * Runs ALL SQL migration files in /migrations in sorted order.
 * Skips batches that fail with non-fatal errors (idempotent).
 *
 * Usage:
 *   node run_migrations.js            → run against DB_MODE in .env (default: remote)
 *   DB_MODE=remote node run_migrations.js
 *
 * Called by deploy.ps1 as part of CI/CD pipeline.
 */
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const db   = require('./db');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const SKIP_FILES     = ['000_logins.sql', '001_wf_schema_backup.sql'];

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

// FR-031 — ledger: ensure table + load applied map (fail-safe: ว่าง = รันทุกไฟล์)
async function ensureLedger(pool) {
  try {
    await pool.request().query(`IF OBJECT_ID('wf.SchemaMigration','U') IS NULL
      CREATE TABLE wf.SchemaMigration (FileName NVARCHAR(255) NOT NULL PRIMARY KEY,
        Checksum CHAR(64) NOT NULL, BatchCount INT NULL,
        AppliedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), AppliedBy NVARCHAR(128) NULL DEFAULT SUSER_SNAME());`);
  } catch (e) { console.log('  (ledger bootstrap deferred:', e.message, ')'); }
}
async function loadApplied(pool) {
  const map = new Map();
  try {
    const r = await pool.request().query(`SELECT FileName, Checksum FROM wf.SchemaMigration`);
    for (const row of r.recordset || []) map.set(row.FileName, row.Checksum);
  } catch { /* ledger not ready yet */ }
  return map;
}
async function recordApplied(pool, fileName, checksum, batchCount) {
  try {
    await pool.request()
      .input('f', fileName).input('c', checksum).input('b', batchCount)
      .query(`MERGE wf.SchemaMigration AS t USING (SELECT @f AS FileName) AS s ON t.FileName=s.FileName
              WHEN MATCHED THEN UPDATE SET Checksum=@c, BatchCount=@b, AppliedAt=SYSUTCDATETIME(), AppliedBy=SUSER_SNAME()
              WHEN NOT MATCHED THEN INSERT (FileName, Checksum, BatchCount) VALUES (@f, @c, @b);`);
  } catch (e) { console.log('  (ledger record skipped:', e.message, ')'); }
}

// Errors that are safe to ignore (object already exists, index already exists, etc.)
const IGNORABLE_CODES = [
  1913, // index already exists
  2714, // object already exists
  2705, // column already exists
   911, // database does not exist (login scripts on wrong db)
];

async function runFile(pool, filePath, sql) {
  const fileName = path.basename(filePath);
  const batches = sql.split(/^\s*GO\s*$/im).filter(b => b.trim());

  let successCount = 0;
  let skipCount    = 0;
  let errorCount   = 0;

  for (const batch of batches) {
    try {
      await pool.request().query(batch);
      successCount++;
    } catch (e) {
      const code = e?.originalError?.code ?? e?.number;
      if (IGNORABLE_CODES.includes(code)) {
        skipCount++;
      } else {
        console.error(`  ✗ Error in ${fileName}:`, e.message);
        errorCount++;
      }
    }
  }

  const parts = [];
  if (successCount) parts.push(`${successCount} OK`);
  if (skipCount)    parts.push(`${skipCount} skipped`);
  if (errorCount)   parts.push(`${errorCount} ERRORS`);
  console.log(`  → ${parts.join(', ')}`);

  return { ok: errorCount === 0, batchCount: batches.length };
}

async function run() {
  console.log('');
  console.log('╔═══════════════════════════════════════╗');
  console.log('║         WinSpeed DB Migration         ║');
  console.log('╚═══════════════════════════════════════╝');

  await db.ownerReady;
  const pool   = db.ownerPool;
  const target = db.getTarget();
  console.log(`\n🔌 Connected → Target: ${target.toUpperCase()}\n`);

  await ensureLedger(pool);
  const applied = await loadApplied(pool);   // FR-031 — files already applied (by checksum)

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql') && !SKIP_FILES.includes(f))
    .sort();

  let totalOK  = 0;
  let totalErr = 0;
  let totalSkip = 0;

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    const checksum = sha256(sql);
    if (applied.get(file) === checksum) {
      console.log(`📄 ${file}\n  → ledger: unchanged, skipped`);
      totalSkip++; totalOK++;
      continue;
    }
    console.log(`📄 ${file}`);
    const { ok, batchCount } = await runFile(pool, path.join(MIGRATIONS_DIR, file), sql);
    if (ok) { totalOK++; await recordApplied(pool, file, checksum, batchCount); }
    else    { totalErr++; }   // errored → not recorded → retries next run
  }

  console.log('');
  console.log('═══════════════════════════════════════');
  if (totalErr === 0) {
    console.log(`✅ All ${totalOK} migration file(s) applied successfully (${totalSkip} unchanged).`);
  } else {
    console.log(`⚠️  ${totalOK} OK, ${totalErr} file(s) had errors.`);
  }
  console.log('═══════════════════════════════════════\n');

  process.exit(totalErr > 0 ? 1 : 0);
}

run().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
