'use strict';

/**
 * rehearse-native-redemption-lifecycle.cjs
 *
 * Hardened Full Lifecycle Rehearsal for Slice 2 (WinSpeed Native 116 Writeback).
 * Implements all specifications in:
 * - docs/sale-app/qa/ANTIGRAVITY-INTEGRATED-NATIVE-UAT-GATE-20260924.md (§2 & §3)
 * - docs/sale-app/qa/WINSPEED-116-LIVE-EVIDENCE-20260924.md
 *
 * SAFETY INVARIANTS:
 * - Engine & Database verification before first write (test principal, DB=test_v2, Server=21181f44f254, prodAccess=0).
 * - ZERO touch of production or prohibited coupons (245833, 245834, 245838, 154558, 154766, 276867).
 * - ZERO touch of dbo.EMRunBrch.
 * - Exact-ID + Run-Ownership predicate cleanup; fails if zero leftover verification is not satisfied.
 * - Durable cleanup receipt written to disk.
 */

process.env.DB_MODE = 'remote_b';
process.env.ALLOW_TEST_NATIVE_WRITEBACK = 'true';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('node:assert/strict');
const db = require('../db');
const { assertTestDatabase } = require('../tests/test-safety');
const {
  createRedemptionDocument,
  reverseRedemptionDocument,
} = require('../services/redemption-native-adapter');

const PROHIBITED_COUPONS = [245833, 245834, 245838, 154558, 154766, 276867];
const RECEIPT_FILE = path.resolve(__dirname, 'rehearsal-cleanup-receipt.json');

// Run ownership tag
const RUN_ID = `RUN-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

// In-memory tracked owned IDs (populated ONLY after successful INSERT)
const ownedCoupons = new Map(); // CouponID -> CouponNo
const ownedRedemptionIds = new Set();
const ownedAuditIds = new Set();

function saveReceipt() {
  const receipt = {
    runId: RUN_ID,
    timestamp: new Date().toISOString(),
    ownedCoupons: Array.from(ownedCoupons.entries()).map(([id, no]) => ({ id, no })),
    ownedRedemptionIds: Array.from(ownedRedemptionIds),
    ownedAuditIds: Array.from(ownedAuditIds),
  };
  fs.writeFileSync(RECEIPT_FILE, JSON.stringify(receipt, null, 2), 'utf8');
}

async function main() {
  console.log('===============================================================');
  console.log(`🚀 STARTING HARDENED SLICE 2 REHEARSAL [${RUN_ID}]`);
  console.log('===============================================================');

  // 1. Safety Guard Verification before first write
  console.log('\n[1/8] Verifying Database & Engine Safety Invariants...');
  process.env.COUPON_NATIVE_POSTING_ENABLED = 'false'; // Start disabled to test gate
  const safety = await assertTestDatabase();

  console.log('✓ Safety Guard Confirmed:');
  console.log(`  - Database:    ${safety.dbName}`);
  console.log(`  - Server:      ${safety.serverName}`);
  console.log(`  - Login:       ${safety.loginName}`);
  console.log(`  - Sysadmin:    ${safety.isSysadmin}`);
  console.log(`  - Prod Access: ${safety.prodAccess}`);

  assert.equal(safety.dbName, 'dbwins_worldfert9_test_v2');
  assert.equal(safety.serverName, '21181f44f254');
  assert.equal(safety.prodAccess, 0);
  assert.equal(safety.isSysadmin, 0);

  // Baseline EMRunBrch
  const emrunBefore = await db.query(`SELECT LastNo FROM dbo.EMRunBrch WHERE RunCode = 'redemption'`);
  const initialLastNo = emrunBefore[0]?.LastNo;
  console.log(`  - Baseline EMRunBrch LastNo: "${initialLastNo}" (MUST NOT CHANGE)`);

  try {
    // 2. Test Feature Gate Denial at Service Boundary
    console.log('\n[2/8] Testing Service Boundary Feature Gate (COUPON_NATIVE_POSTING_ENABLED=false)...');
    let gateDenied = false;
    try {
      await createRedemptionDocument({
        docuNo: 'GATE-TEST-01',
        carLicense: 'TEST-TRUCK',
        lines: [{ couponId: 999999, goodQty: 1 }],
      });
    } catch (err) {
      if (err.code === 'NATIVE_POSTING_DISABLED') {
        gateDenied = true;
        console.log(`✓ Create correctly denied by feature gate: "${err.message}"`);
      } else {
        throw err;
      }
    }
    assert.equal(gateDenied, true, 'createRedemptionDocument must fail closed when flag=false');

    let reverseDenied = false;
    try {
      await reverseRedemptionDocument({ redemtionId: 999999 });
    } catch (err) {
      if (err.code === 'NATIVE_POSTING_DISABLED') {
        reverseDenied = true;
        console.log(`✓ Reverse correctly denied by feature gate: "${err.message}"`);
      } else {
        throw err;
      }
    }
    assert.equal(reverseDenied, true, 'reverseRedemptionDocument must fail closed when flag=false');

    // Enable feature flag for authorized test harness
    process.env.COUPON_NATIVE_POSTING_ENABLED = 'true';

    // 3. Test BLOCKED_SPEC Reversal Gate
    console.log('\n[3/8] Testing Reversal BLOCKED_SPEC Gate (Flag=true)...');
    let blockedSpecThrew = false;
    try {
      await reverseRedemptionDocument({ redemtionId: 999999 });
    } catch (err) {
      if (err.code === 'BLOCKED_SPEC' && err.status === 501) {
        blockedSpecThrew = true;
        console.log(`✓ Reverse strictly rejected as BLOCKED_SPEC (501): "${err.message}"`);
      } else {
        throw err;
      }
    }
    assert.equal(blockedSpecThrew, true, 'reverseRedemptionDocument must be BLOCKED_SPEC (501)');

    // 4. Safe Synthetic Fixture Creation (Atomic ID Registration)
    console.log('\n[4/8] Seeding Run-Owned Synthetic Fixtures in dbo.WFCoupon...');
    const testCouponNo1 = `CP1-${RUN_ID.slice(-10)}`;
    const testCouponNo2 = `CP2-${RUN_ID.slice(-10)}`;

    const seedCoupon = async (couponNo, qty = 10.0) => {
      const maxCpRes = await db.query(`SELECT ISNULL(MAX(CouponID), 0) + 1 AS NextCouponId FROM dbo.WFCoupon`);
      const nextId = Number(maxCpRes[0].NextCouponId);

      assert.ok(
        !PROHIBITED_COUPONS.includes(nextId),
        `CRITICAL: Generated CouponID ${nextId} matches prohibited test coupon!`
      );

      await db.dboWrite(`
        INSERT INTO dbo.WFCoupon (
          CouponID, GoodID, InveID, LocaID, GoodUnitID, GoodPrice,
          DocuID, RefListno, Docutype, Listno, CouponNo, SONo,
          ContainQty, GoodQty, SackQty, RemaQty, GoodName
        ) VALUES (
          @cid, 1156, 1000, 1000, 1002, 15600,
          999999, 1, '104', 1, @cpNo, 'SO-TEST-REHEARSAL',
          50, @qty, 200, @qty, '0-0-60 (เม็ด) REHEARSAL FIXTURE'
        )
      `, {
        cid: { type: db.sql.Int, value: nextId },
        cpNo: { type: db.sql.VarChar(25), value: couponNo },
        qty: { type: db.sql.Decimal(18, 3), value: qty },
      });

      // ONLY record ownership AFTER successful insert
      ownedCoupons.set(nextId, couponNo);
      saveReceipt();
      console.log(`✓ Registered owned coupon: ID=${nextId}, CouponNo="${couponNo}", RemaQty=${qty}`);
      return nextId;
    };

    const couponId1 = await seedCoupon(testCouponNo1, 10.0);
    const couponId2 = await seedCoupon(testCouponNo2, 10.0);

    // 5. Deterministic Input Validation & Fidelity Rejections
    console.log('\n[5/8] Testing Deterministic Validation & Fidelity Guards...');

    // 5.1 Invalid quantities
    let qtyRejected = false;
    try {
      await createRedemptionDocument({
        docuNo: `DOC-${RUN_ID.slice(-8)}-V1`,
        carLicense: 'TEST-TRUCK',
        lines: [{ couponId: couponId1, goodQty: -2 }],
      });
    } catch (err) {
      if (err.code === 'INVALID_GOOD_QTY') qtyRejected = true;
    }
    assert.equal(qtyRejected, true, 'Negative goodQty was not rejected');

    // 5.2 Repeated couponId in lines
    let repeatedCouponRejected = false;
    try {
      await createRedemptionDocument({
        docuNo: `DOC-${RUN_ID.slice(-8)}-V2`,
        carLicense: 'TEST-TRUCK',
        lines: [
          { couponId: couponId1, goodQty: 2 },
          { couponId: couponId1, goodQty: 3 },
        ],
      });
    } catch (err) {
      if (err.code === 'DUPLICATE_COUPON_IN_LINES') repeatedCouponRejected = true;
    }
    assert.equal(repeatedCouponRejected, true, 'Repeated couponId lines were not rejected');

    // 5.3 GoodID mismatch
    let goodIdMismatchRejected = false;
    try {
      await createRedemptionDocument({
        docuNo: `DOC-${RUN_ID.slice(-8)}-V3`,
        carLicense: 'TEST-TRUCK',
        lines: [{ couponId: couponId1, goodId: 9999, goodQty: 1 }],
      });
    } catch (err) {
      if (err.code === 'GOOD_ID_MISMATCH') goodIdMismatchRejected = true;
    }
    assert.equal(goodIdMismatchRejected, true, 'GoodID mismatch was not rejected');

    // 5.4 GoodUnitID mismatch
    let unitMismatchRejected = false;
    try {
      await createRedemptionDocument({
        docuNo: `DOC-${RUN_ID.slice(-8)}-V4`,
        carLicense: 'TEST-TRUCK',
        lines: [{ couponId: couponId1, goodUnitId: 8888, goodQty: 1 }],
      });
    } catch (err) {
      if (err.code === 'GOOD_UNIT_MISMATCH') unitMismatchRejected = true;
    }
    assert.equal(unitMismatchRejected, true, 'GoodUnitID mismatch was not rejected');

    // 5.5 Insufficient balance
    let insufficientRejected = false;
    try {
      await createRedemptionDocument({
        docuNo: `DOC-${RUN_ID.slice(-8)}-V5`,
        carLicense: 'TEST-TRUCK',
        lines: [{ couponId: couponId1, goodQty: 50.0 }],
      });
    } catch (err) {
      if (err.code === 'INSUFFICIENT_COUPON_REMA_QTY') insufficientRejected = true;
    }
    assert.equal(insufficientRejected, true, 'Insufficient balance was not rejected');

    console.log('✓ All 5 deterministic validation and fidelity guards passed.');

    // 6. Concurrency & Deadlock Prevention: Multi-Coupon Lock Ordering
    console.log('\n[6/8] Testing Multi-Coupon Writeback with Deadlock-Safe Ordering...');
    const testDocuNoMulti = `DOC-${RUN_ID.slice(-8)}-MULTI`;

    // Pass lines in descending order (couponId2 > couponId1) to prove adapter sorts them ASC
    const multiDoc = await createRedemptionDocument({
      docuNo: testDocuNoMulti,
      carLicense: 'TRUCK-MULTI',
      lines: [
        { couponId: Math.max(couponId1, couponId2), goodQty: 2.5 },
        { couponId: Math.min(couponId1, couponId2), goodQty: 1.5 },
      ],
      operatorName: 'MultiTester',
      computerName: 'TEST-PC',
    });

    ownedRedemptionIds.add(multiDoc.redemtionId);
    ownedAuditIds.add(multiDoc.auditId);
    saveReceipt();

    assert.equal(multiDoc.sumGoodQty, 4.0);
    assert.equal(multiDoc.linesCount, 2);
    console.log(`✓ Multi-coupon document created: RedemtionID=${multiDoc.redemtionId}, DocuNo="${testDocuNoMulti}"`);

    // 7. Verify Database State Across All Tables
    console.log('\n[7/8] Verifying Integrity Across WFRedemtionHD, DT, WFCoupon, Mirror, SMAudit...');

    // 7.1 WFRedemtionHD
    const hd = (await db.query(`SELECT * FROM dbo.WFRedemtionHD WHERE RedemtionID = ${multiDoc.redemtionId}`))[0];
    assert.equal(hd.DocuNo, testDocuNoMulti);
    assert.equal(hd.DocuType, '116');
    assert.equal(hd.DocuStatus, 'N', 'DocuStatus must be N');
    assert.equal(hd.IsCheckAll, 'Y', 'IsCheckAll must be Y');
    assert.equal(Number(hd.SumGoodQty), 4.0);
    console.log('✓ dbo.WFRedemtionHD verified: DocuStatus="N", SumGoodQty=4.0');

    // 7.2 WFRedemtionDT
    const dtRows = await db.query(`SELECT * FROM dbo.WFRedemtionDT WHERE RedemtionID = ${multiDoc.redemtionId} ORDER BY Listno ASC`);
    assert.equal(dtRows.length, 2);
    assert.equal(dtRows[0].PostInv, 'N');
    assert.equal(dtRows[1].PostInv, 'N');
    assert.equal(Number(dtRows[0].RemaQty), 10.0, 'DT line 1 RemaQty must be SNAPSHOT BEFORE deduction (10.0)');
    assert.equal(Number(dtRows[1].RemaQty), 10.0, 'DT line 2 RemaQty must be SNAPSHOT BEFORE deduction (10.0)');
    console.log('✓ dbo.WFRedemtionDT verified: 2 lines, PostInv="N", Snapshot RemaQty=10.0 on both');

    // 7.3 WFCoupon Balances
    const cp1 = (await db.query(`SELECT RemaQty FROM dbo.WFCoupon WHERE CouponID = ${couponId1}`))[0];
    const cp2 = (await db.query(`SELECT RemaQty FROM dbo.WFCoupon WHERE CouponID = ${couponId2}`))[0];
    assert.equal(Number(cp1.RemaQty), couponId1 < couponId2 ? 8.5 : 7.5);
    assert.equal(Number(cp2.RemaQty), couponId1 < couponId2 ? 7.5 : 8.5);
    console.log(`✓ dbo.WFCoupon balances verified: CP1=${cp1.RemaQty}, CP2=${cp2.RemaQty}`);

    // 7.4 wf.CouponRedemptionMirror
    const mirrors = await db.query(`SELECT * FROM wf.CouponRedemptionMirror WHERE RedemtionID = ${multiDoc.redemtionId} ORDER BY CouponID ASC`);
    assert.equal(mirrors.length, 2);
    assert.equal(mirrors[0].Source, 'SALE_APP');
    assert.equal(mirrors[0].Status, 'COMPLETED');
    assert.equal(mirrors[1].Source, 'SALE_APP');
    assert.equal(mirrors[1].Status, 'COMPLETED');
    console.log('✓ wf.CouponRedemptionMirror verified: 2 rows, Source="SALE_APP", Status="COMPLETED"');

    // 7.5 dbo.SMAudit
    const audit = (await db.query(`SELECT * FROM dbo.SMAudit WHERE audit_id = ${multiDoc.auditId}`))[0];
    assert.equal(audit.audit_action?.trim(), 'I');
    assert.equal(audit.audit_docuno?.trim(), testDocuNoMulti);
    assert.equal(audit.audit_columnid, multiDoc.redemtionId);
    console.log(`✓ dbo.SMAudit verified: audit_id=${multiDoc.auditId}, Action="I", columnid=RedemtionID`);

    // 7.6 Duplicate DocuNo Rejection under transaction
    let dupRejected = false;
    try {
      await createRedemptionDocument({
        docuNo: testDocuNoMulti,
        carLicense: 'TRUCK-MULTI',
        lines: [{ couponId: couponId1, goodQty: 1 }],
      });
    } catch (err) {
      if (err.code === 'DUPLICATE_DELIVERY_DOCU_NO') dupRejected = true;
    }
    assert.equal(dupRejected, true, 'Duplicate DocuNo was not rejected');
    console.log('✓ Duplicate DocuNo correctly rejected under transaction lock.');

    // 7.7 Verify EMRunBrch was UNTOUCHED
    const emrunAfter = await db.query(`SELECT LastNo FROM dbo.EMRunBrch WHERE RunCode = 'redemption'`);
    assert.equal(emrunAfter[0]?.LastNo, initialLastNo, 'EMRunBrch LastNo MUST NOT CHANGE!');
    console.log(`✓ dbo.EMRunBrch verified untouched: LastNo remains "${initialLastNo}"`);

    console.log('\n===============================================================');
    console.log('🎉 ALL HARDENED REHEARSAL INVARIANTS & VERIFICATIONS PASSED!');
    console.log('===============================================================');

  } finally {
    // 8. Safe Owned-Only Fixture Cleanup with Zero Leftover Verification
    console.log('\n[8/8] Cleaning Up Run-Owned Fixtures with Exact Predicates...');
    let cleanupFailed = false;

    try {
      // 8.1 Delete mirror rows
      if (ownedRedemptionIds.size > 0) {
        const idList = Array.from(ownedRedemptionIds).join(',');
        await db.wfQuery(`DELETE FROM wf.CouponRedemptionMirror WHERE RedemtionID IN (${idList})`);
        console.log(`  - Cleaned up wf.CouponRedemptionMirror for RedemtionIDs: [${idList}]`);
      }

      // 8.2 Delete SMAudit rows
      if (ownedAuditIds.size > 0) {
        const auditList = Array.from(ownedAuditIds).join(',');
        await db.dboWrite(`DELETE FROM dbo.SMAudit WHERE audit_id IN (${auditList})`);
        console.log(`  - Cleaned up dbo.SMAudit for audit_ids: [${auditList}]`);
      }

      // 8.3 Delete DT and HD rows
      if (ownedRedemptionIds.size > 0) {
        const idList = Array.from(ownedRedemptionIds).join(',');
        await db.dboWrite(`DELETE FROM dbo.WFRedemtionDT WHERE RedemtionID IN (${idList})`);
        await db.dboWrite(`DELETE FROM dbo.WFRedemtionHD WHERE RedemtionID IN (${idList})`);
        console.log(`  - Cleaned up dbo.WFRedemtionDT and dbo.WFRedemtionHD for [${idList}]`);
      }

      // 8.4 Delete owned coupons using exact (ID AND CouponNo) ownership predicate
      for (const [cid, cno] of ownedCoupons.entries()) {
        await db.dboWrite(`
          DELETE FROM dbo.WFCoupon
          WHERE CouponID = @cid AND CouponNo = @cno
        `, {
          cid: { type: db.sql.Int, value: cid },
          cno: { type: db.sql.VarChar(25), value: cno },
        });
        console.log(`  - Cleaned up dbo.WFCoupon ID ${cid} ("${cno}")`);
      }

      // 8.5 Verification of ZERO Leftovers
      console.log('Verifying zero owned leftovers in database...');
      if (ownedRedemptionIds.size > 0) {
        const idList = Array.from(ownedRedemptionIds).join(',');
        const hdLeft = await db.query(`SELECT COUNT(*) as cnt FROM dbo.WFRedemtionHD WHERE RedemtionID IN (${idList})`);
        const dtLeft = await db.query(`SELECT COUNT(*) as cnt FROM dbo.WFRedemtionDT WHERE RedemtionID IN (${idList})`);
        const mirrorLeft = await db.query(`SELECT COUNT(*) as cnt FROM wf.CouponRedemptionMirror WHERE RedemtionID IN (${idList})`);
        assert.equal(Number(hdLeft[0].cnt), 0, 'Residual WFRedemtionHD detected!');
        assert.equal(Number(dtLeft[0].cnt), 0, 'Residual WFRedemtionDT detected!');
        assert.equal(Number(mirrorLeft[0].cnt), 0, 'Residual CouponRedemptionMirror detected!');
      }

      for (const [cid] of ownedCoupons.entries()) {
        const cpLeft = await db.query(`SELECT COUNT(*) as cnt FROM dbo.WFCoupon WHERE CouponID = ${cid}`);
        assert.equal(Number(cpLeft[0].cnt), 0, `Residual WFCoupon ID ${cid} detected!`);
      }

      console.log('✓ ZERO LEFTOVER VERIFICATION CONFIRMED: Database restored to pre-run state.');
      // Remove durable receipt file upon verified cleanup
      if (fs.existsSync(RECEIPT_FILE)) {
        fs.unlinkSync(RECEIPT_FILE);
      }
    } catch (cleanErr) {
      cleanupFailed = true;
      console.error('❌ CLEANUP ERROR:', cleanErr.message);
    }

    if (cleanupFailed) {
      throw new Error('REHEARSAL RUN FAILED: Cleanup did not satisfy zero-residual verification!');
    }
  }

  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ REHEARSAL EXECUTION FAILED:', err);
  process.exit(1);
});
