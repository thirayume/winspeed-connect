'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { releaseConversionApprovalRequest } = require('../services/rebate-conversion-approval-release');
const epoch = { environment: 'uat', generation: 1, resetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
const sales = { sub: 1, role: 'SALES' }, manager = { sub: 2, role: 'MANAGER' };
function fixture() {
  const state = { row: { Id: 8, CustId: 7, EnvironmentKind: 'uat', ResetId: epoch.resetId, Generation: 1,
    Status: 'PENDING', ConversionStatus: 'PENDING_APPROVAL', ConvertedValueBaht: '100.00', ConversionId: 10,
    ActorPrimaryId: 1, EffectivePrimaryId: 1, ActorBusinessId: 1, EffectiveBusinessId: 1 },
    reservations: [{ Id: 5, AmountBaht: '100.00', Status: 'ACTIVE' }], failDecision: false, visible: true };
  const query = async (sql, p) => {
    if (/SELECT Id,CustId FROM wf.RebateConversionApprovalRequest/.test(sql)) return { recordset: [state.row] };
    if (/sp_getapplock/.test(sql)) return { recordset: [{ LockResult: 0 }] };
    if (/FROM wf.RebateConversionApprovalRequest r/.test(sql)) return { recordset: [state.row] };
    if (/SELECT Id,AmountBaht,Status/.test(sql)) return { recordset: state.reservations };
    if (/SELECT TOP 1 Id FROM wf.RebateShipmentReservation/.test(sql)) return { recordset: state.reservations.filter(r => r.Status === 'ACTIVE') };
    if (/SET ANSI_NULLS/.test(sql)) return {};
    if (/UPDATE wf.RebateShipmentReservation/.test(sql)) { state.reservations.forEach(r => r.Status = 'RELEASED'); return { rowsAffected: [1] }; }
    if (/UPDATE wf.FertilizerTicketConversion/.test(sql)) { state.row.ConversionStatus = p.status; return { rowsAffected: [1] }; }
    if (/UPDATE wf.RebateConversionApprovalRequest/.test(sql)) {
      if (state.failDecision) throw Error('audit failed');
      Object.assign(state.row, { Status: p.status, DecisionActorPrimaryId: p.actor, DecisionEffectivePrimaryId: p.effective,
        DecisionActorBusinessId: p.actorBusiness, DecisionEffectiveBusinessId: p.effectiveBusiness, DecisionReason: p.reason });
      return { rowsAffected: [1] };
    }
    throw Error('unexpected query');
  };
  const options = { windowStartUtc: new Date('2025-12-31T17:00:00Z'), participantFence: async () => {}, authorizeScope: async () => state.visible };
  const run = async (who = manager, action = 'REJECT', reason = 'not approved') => {
    const before = structuredClone(state);
    try { return await releaseConversionApprovalRequest(query, who, { id: 8, action, reason }, epoch, options); }
    catch (e) { Object.assign(state, before); throw e; }
  };
  return { state, run };
}
test('rejection and requester cancellation release once and retain decision identities', async () => {
  for (const [who, action, expected] of [[manager, 'REJECT', 'REJECTED'], [sales, 'CANCEL', 'CANCELLED']]) {
    const f = fixture(); const result = await f.run(who, action);
    assert.equal(result.status, expected); assert.equal(f.state.reservations[0].Status, 'RELEASED');
    assert.equal(f.state.row.DecisionActorPrimaryId, who.sub);
    assert.equal((await f.run(who, action)).replayed, true);
  }
});
test('unauthorized cancel, lost scope and mismatched reservation fail without release', async () => {
  let f = fixture(); await assert.rejects(f.run({ sub: 3, role: 'SALES' }, 'CANCEL'), { code: 'REBATE_CONVERSION_CANCEL_FORBIDDEN' });
  assert.equal(f.state.reservations[0].Status, 'ACTIVE');
  f = fixture(); f.state.visible = false; await assert.rejects(f.run(), { code: 'REBATE_CONVERSION_REQUEST_NOT_FOUND' });
  f = fixture(); f.state.reservations[0].AmountBaht = '99.00'; await assert.rejects(f.run(), { code: 'REBATE_CONVERSION_RESERVATION_INVALID' });
  assert.equal(f.state.reservations[0].Status, 'ACTIVE');
});
test('audit failure rolls back release and conversion state', async () => {
  const f = fixture(); f.state.failDecision = true;
  await assert.rejects(f.run(), /audit failed/);
  assert.equal(f.state.row.Status, 'PENDING'); assert.equal(f.state.row.ConversionStatus, 'PENDING_APPROVAL');
  assert.equal(f.state.reservations[0].Status, 'ACTIVE');
});
