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

function txMock({ wg, wt, trip, members }) {
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
  const soIdA = 777781;
  const soIdB = 777782;
  const tripTruckPlate = '70-7788';
  const multiTripId = 555;
  const trip = { TripId: multiTripId, TripCode: 'TRIP-MULTI', TransRegistration: tripTruckPlate, Status: 'SCHEDULED' };
  const members = [
    { TripId: multiTripId, MemberKind: 'CONFIRMED', MemberId: String(soIdA), DocuNo: null, CustId: 'CUST-ALPHA', CustName: 'Alpha', SOID: soIdA },
    { TripId: multiTripId, MemberKind: 'CONFIRMED', MemberId: String(soIdB), DocuNo: null, CustId: 'CUST-BETA', CustName: 'Beta', SOID: soIdB },
  ];
  const wgMulti = { Id: 1, DocuNo: 'WG-MULTI', CarNo: tripTruckPlate, SPID: soIdA, WeightIn: 22000, DateIn: '2026-09-25', Status: 'IN' };

  try {
    const resA = await fn({
      deliveryDocuNo: 'WG-MULTI',
      reservation: { Id: 1207, CarrierSoId: soIdA, CarrierDocuNo: 'SO-ALPHA-01', TripId: multiTripId },
      tx: txMock({ wg: wgMulti, trip, members })
    });
    console.log('resA passed:', resA.docuNo);

    const resB = await fn({
      deliveryDocuNo: 'WG-MULTI',
      reservation: { Id: 1208, CarrierSoId: soIdB, CarrierDocuNo: 'SO-BETA-02', TripId: multiTripId },
      tx: txMock({ wg: wgMulti, trip, members })
    });
    console.log('resB passed:', resB.docuNo);
  } catch (err) {
    console.error('FAILED with:', err);
  }
})();
