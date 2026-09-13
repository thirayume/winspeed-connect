'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { runWithTarget, query, wfQuery, pools, sql } = require('../db');
const { assertTestDatabase } = require('./test-safety');
const {
  resolveTicketPolicy,
  evaluateTicketExpiry,
  traceNativeTicketChain,
  updateTicketExpiryOverlay,
  reconcileTicketAlerts,
  listTicketAlerts,
} = require('../services/ticket-policy');
const {
  getBangkokDateString,
  addBangkokCalendarDays,
  diffBangkokCalendarDays,
} = require('../services/so-pickup-policy');

const runRemote = (fn) => runWithTarget('remote_b', fn);

// ── 1. Target Safety Marker ──────────────────────────────────────────────────
test('SO-04.0: Target safety marker verifies test database before test execution', async () => {
  await runRemote(async () => {
    const { dbName } = await assertTestDatabase();
    assert.match(dbName, /test/i, 'Database must be test database');
    assert.notEqual(dbName, 'dbwins_worldfert9', 'Must not run against production');
  });
});

// ── 2. Explicit Expiry vs UNKNOWN (Never Guess 60/90 Days) ───────────────────
test('SO-04.1: Expiry evaluation supports explicit dates and UNKNOWN without guessing default lifetime', () => {
  const todayBkk = getBangkokDateString(); // e.g. 2026-09-07

  // Case 1.1: Missing expiry date returns UNKNOWN, never guesses 60/90 days
  const unknownRes = evaluateTicketExpiry(null, todayBkk, 7, false);
  assert.equal(unknownRes.status, 'UNKNOWN');
  assert.equal(unknownRes.expiryDate, null);
  assert.equal(unknownRes.isExpired, false);
  assert.equal(unknownRes.isNearExpiry, false);
  assert.equal(unknownRes.blocked, false);
  assert.equal(unknownRes.label, 'ไม่ระบุวันหมดอายุ');

  // Case 1.2: Empty string or invalid string returns UNKNOWN
  const emptyRes = evaluateTicketExpiry('', todayBkk, 7, false);
  assert.equal(emptyRes.status, 'UNKNOWN');
  const invalidRes = evaluateTicketExpiry('not-a-valid-date', todayBkk, 7, false);
  assert.equal(invalidRes.status, 'UNKNOWN');

  // Case 1.3: Impossible calendar date (e.g. 2026-02-30) returns UNKNOWN (fails closed)
  const impossibleRes = evaluateTicketExpiry('2026-02-30', todayBkk, 7, false);
  assert.equal(impossibleRes.status, 'UNKNOWN', 'Impossible dates must fail closed to UNKNOWN');
});

// ── 3. Bangkok Calendar Boundaries, Near-Expiry & Zero Lead Days ─────────────
test('SO-04.2: Expiry calculation respects Bangkok calendar boundaries and supports alert lead days = 0', () => {
  const todayBkk = getBangkokDateString(); // e.g. 2026-09-07

  // Case 2.1: Expiry is today with lead days = 0 -> NEAR_EXPIRY (expires today)
  const todayExpiry = evaluateTicketExpiry(todayBkk, todayBkk, 0, false);
  assert.equal(todayExpiry.status, 'NEAR_EXPIRY');
  assert.equal(todayExpiry.daysRemaining, 0);
  assert.equal(todayExpiry.label, 'หมดอายุวันนี้');
  assert.equal(todayExpiry.isExpired, false);

  // Case 2.2: Tomorrow with lead days = 0 -> VALID (not yet alerted)
  const tomorrowStr = addBangkokCalendarDays(todayBkk, 1);
  const tomorrowLead0 = evaluateTicketExpiry(tomorrowStr, todayBkk, 0, false);
  assert.equal(tomorrowLead0.status, 'VALID');
  assert.equal(tomorrowLead0.daysRemaining, 1);

  // Case 2.3: Tomorrow with lead days = 7 -> NEAR_EXPIRY (within 7 days)
  const tomorrowLead7 = evaluateTicketExpiry(tomorrowStr, todayBkk, 7, false);
  assert.equal(tomorrowLead7.status, 'NEAR_EXPIRY');
  assert.equal(tomorrowLead7.daysRemaining, 1);
  assert.match(tomorrowLead7.label, /ใกล้หมดอายุ/);

  // Case 2.4: 10 days in the future with lead days = 7 -> VALID
  const in10Days = addBangkokCalendarDays(todayBkk, 10);
  const validRes = evaluateTicketExpiry(in10Days, todayBkk, 7, false);
  assert.equal(validRes.status, 'VALID');
  assert.equal(validRes.daysRemaining, 10);
  assert.equal(validRes.blocked, false);

  // Case 2.5: Yesterday -> EXPIRED (daysRemaining = -1)
  const yesterdayStr = addBangkokCalendarDays(todayBkk, -1);
  const expiredRes = evaluateTicketExpiry(yesterdayStr, todayBkk, 7, false);
  assert.equal(expiredRes.status, 'EXPIRED');
  assert.equal(expiredRes.daysRemaining, -1);
  assert.equal(expiredRes.isExpired, true);
});

// ── 4. Strict Mode Independence (Strict OFF vs Strict ON) ────────────────────
test('SO-04.3: Expiry Strict Mode is independent from pickup Strict: OFF warns, ON blocks', () => {
  const todayBkk = getBangkokDateString();
  const expiredDate = addBangkokCalendarDays(todayBkk, -2); // Expired 2 days ago

  // Case 3.1: Strict OFF (default): warns but blocked = false
  const strictOff = evaluateTicketExpiry(expiredDate, todayBkk, 7, false);
  assert.equal(strictOff.status, 'EXPIRED');
  assert.equal(strictOff.blocked, false);
  assert.ok(strictOff.warning, 'Strict OFF must provide warning message');
  assert.equal(strictOff.error, null);

  // Case 3.2: Strict ON: blocked = true, provides blocking error message
  const strictOn = evaluateTicketExpiry(expiredDate, todayBkk, 7, true);
  assert.equal(strictOn.status, 'EXPIRED');
  assert.equal(strictOn.blocked, true);
  assert.ok(strictOn.error, 'Strict ON must provide error message');
  assert.match(strictOn.error, /บล็อกการใช้ตั๋วคุม/);
});

// ── 5. Native Chain Trace (I/K → AI → C/D → 116 → J/N) ────────────────────────
test('SO-04.4: traceNativeTicketChain resolves native chain links, product units and customer restriction', async () => {
  await runRemote(async () => {
    await assertTestDatabase();

    // Query an existing native coupon from WFCoupon to test real trace
    const sampleCoupon = await query(`
      SELECT TOP 1 CouponNo, SONo, DocuID
      FROM dbo.WFCoupon
      WHERE CouponNo IS NOT NULL AND SONo IS NOT NULL
      ORDER BY CouponID DESC
    `);

    assert.ok(sampleCoupon.length > 0, 'Must find coupon in database');
    const couponNo = sampleCoupon[0].CouponNo;

    const trace = await traceNativeTicketChain(couponNo);
    assert.ok(trace, 'Trace result must not be null');
    assert.equal(trace.ticketRef, couponNo);
    assert.ok(trace.policy, 'Policy metadata must be present');
    assert.equal(typeof trace.policy.alertDays, 'number');
    assert.equal(typeof trace.policy.strictMode, 'boolean');

    // Verify chain structure
    assert.ok(Array.isArray(trace.chain.coupons), 'Coupons list must be array');
    assert.ok(trace.chain.coupons.length > 0, 'Must have at least one coupon');
    const firstCoupon = trace.chain.coupons[0];
    assert.equal(firstCoupon.couponNo, couponNo);
    assert.ok(firstCoupon.goodId, 'GoodID must be present');
    assert.ok(firstCoupon.unitName, 'UnitName must be present');

    // Verify Customer Candidate Restriction
    assert.ok(trace.customerCandidate, 'Customer candidate section must exist');
    assert.equal(trace.customerCandidate.isPrefixCandidateOnly, true);
    assert.equal(trace.customerCandidate.sharedRedemptionAllowed, false);
    assert.match(trace.customerCandidate.note, /Prefix ลูกค้าเป็น candidate เท่านั้น/);
  });
});

// ── 6. Overlay Update with Reason Master & Audit Trail ───────────────────────
test('SO-04.5: updateTicketExpiryOverlay enforces reason master, records overlay and logs ChangeEvent', async () => {
  await runRemote(async () => {
    await assertTestDatabase();

    const testDocuNo = `TEST-TICKET-${Date.now()}`;
    const testExpiry = '2026-11-30';

    try {
      // 6.1 Update with valid reason master
      const updateRes = await updateTicketExpiryOverlay({
        docuNo: testDocuNo,
        docuType: 104,
        docuId: 99999,
        goodCode: 'TEST-GOOD',
        expiryDate: testExpiry,
        strictOverride: true,
        reasonCode: 'POLICY_ADJUSTMENT',
        reasonText: 'ปรับปรุงวันหมดอายุสำหรับสัญญาจัดซื้อพิเศษ',
        userId: 'TEST_AGENT',
      });

      assert.equal(updateRes.success, true);
      assert.equal(updateRes.docuNo, testDocuNo);
      assert.equal(updateRes.expiryDate, testExpiry);
      assert.equal(updateRes.expiryType, 'EXPLICIT');
      assert.equal(updateRes.strictOverride, true);

      // 6.2 Verify row in wf.ControlTicketOverlay
      const overlayRows = await query(`
        SELECT * FROM wf.ControlTicketOverlay WHERE DocuNo = @dno
      `, { dno: { type: sql.NVarChar(50), value: testDocuNo } });

      assert.equal(overlayRows.length, 1);
      const row = overlayRows[0];
      assert.equal(row.ExpiryType, 'EXPLICIT');
      assert.equal(row.StrictOverrideFlag, true);
      assert.equal(row.ReasonCode, 'POLICY_ADJUSTMENT');
      assert.equal(row.CreatedBy, 'TEST_AGENT');

      // 6.3 Verify Audit log in wf.ChangeEvent
      const auditRows = await query(`
        SELECT TOP 1 * FROM wf.ChangeEvent
        WHERE EntityType = 'CONTROL_TICKET' AND EntityId = @dno
        ORDER BY EventId DESC
      `, { dno: { type: sql.VarChar(100), value: testDocuNo } });

      assert.ok(auditRows.length > 0, 'Must record ChangeEvent for ticket overlay');
      assert.equal(auditRows[0].ReasonCode, 'POLICY_ADJUSTMENT');
      assert.equal(auditRows[0].UserId, 'TEST_AGENT');

      // 6.4 Invalid reason rejection check
      let invalidReasonCaught = false;
      try {
        await updateTicketExpiryOverlay({
          docuNo: testDocuNo,
          expiryDate: testExpiry,
          reasonCode: 'INVALID_REASON_XYZ',
          reasonText: '',
          userId: 'TEST_AGENT',
        });
      } catch (err) {
        invalidReasonCaught = true;
        assert.match(err.message, /ไม่ถูกต้องหรือยังไม่เปิดใช้งาน/);
      }
      assert.equal(invalidReasonCaught, true, 'Must reject invalid reason code');
    } finally {
      // Clean up test overlay and change events
      await wfQuery(`DELETE FROM wf.ControlTicketOverlay WHERE DocuNo = @dno`, {
        dno: { type: sql.NVarChar(50), value: testDocuNo }
      });
      await wfQuery(`DELETE FROM wf.ChangeEvent WHERE EntityType = 'CONTROL_TICKET' AND EntityId = @dno`, {
        dno: { type: sql.VarChar(100), value: testDocuNo }
      });
      await wfQuery(`DELETE FROM wf.ControlTicketAlert WHERE DocuNo = @dno`, {
        dno: { type: sql.NVarChar(50), value: testDocuNo }
      });
    }
  });
});

// ── 7. Deduplicated Alerts & Lifecycle Management ────────────────────────────
test('SO-04.6: Near-expiry and expired alerts are deduplicated and resolved when expiry is extended', async () => {
  await runRemote(async () => {
    await assertTestDatabase();

    const testDocuNo = `TEST-ALERT-DEDUP-${Date.now()}`;
    const todayBkk = getBangkokDateString();
    const nearExpiryDate = addBangkokCalendarDays(todayBkk, 2); // 2 days from now

    try {
      // 7.1 Create overlay with near-expiry date
      await updateTicketExpiryOverlay({
        docuNo: testDocuNo,
        expiryDate: nearExpiryDate,
        reasonCode: 'POLICY_ADJUSTMENT',
        reasonText: 'Test near expiry alert generation',
        userId: 'TEST_ADMIN',
      });

      // 7.2 Run alert reconciliation
      await reconcileTicketAlerts(testDocuNo);

      // Check alert row
      const alerts1 = await query(`
        SELECT * FROM wf.ControlTicketAlert WHERE DocuNo = @dno AND Status = 'ACTIVE'
      `, { dno: { type: sql.NVarChar(50), value: testDocuNo } });

      assert.equal(alerts1.length, 1, 'Must create exactly 1 active alert');
      assert.equal(alerts1[0].AlertType, 'NEAR_EXPIRY');
      const firstHash = alerts1[0].DedupHash;

      // 7.3 Run reconciliation AGAIN (simulating frequent polling / page refresh)
      await reconcileTicketAlerts(testDocuNo);

      const alerts2 = await query(`
        SELECT * FROM wf.ControlTicketAlert WHERE DocuNo = @dno AND Status = 'ACTIVE'
      `, { dno: { type: sql.NVarChar(50), value: testDocuNo } });

      assert.equal(alerts2.length, 1, 'Re-running reconciliation MUST NOT create duplicate alerts');
      assert.equal(alerts2[0].DedupHash, firstHash);

      // 7.4 Extend expiry date far into the future (e.g. 60 days)
      const farFutureDate = addBangkokCalendarDays(todayBkk, 60);
      await updateTicketExpiryOverlay({
        docuNo: testDocuNo,
        expiryDate: farFutureDate,
        reasonCode: 'POLICY_ADJUSTMENT',
        reasonText: 'Extended ticket expiry to resolve alert',
        userId: 'TEST_ADMIN',
      });

      // Check that alert was resolved
      const activeAfterExtend = await query(`
        SELECT * FROM wf.ControlTicketAlert WHERE DocuNo = @dno AND Status = 'ACTIVE'
      `, { dno: { type: sql.NVarChar(50), value: testDocuNo } });
      assert.equal(activeAfterExtend.length, 0, 'Active alert must be resolved when expiry is extended');

      const resolvedAlert = await query(`
        SELECT * FROM wf.ControlTicketAlert WHERE DocuNo = @dno AND Status = 'RESOLVED'
      `, { dno: { type: sql.NVarChar(50), value: testDocuNo } });
      assert.equal(resolvedAlert.length, 1, 'Previous alert must be marked as RESOLVED');
      assert.ok(resolvedAlert[0].ResolvedAt !== null, 'ResolvedAt timestamp must be recorded');
    } finally {
      await wfQuery(`DELETE FROM wf.ControlTicketOverlay WHERE DocuNo = @dno`, {
        dno: { type: sql.NVarChar(50), value: testDocuNo }
      });
      await wfQuery(`DELETE FROM wf.ControlTicketAlert WHERE DocuNo = @dno`, {
        dno: { type: sql.NVarChar(50), value: testDocuNo }
      });
      await wfQuery(`DELETE FROM wf.ChangeEvent WHERE EntityType = 'CONTROL_TICKET' AND EntityId = @dno`, {
        dno: { type: sql.VarChar(100), value: testDocuNo }
      });
    }
  });
});

test.after(async () => {
  await Promise.all(Object.values(pools).map(p => p.close().catch(() => {})));
  setTimeout(() => process.exit(0), 100).unref();
});
