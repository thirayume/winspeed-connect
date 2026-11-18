'use strict';

// POST /api/rebate/claims after a Rebate reset (generation > 0): the balance is the
// verified shipment ledger. The claim is planned, written and reserved in one transaction
// under the fences, and the WinSpeed 104 lots are not read.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const state = { epoch: null, fenceError: null, planError: null, applyError: null, planned: [], applied: [], participant: [], replay: null, visible: 1 };
const shipmentEpoch = { environment: 'uat', generation: 1, resetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  lastResetAtUtc: new Date('2026-11-14T02:00:00Z'), manifestDigest: 'a'.repeat(64), uninitialized: false, fenced: true };

const fencePath = require.resolve('../services/rebate-route-fence');
const realFence = require(fencePath);
require.cache[fencePath].exports = { ...realFence,
  withRebateRouteFence: async operation => { if (state.fenceError) throw state.fenceError; return operation(state.epoch); },
  routeParticipantFence: async (_query, epoch) => { state.participant.push(epoch.generation); return epoch; } };

const allocation = (accrualId, soid, ton, amount, docuDate, docuNo) => ({ accrualId, quantityTon: ton, amountBaht: amount,
  isOpeningBalance: docuDate < '2026-01-01', sourceSOID: soid, sourceListNo: 1, sourceDocuNo: docuNo, sourceDocuDate: docuDate,
  sourceCouponNo: `CP-${soid}`, sourceRefSOID: 900 + soid, sourceRefListNo: 1, sourceBookingDocuNo: `BK-${soid}`,
  goodCode: '7-16080800BBCAR', goodName: '16-8-8', listPricePerTon: '15600.00', netPricePerTon: '15000.00', rebatePerTon: '600.00', planId: 4 });
const plan = { allocations: [allocation(11, 501, '1.500', '900.00', '2026-11-14', 'I69-09001'), allocation(12, 502, '0.500', '300.00', '2026-11-15', 'I69-09002')],
  totalAmount: '1200.00' };

const claimPath = require.resolve('../services/rebate-shipment-claim');
const realClaim = require(claimPath);
require.cache[claimPath].exports = { ...realClaim,
  planShipmentClaim: async (_query, epoch, user, input) => { state.planned.push({ epoch, user, input }); if (state.planError) throw state.planError; return plan; },
  applyShipmentClaimPlan: async (_query, epoch, input) => { state.applied.push({ epoch, input }); if (state.applyError) throw state.applyError; return []; } };

const db = h.installDbStub(({ text }) => {
  if (/FROM dbo\.EMCust/.test(text)) return [{ CustID: 1078, CustCode: '0330005', CustName: 'ลูกค้า', SaleAreaID: 1 }];
  if (/SaleAreaCode/.test(text)) return [{ SaleAreaCode: '03300101' }];
  if (/FROM wf\.PolicySnapshot/.test(text)) return [{ SnapshotId: 1, RevisionNumber: 1, CustomerRatio: 100, CompanyRatio: 0 }];
  if (/SELECT \* FROM wf\.RebateClaim WITH \(UPDLOCK, HOLDLOCK\) WHERE IdempotencyKey/.test(text)) return state.replay ? [state.replay] : [];
  if (/COUNT\(\*\) AS TotalLines/.test(text)) return [{ TotalLines: 1, VisibleLines: state.visible }];
  if (/SELECT Id, EmpId, PositionCode FROM wf\.AppUser/.test(text)) return [{ Id: 12, EmpId: 12, PositionCode: null }];
  if (/INSERT INTO wf\.RebateClaim \(/.test(text)) return [{ Id: 77, Status: 'TIER2_PENDING' }];
  return [];
}, { activeUserIds: h.TEST_USERS });

let app;
test.before(async () => { app = await h.startApp([['/api/rebate', '../../routes/rebate']]); });
test.after(async () => { await app.close(); });
test.beforeEach(() => { Object.assign(state, { epoch: shipmentEpoch, fenceError: null, planError: null, applyError: null, planned: [], applied: [], participant: [], replay: null, visible: 1 }); });

const accounting = { sub: 12, role: 'ACCOUNTING' };
const lines = [{ goodCode: '7-16080800BBCAR', qtyTon: 2, pricePerTon: 99999, netPricePerTon: 1 }];
const submit = (body = {}, user = accounting) => app.call('POST', '/api/rebate/claims', { body: { custId: '1078', lines, ...body }, user });
const failure = (code, status) => Object.assign(new Error(code), { code, status });

test('after a reset the claim is priced and reserved from the shipment ledger, not the 104 lots', async () => {
  const before = db.calls.length;
  const r = await submit();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const calls = db.calls.slice(before);

  assert.equal(calls.some(c => /v_RebateAccrualRemaining/.test(c.text)), false, 'the 104 lot view must not be read after a reset');
  assert.deepEqual(state.participant, [1], 'participant fence taken once inside the business transaction');
  assert.equal(state.planned.length, 1);
  assert.equal(state.planned[0].epoch, shipmentEpoch);
  assert.equal(state.planned[0].input.custId, 1078);
  assert.equal(state.planned[0].input.startDate, '2026-01-01');
  assert.equal(Number(state.planned[0].user.sub), 12);

  const header = calls.find(c => /INSERT INTO wf\.RebateClaim \(/.test(c.text));
  assert.equal(Number(header.inputs.amt), 1200, 'header amount is the ledger total, never a caller price');
  const inserted = calls.filter(c => /INSERT INTO wf\.RebateClaimLine/.test(c.text));
  assert.deepEqual(inserted.map(c => [c.inputs.lno, c.inputs.ltype, Number(c.inputs.qty), Number(c.inputs.price), Number(c.inputs.netPrice), Number(c.inputs.rebate), c.inputs.planId, c.inputs.sSoid, c.inputs.sDocu]),
    [[1, 'REBATE', 1.5, 15600, 15000, 600, 4, 501, 'I69-09001'], [2, 'REBATE', 0.5, 15600, 15000, 600, 4, 502, 'I69-09002']]);

  assert.equal(state.applied.length, 1);
  assert.deepEqual(state.applied[0].input, { custId: 1078, claimId: 77, allocations: plan.allocations });
  const order = text => calls.findIndex(c => text.test(c.text));
  assert.ok(order(/INSERT INTO wf\.RebateClaim \(/) < order(/INSERT INTO wf\.RebateClaimLine/));

  const audit = calls.find(c => /REBATE_CLAIM/.test(JSON.stringify(c.inputs)) && /CREATE_CLAIM/.test(JSON.stringify(c.inputs)));
  assert.ok(audit, 'expected the CREATE_CLAIM audit event');
  const after = JSON.parse(Object.values(audit.inputs).find(v => typeof v === 'string' && v.includes('balanceSource')));
  assert.deepEqual({ source: after.balanceSource, generation: after.resetGeneration, resetId: after.resetId, accruals: after.reservedAccruals },
    { source: 'SHIPMENT_LEDGER', generation: 1, resetId: shipmentEpoch.resetId, accruals: 2 });
});

test('a failed reservation rejects the claim with a reason and writes no approval or audit row', async () => {
  state.applyError = failure('REBATE_RESERVATION_SOURCE_CHANGED', 409);
  const before = db.calls.length;
  const r = await submit();
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'REBATE_RESERVATION_SOURCE_CHANGED');
  assert.match(r.body.message, /เอกสารขนส่งต้นทางมีการเปลี่ยนแปลง/);
  const calls = db.calls.slice(before);
  assert.equal(calls.some(c => /INSERT INTO wf\.RebateClaimApproval/.test(c.text)), false);
  assert.equal(calls.some(c => /CREATE_CLAIM/.test(JSON.stringify(c.inputs))), false);
});

test('insufficient ledger balance and out-of-scope customers are refused before anything is written', async () => {
  for (const [code, status, message] of [['REBATE_CLAIM_INSUFFICIENT', 400, /มากกว่ายอดรีเบทคงเหลือ/], ['REBATE_CUSTOMER_OUT_OF_SCOPE', 404, /ไม่พบยอดรีเบท/],
    ['REBATE_CLAIM_DIFFERENCE_UNAVAILABLE', 400, /คืนส่วนต่าง/]]) {
    state.planError = failure(code, status);
    const before = db.calls.length;
    const r = await submit();
    assert.equal(r.status, status); assert.equal(r.body.code, code); assert.match(r.body.message, message);
    assert.equal(db.calls.slice(before).some(c => /INSERT INTO wf\.RebateClaim/.test(c.text)), false);
    assert.equal(state.applied.length, 0);
  }
});

test('while a reset is in progress the claim is refused with 503 and nothing runs', async () => {
  state.fenceError = failure('REBATE_RESET_IN_PROGRESS_OR_UNINITIALIZED', 503);
  const before = db.calls.length;
  const r = await submit();
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'REBATE_RESET_IN_PROGRESS_OR_UNINITIALIZED');
  assert.match(r.body.message, /กำลังเริ่มยอดรีเบทใหม่/);
  assert.equal(state.planned.length, 0);
  assert.equal(db.calls.slice(before).some(c => /INSERT INTO wf\.RebateClaim/.test(c.text)), false);
});

test('idempotency replay cannot bypass a closed fence or both-source scope checks', async () => {
  state.fenceError = failure('REBATE_RESET_IN_PROGRESS_OR_UNINITIALIZED',503);
  const before=db.calls.length;
  const blocked=await submit({idempotencyKey:'UAT-REPLAY'});
  assert.equal(blocked.status,503);
  assert.equal(db.calls.slice(before).some(c=>/IdempotencyKey\s*=\s*@k/.test(c.text)),false);

  state.fenceError=null;
  const body={custId:'1078',lines,idempotencyKey:'UAT-REPLAY'};
  state.replay={Id:77,CustId:'1078',Status:'TIER2_PENDING',CreatedAt:new Date('2026-11-14T03:00:00Z'),
    RequestPayloadHash:require('../routes/rebate').buildCanonicalPayloadHash(body)};
  const first=await app.call('POST','/api/rebate/claims',{body,user:accounting});
  assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(first.body.replayed,true);
  state.visible=0;
  const denied=await app.call('POST','/api/rebate/claims',{body,user:accounting});
  assert.equal(denied.status,404);assert.equal(denied.body.code,'REBATE_CLAIM_REPLAY_OUT_OF_SCOPE');
});

test('a claim without a customer cannot reach the shipment ledger', async () => {
  const r = await app.call('POST', '/api/rebate/claims', { body: { lines }, user: accounting });
  assert.equal(r.status, 400);
  assert.equal(state.planned.length, 0);
});

test('before any reset the claim still reads the 104 lots and never touches the shipment ledger', async () => {
  state.epoch = realFence.UNFENCED;
  const before = db.calls.length;
  const r = await submit();
  // the stub has no 104 lots, so the legacy path answers with its own reconciliation message
  assert.equal(r.status, 400);
  assert.match(r.body.message, /ไม่ตรงกับยอดขนจริง/);
  assert.equal(db.calls.slice(before).some(c => /v_RebateAccrualRemaining/.test(c.text)), true);
  assert.equal(state.planned.length, 0);
  assert.equal(state.applied.length, 0);
  assert.deepEqual(state.participant, [0]);
});
