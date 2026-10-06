'use strict';

/**
 * R11 D10 — R10.7-1: manual settle only for cuts on/after go-live and not older than
 * (reservation created − N days); plate must match unless overridden (audited).
 * Automatic matching never takes a cut dated before the carrier bill's confirm.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { manualSettleCouponCut } = require('../services/coupon-service');
const { matchCutsToReservations } = require('../services/coupon-settlement-matcher');

function makeDeps({ cutDate, cutPlate = 'กพ70-9233/9234', tripPlate = 'กพ70-9233/9234' }) {
  const writes = [];
  const reservation = {
    Id: 20, CouponId: 246003, CarrierSoId: 278026, CarrierDocuNo: 'K69-02764', TripId: 53,
    ReservedQty: 1, ConsumedQty: 0, RemainingReservedQty: 1, BeneficiaryCustId: '16002', OwnerCustId: '1141',
    Status: 'RESERVED', CreatedAt: new Date('2026-10-06T03:55:00Z'), TripPlate: tripPlate,
    BeneficiaryName: 'คุณจันทิมา แก้วมณี', BeneficiaryCode: '0342001-1',
  };
  const cut = { RedemtionID: 183005, CouponID: 246003, OriginalGoodQty: 1, GoodQty: 1, DocuNo: '69100006', DocuDate: new Date(cutDate), CarLicense: cutPlate, IssueName: 'คุณจันทิมา แก้วมณี' };
  const req = () => {
    const inputs = {};
    return {
      input(k, _t, v) { inputs[k] = v; return this; },
      async query(text) {
        writes.push({ text, inputs: { ...inputs } });
        if (/UPDATE wf\.CouponReservation/.test(text)) return { rowsAffected: [1], recordset: [{ Status: 'CONSUMED' }] };
        return { rowsAffected: [1], recordset: [] };
      },
    };
  };
  return {
    writes,
    deps: {
      checkMigration139: async () => true,
      settlementPolicy: { settlementWindowDays: 3, goLiveCutoffDate: '2026-10-01' },
      wfQuery: async (text) => {
        if (/FROM wf\.CouponReservation cr/.test(text)) return { recordset: [reservation] };
        if (/FROM dbo\.WFRedemtionDT rd/.test(text)) return { recordset: [cut] };
        if (/FROM wf\.CouponReservationSettlement/.test(text)) return { recordset: [] };
        return { recordset: [] };
      },
      wfTransaction: async (fn) => fn({ request: req }),
    },
  };
}

const base = { reservationId: 20, redemptionId: 183005, reason: 'UAT R11 manual settle check', role: 'ACCOUNTING', actor: { userId: 40, role: 'ACCOUNTING' } };

test('R10.7-1: a cut dated before the go-live cutoff cannot be settled manually', async () => {
  const { deps } = makeDeps({ cutDate: '2026-09-30T00:00:00Z' });
  await assert.rejects(manualSettleCouponCut({ ...base, deps }), e => e.status === 400 && /Go-Live/.test(e.message));
});

test('R10.7-1: a cut older than reservation created − N days cannot be settled manually', async () => {
  const { deps } = makeDeps({ cutDate: '2026-10-02T00:00:00Z' }); // created 06/10 − 3 = 03/10
  await assert.rejects(manualSettleCouponCut({ ...base, deps }), e => e.status === 400 && /ไม่อยู่ในช่วงที่อนุญาต/.test(e.message));
});

test('R10.7-1: plate mismatch needs the override box; the override is recorded in the note', async () => {
  const mismatch = makeDeps({ cutDate: '2026-10-06T00:00:00Z', cutPlate: 'กพ70-0000' });
  await assert.rejects(manualSettleCouponCut({ ...base, deps: mismatch.deps }), e => e.status === 400 && /override/.test(e.message));

  const ok = makeDeps({ cutDate: '2026-10-06T00:00:00Z', cutPlate: 'กพ70-0000' });
  const r = await manualSettleCouponCut({ ...base, overridePlate: true, deps: ok.deps });
  assert.equal(r.success, true);
  const ins = ok.writes.find(w => /INSERT INTO wf\.CouponReservationSettlement/.test(w.text));
  assert.match(ins.inputs.note, /^MANUAL \(ยกเว้นทะเบียน\): /);
});

test('RULE 2: automatic matching never takes a cut dated before the confirm, even inside the window', () => {
  const res = matchCutsToReservations(
    [{ id: '20', couponId: 246003, reservedQty: 1, plate: 'กพ70-9233/9234', confirmDate: '2026-10-06', createdAt: '2026-10-06' }],
    [{ redemptionId: '183005', couponId: 246003, goodQty: 1, docuNo: '69100006', docuDate: '2026-10-05', carLicense: 'กพ70-9233/9234' }],
    { settlementWindowDays: 3 },
  );
  assert.equal(res.matches.length, 0);
  assert.equal(res.unmatchedCuts.length, 1, 'listed for review instead');
  assert.equal(res.unmatchedCuts[0].reason, 'CUT_BEFORE_CONFIRM');
});
