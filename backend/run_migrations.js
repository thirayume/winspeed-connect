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
const db   = require('./db');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const SKIP_FILES     = ['001_wf_schema_backup.sql'];

// Errors that are safe to ignore (object already exists, index already exists, etc.)
const IGNORABLE_CODES = [
  1913, // index already exists
  2714, // object already exists
  2705, // column already exists
   911, // database does not exist (login scripts on wrong db)
];

async function runFile(pool, filePath) {
  const fileName = path.basename(filePath);
  const sql = fs.readFileSync(filePath, 'utf-8');
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

  return errorCount === 0;
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

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql') && !SKIP_FILES.includes(f))
    .sort();

  let totalOK  = 0;
  let totalErr = 0;

  for (const file of files) {
    console.log(`📄 ${file}`);
    const ok = await runFile(pool, path.join(MIGRATIONS_DIR, file));
    if (ok) totalOK++;
    else    totalErr++;
  }

  console.log('');
  console.log('═══════════════════════════════════════');
  if (totalErr === 0) {
    console.log(`✅ All ${totalOK} migration file(s) applied successfully.`);
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
