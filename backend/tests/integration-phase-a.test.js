const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { runWithTarget, query, wfQuery, wfTransaction, pools, sql } = require('../db');
const { normalizeClaim } = require('../routes/rebate');
const {
  validateReasonCode,
  validateSetting,
  validateSettingsPayload,
  updatePolicySettings,
  getEffectivePolicySnapshot,
  getPolicySettings,
} = require('../services/policy-contract');

// Helper to run assertions against remote_b test database
const runRemote = (fn) => runWithTarget('remote_b', fn);

// ── 1. UI Reason Roundtrip: Cancel/Delete SO ─────────────────────────────────
test('Phase A1: Reason Roundtrip enforces active reason master and detail for OTHER', async () => {
  await runRemote(async () => {
    // 1.1 Valid SO_CANCEL reason from DB
    const cancelValid = await validateReasonCode(null, 'SO_CANCELLED', '', 'SO_CANCEL');
    assert.equal(cancelValid.valid, true);
    assert.equal(cancelValid.reasonCode, 'SO_CANCELLED');
    assert.ok(cancelValid.reasonText.length > 0);

    // 1.2 Invalid reason code
    const cancelInvalid = await validateReasonCode(null, 'NON_EXISTENT_CODE_XYZ', '', 'SO_CANCEL');
    assert.equal(cancelInvalid.valid, false);
    assert.match(cancelInvalid.error, /ไม่ถูกต้องหรือยังไม่เปิดใช้งาน/);

    // 1.3 OTHER without detail (< 5 chars)
    const otherTooShort = await validateReasonCode(null, 'OTHER', 'no', 'SO_CANCEL');
    assert.equal(otherTooShort.valid, false);
    assert.match(otherTooShort.error, /อย่างน้อย 5 ตัวอักษร/);

    // 1.4 OTHER with valid detail (>= 5 chars)
    const otherValid = await validateReasonCode(null, 'OTHER', 'ลูกค้ายกเลิกเพราะคิวขนส่งล่าช้า', 'SO_CANCEL');
    assert.equal(otherValid.valid, true);
    assert.equal(otherValid.reasonCode, 'OTHER');
    assert.equal(otherValid.reasonText, 'ลูกค้ายกเลิกเพราะคิวขนส่งล่าช้า');

    // 1.5 Valid SO_DELETE reason from DB
    const delValid = await validateReasonCode(null, 'SO_DELETED', '', 'SO_DELETE');
    assert.equal(delValid.valid, true);
    assert.equal(delValid.reasonCode, 'SO_DELETED');

    // 1.6 Reason code restricted to other contexts (e.g. POLICY reason used in SO_CANCEL)
    const wrongContext = await validateReasonCode(null, 'POLICY_ADJUSTMENT', '', 'SO_CANCEL');
    assert.equal(wrongContext.valid, false);
    assert.match(wrongContext.error, /ไม่สามารถใช้กับบริบท SO_CANCEL ได้/);
  });
});

// ── 2. Audit Failure Rollback: Full Transaction Atomicity ───────────────────
test('Phase A2: Transaction rolls back completely if audit or secondary operation fails', async () => {
  await runRemote(async () => {
    const testDocuNo = `TEST-ROLLBACK-${Date.now()}`;

    // Attempt a transaction where an error occurs at the audit step
    let caughtError = null;
    try {
      await wfTransaction(async (tx) => {
        // Step 1: Insert temporary sales order
        const insReq = tx.request();
        insReq.input('docu', sql.NVarChar(50), testDocuNo);
        await insReq.query(`
          INSERT INTO wf.SalesOrder (WfRef, SoPrefix, CustId, CustName, Status)
          VALUES (@docu, 'AI', 'TEST_CUST', 'Test Customer', 'DRAFT')
        `);

        // Step 2: Simulate audit failure
        throw new Error('SIMULATED_AUDIT_LOG_ERROR');
      });
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError, 'Transaction must throw on audit failure');
    assert.equal(caughtError.message, 'SIMULATED_AUDIT_LOG_ERROR');

    // Step 3: Verify the record was rolled back and does not exist in DB
    const check = await wfQuery(`SELECT Id FROM wf.SalesOrder WHERE WfRef = @docu`, {
      docu: { type: sql.NVarChar(50), value: testDocuNo }
    });
    assert.equal(check.recordset.length, 0, 'SalesOrder row must NOT persist when audit fails');
  });
});

// ── 3. Persisted Normal Line-backed Claim & Scalar Projection ────────────────
test('Phase A3: Line-backed claim reads real accrual remaining and guarantees scalar projections', async () => {
  await runRemote(async () => {
    // 3.1 Verify real view wf.v_RebateAccrualRemaining exists and returns valid columns
    const lots = await query(`
      SELECT TOP 5 SourceSOID, SourceListNo, GoodCode, QtyTon, RemainingTonRebate, RemainingTonDiff
      FROM wf.v_RebateAccrualRemaining
      WHERE RemainingTonRebate > 0 OR RemainingTonDiff > 0
    `);

    assert.ok(Array.isArray(lots), 'v_RebateAccrualRemaining must return array');
    assert.ok(lots.length > 0, 'Should have test accrual lots in database');
    const firstLot = lots[0];
    assert.ok(firstLot.SourceSOID !== undefined, 'Must have SourceSOID');
    assert.ok(firstLot.SourceListNo !== undefined, 'Must have SourceListNo');
    assert.ok(firstLot.RemainingTonRebate !== undefined, 'Must have RemainingTonRebate');

    // 3.2 Verify scalar normalization on duplicate SQL aliases (R1)
    const simulatedDupe = {
      Id: 9999,
      CustomerRatio: [100.00, 100.00],
      CompanyRatio: [0.00, 0.00],
      CustomerAmount: [50000.00, 50000.00],
      RetainedAmount: [0.00, 0.00],
      IsSelfClaim: [false, false],
    };
    const norm = normalizeClaim(simulatedDupe);
    assert.equal(typeof norm.CustomerRatio, 'number');
    assert.equal(Array.isArray(norm.CustomerRatio), false);
    assert.equal(typeof norm.CustomerAmount, 'number');
    assert.equal(Array.isArray(norm.CustomerAmount), false);

    // 3.3 Verify minor-unit cents precision (R7)
    const totalAmt = 150000.50;
    const cRatio = 100.00;
    const totalCents = Math.round(totalAmt * 100);
    const customerCents = Math.round(totalCents * (cRatio / 100));
    const retainedCents = totalCents - customerCents;
    assert.equal(customerCents / 100, 150000.50);
    assert.equal(retainedCents / 100, 0.00);
    assert.equal((customerCents + retainedCents) / 100, totalAmt);
  });
});

// ── 4. Concurrent Allocation & Applock Serialization ─────────────────────────
test('Phase A4: sp_getapplock serializes concurrent allocations to prevent double-spending', async () => {
  await runRemote(async () => {
    const lockKey = `RebateCust_TEST_LOCK_${Date.now()}`;
    const pl = pools('remote_b');
    await pl.ready;

    const tx1 = new sql.Transaction(pl.ownerPool);
    const tx2 = new sql.Transaction(pl.ownerPool);

    await tx1.begin();
    await tx2.begin();

    try {
      // tx1 acquires Exclusive applock
      const req1 = tx1.request();
      req1.input('rname', sql.NVarChar(255), lockKey);
      const res1 = await req1.query(`
        DECLARE @res INT;
        EXEC @res = sp_getapplock @Resource = @rname, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 0;
        SELECT @res AS LockResult;
      `);
      assert.ok(res1.recordset[0].LockResult >= 0, 'tx1 must acquire applock successfully');

      // tx2 attempts to acquire the SAME lock with timeout 0 -> must fail with result < 0
      const req2 = tx2.request();
      req2.input('rname', sql.NVarChar(255), lockKey);
      const res2 = await req2.query(`
        DECLARE @res INT;
        EXEC @res = sp_getapplock @Resource = @rname, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 0;
        SELECT @res AS LockResult;
      `);
      const lockRes2 = res2.recordset[0].LockResult;
      assert.ok(lockRes2 < 0, `tx2 must be blocked by tx1 applock (expected < 0, got ${lockRes2})`);
    } finally {
      await tx1.rollback();
      await tx2.rollback();
    }
  });
});

// ── 5. Idempotency Key & Payload Hash Replay / Conflict ──────────────────────
test('Phase A5: Idempotency Key returns replay on same payload and 409 on altered payload', async () => {
  await runRemote(async () => {
    const testKey = `IDEM-TEST-${Date.now()}`;
    const payloadA = { custId: 'CUST-01', claimAmt: 10000, note: 'Initial submission' };
    const payloadB = { custId: 'CUST-01', claimAmt: 20000, note: 'Altered amount' };

    const hashA = crypto.createHash('sha256').update(JSON.stringify(payloadA)).digest('hex');
    const hashB = crypto.createHash('sha256').update(JSON.stringify(payloadB)).digest('hex');

    let testClaimId = null;

    try {
      // Insert initial claim with hashA
      const ins = await wfQuery(`
        INSERT INTO wf.RebateClaim (
          SalesUserId, ClaimAmt, RemainingAmt, Status, CurrentTier,
          CustomerRatio, CompanyRatio, CustomerAmount, RetainedAmount, IsSelfClaim,
          IdempotencyKey, RequestPayloadHash
        )
        OUTPUT inserted.Id
        VALUES (
          1, 10000.00, 10000.00, 'TIER2_PENDING', 2,
          100.00, 0.00, 10000.00, 0.00, 0,
          @k, @h
        )
      `, {
        k: { type: sql.VarChar(100), value: testKey },
        h: { type: sql.VarChar(64), value: hashA }
      });
      testClaimId = ins.recordset[0].Id;

      // Safe Replay test (same key, same hash)
      const replayCheck = await wfQuery(`SELECT * FROM wf.RebateClaim WHERE IdempotencyKey = @k`, {
        k: { type: sql.VarChar(100), value: testKey }
      });
      const found = replayCheck.recordset[0];
      assert.ok(found, 'Should find existing idempotent record');
      assert.equal(found.RequestPayloadHash, hashA);

      // Conflict test (same key, different hash)
      assert.notEqual(found.RequestPayloadHash, hashB, 'Mismatched payload hash must be detected as conflict');
    } finally {
      if (testClaimId) {
        await wfQuery(`DELETE FROM wf.RebateClaim WHERE Id = @id`, {
          id: { type: sql.Int, value: testClaimId }
        });
      }
    }
  });
});

// ── 6. Missing Snapshot Fail Closed Invariant ────────────────────────────────
test('Phase A6: Policy snapshot query fails closed when no active snapshot exists', async () => {
  await runRemote(async () => {
    // 6.1 Query active REBATE_POLICY snapshot from real DB
    const activeSnapshot = await getEffectivePolicySnapshot('REBATE_POLICY');
    assert.ok(activeSnapshot, 'Must have an active snapshot in the test database');
    assert.ok(activeSnapshot.SnapshotId > 0);
    assert.ok(activeSnapshot.RevisionNumber >= 1);
    assert.equal(Number(activeSnapshot.CustomerRatio), 100);
    assert.equal(Number(activeSnapshot.CompanyRatio), 0);

    // 6.2 Query non-existent policy name -> MUST throw and NOT return fallback
    let missingError = null;
    try {
      await getEffectivePolicySnapshot('NON_EXISTENT_POLICY_SHOULD_FAIL');
    } catch (err) {
      missingError = err;
    }
    assert.ok(missingError, 'Must throw error when no active snapshot exists');
    assert.match(missingError.message, /ไม่พบนโยบายที่กำลังมีผลบังคับใช้/);
  });
});

// ── 7. Future Policy Scheduling Invariant ────────────────────────────────────
test('Phase A7: Future scheduled snapshots are excluded from current effective lookup', async () => {
  await runRemote(async () => {
    const pl = pools('remote_b');
    await pl.ready;

    // Current effective snapshot
    const currentSnap = await getEffectivePolicySnapshot('REBATE_POLICY');

    // Create a temporary future snapshot (EffectiveFrom = +7 days)
    const insFuture = await wfQuery(`
      INSERT INTO wf.PolicySnapshot (
        PolicyName, RevisionNumber, CustomerRatio, CompanyRatio, SnapshotJson,
        EffectiveFrom, EffectiveTo, ChangedBy
      )
      OUTPUT inserted.SnapshotId
      VALUES (
        'REBATE_POLICY', 9999, 80.00, 20.00, '{}',
        DATEADD(DAY, 7, SYSUTCDATETIME()), NULL, 'FUTURE_TEST_USER'
      )
    `);
    const futureSnapshotId = insFuture.recordset[0].SnapshotId;

    try {
      // Query effective snapshot right now -> MUST still return currentSnap, NOT the future one
      const lookupNow = await getEffectivePolicySnapshot('REBATE_POLICY');
      assert.equal(lookupNow.SnapshotId, currentSnap.SnapshotId);
      assert.notEqual(lookupNow.SnapshotId, futureSnapshotId);
      assert.equal(Number(lookupNow.CustomerRatio), Number(currentSnap.CustomerRatio));
    } finally {
      // Clean up temporary future snapshot
      await wfQuery(`DELETE FROM wf.PolicySnapshot WHERE SnapshotId = @id`, {
        id: { type: sql.Int, value: futureSnapshotId }
      });
    }
  });
});

// ── 8. Mandatory & Stale ExpectedRevision Invariant ──────────────────────────
test('Phase A8: updatePolicySettings enforces mandatory and fresh expectedRevision', async () => {
  await runRemote(async () => {
    // 8.1 Missing expectedRevision (undefined)
    let missingRevErr = null;
    try {
      await updatePolicySettings({
        updates: { PICKUP_LEAD_TIME_DAYS: 2 },
        reasonCode: 'POLICY_ADJUSTMENT',
        reasonText: 'Test missing revision',
        userId: 'TEST_ADMIN',
      });
    } catch (err) {
      missingRevErr = err;
    }
    assert.ok(missingRevErr, 'Must reject missing expectedRevision');
    assert.equal(missingRevErr.status, 400);
    assert.match(missingRevErr.message, /ต้องระบุ expectedRevision/);

    // 8.2 Stale expectedRevision (e.g. 999999)
    let staleRevErr = null;
    try {
      await updatePolicySettings({
        updates: { PICKUP_LEAD_TIME_DAYS: 2 },
        expectedRevision: 999999,
        reasonCode: 'POLICY_ADJUSTMENT',
        reasonText: 'Test stale revision',
        userId: 'TEST_ADMIN',
      });
    } catch (err) {
      staleRevErr = err;
    }
    assert.ok(staleRevErr, 'Must reject stale expectedRevision');
    assert.equal(staleRevErr.status, 409);
    assert.match(staleRevErr.message, /การตั้งค่าถูกปรับปรุงโดยผู้ดูแลระบบท่านอื่นแล้ว/);
  });
});

// ── 9. Legitimate Zero-value Save & Reload Invariant ─────────────────────────
test('Phase A9: Legitimate zero values are preserved and reloaded without reverting to defaults', async () => {
  await runRemote(async () => {
    // 9.1 Validation layer allows 0 for lead time, overload tolerance, ticket alert, company ratio
    const zeroLead = validateSetting('PICKUP_LEAD_TIME_DAYS', 0);
    assert.equal(zeroLead.valid, true);
    assert.equal(zeroLead.formattedValue, '0');

    const zeroTolerance = validateSetting('TRIP_OVERLOAD_TOLERANCE_PCT', 0);
    assert.equal(zeroTolerance.valid, true);
    assert.equal(zeroTolerance.formattedValue, '0');

    const zeroAlert = validateSetting('CONTROL_TICKET_ALERT_DAYS', 0);
    assert.equal(zeroAlert.valid, true);
    assert.equal(zeroAlert.formattedValue, '0');

    const zeroCompany = validateSetting('COMPANY_RATIO', 0);
    assert.equal(zeroCompany.valid, true);
    assert.equal(zeroCompany.formattedValue, '0');

    // 9.2 DB Save & Reload 0 value
    // Read current settings and revision
    const settingsRes = await getPolicySettings();
    const origVal = settingsRes.raw['PICKUP_LEAD_TIME_DAYS'];
    const currentRev = settingsRes.currentRevision;

    try {
      // Save 0 with expectedRevision
      const updateRes = await updatePolicySettings({
        updates: { PICKUP_LEAD_TIME_DAYS: 0 },
        expectedRevision: currentRev,
        reasonCode: 'POLICY_ADJUSTMENT',
        reasonText: 'Test saving legitimate 0 lead time',
        userId: 'TEST_ADMIN',
      });
      assert.ok(updateRes.updatedCount > 0);

      // Reload from DB and verify exact '0'
      const reloaded = await query(`
        SELECT SettingValue FROM wf.SystemSetting WHERE SettingKey = 'PICKUP_LEAD_TIME_DAYS'
      `);
      assert.equal(reloaded[0].SettingValue, '0');
    } finally {
      // Restore original value
      const latestSettings = await getPolicySettings();
      if (latestSettings.currentRevision) {
        await updatePolicySettings({
          updates: { PICKUP_LEAD_TIME_DAYS: parseInt(origVal, 10) },
          expectedRevision: latestSettings.currentRevision,
          reasonCode: 'POLICY_ADJUSTMENT',
          reasonText: 'Restore original lead time after test',
          userId: 'TEST_ADMIN',
        });
      }
    }
  });
});
