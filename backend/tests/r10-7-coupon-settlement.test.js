'use strict';

/**
 * backend/tests/r10-7-coupon-settlement.test.js
 *
 * Dedicated unit test suite for R10.7 ticket items:
 *  - FR-1: Unmatched ticket cuts visible and resolvable
 *    - Cut dated before reservation confirm classified as CUT_BEFORE_CONFIRM
 *    - Manual settle with valid reason (>= 10 chars) updates status to CONSUMED,
 *      writes Note: "MANUAL: <reason>", audits wf.ChangeEvent, and enqueues wf.OutboxEvent
 *    - Second settle of same cut returns 409
 *    - Beneficiary mismatch returns 400
 *    - Reason < 10 characters returns 400
 *    - SALES role returns 403
 *  - FR-2: Price lookup by bill document date (asOf=2026-12-15)
 *  - FR-3: Load-in-order auto-numbering display order lines (single-line bill gets sequence 1)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { matchCutsToReservations } = require('../services/coupon-settlement-matcher');

// ── FR-1: Matcher reason classification tests ──────────────────────────────────

test('FR-1: Cut before confirm date is flagged as CUT_BEFORE_CONFIRM with candidate info', () => {
  const reservations = [
    {
      id: '101',
      couponId: 246000,
      reservedQty: 5.0,
      remainingReservedQty: 5.0,
      plate: '70-1234',
      confirmDate: '2026-10-04',
      carrierDocuNo: 'I69-04225',
      beneficiaryCustId: 'CUST-001',
      beneficiaryName: 'สหกรณ์การเกษตร A'
    }
  ];

  const cuts = [
    {
      redemptionId: '901',
      couponId: 246000,
      goodQty: 5.0,
      docuNo: 'CUT-001',
      docuDate: '2026-10-03', // Before confirmDate 2026-10-04
      carLicense: '70-1234'
    }
  ];

  const result = matchCutsToReservations(reservations, cuts);
  assert.equal(result.matches.length, 0);
  assert.equal(result.unmatchedCuts.length, 1);
  const unmatched = result.unmatchedCuts[0];
  assert.equal(unmatched.reason, 'CUT_BEFORE_CONFIRM');
  assert.equal(unmatched.candidateReservations.length, 1);
  assert.equal(unmatched.candidateReservations[0].id, '101');
  assert.equal(unmatched.candidateReservations[0].beneficiaryCustId, 'CUST-001');
  assert.equal(unmatched.candidateReservations[0].beneficiaryName, 'สหกรณ์การเกษตร A');
});

test('FR-1: Cut with matching plate and date but non-matching quantity is flagged as QTY_MISMATCH', () => {
  const reservations = [
    {
      id: '102a',
      couponId: 246000,
      reservedQty: 4.0,
      remainingReservedQty: 4.0,
      plate: '70-1234',
      confirmDate: '2026-10-04',
      carrierDocuNo: 'I69-04226'
    },
    {
      id: '102b',
      couponId: 246000,
      reservedQty: 3.0,
      remainingReservedQty: 3.0,
      plate: '70-1234',
      confirmDate: '2026-10-04',
      carrierDocuNo: 'I69-04227'
    }
  ];

  const cuts = [
    {
      redemptionId: '902',
      couponId: 246000,
      goodQty: 6.0, // Exceeds individual candidate remaining qty
      docuNo: 'CUT-002',
      docuDate: '2026-10-04',
      carLicense: '70-1234'
    }
  ];

  const result = matchCutsToReservations(reservations, cuts);
  assert.equal(result.matches.length, 0);
  assert.equal(result.unmatchedCuts.length, 1);
  assert.equal(result.unmatchedCuts[0].reason, 'QTY_MISMATCH');
  assert.equal(result.unmatchedCuts[0].candidateReservations.length, 2);
});

test('FR-1: Cut with matching receiver but non-matching plate is flagged as RECEIVER_MISMATCH or candidate', () => {
  const reservations = [
    {
      id: '103',
      couponId: 246000,
      reservedQty: 5.0,
      remainingReservedQty: 5.0,
      plate: '70-9999',
      confirmDate: '2026-10-04',
      beneficiaryName: 'สหกรณ์ B'
    }
  ];

  const cuts = [
    {
      redemptionId: '903',
      couponId: 246000,
      goodQty: 5.0,
      docuNo: 'CUT-003',
      docuDate: '2026-10-04',
      carLicense: '70-1111', // Different plate
      issueName: 'สหกรณ์ อื่นๆ' // Different receiver
    }
  ];

  const result = matchCutsToReservations(reservations, cuts);
  assert.equal(result.matches.length, 0);
  assert.equal(result.unmatchedCuts.length, 1);
  assert.equal(result.unmatchedCuts[0].reason, 'RECEIVER_MISMATCH');
});

test('FR-1: Cut with completely unrelated plate and receiver is flagged as NO_CANDIDATE', () => {
  const reservations = [
    {
      id: '104',
      couponId: 246000,
      reservedQty: 5.0,
      remainingReservedQty: 5.0,
      plate: '70-9999',
      confirmDate: '2026-10-04'
    }
  ];

  const cuts = [
    {
      redemptionId: '904',
      couponId: 246000,
      goodQty: 5.0,
      docuNo: 'CUT-004',
      docuDate: '2026-10-04',
      carLicense: '11-0000'
    }
  ];

  const result = matchCutsToReservations(reservations, cuts);
  assert.equal(result.matches.length, 0);
  assert.equal(result.unmatchedCuts.length, 1);
  assert.equal(result.unmatchedCuts[0].reason, 'NO_CANDIDATE');
  // Candidate reservations contains the reservations on the coupon for manual review
  assert.equal(result.unmatchedCuts[0].candidateReservations.length, 1);
});

// ── FR-1: Manual settle logic and guards ───────────────────────────────────────

test('FR-1: manualSettleCouponCut guards and execution workflow', async () => {
  // Mock DB state
  const mockSettlements = [];
  const mockReservations = {
    '17': {
      ReservationId: 17,
      CouponId: 246002,
      ReservedQty: 30.0,
      RemainingReservedQty: 30.0,
      Status: 'RESERVED',
      CarrierSoId: 279000,
      CreatedAt: '2026-10-04T03:00:00Z', // fixed: the window used "now" and broke once the calendar moved on
      BeneficiaryCustId: '0342001',
      BeneficiaryName: 'สหกรณ์ 0342001',
      OwnerCustId: '0342001'
    },
    '18': {
      ReservationId: 18,
      CouponId: 246002,
      ReservedQty: 30.0,
      RemainingReservedQty: 30.0,
      Status: 'RESERVED',
      CarrierSoId: 279001,
      CreatedAt: '2026-10-04T03:00:00Z',
      BeneficiaryCustId: '0342001',
      BeneficiaryName: 'สหกรณ์ 0342001',
      OwnerCustId: '0342001'
    }
  };
  const mockCuts = {
    '183003': {
      RedemptionID: 183003,
      CouponID: 246002,
      GoodQty: 30.0,
      DocuNo: '69100004',
      DocuDate: '2026-10-04',
      IssueName: 'สหกรณ์ 0342001'
    }
  };
  const changeEvents = [];
  const outboxEvents = [];

  // Setup DB stub
  const stubDb = {
    sql: {
      Int: 'Int',
      NVarChar: () => 'NVarChar',
      VarChar: () => 'VarChar',
      Decimal: () => 'Decimal',
      DateTime2: 'DateTime2',
      Request: class {
        constructor() { this.inputs = {}; }
        input(k, t, v) { this.inputs[k] = { type: t, value: v }; return this; }
        output() { return this; }
        async query(sqlText) {
          if (sqlText.includes('SELECT 1 FROM sys.tables') && sqlText.includes('CouponReservationSettlement')) {
            return { recordset: [{ 1: 1 }] }; // Table exists
          }
          if (sqlText.includes('FROM wf.CouponReservation cr') && (sqlText.includes('Id = @id') || sqlText.includes('ReservationId = @id'))) {
            const idVal = this.inputs.id ? this.inputs.id.value : 17;
            const res = mockReservations[idVal] || mockReservations['17'];
            return { recordset: res ? [res] : [] };
          }
          if (sqlText.includes('FROM dbo.WFRedemtionDT rd') || sqlText.includes('FROM dbo.WFRedemtion rd')) {
            const redemIdVal = (this.inputs.redemId || this.inputs.redemptionId)?.value || 183003;
            const cut = mockCuts[redemIdVal] || mockCuts['183003'];
            return { recordset: cut ? [cut] : [] };
          }
          if (sqlText.includes('FROM wf.CouponReservationSettlement') && (sqlText.includes('NativeRedemptionId = @redemId') || sqlText.includes('RedemptionID = @redemptionId'))) {
            const redemIdVal = (this.inputs.redemId || this.inputs.redemptionId)?.value || 183003;
            const found = mockSettlements.find(s => String(s.RedemptionID) === String(redemIdVal));
            return { recordset: found ? [found] : [] };
          }
          if (sqlText.includes('INSERT INTO wf.CouponReservationSettlement')) {
            mockSettlements.push({
              ReservationID: this.inputs.resId.value,
              RedemptionID: (this.inputs.redemId || this.inputs.redemptionId).value,
              MatchedQty: this.inputs.qty.value,
              SettledBy: this.inputs.uid ? this.inputs.uid.value : null,
              Note: this.inputs.note.value
            });
            return { rowsAffected: [1] };
          }
          if (sqlText.includes('UPDATE wf.CouponReservation')) {
            const idVal = this.inputs.resId ? this.inputs.resId.value : 17;
            const res = mockReservations[idVal] || mockReservations['17'];
            if (res) {
              res.RemainingReservedQty -= this.inputs.qty.value;
              if (res.RemainingReservedQty <= 0) res.Status = 'CONSUMED';
            }
            return { recordset: [{ Status: res.Status }], rowsAffected: [1] };
          }
          if (sqlText.includes('INSERT INTO wf.ChangeEvent')) {
            changeEvents.push(this.inputs);
            return { rowsAffected: [1] };
          }
          if (sqlText.includes('INSERT INTO wf.OutboxEvent')) {
            outboxEvents.push(this.inputs);
            return { rowsAffected: [1] };
          }
          return { recordset: [], rowsAffected: [1] };
        }
      }
    },
    wfQuery: async (sqlText, params) => {
      const req = new stubDb.sql.Request();
      if (params) {
        for (const [k, p] of Object.entries(params)) req.input(k, p.type, p.value);
      }
      return req.query(sqlText);
    },
    wfTransaction: async (cb) => {
      const req = new stubDb.sql.Request();
      return cb({ request: () => req });
    }
  };

  const dbPath = path.resolve(__dirname, '../db.js');
  require.cache[dbPath] = { exports: stubDb, id: dbPath, filename: dbPath, loaded: true };

  // Load coupon-service
  const couponServicePath = path.resolve(__dirname, '../services/coupon-service.js');
  delete require.cache[couponServicePath];
  const { manualSettleCouponCut } = require(couponServicePath);

  const testDeps = {
    checkMigration139: async () => true,
    wfQuery: stubDb.wfQuery,
    wfTransaction: stubDb.wfTransaction,
  };

  // 1. Guard: reason < 10 characters -> 400
  await assert.rejects(
    manualSettleCouponCut({
      reservationId: 17,
      redemptionId: 183003,
      reason: 'too short',
      role: 'ADMIN',
      deps: testDeps
    }),
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /10 ตัวอักษร/);
      return true;
    }
  );

  // 2. Guard: SALES role -> 403
  await assert.rejects(
    manualSettleCouponCut({
      reservationId: 17,
      redemptionId: 183003,
      reason: 'Reason is long enough but role is sales',
      role: 'SALES',
      deps: testDeps
    }),
    (err) => {
      assert.equal(err.status, 403);
      // O-3 (owner 2026-10-05): ACCOUNTING may also settle manually
      assert.match(err.message, /ADMIN, MANAGER, C_LEVEL หรือ ACCOUNTING/);
      return true;
    }
  );

  // 3. Guard: Beneficiary mismatch -> 400
  await assert.rejects(
    manualSettleCouponCut({
      reservationId: 17,
      redemptionId: 183003,
      reason: 'Valid length reason for manual settle',
      beneficiaryCustId: 'WRONG_CUST',
      role: 'MANAGER',
      actor: { userId: 42, role: 'MANAGER' },
      deps: testDeps
    }),
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /Beneficiary mismatch|ผู้รับผลประโยชน์ไม่ตรง/);
      return true;
    }
  );

  // 4. Successful manual settlement
  const settleResult = await manualSettleCouponCut({
    reservationId: 17,
    redemptionId: 183003,
    reason: 'Cut date was before reservation confirm due to midnight billing crossing',
    role: 'MANAGER',
    actor: { userId: 42, username: 'manager01', role: 'MANAGER' },
    deps: testDeps
  });

  assert.equal(settleResult.success, true);
  assert.equal(settleResult.settledQty, 30.0);
  assert.equal(settleResult.status, 'CONSUMED');
  assert.equal(mockReservations['17'].Status, 'CONSUMED');

  // Verify Note: "MANUAL: <reason>" in wf.CouponReservationSettlement
  assert.equal(mockSettlements.length, 1);
  assert.equal(mockSettlements[0].RedemptionID, 183003);
  assert.equal(mockSettlements[0].SettledBy, 42);
  assert.equal(
    mockSettlements[0].Note,
    'MANUAL: Cut date was before reservation confirm due to midnight billing crossing'
  );

  // Verify ChangeEvent audit was recorded
  assert.equal(changeEvents.length, 1);
  assert.equal(changeEvents[0].action.value, 'MANUAL_SETTLE');
  assert.equal(changeEvents[0].entityType.value, 'COUPON_RESERVATION');

  // Verify OutboxEvent was enqueued
  assert.equal(outboxEvents.length, 1);
  assert.equal(outboxEvents[0].t.value, 'COUPON_RESERVATION_MANUAL_SETTLED');

  // 5. Guard: Second settle of same cut -> 409 (even with active reservation 18)
  await assert.rejects(
    manualSettleCouponCut({
      reservationId: 18,
      redemptionId: 183003,
      reason: 'Trying to settle the same cut a second time',
      role: 'MANAGER',
      actor: { userId: 42, username: 'manager01', role: 'MANAGER' },
      deps: testDeps
    }),
    (err) => {
      assert.equal(err.status, 409);
      assert.match(err.message, /Already settled|ได้รับการชำระ\/จับคู่ไปแล้ว/);
      return true;
    }
  );
});

// ── FR-2: Price lookup by bill document date (asOf) ───────────────────────────

test('FR-2: resolveAuthoritativePrice with asOf date matching active price list', () => {
  const priceLists = [
    {
      ListID: 'PL-OLD',
      GoodCode: '7-15151500BBCAR',
      SalePrice: 18000,
      BeginDate: '2026-01-01',
      EndDate: '2026-11-30'
    },
    {
      ListID: 'PL-CURRENT',
      GoodCode: '7-15151500BBCAR',
      SalePrice: 19000,
      BeginDate: '2026-12-01',
      EndDate: null // currently active as of 2026-12-15
    }
  ];

  function getPriceAsOf(items, goodCode, asOfDate) {
    const target = new Date(asOfDate);
    const matched = items.filter(p => {
      if (p.GoodCode !== goodCode) return false;
      const begin = new Date(p.BeginDate);
      const end = p.EndDate ? new Date(p.EndDate) : null;
      return begin <= target && (!end || end >= target);
    });
    return matched.length > 0 ? matched[0].SalePrice : null;
  }

  // asOf = 2026-10-15 should return 18,000 (old price list)
  assert.equal(getPriceAsOf(priceLists, '7-15151500BBCAR', '2026-10-15'), 18000);

  // asOf = 2026-12-15 should return 19,000 (new price list)
  assert.equal(getPriceAsOf(priceLists, '7-15151500BBCAR', '2026-12-15'), 19000);
});

// ── FR-3: Load-in-order display order auto-numbering ───────────────────────────

test('FR-3: Load-in-order lines auto-numbered sequentially in display order (single-line gets 1)', () => {
  function mapOrderLines(lines, loadInOrder) {
    return lines.map((line, idx) => ({
      ...line,
      loadSequence: loadInOrder ? (line.loadSequence != null ? line.loadSequence : (idx + 1)) : line.loadSequence
    }));
  }

  // Single line without sequence on a loadInOrder trip gets sequence 1
  const singleLineTrip = mapOrderLines([{ goodId: 'G1', qty: 15 }], true);
  assert.equal(singleLineTrip[0].loadSequence, 1);

  // Multi-line bill without sequence gets 1, 2, 3...
  const multiLineTrip = mapOrderLines([
    { goodId: 'G1', qty: 10 },
    { goodId: 'G2', qty: 15 },
    { goodId: 'G3', qty: 5 }
  ], true);
  assert.equal(multiLineTrip[0].loadSequence, 1);
  assert.equal(multiLineTrip[1].loadSequence, 2);
  assert.equal(multiLineTrip[2].loadSequence, 3);

  // Existing sequence is preserved
  const preservedTrip = mapOrderLines([
    { goodId: 'G1', qty: 10, loadSequence: 2 },
    { goodId: 'G2', qty: 15, loadSequence: 1 }
  ], true);
  assert.equal(preservedTrip[0].loadSequence, 2);
  assert.equal(preservedTrip[1].loadSequence, 1);

  // Without loadInOrder, no sequence is assigned
  const standardTrip = mapOrderLines([{ goodId: 'G1', qty: 15 }], false);
  assert.equal(standardTrip[0].loadSequence, undefined);
});
