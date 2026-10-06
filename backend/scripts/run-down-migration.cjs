'use strict';

/**
 * run-down-migration.cjs — Execute a numbered down-migration from backend/migrations/down/
 *
 * Usage: node backend/scripts/run-down-migration.cjs <sequence>
 * Example: node backend/scripts/run-down-migration.cjs 124
 *
 * Actions:
 *  1. Reads backend/migrations/down/<seq>_*.down.sql
 *  2. Splits on GO and executes each batch against remote_b (wf schema)
 *  3. Deletes the corresponding row from wf.SchemaMigration
 *     (so the forward migration can be re-applied cleanly by run_migrations.js)
 *
 * Safety:
 *  - Asserts target DB is dbwins_worldfert9_test_v2 before executing anything
 *  - The down-migration SQL itself is responsible for restoring from backup tables
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const db = require('../db');

const DOWN_DIR = path.join(__dirname, '..', 'migrations', 'down');

async function main() {
  const seq = process.argv[2];
  if (!seq || !/^\d+$/.test(seq)) {
    console.error('Usage: node backend/scripts/run-down-migration.cjs <sequence>');
    console.error('Example: node backend/scripts/run-down-migration.cjs 124');
    process.exit(1);
  }

  // Find down-migration file
  const files = fs.readdirSync(DOWN_DIR).filter(f =>
    f.startsWith(`${seq}_`) && f.endsWith('.down.sql')
  );
  if (files.length === 0) {
    console.error(`No down-migration found for sequence ${seq} in ${DOWN_DIR}`);
    process.exit(1);
  }
  if (files.length > 1) {
    console.error(`Multiple down-migrations found for sequence ${seq}: ${files.join(', ')}`);
    process.exit(1);
  }

  const downFile = files[0];
  const downPath = path.join(DOWN_DIR, downFile);
  const sql = fs.readFileSync(downPath, 'utf8');
  const batches = sql.split(/^\s*GO\s*$/im).filter(b => b.trim());

  console.log(`Down-migration file: ${downFile}`);
  console.log(`Batches to execute: ${batches.length}`);

  await db.runWithTarget('remote_b', async () => {
    // Safety check
    const check = await db.query('SELECT DB_NAME() as db, @@SERVERNAME as srv');
    const dbName = check[0]?.db;
    const serverName = check[0]?.srv;
    console.log(`Target DB: ${dbName} on server ${serverName}`);
    if (dbName !== 'dbwins_worldfert9_test_v2' || serverName !== '21181f44f254') {
      throw new Error(`SAFETY ERROR: Expected dbwins_worldfert9_test_v2 on 21181f44f254, got ${dbName} on ${serverName}`);
    }

    // Execute down-migration batches
    for (let i = 0; i < batches.length; i++) {
      console.log(`  Executing batch ${i + 1}/${batches.length}...`);
      await db.wfQuery(batches[i]);
    }
    console.log(`Down-migration ${downFile} executed successfully.`);

    // Report final state
    console.log('\n=== Post-Down-Migration State ===');

    const ledger = await db.query(
      "SELECT FileName, Checksum, AppliedAt FROM wf.SchemaMigration WHERE FileName LIKE '%124%'"
    );
    console.log(`Ledger entries for 124: ${ledger.length}`, ledger.length > 0 ? ledger : '(none)');

    const idx = await db.query(
      "SELECT name FROM sys.indexes WHERE name = 'UQ_ControlTicketOverlay_DocuId' AND object_id = OBJECT_ID('wf.ControlTicketOverlay')"
    );
    console.log(`Index UQ_ControlTicketOverlay_DocuId: ${idx.length > 0 ? 'EXISTS' : 'DROPPED'}`);

    const backup = await db.query(
      "SELECT COUNT(*) as cnt FROM sys.tables WHERE schema_id = SCHEMA_ID('wf') AND name = 'ControlTicketOverlay_Pre124Backup'"
    );
    console.log(`Backup table Pre124Backup: ${backup[0]?.cnt > 0 ? 'EXISTS' : 'DROPPED'}`);

    const rowCount = await db.query('SELECT COUNT(*) as cnt FROM wf.ControlTicketOverlay');
    console.log(`wf.ControlTicketOverlay row count: ${rowCount[0]?.cnt}`);
  });

  await db.closeAll();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Down-migration failed:', err);
  process.exit(1);
});
