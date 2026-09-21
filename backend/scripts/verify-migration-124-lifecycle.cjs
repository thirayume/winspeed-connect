'use strict';

/**
 * verify-migration-124-lifecycle.cjs — End-to-end lifecycle verification
 *
 * Phase 3 of R4 remediation:
 *   1. Assert precondition: D6302477 has exactly 2 coupons (154558, 154766)
 *   2. Seed synthetic legacy fixture (DocuId=0, DocuNo='D6302477')
 *   3. Apply migration 124 via run_migrations.js runner (NOT manual SQL)
 *   4. Assert forward migration outcome (cloned rows, backup, index, ledger)
 *   5. Execute down-migration via run-down-migration.cjs
 *   6. Assert rollback outcome (restored legacy row, index dropped, ledger cleared)
 *   7. Re-apply migration 124 via runner (proves ledger was cleared properly)
 *   8. Assert re-application with identical checksum
 *   9. FINALLY: cleanup fixture + drop backup table + report final state
 *
 * Usage: node backend/scripts/verify-migration-124-lifecycle.cjs
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { execSync } = require('child_process');
const path = require('path');
const db = require('../db');

const BACKEND_DIR = path.join(__dirname, '..');
const ROOT_DIR = path.join(BACKEND_DIR, '..');
const DOCU_NO = 'D6302477';

async function main() {
  let firstChecksum = null;
  let seeded = false;

  await db.runWithTarget('remote_b', async () => {
    // ── Safety Check ──
    const check = await db.query('SELECT DB_NAME() as db, @@SERVERNAME as srv');
    const dbName = check[0]?.db;
    const serverName = check[0]?.srv;
    console.log(`Target DB: ${dbName} on server ${serverName}`);
    if (dbName !== 'dbwins_worldfert9_test_v2' || serverName !== '21181f44f254') {
      throw new Error(`SAFETY ERROR: Expected dbwins_worldfert9_test_v2 on 21181f44f254, got ${dbName} on ${serverName}`);
    }

    try {
      // ════════════════════════════════════════════════════════════════════
      // STEP 0: Reset baseline if 124 is already applied
      // ════════════════════════════════════════════════════════════════════
      const existingLedger = await db.query(
        "SELECT FileName FROM wf.SchemaMigration WHERE FileName LIKE '%124%'"
      );
      if (existingLedger.length > 0) {
        console.log('Migration 124 is already in ledger. Resetting via down-migration before lifecycle test...');
        execSync('node backend/scripts/run-down-migration.cjs 124', { cwd: ROOT_DIR, encoding: 'utf8', stdio: 'inherit' });
      }

      // ════════════════════════════════════════════════════════════════════
      // STEP 1: Precondition — D6302477 must have exactly 2 coupons
      // ════════════════════════════════════════════════════════════════════
      console.log('\n═══ STEP 1: Precondition Check ═══');
      const coupons = await db.query(
        "SELECT CouponID FROM dbo.WFCoupon WHERE CouponNo = @cno",
        { cno: { type: db.sql.NVarChar(50), value: DOCU_NO } }
      );
      console.log(`Coupons for ${DOCU_NO}:`, coupons.map(r => r.CouponID));
      if (coupons.length !== 2) {
        throw new Error(`PRECONDITION FAILED: Expected exactly 2 coupons for ${DOCU_NO}, got ${coupons.length}`);
      }
      const couponIds = coupons.map(r => Number(r.CouponID)).sort((a, b) => a - b);
      const [cid1, cid2] = couponIds;
      console.log(`Coupon IDs: ${cid1}, ${cid2}`);
      if (cid1 !== 154558 || cid2 !== 154766) {
        console.warn(`WARNING: CouponIDs differ from expected (154558, 154766). Got (${cid1}, ${cid2}). Proceeding with actual values.`);
      }

      // ════════════════════════════════════════════════════════════════════
      // STEP 2: Seed synthetic legacy fixture
      // ════════════════════════════════════════════════════════════════════
      console.log('\n═══ STEP 2: Seed Synthetic Fixture ═══');
      // Verify no existing rows for this DocuNo
      const preExisting = await db.wfQuery(
        "SELECT COUNT(*) as cnt FROM wf.ControlTicketOverlay WHERE DocuNo = @dno",
        { dno: { type: db.sql.NVarChar(50), value: DOCU_NO } }
      );
      console.log(`Pre-existing rows for ${DOCU_NO}: ${preExisting.recordset[0].cnt}`);
      if (preExisting.recordset[0].cnt > 0) {
        throw new Error(`PRECONDITION FAILED: ${DOCU_NO} already has rows in wf.ControlTicketOverlay. Cannot seed fixture.`);
      }

      await db.wfQuery(`
        INSERT INTO wf.ControlTicketOverlay (
          DocuNo, DocuType, DocuId, GoodCode,
          ExpiryDate, ExpiryType, PolicySnapshotId, StrictOverrideFlag,
          ReasonCode, ReasonText, CreatedBy, CreatedAt, UpdatedAt
        )
        VALUES (
          @dno, 104, 0, '18-8-8',
          '2027-06-30', 'EXPLICIT', 1, 0,
          'POLICY_ADJUSTMENT', 'Synthetic Migration 124 Fixture', 'LIFECYCLE-TEST', SYSUTCDATETIME(), SYSUTCDATETIME()
        )
      `, { dno: { type: db.sql.NVarChar(50), value: DOCU_NO } });
      seeded = true;

      const seedCheck = await db.wfQuery(
        "SELECT Id, DocuId, DocuNo FROM wf.ControlTicketOverlay WHERE DocuNo = @dno",
        { dno: { type: db.sql.NVarChar(50), value: DOCU_NO } }
      );
      console.log(`Seeded rows:`, seedCheck.recordset);
      if (seedCheck.recordset.length !== 1 || Number(seedCheck.recordset[0].DocuId) !== 0) {
        throw new Error('Seed verification failed: expected exactly 1 row with DocuId=0');
      }
      console.log('PASS: Synthetic fixture seeded (DocuId=0).');

      // ════════════════════════════════════════════════════════════════════
      // STEP 3: Apply migration 124 via runner
      // ════════════════════════════════════════════════════════════════════
      console.log('\n═══ STEP 3: Apply Migration 124 via Runner ═══');
      const migrateOutput = execSync('node backend/run_migrations.js', {
        cwd: ROOT_DIR,
        encoding: 'utf8',
        timeout: 120000,
      });
      console.log(migrateOutput);

      // ════════════════════════════════════════════════════════════════════
      // STEP 4: Assert forward migration outcome
      // ════════════════════════════════════════════════════════════════════
      console.log('\n═══ STEP 4: Assert Forward Migration ═══');

      // 4a. Ledger entry
      const ledger = await db.query(
        "SELECT FileName, Checksum, BatchCount, AppliedAt FROM wf.SchemaMigration WHERE FileName LIKE '%124%'"
      );
      console.log('Ledger:', ledger);
      if (ledger.length !== 1) {
        throw new Error(`Expected 1 ledger entry for 124, got ${ledger.length}`);
      }
      firstChecksum = ledger[0].Checksum;
      console.log(`PASS: Ledger entry exists. Checksum=${firstChecksum}`);

      // 4b. Backup table exists and contains pre-migration fixture
      const backupExists = await db.query(
        "SELECT COUNT(*) as cnt FROM sys.tables WHERE schema_id = SCHEMA_ID('wf') AND name = 'ControlTicketOverlay_Pre124Backup'"
      );
      if (Number(backupExists[0]?.cnt) !== 1) {
        throw new Error('Backup table wf.ControlTicketOverlay_Pre124Backup does not exist');
      }
      const backupRows = await db.wfQuery(
        "SELECT DocuId, DocuNo FROM wf.ControlTicketOverlay_Pre124Backup WHERE DocuNo = @dno",
        { dno: { type: db.sql.NVarChar(50), value: DOCU_NO } }
      );
      console.log('Backup rows for fixture:', backupRows.recordset);
      if (backupRows.recordset.length !== 1 || Number(backupRows.recordset[0].DocuId) !== 0) {
        throw new Error('Backup table must contain original fixture row with DocuId=0');
      }
      console.log('PASS: Backup table contains pre-migration fixture.');

      // 4c. Cloned rows in main table
      const postMigRows = await db.wfQuery(
        "SELECT DocuId FROM wf.ControlTicketOverlay WHERE DocuNo = @dno ORDER BY DocuId",
        { dno: { type: db.sql.NVarChar(50), value: DOCU_NO } }
      );
      console.log('Post-migration rows:', postMigRows.recordset);
      const postIds = postMigRows.recordset.map(r => Number(r.DocuId)).sort((a, b) => a - b);
      if (postIds.length !== 2) {
        throw new Error(`Expected 2 cloned rows, got ${postIds.length}`);
      }
      if (postIds[0] !== cid1 || postIds[1] !== cid2) {
        throw new Error(`Cloned rows have unexpected DocuIds: ${postIds} (expected ${cid1}, ${cid2})`);
      }
      // Verify DocuId=0 is gone
      const zeroRows = await db.wfQuery(
        "SELECT COUNT(*) as cnt FROM wf.ControlTicketOverlay WHERE DocuNo = @dno AND DocuId = 0",
        { dno: { type: db.sql.NVarChar(50), value: DOCU_NO } }
      );
      if (Number(zeroRows.recordset[0].cnt) !== 0) {
        throw new Error('DocuId=0 row was not deleted by migration');
      }
      console.log(`PASS: Legacy row cloned to ${cid1} and ${cid2}. DocuId=0 deleted.`);

      // 4d. Index exists
      const idxCheck = await db.query(
        "SELECT name FROM sys.indexes WHERE name = 'UQ_ControlTicketOverlay_DocuId' AND object_id = OBJECT_ID('wf.ControlTicketOverlay')"
      );
      if (idxCheck.length !== 1) {
        throw new Error('Index UQ_ControlTicketOverlay_DocuId was not created by migration');
      }
      console.log('PASS: Index UQ_ControlTicketOverlay_DocuId exists.');

      // ════════════════════════════════════════════════════════════════════
      // STEP 5: Execute down-migration
      // ════════════════════════════════════════════════════════════════════
      console.log('\n═══ STEP 5: Execute Down-Migration via run-down-migration.cjs ═══');
      const downOutput = execSync('node backend/scripts/run-down-migration.cjs 124', {
        cwd: ROOT_DIR,
        encoding: 'utf8',
        timeout: 120000,
      });
      console.log(downOutput);

      // ════════════════════════════════════════════════════════════════════
      // STEP 6: Assert rollback outcome
      // ════════════════════════════════════════════════════════════════════
      console.log('\n═══ STEP 6: Assert Rollback ═══');

      // 6a. Index must be dropped
      const idxAfterDown = await db.query(
        "SELECT name FROM sys.indexes WHERE name = 'UQ_ControlTicketOverlay_DocuId' AND object_id = OBJECT_ID('wf.ControlTicketOverlay')"
      );
      if (idxAfterDown.length !== 0) {
        throw new Error('Index UQ_ControlTicketOverlay_DocuId was not dropped by down-migration');
      }
      console.log('PASS: Index dropped after down-migration.');

      // 6b. Ledger cleared
      const ledgerAfterDown = await db.query(
        "SELECT FileName FROM wf.SchemaMigration WHERE FileName LIKE '%124%'"
      );
      if (ledgerAfterDown.length !== 0) {
        throw new Error('Ledger entry for 124 was not cleared by down-migration');
      }
      console.log('PASS: Ledger entry for 124 cleared.');

      // 6c. Original legacy row restored
      const restoredRows = await db.wfQuery(
        "SELECT DocuId FROM wf.ControlTicketOverlay WHERE DocuNo = @dno",
        { dno: { type: db.sql.NVarChar(50), value: DOCU_NO } }
      );
      console.log('Restored rows:', restoredRows.recordset);
      if (restoredRows.recordset.length !== 1 || Number(restoredRows.recordset[0].DocuId) !== 0) {
        throw new Error('Down-migration did not restore original legacy row with DocuId=0');
      }
      console.log('PASS: Original legacy row (DocuId=0) restored.');

      // ════════════════════════════════════════════════════════════════════
      // STEP 7: Re-apply migration 124 via runner
      // ════════════════════════════════════════════════════════════════════
      console.log('\n═══ STEP 7: Re-Apply Migration 124 via Runner ═══');
      const reapplyOutput = execSync('node backend/run_migrations.js', {
        cwd: ROOT_DIR,
        encoding: 'utf8',
        timeout: 120000,
      });
      console.log(reapplyOutput);

      // ════════════════════════════════════════════════════════════════════
      // STEP 8: Assert re-application
      // ════════════════════════════════════════════════════════════════════
      console.log('\n═══ STEP 8: Assert Re-Application ═══');
      const ledgerReapply = await db.query(
        "SELECT FileName, Checksum, BatchCount, AppliedAt FROM wf.SchemaMigration WHERE FileName LIKE '%124%'"
      );
      if (ledgerReapply.length !== 1) {
        throw new Error(`Expected 1 ledger entry after re-apply, got ${ledgerReapply.length}`);
      }
      const secondChecksum = ledgerReapply[0].Checksum;
      console.log(`First checksum:  ${firstChecksum}`);
      console.log(`Second checksum: ${secondChecksum}`);
      if (firstChecksum !== secondChecksum) {
        throw new Error(`Checksum mismatch after re-apply! ${firstChecksum} !== ${secondChecksum}`);
      }
      console.log('PASS: Ledger re-created with identical checksum.');

      // Verify index re-created
      const idxReapply = await db.query(
        "SELECT name FROM sys.indexes WHERE name = 'UQ_ControlTicketOverlay_DocuId' AND object_id = OBJECT_ID('wf.ControlTicketOverlay')"
      );
      if (idxReapply.length !== 1) {
        throw new Error('Index not re-created after re-apply');
      }
      console.log('PASS: Index re-created after re-apply.');

      // Verify rows cloned again
      const finalRows = await db.wfQuery(
        "SELECT DocuId FROM wf.ControlTicketOverlay WHERE DocuNo = @dno ORDER BY DocuId",
        { dno: { type: db.sql.NVarChar(50), value: DOCU_NO } }
      );
      const finalIds = finalRows.recordset.map(r => Number(r.DocuId)).sort((a, b) => a - b);
      if (finalIds.length !== 2 || finalIds[0] !== cid1 || finalIds[1] !== cid2) {
        throw new Error(`Re-apply did not clone rows correctly: ${finalIds}`);
      }
      console.log(`PASS: Rows re-cloned to ${cid1} and ${cid2} after re-apply.`);

      console.log('\n════════════════════════════════════════════════');
      console.log('ALL 8 STEPS PASSED — Migration 124 lifecycle verified.');
      console.log('════════════════════════════════════════════════');

    } finally {
      // ════════════════════════════════════════════════════════════════════
      // FINALLY: Cleanup — always runs regardless of assertion failures
      // ════════════════════════════════════════════════════════════════════
      console.log('\n═══ FINALLY: Cleanup & Final State Report ═══');

      try {
        // Delete synthetic fixture rows
        if (seeded) {
          const delResult = await db.wfQuery(
            "DELETE FROM wf.ControlTicketOverlay WHERE DocuNo = @dno",
            { dno: { type: db.sql.NVarChar(50), value: DOCU_NO } }
          );
          console.log(`Deleted ${delResult.rowsAffected[0]} fixture rows for ${DOCU_NO}`);
        }
      } catch (cleanupErr) {
        console.error('WARNING: fixture cleanup failed:', cleanupErr.message);
      }

      try {
        // Drop backup table if it exists
        await db.wfQuery("IF OBJECT_ID('wf.ControlTicketOverlay_Pre124Backup', 'U') IS NOT NULL DROP TABLE wf.ControlTicketOverlay_Pre124Backup");
        console.log('Backup table dropped (or did not exist).');
      } catch (cleanupErr) {
        console.error('WARNING: backup table cleanup failed:', cleanupErr.message);
      }

      // Final state report
      try {
        const finalLedger = await db.query(
          "SELECT FileName, Checksum, AppliedAt FROM wf.SchemaMigration WHERE FileName LIKE '%124%'"
        );
        console.log('\n=== Final DB State ===');
        console.log(`Ledger 124: ${finalLedger.length > 0 ? JSON.stringify(finalLedger[0]) : '(none)'}`);

        const finalIdx = await db.query(
          "SELECT name FROM sys.indexes WHERE name = 'UQ_ControlTicketOverlay_DocuId' AND object_id = OBJECT_ID('wf.ControlTicketOverlay')"
        );
        console.log(`Index UQ_ControlTicketOverlay_DocuId: ${finalIdx.length > 0 ? 'EXISTS' : 'NOT PRESENT'}`);

        const finalBackup = await db.query(
          "SELECT COUNT(*) as cnt FROM sys.tables WHERE schema_id = SCHEMA_ID('wf') AND name = 'ControlTicketOverlay_Pre124Backup'"
        );
        console.log(`Backup table Pre124Backup: ${finalBackup[0]?.cnt > 0 ? 'EXISTS' : 'DROPPED'}`);

        const finalCount = await db.query('SELECT COUNT(*) as cnt FROM wf.ControlTicketOverlay');
        console.log(`wf.ControlTicketOverlay total rows: ${finalCount[0]?.cnt}`);
      } catch (reportErr) {
        console.error('WARNING: final state report failed:', reportErr.message);
      }
    }
  });

  await db.closeAll();
}

main().catch(err => {
  console.error('\nLIFECYCLE VERIFICATION FAILED:', err.message);
  process.exit(1);
});
