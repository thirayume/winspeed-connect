'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync('backend/scripts/verify-native-r5-desired-behavior.cjs', 'utf8');
const setup = source.slice(0, source.indexOf('(async () => {'));

vm.runInNewContext(setup + `
(async () => {
  const wg = { Id: 1, DocuNo: 'WG-501', CarNo: '70-9999', SPID: 111, WeightIn: 14000, DateIn: '2026-09-25', Status: 'WEIGH_IN' };
  const wt = { Id: 2, SoId: 111, WfRef: 'SO-111', TruckPlate: '70-9999', TareKg: 14000, WeighInAt: '2026-09-25', Status: 'WEIGHED_IN' };
  
  // 1. Negative: conflicting CarrierSoId 222 + CarrierDocuNo 'SO-111' against scale SOID 111
  await assert.rejects(
    () => fn({ deliveryDocuNo: 'WG-501', reservation: { Id: 3, CarrierSoId: 222, CarrierDocuNo: 'SO-111' }, tx: txMock({ wg, wt }) }),
    e => e.code === 'DELIVERY_EVIDENCE_CONFLICT'
  );
  console.log('PASS 1: Old conflict case correctly rejected with DELIVERY_EVIDENCE_CONFLICT');

  // 2. Positive: Scale ticket references TripCode 'TRIP-501', reservation is for member SO 111
  const trip = { TripId: 501, TripCode: 'TRIP-501', TransRegistration: '70-9999', Status: 'SCHEDULED' };
  const members = [{ TripId: 501, MemberKind: 'CONFIRMED', MemberId: '111', SOID: 111, DocuNo: 'SO-111' }];
  const tripTicket = { ...wt, WfRef: 'TRIP-501' };
  const res = await fn({
    deliveryDocuNo: 'WG-501',
    reservation: { Id: 4, TripId: 501, CarrierSoId: 111, CarrierDocuNo: 'SO-111' },
    tx: txMock({ wg, wt: tripTicket, trip, members })
  });
  assert.equal(res.docuNo, 'WG-501');
  assert.equal(res.carLicense, '70-9999');
  console.log('PASS 2: Valid TripCode reference correctly ACCEPTED (regression fixed)');

  // 3. Multi-SO Trip: Second SO 222 on same trip also accepted with TripCode
  const membersMulti = [
    { TripId: 501, MemberKind: 'CONFIRMED', MemberId: '111', SOID: 111, DocuNo: 'SO-111' },
    { TripId: 501, MemberKind: 'CONFIRMED', MemberId: '222', SOID: 222, DocuNo: 'SO-222' }
  ];
  const resMulti = await fn({
    deliveryDocuNo: 'WG-501',
    reservation: { Id: 5, TripId: 501, CarrierSoId: 222, CarrierDocuNo: 'SO-222' },
    tx: txMock({ wg, wt: tripTicket, trip, members: membersMulti })
  });
  assert.equal(resMulti.docuNo, 'WG-501');
  console.log('PASS 3: Second member SO on same trip with TripCode scale reference accepted');

  // 4. Negative: Reservation has internal contradiction (CarrierSoId 222 + CarrierDocuNo 'SO-111') in Trip
  await assert.rejects(
    () => fn({
      deliveryDocuNo: 'WG-501',
      reservation: { Id: 6, TripId: 501, CarrierSoId: 222, CarrierDocuNo: 'SO-111' },
      tx: txMock({ wg, wt: tripTicket, trip, members: membersMulti })
    }),
    e => e.code === 'DELIVERY_EVIDENCE_CONFLICT'
  );
  console.log('PASS 4: Inconsistent CarrierSoId vs CarrierDocuNo rejected with DELIVERY_EVIDENCE_CONFLICT');

  // 5. Negative: Reservation for SO not in trip rejected with DELIVERY_EVIDENCE_MISMATCH
  await assert.rejects(
    () => fn({
      deliveryDocuNo: 'WG-501',
      reservation: { Id: 7, TripId: 501, CarrierSoId: 999, CarrierDocuNo: 'SO-999' },
      tx: txMock({ wg, wt: tripTicket, trip, members: membersMulti })
    }),
    e => e.code === 'DELIVERY_EVIDENCE_MISMATCH'
  );
  console.log('PASS 5: Unrelated SO rejected with DELIVERY_EVIDENCE_MISMATCH');
})().catch(e => { console.error(e); process.exitCode = 1; });
`, { require, console, process });
