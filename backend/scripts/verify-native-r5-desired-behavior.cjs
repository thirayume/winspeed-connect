'use strict';
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
  console.log('Testing R5-01 desired behavior on resolvePhysicalDeliveryEvidence...');

  // 1. Unlinked coincident text DocuNo must be REJECTED (no typed SO or trip link)
  const wgUnlinked = {
    Id: 1, DocuNo: 'I69-COINCIDENT', CarNo: '70-9999', SPID: null, WeightIn: 1000, DateIn: '2026-09-25', Status: '1'
  };
  await assert.rejects(
    () => fn({
      deliveryDocuNo: wgUnlinked.DocuNo,
      reservation: { Id: 1, CarrierSoId: '111', CarrierDocuNo: wgUnlinked.DocuNo, TripId: null },
      tx: txMock({ wg: wgUnlinked })
    }),
    (err) => {
      assert.equal(err.code, 'DELIVERY_EVIDENCE_MISMATCH');
      assert.equal(err.status, 400);
      return true;
    }
  );
  console.log('✓ Case 1 passed: Coincident DocuNo without typed link rejected with 400 DELIVERY_EVIDENCE_MISMATCH');

  // 2. Positive Multi-SO / Multi-Customer on same delivery trip
  // Trip 501 has truck 70-9999, carrying SO A (111, Cust C01) and SO B (222, Cust C02)
  const trip501 = { TripId: 501, TripCode: 'TRIP-501', TransRegistration: '70-9999', Status: 'SCHEDULED' };
  const members501 = [
    { TripId: 501, MemberKind: 'CONFIRMED', MemberId: '111', DocuNo: 'SO-111', CustId: 'C01', CustName: 'Customer A', SOID: 111 },
    { TripId: 501, MemberKind: 'CONFIRMED', MemberId: '222', DocuNo: 'SO-222', CustId: 'C02', CustName: 'Customer B', SOID: 222 },
  ];
  // Scale ticket header was created referencing SO A (SPID: 111)
  const wgMulti = {
    Id: 2, DocuNo: 'WG-TRIP-501', CarNo: '70-9999', SPID: 111, WeightIn: 25000, DateIn: '2026-09-25', Status: '1'
  };

  // 2a. Reservation for SO A (111) -> direct match -> ACCEPTED
  const res1 = await fn({
    deliveryDocuNo: wgMulti.DocuNo,
    reservation: { Id: 10, CarrierSoId: '111', CarrierDocuNo: 'SO-111', TripId: 501 },
    tx: txMock({ wg: wgMulti, trip: trip501, members: members501 })
  });
  assert.equal(res1.docuNo, wgMulti.DocuNo);
  assert.equal(res1.carLicense, '70-9999');
  console.log('✓ Case 2a passed: Primary SO A on trip accepted via direct link');

  // 2b. Reservation for SO B (222, Customer B) -> second SO on same trip -> ACCEPTED!
  const res2 = await fn({
    deliveryDocuNo: wgMulti.DocuNo,
    reservation: { Id: 11, CarrierSoId: '222', CarrierDocuNo: 'SO-222', TripId: 501 },
    tx: txMock({ wg: wgMulti, trip: trip501, members: members501 })
  });
  assert.equal(res2.docuNo, wgMulti.DocuNo);
  assert.equal(res2.carLicense, '70-9999');
  console.log('✓ Case 2b passed: Second SO B on same trip & truck accepted via authoritative trip membership');

  // 3. Unselected SO (SO C 333) trying to claim Trip 501 -> REJECTED
  await assert.rejects(
    () => fn({
      deliveryDocuNo: wgMulti.DocuNo,
      reservation: { Id: 12, CarrierSoId: '333', CarrierDocuNo: 'SO-333', TripId: 501 },
      tx: txMock({ wg: wgMulti, trip: trip501, members: members501 })
    }),
    (err) => {
      assert.equal(err.code, 'DELIVERY_EVIDENCE_MISMATCH');
      assert.equal(err.status, 400);
      return true;
    }
  );
  console.log('✓ Case 3 passed: Unselected SO 333 not in trip rejected with 400 DELIVERY_EVIDENCE_MISMATCH');

  // 4. Scale ticket for unrelated SO C (333) used with Trip 501 -> REJECTED
  const wgUnrelated = {
    Id: 3, DocuNo: 'WG-UNRELATED', CarNo: '70-9999', SPID: 333, WeightIn: 20000, DateIn: '2026-09-25', Status: '1'
  };
  await assert.rejects(
    () => fn({
      deliveryDocuNo: wgUnrelated.DocuNo,
      reservation: { Id: 11, CarrierSoId: '222', CarrierDocuNo: 'SO-222', TripId: 501 },
      tx: txMock({ wg: wgUnrelated, trip: trip501, members: members501 })
    }),
    (err) => {
      assert.equal(err.code, 'DELIVERY_EVIDENCE_MISMATCH');
      assert.equal(err.status, 400);
      return true;
    }
  );
  console.log('✓ Case 4 passed: Scale ticket with unrelated SO rejected with 400 DELIVERY_EVIDENCE_MISMATCH');

  // 5. Plate mismatch between trip and scale ticket -> CAR_LICENSE_MISMATCH (400)
  const wgPlateMismatch = {
    Id: 4, DocuNo: 'WG-PLATE-BAD', CarNo: '70-1111', SPID: 111, WeightIn: 25000, DateIn: '2026-09-25', Status: '1'
  };
  await assert.rejects(
    () => fn({
      deliveryDocuNo: wgPlateMismatch.DocuNo,
      reservation: { Id: 11, CarrierSoId: '222', CarrierDocuNo: 'SO-222', TripId: 501 },
      tx: txMock({ wg: wgPlateMismatch, trip: trip501, members: members501 })
    }),
    (err) => {
      assert.equal(err.code, 'CAR_LICENSE_MISMATCH');
      assert.equal(err.status, 400);
      return true;
    }
  );
  console.log('✓ Case 5 passed: Plate mismatch between trip and scale ticket rejected with 400 CAR_LICENSE_MISMATCH');

  console.log('\nAll R5-01 desired behavior test cases passed successfully!');
})().catch(e => {
  console.error('Test failed:', e);
  process.exitCode = 1;
});
