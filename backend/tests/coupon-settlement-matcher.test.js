/**
 * coupon-settlement-matcher.test.js
 *
 * Unit tests for pure coupon settlement matching logic (R6 §1.4).
 * Tests all 6 required pure-function fixtures with zero DB dependencies.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { matchCutsToReservations, normalizePlate } = require('../services/coupon-settlement-matcher');

test('1. Normalization: plate string is trimmed, space-stripped, and lower-cased', () => {
  assert.equal(normalizePlate(' กพ 70 - 9203 / 9204 '), 'กพ70-9203/9204');
  assert.equal(normalizePlate('  70-9999  '), '70-9999');
  assert.equal(normalizePlate(null), '');
  assert.equal(normalizePlate(undefined), '');
});

test('2. Live run fixture: exact plate, date >= confirm, exact quantity matches accurately', () => {
  const reservations = [
    { id: '1', couponId: 246000, reservedQty: 4.0, plate: 'กพ70-9203/9204', confirmDate: '2026-10-03', carrierDocuNo: 'I69-04225' },
    { id: '2', couponId: 246000, reservedQty: 2.0, plate: 'กพ70-9205/9206', confirmDate: '2026-10-03', carrierDocuNo: 'I69-04226' }
  ];

  const cuts = [
    { redemptionId: '183000', couponId: 246000, goodQty: 4.0, docuNo: '69100001', docuDate: '2026-10-03', carLicense: 'กพ70-9203/9204' },
    { redemptionId: '183001', couponId: 246000, goodQty: 2.0, docuNo: '69100002', docuDate: '2026-10-03', carLicense: 'กพ70-9205/9206' }
  ];

  const res = matchCutsToReservations(reservations, cuts);
  assert.equal(res.matches.length, 2);
  assert.equal(res.doubleCountedQty, 6.0);
  assert.equal(res.ambiguous.length, 0);
  assert.equal(res.unmatchedCuts.length, 0);
  assert.equal(res.unmatchedReservations.length, 0);

  assert.equal(res.matches[0].reservationId, '1');
  assert.equal(res.matches[0].matchedQty, 4.0);
  assert.equal(res.matches[0].isPartial, false);

  assert.equal(res.matches[1].reservationId, '2');
  assert.equal(res.matches[1].matchedQty, 2.0);
  assert.equal(res.matches[1].isPartial, false);
});

test('3. Earlier cut before reservation: cut dated before reservation confirm MUST NOT match', () => {
  const reservations = [
    { id: '1', couponId: 246000, reservedQty: 4.0, plate: 'กพ70-9203/9204', confirmDate: '2026-10-03' }
  ];

  const cuts = [
    { redemptionId: '100', couponId: 246000, goodQty: 4.0, docuNo: '69080001', docuDate: '2026-08-20', carLicense: 'กพ70-9203/9204' }
  ];

  const res = matchCutsToReservations(reservations, cuts);
  assert.equal(res.matches.length, 0, 'Earlier cut must never match subsequent reservation');
  assert.equal(res.doubleCountedQty, 0);
  // R10.7-1: a cut six weeks before the reservation is history, not an unmatched app cut
  assert.equal(res.unmatchedCuts.length, 0);
  assert.equal(res.unmatchedReservations.length, 1);

  // ...but a cut inside the N-day window before the reservation is still listed for review
  const recent = matchCutsToReservations(reservations, [{ ...cuts[0], redemptionId: '101', docuDate: '2026-10-01' }]);
  assert.equal(recent.matches.length, 0);
  assert.equal(recent.unmatchedCuts.length, 1);
  assert.equal(recent.unmatchedCuts[0].reason, 'CUT_BEFORE_CONFIRM');
});

test('4. Same plate on old trip: cut from previous month with same plate MUST NOT match', () => {
  const reservations = [
    { id: '10', couponId: 246000, reservedQty: 4.0, plate: 'กพ70-9203/9204', confirmDate: '2026-10-01' }
  ];

  const cuts = [
    { redemptionId: '101', couponId: 246000, goodQty: 4.0, docuNo: '69090123', docuDate: '2026-09-15', carLicense: 'กพ70-9203/9204' }
  ];

  const res = matchCutsToReservations(reservations, cuts);
  assert.equal(res.matches.length, 0);
  assert.equal(res.doubleCountedQty, 0);
});

test('5. Quantity-only coincidence: cut without plate or different plate MUST NEVER match on quantity alone', () => {
  const reservations = [
    { id: '1', couponId: 246000, reservedQty: 4.0, plate: 'กพ70-9203/9204', confirmDate: '2026-10-03' },
    { id: '2', couponId: 246000, reservedQty: 2.0, plate: null, confirmDate: '2026-10-03' }
  ];

  const cuts = [
    // Same quantity (4.0) but different plate
    { redemptionId: '201', couponId: 246000, goodQty: 4.0, docuNo: '69100099', docuDate: '2026-10-03', carLicense: 'ฮฮ-9999' },
    // Same quantity (2.0) but null plate
    { redemptionId: '202', couponId: 246000, goodQty: 2.0, docuNo: '69100100', docuDate: '2026-10-03', carLicense: null }
  ];

  const res = matchCutsToReservations(reservations, cuts);
  assert.equal(res.matches.length, 0, 'Matching on quantity alone is strictly prohibited');
  assert.equal(res.doubleCountedQty, 0);
  assert.equal(res.unmatchedCuts.length, 2);
  assert.equal(res.unmatchedReservations.length, 2);
});

test('6. Partial cut: cut consumes only cut quantity, remaining stays reserved', () => {
  const reservations = [
    { id: '1', couponId: 246000, reservedQty: 4.0, plate: 'กพ70-9203/9204', confirmDate: '2026-10-03' }
  ];

  const cuts = [
    { redemptionId: '301', couponId: 246000, goodQty: 2.5, docuNo: '69100050', docuDate: '2026-10-03', carLicense: 'กพ70-9203/9204' }
  ];

  const res = matchCutsToReservations(reservations, cuts);
  assert.equal(res.matches.length, 1);
  assert.equal(res.matches[0].matchedQty, 2.5);
  assert.equal(res.matches[0].isPartial, true);
  assert.equal(res.matches[0].remainingReservedQty, 1.5);
  assert.equal(res.doubleCountedQty, 2.5);

  assert.equal(res.unmatchedReservations.length, 1);
  assert.equal(res.unmatchedReservations[0].remainingReservedQty, 1.5);
});

test('7. Two reservations with one cut: cut is used exactly once, first candidate matches', () => {
  const reservations = [
    { id: '1', couponId: 246000, reservedQty: 4.0, plate: 'กพ70-9203/9204', confirmDate: '2026-10-03' },
    { id: '2', couponId: 246000, reservedQty: 2.0, plate: 'กพ70-9203/9204', confirmDate: '2026-10-03' }
  ];

  const cuts = [
    { redemptionId: '401', couponId: 246000, goodQty: 4.0, docuNo: '69100077', docuDate: '2026-10-03', carLicense: 'กพ70-9203/9204' }
  ];

  const res = matchCutsToReservations(reservations, cuts);
  assert.equal(res.matches.length, 1);
  assert.equal(res.matches[0].reservationId, '1');
  assert.equal(res.matches[0].matchedQty, 4.0);
  assert.equal(res.doubleCountedQty, 4.0);
  assert.equal(res.unmatchedReservations.length, 1);
  assert.equal(res.unmatchedReservations[0].id, '2');
});

test('8. Same-day local-midnight Bangkok business date (R6-6): cut at local midnight matches same-day confirmation without UTC shift error', () => {
  // Confirmation created at Bangkok 15:30 on 2026-10-03 (UTC 08:30:00)
  const reservations = [
    { id: '1', couponId: 246000, reservedQty: 4.0, plate: 'กพ70-9203/9204', confirmDate: '2026-10-03T08:30:00.000Z' }
  ];

  // WinSpeed DocuDate stored as midnight local time: 2026-10-03 00:00:00 +07:00 (which is 2026-10-02T17:00:00.000Z in UTC)
  const cuts = [
    { redemptionId: '501', couponId: 246000, goodQty: 4.0, docuNo: '69100088', docuDate: '2026-10-02T17:00:00.000Z', carLicense: 'กพ70-9203/9204' }
  ];

  const res = matchCutsToReservations(reservations, cuts);
  assert.equal(res.matches.length, 1, 'Same-day local midnight cut must match same-day confirmation in Bangkok timezone');
  assert.equal(res.matches[0].reservationId, '1');
  assert.equal(res.matches[0].matchedQty, 4.0);
  assert.equal(res.doubleCountedQty, 4.0);
  assert.equal(res.unmatchedCuts.length, 0);
  assert.equal(res.unmatchedReservations.length, 0);
});

test('9. Same truck twice on the same day (R7-2): Trip 1 (morning) and Trip 2 (afternoon) match Cut 1 and Cut 2 FIFO', () => {
  const reservations = [
    { id: '101', couponId: 246000, reservedQty: 10.0, plate: 'กพ70-9203/9204', confirmDate: '2026-10-04T08:00:00.000Z', carrierDocuNo: 'I69-04230' },
    { id: '102', couponId: 246000, reservedQty: 10.0, plate: 'กพ70-9203/9204', confirmDate: '2026-10-04T13:00:00.000Z', carrierDocuNo: 'I69-04231' }
  ];

  const cuts = [
    { redemptionId: '601', couponId: 246000, goodQty: 10.0, docuNo: '69100010', docuDate: '2026-10-04T09:00:00.000Z', carLicense: 'กพ70-9203/9204' },
    { redemptionId: '602', couponId: 246000, goodQty: 10.0, docuNo: '69100011', docuDate: '2026-10-04T14:00:00.000Z', carLicense: 'กพ70-9203/9204' }
  ];

  const res = matchCutsToReservations(reservations, cuts);
  assert.equal(res.matches.length, 2, 'Both trips must match their corresponding cuts FIFO');
  assert.equal(res.ambiguous.length, 0, 'No ambiguity should remain for chronological trips');
  assert.equal(res.matches[0].reservationId, '101');
  assert.equal(res.matches[0].redemptionId, '601');
  assert.equal(res.matches[0].matchedQty, 10.0);
  assert.equal(res.matches[1].reservationId, '102');
  assert.equal(res.matches[1].redemptionId, '602');
  assert.equal(res.matches[1].matchedQty, 10.0);
  assert.equal(res.unmatchedCuts.length, 0);
  assert.equal(res.unmatchedReservations.length, 0);
});

test('10. Partial cut followed by second cut on same reservation (R7-2): Cut 1 (6t) then Cut 2 (4t) fully consume 10t reservation', () => {
  // Scenario A: Both cuts arrive together
  const reservationsA = [
    { id: '201', couponId: 246000, reservedQty: 10.0, plate: 'กพ70-9203/9204', confirmDate: '2026-10-04T08:00:00.000Z' }
  ];
  const cutsA = [
    { redemptionId: '701', couponId: 246000, goodQty: 6.0, docuNo: '69100020', docuDate: '2026-10-04T09:00:00.000Z', carLicense: 'กพ70-9203/9204' },
    { redemptionId: '702', couponId: 246000, goodQty: 4.0, docuNo: '69100021', docuDate: '2026-10-04T10:00:00.000Z', carLicense: 'กพ70-9203/9204' }
  ];

  const resA = matchCutsToReservations(reservationsA, cutsA);
  assert.equal(resA.matches.length, 2);
  assert.equal(resA.matches[0].reservationId, '201');
  assert.equal(resA.matches[0].matchedQty, 6.0);
  assert.equal(resA.matches[0].isPartial, true);
  assert.equal(resA.matches[1].reservationId, '201');
  assert.equal(resA.matches[1].matchedQty, 4.0);
  assert.equal(resA.matches[1].isPartial, false);
  assert.equal(resA.unmatchedReservations.length, 0);

  // Scenario B: First cut already settled; reservation fed with remaining quantity (4t)
  const reservationsB = [
    { id: '201', couponId: 246000, reservedQty: 10.0, consumedQty: 6.0, remainingReservedQty: 4.0, plate: 'กพ70-9203/9204', confirmDate: '2026-10-04T08:00:00.000Z' }
  ];
  const cutsB = [
    { redemptionId: '702', couponId: 246000, goodQty: 4.0, docuNo: '69100021', docuDate: '2026-10-04T10:00:00.000Z', carLicense: 'กพ70-9203/9204' }
  ];

  const resB = matchCutsToReservations(reservationsB, cutsB);
  assert.equal(resB.matches.length, 1);
  assert.equal(resB.matches[0].reservationId, '201');
  assert.equal(resB.matches[0].matchedQty, 4.0);
  assert.equal(resB.matches[0].isPartial, false);
  assert.equal(resB.unmatchedReservations.length, 0);
  assert.equal(resB.unmatchedCuts.length, 0);
});

test('11. Cut number mapping (R8-2): cut with RedemptionDocuNo correctly populates redemptionDocuNo in matches and doubleCountedReservations', () => {
  const reservations = [
    { id: '301', couponId: 246000, reservedQty: 5.0, plate: 'กพ70-9203/9204', confirmDate: '2026-10-04' }
  ];
  const cuts = [
    { RedemtionID: 183000, CouponID: 246000, GoodQty: 5.0, RedemptionDocuNo: '69100001', DocuDate: '2026-10-04', CarLicense: 'กพ70-9203/9204' }
  ];

  const res = matchCutsToReservations(reservations, cuts);
  assert.equal(res.matches.length, 1);
  assert.equal(res.matches[0].redemptionDocuNo, '69100001', 'Match must preserve cut docuNo from RedemptionDocuNo');
  assert.equal(res.doubleCountedReservations[0].matchingRedemptionDocuNo, '69100001', 'Double count reservation must preserve cut docuNo');
});

test('12. Stubbed settlement test (R8-2): cut number reaches inserted settlement row and NativeDocuNo', async () => {
  const { settleCouponReservations } = require('../services/coupon-service');
  const insertedRows = [];
  const updatedReservations = [];

  const mockTx = {
    request() {
      const inputs = {};
      return {
        input(name, type, val) {
          inputs[name] = val;
          return this;
        },
        async query(sqlText) {
          if (sqlText.includes('SELECT 1 FROM wf.CouponReservationSettlement')) {
            return { recordset: [] };
          }
          if (sqlText.includes('INSERT INTO wf.CouponReservationSettlement')) {
            insertedRows.push({ ...inputs });
            return { rowsAffected: [1] };
          }
          if (sqlText.includes('UPDATE wf.CouponReservation')) {
            updatedReservations.push({ ...inputs });
            return { rowsAffected: [1] };
          }
          return { recordset: [] };
        }
      };
    }
  };

  const stubDeps = {
    checkMigration139: async () => true,
    wfQuery: async (sqlText) => {
      if (sqlText.includes('FROM wf.CouponReservation cr')) {
        return {
          recordset: [
            {
              Id: 101,
              CouponId: 246000,
              CarrierSoId: '278001',
              CarrierDocuNo: 'I69-04225',
              TripId: 30,
              ReservedQty: 4.0,
              ConsumedQty: 0,
              RemainingReservedQty: 4.0,
              CreatedAt: new Date('2026-10-04T08:00:00Z'),
              TripPlate: 'กพ70-9203/9204',
              ConfirmDate: new Date('2026-10-04T08:00:00Z')
            }
          ]
        };
      }
      if (sqlText.includes('FROM dbo.WFRedemtionDT rd')) {
        return {
          recordset: [
            {
              RedemtionID: 183000,
              CouponID: 246000,
              GoodQty: 4.0,
              DocuNo: '69100001',
              RedemptionDocuNo: '69100001',
              DocuDate: new Date('2026-10-04T09:00:00Z'),
              CarLicense: 'กพ70-9203/9204',
              IssueName: 'World Fert'
            }
          ]
        };
      }
      return { recordset: [] };
    },
    wfTransaction: async (fn) => fn(mockTx)
  };

  const result = await settleCouponReservations(246000, { userId: 43 }, stubDeps);

  assert.equal(result.settledCount, 1);
  assert.equal(result.settlements[0].redemptionDocuNo, '69100001');
  assert.equal(insertedRows.length, 1);
  assert.equal(insertedRows[0].docuNo, '69100001', 'Cut number 69100001 must reach inserted NativeDocuNo parameter');
  assert.equal(insertedRows[0].redemId, 183000);
  assert.equal(insertedRows[0].resId, 101);
  assert.equal(insertedRows[0].qty, 4.0);
  assert.equal(insertedRows[0].uid, 43);
});

test('13. Migration 139 cache (R8-1): checkMigration139 does not cache false indefinitely and caches true once positive', async () => {
  const { checkMigration139, _resetMigration139Cache } = require('../services/coupon-service');
  _resetMigration139Cache();

  let simulatePresent = false;
  const mockQuery = async () => ({
    recordset: [{ hasConsumedQty: simulatePresent ? 8 : null, hasTable: simulatePresent ? 12345 : null }]
  });

  // 1. Initial check when migration is not present -> returns false
  const first = await checkMigration139(mockQuery);
  assert.equal(first, false, 'Should return false when migration is not present');

  // 2. Migration is applied in DB -> simulatePresent becomes true
  simulatePresent = true;

  // 3. Second check -> must return true immediately without restart because false was NOT cached!
  const second = await checkMigration139(mockQuery);
  assert.equal(second, true, 'Should return true after migration is applied without restart');

  // 4. Third check -> should return true from cache
  simulatePresent = false; // even if query would return false, cache holds true
  const third = await checkMigration139(mockQuery);
  assert.equal(third, true, 'Should retain cached true');

  _resetMigration139Cache();
});




