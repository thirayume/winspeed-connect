'use strict';

/**
 * R11 D10 — R10.7-1: manual settle only for cuts on/after go-live and not older than
 * (reservation created − N days); plate must match unless overridden (audited).
 * Automatic matching never takes a cut dated before the carrier bill's confirm.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// logChangeEvent asks the module's wfQuery whether wf.ChangeEvent has ActorUserId. Answer from a stub:
// the real one opens a msnodesqlv8 pool, and its pending connect keeps node from ever exiting.
const dbPath = require.resolve('../db');
const plainDbExports = Object.fromEntries(
  Object.entries(Object.getOwnPropertyDescriptors(require('../db')))
    .filter(([, desc]) => 'value' in desc)
    .map(([key, desc]) => [key, desc.value])
);
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: { ...plainDbExports, wfQuery: async () => ({ recordset: [] }) }
};

const { manualSettleCouponCut } = require('../services/coupon-service');
const { matchCutsToReservations } = require('../services/coupon-settlement-matcher');

function makeDeps({ cutDate, cutPlate = 'กพ70-9233/9234', tripPlate = 'กพ70-9233/9234', duplicateCut = false, expiredAtRead = false, expiredAtCommit = false, non116 = false, unverifiedStatus = false }) {
  const writes = [], reads = [];
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
        const legacy=require('./helpers/native-hold-legacy.cjs')(text);if(legacy)return legacy;
        if (/UPDATE wf\.CouponReservation/.test(text)) return expiredAtCommit
          ? { rowsAffected: [0], recordset: [] }
          : { rowsAffected: [1], recordset: [{ Status: 'CONSUMED' }] };
        return { rowsAffected: [1], recordset: [] };
      },
    };
  };
  return {
    writes, reads,
    deps: {
      checkMigration139: async () => true,
      settlementPolicy: { settlementWindowDays: 3, goLiveCutoffDate: '2026-10-01' },
      wfQuery: async (text, params) => {
        reads.push({text,params});
        const legacy=require('./helpers/native-hold-legacy.cjs')(text);if(legacy)return legacy;
        if (/FROM wf\.CouponReservation cr/.test(text)) return { recordset: expiredAtRead ? [] : [reservation] };
        if (/FROM dbo\.WFRedemtionDT rd/.test(text)) return { recordset: non116 || unverifiedStatus ? [] : duplicateCut ? [cut, {...cut}] : [cut] };
        if (/FROM wf\.CouponReservationSettlement/.test(text)) return { recordset: [] };
        return { recordset: [] };
      },
      wfTransaction: async (fn) => { const before = writes.length; try { return await fn({ request: req }); } catch(e) { writes.splice(before); throw e; } }, validateSettlementSnapshot: async()=>{}, validateManualSettlementWindow:async()=>{}, couponVisible:async()=>true,reservationsVisible:async()=>true,
    },
  };
}

const base = { reservationId: 20, redemptionId: 183005, reason: 'UAT R11 manual settle check', role: 'ACCOUNTING', actor: { userId: 40, role: 'ACCOUNTING' } };

test('manual preflight refuses legacy cut calculation when a recovery exists',async()=>{
  const f=makeDeps({cutDate:'2026-10-06T00:00:00Z'});const prior=f.deps.wfQuery;let cutRead=false;
  f.deps.wfQuery=async(text,params)=>{
    if(text.includes('COUPON_RECOVERY_READINESS_V1'))return {recordset:[{...require('./helpers/coupon-bridge-metadata').absent,RecoverySchemaState:'COUPON_RECOVERY_READINESS_V1',Ledger232:0,EditHoldVisible:0,Ledger231:1,RecoveryVisible:1,RecoverySelect:1,SchemaSelect:1}]};
    if(text.includes('AS RecoveryExists'))return {recordset:[{RecoveryExists:1}]};
    if(text.includes('FROM dbo.WFRedemtionDT rd'))cutRead=true;
    return prior(text,params);
  };
  await assert.rejects(manualSettleCouponCut({...base,deps:f.deps}),{code:'COUPON_RECOVERY_REVIEW_REQUIRED'});
  assert.equal(cutRead,false);assert.equal(f.writes.length,0);
});

test('manual settlement scopes the cut to the reserved coupon and rejects duplicate matching lines',async()=>{
  const f=makeDeps({cutDate:'2026-10-06T00:00:00Z',duplicateCut:true});
  await assert.rejects(manualSettleCouponCut({...base,deps:f.deps}),{code:'REDEMPTION_LINE_AMBIGUOUS'});
  const read=f.reads.find(r=>/FROM dbo\.WFRedemtionDT rd/.test(r.text));
  assert.match(read.text,/rd\.RedemtionID = @redemId AND rd\.CouponID = @cid/);
  assert.match(read.text,/rh\.DocuType = 116/);
  assert.match(read.text,/GROUP BY NativeRedemptionId, CouponId/);
  assert.equal(read.params.cid.value,246003);assert.equal(f.writes.length,0);
});

test('manual settlement rejects an expired reservation and a non-116 document before writing',async()=>{
  const expired=makeDeps({cutDate:'2026-10-06T00:00:00Z',expiredAtRead:true});
  await assert.rejects(manualSettleCouponCut({...base,deps:expired.deps}),e=>e.status===404);
  assert.match(expired.reads[0].text,/ExpiresAt IS NULL OR cr\.ExpiresAt > GETUTCDATE\(\)/);
  assert.equal(expired.writes.length,0);
  const non116=makeDeps({cutDate:'2026-10-06T00:00:00Z',non116:true});
  await assert.rejects(manualSettleCouponCut({...base,deps:non116.deps}),e=>e.status===404);
  assert.match(non116.reads.find(r=>/FROM dbo\.WFRedemtionDT rd/.test(r.text)).text,/rh\.DocuType = 116/);
  assert.equal(non116.writes.length,0);
});

test('manual settlement queries only verified native status and makes no write for an unverified source',async()=>{
  const f=makeDeps({cutDate:'2026-10-06T00:00:00Z',unverifiedStatus:true});
  await assert.rejects(manualSettleCouponCut({...base,deps:f.deps}),e=>e.status===404);
  const read=f.reads.find(r=>/FROM dbo\.WFRedemtionDT rd/.test(r.text));
  assert.match(read.text,/ISNULL\(LTRIM\(RTRIM\(rh\.DocuStatus\)\),''\) IN \('N','Y'\)/);
  assert.equal(f.writes.length,0);
});

test('expiration between the read and settlement causes transactional rollback',async()=>{
  const f=makeDeps({cutDate:'2026-10-06T00:00:00Z',expiredAtCommit:true});
  let updateSql='';
  const originalTx=f.deps.wfTransaction;
  f.deps.wfTransaction=fn=>originalTx(tx=>fn({request(){const request=tx.request(),query=request.query;
    request.query=async text=>{if(/UPDATE wf\.CouponReservation/.test(text))updateSql=text;return query.call(request,text);};return request;}}));
  await assert.rejects(manualSettleCouponCut({...base,deps:f.deps}),e=>e.status===409);
  assert.match(updateSql,/ExpiresAt IS NULL OR ExpiresAt > GETUTCDATE\(\)/);
  assert.equal(f.writes.length,0);
});

test('changed global start date is rejected before settlement, audit or outbox writes',async()=>{
  const f=makeDeps({cutDate:'2026-10-06T00:00:00Z'});
  f.deps.validateManualSettlementWindow=async(_tx,context)=>{
    assert.equal(context.window.businessDate,'2026-01-01');
    assert.equal(context.redemptionId,183005);
    assert.equal(context.couponId,246003);
    throw Object.assign(Error('DATA_WINDOW_CHANGED'),{code:'DATA_WINDOW_CHANGED',status:409});
  };
  await assert.rejects(manualSettleCouponCut({...base,dataWindow:{businessDate:'2026-01-01'},deps:f.deps}),{code:'DATA_WINDOW_CHANGED'});
  assert.equal(f.writes.length,0);
});

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
