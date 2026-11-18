'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createConversionApprovalRequest } = require('../services/rebate-conversion-approval-request');
const epoch = { environment: 'uat', generation: 1, resetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
const user = { sub: 1, role: 'SALES' };
const payload = { requestId: 'e15f7d22-3a47-4fcb-a954-0112b1a3ed07', custId: 7, goodId: 3,
  standingYear: 2026, note: 'UAT test', requestedAmountBaht: 100 };
function fixture() {
  const state = { row: null, reservations: [], conversions: 0, visible: true, sourceChanged: false, failInsert: false };
  const query = async (sql, p) => {
    if (/sp_getapplock/.test(sql)) return { recordset: [{ LockResult: 0 }] };
    if (/FROM wf.RebateConversionApprovalRequest r/.test(sql)) return { recordset: state.row ? [state.row] : [] };
    if (/SELECT AccrualId,QuantityTon/.test(sql)) return { recordset: state.reservations };
    if (/INSERT wf.RebateConversionApprovalRequest/.test(sql)) {
      if (state.failInsert) throw Error('insert failed');
      state.row = { Id: 8, Fingerprint: p.fingerprint, EnvironmentKind: p.environment, ResetId: p.resetId,
        Generation: p.generation, CustId: p.custId, ConversionId: p.conversionId, Status: 'PENDING',
        ConversionStatus: 'PENDING_APPROVAL', ConvertedValueBaht: '100.00', InDataWindow: 1, ActorPrimaryId: p.actor,
        EffectivePrimaryId: p.effective, ActorBusinessId: p.actorBusiness, EffectiveBusinessId: p.effectiveBusiness };
      return { recordset: [{ Id: 8 }] };
    }
    throw Error('unexpected query');
  };
  const options = { windowStartUtc: new Date('2025-12-31T17:00:00Z'), participantFence: async () => {}, scopeFilter: async () => ({ sql: '1=1', inputs: {} }),
    clock: () => '2026-11-14', readCycle: async () => 12,
    createConversion: async (_q, input, config) => {
      assert.equal(config.pendingApproval, true); assert.equal(input.custId, 7);
      state.conversions++; state.reservations = [{ AccrualId: 5, QuantityTon: '1.000', AmountBaht: '100.00', Status: 'ACTIVE' }];
      return { conversion: { id: 10, status: 'PENDING_APPROVAL' } };
    },
    readLots: async () => state.visible ? [{ AccrualId: 5 }] : [],
    reserve: async () => { if (state.sourceChanged) throw Object.assign(Error('changed'), { code: 'REBATE_RESERVATION_SOURCE_CHANGED' }); return { replayed: true }; },
  };
  let queue = Promise.resolve();
  const run = (body = payload, who = user, ep = epoch) => {
    const work = async () => { const before = structuredClone(state);
      try { return await createConversionApprovalRequest(query, who, body, ep, options); }
      catch (e) { Object.assign(state, before); throw e; } };
    const next = queue.then(work, work); queue = next.catch(() => {}); return next;
  };
  return { state, run };
}
test('concurrent retries reserve once and return the same pending request', async () => {
  const f = fixture(); const [first, second] = await Promise.all([f.run(), f.run()]);
  assert.equal(first.replayed, false); assert.equal(second.replayed, true); assert.equal(f.state.conversions, 1);
  assert.equal(f.state.reservations.length, 1);
});
test('changed input, lost scope and changed evidence do not replay or reserve again', async () => {
  const f = fixture(); await f.run();
  await assert.rejects(f.run({ ...payload, requestedAmountBaht: 50 }), { code: 'REBATE_CONVERSION_REQUEST_CONFLICT' });
  f.state.visible = false;
  await assert.rejects(f.run(), { code: 'REBATE_CONVERSION_RESERVATION_INVALID' });
  f.state.visible = true; f.state.sourceChanged = true;
  await assert.rejects(f.run(), { code: 'REBATE_RESERVATION_SOURCE_CHANGED' });
  assert.equal(f.state.conversions, 1);
});
test('failure to journal request rolls back conversion and reservation', async () => {
  const f = fixture(); f.state.failInsert = true;
  await assert.rejects(f.run(), /insert failed/);
  assert.equal(f.state.conversions, 0); assert.deepEqual(f.state.reservations, []);
});
test('a replay outside the configured data window is not exposed or recreated', async () => {
  const f = fixture(); await f.run(); f.state.row.InDataWindow = 0;
  await assert.rejects(f.run(), { code: 'REBATE_CONVERSION_REQUEST_NOT_FOUND' });
  assert.equal(f.state.conversions, 1); assert.equal(f.state.reservations.length, 1);
});
