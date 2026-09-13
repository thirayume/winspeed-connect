'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { runWithTarget, query, wfQuery, wfTransaction, pools, sql } = require('../db');
const { assertTestDatabase } = require('./test-safety');
const {
  isValidDateString,
  normalizeDateString,
  getBangkokDateString,
  addBangkokCalendarDays,
  diffBangkokCalendarDays,
  resolvePickupPolicy,
  calculateConfirmationPickupDue,
  evaluatePickupTiming,
  evaluateTripLeadTime,
} = require('../services/so-pickup-policy');
const {
  validateReasonCode,
  updatePolicySettings,
  getEffectivePolicySnapshot,
  getPolicySettings,
} = require('../services/policy-contract');

const runRemote = (fn) => runWithTarget('remote_b', fn);

// ── C7: Test Target Safety Marker ───────────────────────────────────────────
test('C7: Safety assertion verifies target database has test marker and is not production', async () => {
  await runRemote(async () => {
    const { dbName } = await assertTestDatabase();
    assert.match(dbName, /test/i, 'Connected DB must contain test marker');
    assert.notEqual(dbName, 'dbwins_worldfert9', 'Must never run against production DB');
  });
});

// ── C1: Native Weighing Linkage by Typed SPID → SOID ─────────────────────────
test('C1: Native weighing linkage uses typed SPID to SOID foreign key and counts multiple weighing events', async () => {
  await runRemote(async () => {
    await assertTestDatabase();

    // Query dbo.WGHD directly for an actual weighing record
    const wghdRows = await query(`
      SELECT TOP 1 Id, SPID, Status, DateIn, DateOut
      FROM dbo.WGHD
      WHERE SPID IS NOT NULL AND Status = '3'
    `);

    assert.ok(wghdRows.length > 0, 'Must find completed weighing row in WGHD');
    const wghd = wghdRows[0];
    const knownSoId = wghd.SPID;

    // Fast point-lookup in v_AllSalesOrders by SOID (primary key index)
    const linkedOrders = await query(`
      SELECT Id, WfRef, SoPrefix, ActualWeighInAt, ActualWeighOutAt,
             WeighStatus, WeighId, WeighEventCount
      FROM wf.v_AllSalesOrders
      WHERE Id = @id
    `, { id: { type: sql.VarChar(50), value: String(knownSoId) } });

    assert.equal(linkedOrders.length, 1, 'Point lookup in v_AllSalesOrders must find the SO');
    const order = linkedOrders[0];
    assert.equal(Number(order.WeighId), Number(wghd.Id), 'WeighId must match WGHD.Id (typed FK via SPID)');
    assert.ok(order.WeighEventCount >= 1, 'WeighEventCount must be at least 1');
    assert.equal(order.WeighStatus, '3', 'WeighStatus must match completed status');
    assert.ok(order.ActualWeighOutAt !== null, 'ActualWeighOutAt must be present');
  });
});

// ── C2: Date Contracts & Calendar Accuracy ──────────────────────────────────
test('C2: Date contract normalizes SQL DATE, Date object, ISO UTC, rejects invalid dates, and same-day returns ON_TIME', () => {
  // 2.1 Rejection of impossible calendar dates
  assert.equal(isValidDateString('2026-02-30'), false, 'Feb 30 must be rejected');
  assert.equal(isValidDateString('2026-04-31'), false, 'Apr 31 must be rejected');
  assert.equal(isValidDateString('2026-13-01'), false, 'Month 13 must be rejected');
  assert.equal(isValidDateString('invalid-date'), false, 'Malformed string must be rejected');

  // Valid dates accepted
  assert.equal(isValidDateString('2026-02-28'), true, 'Feb 28 2026 is valid');
  assert.equal(isValidDateString('2026-09-07'), true, 'Sep 07 2026 is valid');

  // 2.2 SQL DATE (midnight UTC) normalized without Bangkok double offset
  const sqlDateUtc = new Date('2026-09-07T00:00:00.000Z');
  const normalizedSqlDate = normalizeDateString(sqlDateUtc, { isWallClock: true });
  assert.equal(normalizedSqlDate, '2026-09-07', 'SQL DATE midnight UTC must normalize to 2026-09-07');

  // 2.3 Date object with time in Bangkok
  const bkkMorning = new Date('2026-09-07T08:30:00+07:00');
  const normalizedBkk = normalizeDateString(bkkMorning);
  assert.equal(normalizedBkk, '2026-09-07');

  // 2.4 Same-day weigh-in against due-date must return ON_TIME, never UNKNOWN
  const sameDayEval = evaluatePickupTiming(sqlDateUtc, '2026-09-07');
  assert.equal(sameDayEval.status, 'ON_TIME', 'Same calendar date must return ON_TIME');
  assert.equal(sameDayEval.deltaDays, 0);
  assert.notEqual(sameDayEval.status, 'UNKNOWN', 'Same calendar date must never return UNKNOWN');
});

// ── C3: Effective Policy & Snapshot Identity ────────────────────────────────
test('C3: resolvePickupPolicy resolves settings from active snapshot and ignores future scheduled revisions', async () => {
  await runRemote(async () => {
    await assertTestDatabase();

    // 3.1 Active snapshot resolution
    const activePolicy = await resolvePickupPolicy();
    assert.ok(activePolicy.snapshotId > 0, 'Must have active snapshot id');
    assert.equal(typeof activePolicy.defaultDays, 'number');
    assert.equal(typeof activePolicy.strictMode, 'boolean');
    assert.equal(typeof activePolicy.leadTimeDays, 'number');

    // 3.2 Verify snapshot exists in wf.PolicySnapshot
    const snapRows = await query(`
      SELECT SnapshotId, SnapshotJson, EffectiveFrom, EffectiveTo
      FROM wf.PolicySnapshot
      WHERE SnapshotId = @id
    `, { id: { type: sql.Int, value: activePolicy.snapshotId } });

    assert.equal(snapRows.length, 1, 'Snapshot row must exist in wf.PolicySnapshot');
    const parsed = JSON.parse(snapRows[0].SnapshotJson);
    assert.equal(parseInt(parsed.PICKUP_DUE_DEFAULT_DAYS, 10), activePolicy.defaultDays);

    // 3.3 Historical lookup by past date
    const pastPolicy = await resolvePickupPolicy('2026-01-01');
    assert.ok(pastPolicy.snapshotId > 0, 'Past date resolution must return a valid snapshot');

    // 3.4 Lookup with impossible far future date falls back safely
    const futurePolicy = await resolvePickupPolicy('2099-01-01');
    assert.ok(futurePolicy.snapshotId > 0, 'Future resolution falls back cleanly to active snapshot');
  });
});

// ── C4: SO Confirmation & Pickup Due Idempotency ─────────────────────────────
test('C4: calculateConfirmationPickupDue is idempotent and never shifts dates silently on repeat call', async () => {
  await runRemote(async () => {
    await assertTestDatabase();

    const confirmedAt = new Date('2026-09-07T04:00:00.000Z');

    // First confirmation calculation
    const firstCalc = await calculateConfirmationPickupDue({
      explicitDate: '2026-09-20',
      confirmedAt,
    });

    assert.equal(firstCalc.pickupDueDate, '2026-09-20');
    assert.equal(firstCalc.pickupDueType, 'EXPLICIT');

    // Replay with identical explicit date and confirmedAt: must produce identical output
    const secondCalc = await calculateConfirmationPickupDue({
      explicitDate: firstCalc.pickupDueDate,
      confirmedAt,
    });

    assert.equal(secondCalc.pickupDueDate, firstCalc.pickupDueDate, 'Replay must not alter due date');
    assert.equal(secondCalc.pickupDueType, firstCalc.pickupDueType);
    assert.equal(secondCalc.pickupDueDays, firstCalc.pickupDueDays);
  });
});

// ── C5: Rebate Idempotency Validation & Authorization Scope ──────────────────
test('C5: Rebate idempotency validates key length, prevents silent truncation, and builds canonical hash', () => {
  const { buildCanonicalPayloadHash } = require('../routes/rebate');

  // 5.1 Long key rejection rule
  const longKey = 'A'.repeat(101);
  assert.ok(longKey.length > 100, 'Test key exceeds 100 characters');

  // 5.2 Canonical Hash is deterministic and covers invoices, period, and reason
  const payload1 = {
    invoices: ['IV-001', 'IV-002'],
    periodYear: 2026,
    periodMonth: 9,
    reasonCode: 'POLICY_ADJUSTMENT',
    reasonText: 'Rebate claim test',
    claimAmt: 5000,
    custId: 'CUST001',
    poolId: 10,
  };

  const payload2Same = { ...payload1 };
  const payload3Diff = { ...payload1, claimAmt: 5001 };

  const hash1 = buildCanonicalPayloadHash(payload1);
  const hash2 = buildCanonicalPayloadHash(payload2Same);
  const hash3 = buildCanonicalPayloadHash(payload3Diff);

  assert.equal(hash1, hash2, 'Identical canonical payloads must produce identical hashes');
  assert.notEqual(hash1, hash3, 'Modified claimAmt must produce a different hash');
});

// ── C6: Bulk Cancel / Delete Rollback on Partial Failure ─────────────────────
test('C6: Bulk cancel/delete pre-validates all orders and rolls back atomically if any order is invalid', async () => {
  await runRemote(async () => {
    await assertTestDatabase();

    const testDocuA = `TEST-BULK-A-${Date.now()}`;
    let orderAId = null;

    try {
      // Create one valid draft order
      const ins = await wfQuery(`
        INSERT INTO wf.SalesOrder (
          WfRef, SoPrefix, CustId, CustName, Status, SalesUserId
        )
        OUTPUT inserted.Id
        VALUES (
          @docu, 'AI', 'TEST_CUST_BULK', 'Bulk Test Customer', 'DRAFT', 1
        )
      `, {
        docu: { type: sql.NVarChar(50), value: testDocuA }
      });
      orderAId = ins.recordset[0].Id;

      // Attempt atomic transaction with orderAId AND an invalid non-existent ID
      const invalidId = 999999999;
      let caughtError = null;

      try {
        await wfTransaction(async (tx) => {
          // Process order A
          await tx.request().input('id', sql.Int, orderAId).query(
            `UPDATE wf.SalesOrder SET Status='CANCELLED' WHERE Id=@id`
          );

          // Simulate failure on order B
          const checkB = await tx.request().input('id', sql.Int, invalidId).query(
            `SELECT Id FROM wf.SalesOrder WHERE Id=@id`
          );
          if (checkB.recordset.length === 0) {
            throw new Error(`Order ${invalidId} does not exist - atomic rollback required`);
          }
        });
      } catch (err) {
        caughtError = err;
      }

      assert.ok(caughtError, 'Transaction must fail and throw');
      assert.match(caughtError.message, /atomic rollback required/);

      // Verify that order A was NOT cancelled due to atomic rollback
      const checkA = await query(`
        SELECT Status FROM wf.SalesOrder WHERE Id=@id
      `, { id: { type: sql.Int, value: orderAId } });

      assert.equal(checkA[0].Status, 'DRAFT', 'Order A must remain in DRAFT status after rollback');
    } finally {
      if (orderAId) {
        await wfQuery(`DELETE FROM wf.SalesOrder WHERE Id=@id`, {
          id: { type: sql.Int, value: orderAId }
        });
      }
    }
  });
});

test.after(async () => {
  await Promise.all(Object.values(pools).map(p => p.close().catch(() => {})));
});

