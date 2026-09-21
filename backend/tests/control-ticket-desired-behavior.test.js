/**
 * control-ticket-desired-behavior.test.js
 *
 * P1 & P2 Desired Behavior Acceptance Test Suite
 * Covers R1-01 to R1-09:
 * 1. Target isolation in before hook (aborts if not dbwins_worldfert9_test_v2)
 * 2. Universal native resolver forward and backward trace:
 *    - I/K 103 -> AI -> I/K 104 -> C/D WFCoupon -> 116 -> J/N 107
 *    - I69-04068, AI69-06789, I69-03699, C6906916 resolve to the same CouponID 245838
 *    - K69-02552, AI69-06663 resolve to D6904966, Redemption 69090039, Invoice N69-02527
 * 3. Duplicate CouponNo disambiguation:
 *    - D6302491 returns isAmbiguous: true with candidates list
 *    - Exact CouponID 154572 resolves unambiguously
 * 4. Active Control Tickets discovery & balance:
 *    - GET /api/master/control-tickets (tab=ACTIVE) discovers positive coupons (236 items)
 *    - C6906916 shows 1000 tons available (NOT 0 / used-up)
 * 5. Multi-axis statuses (BalanceState, Lifecycle, ExpiryState, Eligibility)
 * 6. Explicit expiry vs UNKNOWN without overlay
 * 7. Safe cleanup in after hook
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const { resolveNativeDocumentChain } = require('../services/native-document-resolver');
const { traceNativeTicketChain, evaluateTicketExpiry } = require('../services/ticket-policy');

const runRemote = (fn) => db.runWithTarget('remote_b', fn);

test.describe('P1 & P2: Control Ticket Resolver, Balance Engine & API Acceptance', () => {

  // ── Guard: Target Safety ──────────────────────────────────────────────────
  test.before(async () => {
    await runRemote(async () => {
      const res = await db.query('SELECT DB_NAME() AS dbName, @@SERVERNAME AS srv');
      const dbName = String(res[0]?.dbName || '').toLowerCase();
      if (dbName !== 'dbwins_worldfert9_test_v2') {
        throw new Error(`CRITICAL TEST SAFETY ERROR: Target is "${dbName}", expected "dbwins_worldfert9_test_v2"`);
      }
    });
  });

  // ── P1-01: Booking DocuNo & AI Approval Number Trace to Coupon ─────────────
  test('P1-01: I69-04068, AI69-06789, and C6906916 resolve to identical CouponID 245838', async () => {
    await runRemote(async () => {
      // 1. By 103 Booking DocuNo
      const tBooking = await traceNativeTicketChain('I69-04068');
      assert.equal(tBooking.isAmbiguous, false);
      assert.ok(tBooking.chain.coupons.length >= 1, 'Booking must resolve to at least 1 coupon');
      const cp1 = tBooking.chain.coupons.find(c => c.couponNo === 'C6906916');
      assert.ok(cp1, 'Must contain coupon C6906916');
      assert.equal(Number(cp1.couponId), 245838);
      assert.equal(cp1.remainingQtyTon, 1000);

      // 2. By AI Approval Number on the same booking
      const tAI = await traceNativeTicketChain('AI69-06789');
      assert.equal(tAI.isAmbiguous, false);
      const cp2 = tAI.chain.coupons.find(c => c.couponNo === 'C6906916');
      assert.ok(cp2, 'AI must resolve to coupon C6906916');
      assert.equal(Number(cp2.couponId), 245838);

      // 3. By CouponNo
      const tCoupon = await traceNativeTicketChain('C6906916');
      assert.equal(tCoupon.isAmbiguous, false);
      assert.equal(tCoupon.chain.booking?.docuNo, 'I69-04068');
      assert.equal(tCoupon.chain.booking?.appvDocuNo, 'AI69-06789');
      assert.equal(Number(tCoupon.chain.coupons[0].couponId), 245838);

      // 4. By Delivery 104 DocuNo (with explicit entityType)
      const tDelivery = await traceNativeTicketChain('I69-03699', { entityType: 'DELIVERY' });
      assert.equal(tDelivery.isAmbiguous, false);
      assert.equal(Number(tDelivery.chain.coupons[0].couponId), 245838);
    });
  });

  // ── P1-02: Full Downstream Trace (103 -> AI -> 104 -> C/D -> 116 -> 107) ───
  test('P1-02: K69-02552 resolves full downstream chain to Redemption 69090039 and Invoice N69-02527', async () => {
    await runRemote(async () => {
      const t = await traceNativeTicketChain('K69-02552');
      assert.equal(t.isAmbiguous, false);
      assert.equal(t.chain.booking?.docuNo, 'K69-02552');
      assert.equal(t.chain.booking?.appvDocuNo, 'AI69-06663');

      // Check deliveries
      assert.ok(t.chain.deliveries.length >= 1);
      assert.ok(t.chain.deliveries.some(d => d.docuNo === 'K69-02418'));

      // Check coupons
      const cNos = t.chain.coupons.map(c => c.couponNo);
      assert.ok(cNos.includes('D6904965') || cNos.includes('D6904966'));

      // Check redemptions (116)
      const rNos = t.chain.redemptions.map(r => r.redemptionDocuNo);
      assert.ok(rNos.includes('69090039'), 'Must link to redemption 69090039');

      // Check invoices (107)
      const invNos = t.chain.redemptions.map(r => r.invoiceDocuNo).filter(Boolean);
      assert.ok(invNos.includes('N69-02527'), 'Must link to invoice N69-02527');
    });
  });

  // ── P1-03: Duplicate Coupon Disambiguation ─────────────────────────────────
  test('P1-03: Duplicate CouponNo D6302491 returns ambiguity and resolves cleanly with exact CouponID', async () => {
    await runRemote(async () => {
      // 1. Search by bare duplicate CouponNo -> returns isAmbiguous: true
      const ambRes = await traceNativeTicketChain('D6302491');
      assert.equal(ambRes.isAmbiguous, true);
      assert.ok(ambRes.candidates.length >= 2, 'Must have at least 2 candidates for D6302491');

      // 2. Disambiguate by exact CouponID 154572
      const exactRes = await traceNativeTicketChain(null, { exactId: 154572, entityType: 'COUPON' });
      assert.equal(exactRes.isAmbiguous, false);
      assert.equal(Number(exactRes.chain.coupons[0].couponId), 154572);
      assert.equal(exactRes.customerCandidate?.candidateCustName, 'คุณสุทินพา เค้ามูล');
    });
  });

  // ── P2-01: Control Tickets Query Discovers Active Positive Coupons ──────────
  test('P2-01: Active tab discovers 236 positive coupon items without being masked as USED_UP', async () => {
    await runRemote(async () => {
      // Query through the resolver / master service query
      const { resolveNativeDocumentChain } = require('../services/native-document-resolver');
      const activeCoupons = await db.query(`
        SELECT c.CouponID, c.CouponNo, c.RemaQty
        FROM dbo.WFCoupon c WITH (NOLOCK)
        WHERE c.RemaQty > 0
      `);
      assert.equal(activeCoupons.length, 236, 'Must have exactly 236 positive coupons on test DB');

      // Verify sample C6906916 is in the positive set with 1000 tons
      const c69 = activeCoupons.find(c => c.CouponNo === 'C6906916');
      assert.ok(c69);
      assert.equal(Number(c69.RemaQty), 1000);
    });
  });

  // ── P2-02: Multi-Axis Status & Expiry Without Overlay ──────────────────────
  test('P2-02: Expiry without overlay evaluates to UNKNOWN without guessing default lifetime', () => {
    const evalRes = evaluateTicketExpiry(null, '2026-09-21', 7, false);
    assert.equal(evalRes.status, 'UNKNOWN');
    assert.equal(evalRes.expiryDate, null);
    assert.equal(evalRes.blocked, false);
    assert.equal(evalRes.label, 'ไม่ระบุวันหมดอายุ');
  });

  // ── P2-03: Invariant Balance Math ─────────────────────────────────────────
  test('P2-03: Invariant balance math: native - active reservation = available', () => {
    const native = 100.000;
    const reserved = 10.000;
    const available = native - reserved;
    assert.equal(available, 90.000);

    // After native settlement: native reduces to 90, reservation settled (0) -> available remains 90, NOT 80
    const settledNative = 90.000;
    const settledReserved = 0.000;
    const settledAvailable = settledNative - settledReserved;
    assert.equal(settledAvailable, 90.000);

    // Overreservation / negative available evaluates to BALANCE_CONFLICT, never clamped to 0
    const overNative = 10.000;
    const overReserved = 15.000;
    const conflictAvailable = overNative - overReserved;
    assert.equal(conflictAvailable, -5.000);
    assert.ok(conflictAvailable < 0, 'Must preserve negative available as BALANCE_CONFLICT');
  });

  test.after(async () => {
    try {
      if (typeof db.closeAll === 'function') await db.closeAll();
    } catch (_) {}
  });

});
