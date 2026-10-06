'use strict';
// DB-free verification of R6-01: typed carrier identity, distinct DRAFT vs CONFIRMED membership, and empty trip handling.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const src = fs.readFileSync('backend/services/coupon-service.js', 'utf8');
const start = src.indexOf('async function resolvePhysicalDeliveryEvidence(');
const end = src.indexOf('async function resolveVehiclePlate(', start);
const fn = vm.runInNewContext(src.slice(start, end) + '\nresolvePhysicalDeliveryEvidence', {
  sql: { NVarChar: () => 0, Int: 0, VarChar: () => 0 },
});

function txMock({ wg = null, wt = null, trip = null, members = [] }) {
  return {
    request() {
      return {
        input() { return this; },
        async query(q) {
          if (q.includes('FROM dbo.WGHD')) return { recordset: wg ? [wg] : [] };
          if (q.includes('FROM wf.WeighTicket')) return { recordset: wt ? [wt] : [] };
          if (q.includes('FROM wf.SalesTrip')) return { recordset: trip ? [trip] : [] };
          if (q.includes('FROM wf.v_TripMember')) return { recordset: members };
          throw new Error('Unexpected query in mock: ' + q);
        }
      };
    }
  };
}

(async () => {
  console.log('Testing R6-01 fixes on resolvePhysicalDeliveryEvidence...');

  const trip501 = { TripId: 501, TripCode: 'TRIP-501', TransRegistration: '70-9999', Status: 'SCHEDULED' };
  const wg501 = { Id: 1, DocuNo: 'WG-501', CarNo: '70-9999', SPID: 111, WeightIn: 1000, DateIn: '2026-09-25', Status: '1' };
  const confirmed111 = { TripId: 501, MemberKind: 'CONFIRMED', MemberId: '111', SOID: 111, DocuNo: 'SO-111' };

  // Scenario 1: Missing carrier SO/DocuNo on reservation
  await assert.rejects(
    () => fn({
      deliveryDocuNo: 'WG-501',
      reservation: { Id: 1, TripId: 501 },
      tx: txMock({ wg: wg501, trip: trip501, members: [confirmed111] })
    }),
    (err) => {
      assert.equal(err.code, 'DELIVERY_EVIDENCE_MISMATCH');
      assert.equal(err.status, 400);
      assert.match(err.message, /ไม่มีข้อมูลระบุ SO หรือเอกสารอ้างอิง/);
      return true;
    }
  );
  console.log('✓ Scenario 1: Missing carrier identity rejected with 400 DELIVERY_EVIDENCE_MISMATCH');

  // Scenario 2: Draft MemberId collides with native SOID
  const draft222 = { TripId: 501, MemberKind: 'DRAFT', MemberId: '222', SOID: null, DocuNo: 'DRAFT-OTHER' };
  await assert.rejects(
    () => fn({
      deliveryDocuNo: 'WG-501',
      reservation: { Id: 2, TripId: 501, CarrierSoId: 222, CarrierDocuNo: 'UNRELATED-222' },
      tx: txMock({ wg: wg501, trip: trip501, members: [confirmed111, draft222] })
    }),
    (err) => {
      assert.equal(err.code, 'DELIVERY_EVIDENCE_MISMATCH');
      assert.equal(err.status, 400);
      assert.match(err.message, /ไม่ได้เป็นสมาชิกของทริปจัดส่ง/);
      return true;
    }
  );
  console.log('✓ Scenario 2: Draft MemberId colliding with native SOID rejected with 400 DELIVERY_EVIDENCE_MISMATCH');

  // Scenario 3: Empty trip membership plus direct SO
  await assert.rejects(
    () => fn({
      deliveryDocuNo: 'WG-501',
      reservation: { Id: 3, TripId: 501, CarrierSoId: 111, CarrierDocuNo: 'SO-111' },
      tx: txMock({ wg: wg501, trip: trip501, members: [] })
    }),
    (err) => {
      assert.equal(err.code, 'DELIVERY_EVIDENCE_MISMATCH');
      assert.equal(err.status, 400);
      assert.match(err.message, /ไม่ได้เป็นสมาชิกของทริปจัดส่ง/);
      return true;
    }
  );
  console.log('✓ Scenario 3: Empty trip membership rejected with 400 DELIVERY_EVIDENCE_MISMATCH');

  // Scenario 4 (Positive Regression): Legitimate Confirmed multi-SO on same trip
  const confirmed222 = { TripId: 501, MemberKind: 'CONFIRMED', MemberId: '222', SOID: 222, DocuNo: 'SO-222' };
  const posRes = await fn({
    deliveryDocuNo: 'WG-501',
    reservation: { Id: 4, TripId: 501, CarrierSoId: 222, CarrierDocuNo: 'SO-222' },
    tx: txMock({ wg: wg501, trip: trip501, members: [confirmed111, confirmed222] })
  });
  assert.equal(posRes.docuNo, 'WG-501');
  assert.equal(posRes.carLicense, '70-9999');
  console.log('✓ Scenario 4 (Positive): Legitimate multi-SO confirmed membership accepted');

  console.log('\nAll R6-01 regression tests PASSED!');
})().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
