'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { approveConversionRequest } = require('../services/rebate-conversion-approval-issue');
const epoch = { environment: 'uat', generation: 1, resetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
const manager = { sub: 1, roles: ['SALES','MANAGER'], role: 'SALES' };
function fixture() {
  const state = { row: { Id: 8, CustId: 7, ConversionCustId: 7, EnvironmentKind: 'uat', ResetId: epoch.resetId,
    Generation: 1, Status: 'PENDING', ConversionStatus: 'PENDING_APPROVAL', ConversionId: 10,
    GoodId: 3, StandingYear: 2026, StandingPricePerTon: '1000.00', ConvertedTons: '0.1000', ConvertedValueBaht: '100.00',
    RequestedExpiryDate: null }, reservations: [{ AccrualId: 5, QuantityTon: '1.000', AmountBaht: '100.00', Status: 'ACTIVE' }],
    tickets: [], price: 1000, sourceChanged: false, failAudit: false };
  const query = async (sql, p) => {
    if (/SELECT Id,CustId FROM wf.RebateConversionApprovalRequest/.test(sql)) return { recordset: [state.row] };
    if (/sp_getapplock/.test(sql)) return { recordset: [{ LockResult: 0 }] };
    if (/FROM wf.RebateConversionApprovalRequest r/.test(sql)) return { recordset: [state.row] };
    if (/SELECT AccrualId,QuantityTon/.test(sql)) return { recordset: state.reservations };
    if (/SELECT Id,CustId,GoodId,IssuedTonnage/.test(sql)) return { recordset: state.tickets };
    if (/UPDATE wf.FertilizerTicketConversion/.test(sql)) { state.row.ConversionStatus = 'ISSUED'; return { rowsAffected: [1] }; }
    if (/UPDATE wf.RebateConversionApprovalRequest/.test(sql)) {
      if (state.failAudit) throw Error('audit failed');
      Object.assign(state.row, { Status: 'APPROVED', DecisionActorPrimaryId: p.actor, DecisionEffectivePrimaryId: p.effective,
        DecisionActorBusinessId: p.actorBusiness, DecisionEffectiveBusinessId: p.effectiveBusiness, DecisionReason: p.reason });
      return { rowsAffected: [1] };
    }
    throw Error('unexpected query');
  };
  const options = { windowStartUtc: new Date('2025-12-31T17:00:00Z'), participantFence: async () => {}, authorizeScope: async () => ({ sql: '1=1', inputs: {} }),
    readLots: async () => [{ AccrualId: 5 }], reserve: async () => { if (state.sourceChanged) throw Object.assign(Error('changed'), { code: 'REBATE_RESERVATION_SOURCE_CHANGED' }); },
    standingPrice: async () => ({ goodId: 3, basePrice: state.price }), clock: () => '2026-11-14', readValidity: async () => 90,
    issue: async (_q, p) => { state.tickets.push({ Id: 20, CustId: p.custId, GoodId: p.goodId, IssuedTonnage: p.issuedTonnage });
      return { id: 20, conversionId: p.conversionId, custId: p.custId, goodId: p.goodId, issuedTonnage: p.issuedTonnage }; } };
  const run = async () => { const before = structuredClone(state);
    try { return await approveConversionRequest(query, manager, { id: 8, reason: 'approved' }, epoch, options); }
    catch (e) { Object.assign(state, before); throw e; } };
  return { state, run };
}
test('self approval issues one ticket atomically and retry returns the same receipt', async () => {
  const f = fixture(); const first = await f.run(); const second = await f.run();
  assert.equal(first.ticketId, 20); assert.equal(first.replayed, false); assert.equal(second.replayed, true);
  assert.equal(f.state.tickets.length, 1); assert.equal(f.state.row.Status, 'APPROVED');
});
test('changed price or source cannot issue a ticket', async () => {
  for (const change of ['price','sourceChanged']) {
    const f = fixture(); if (change === 'price') f.state.price = 1100; else f.state.sourceChanged = true;
    await assert.rejects(f.run()); assert.equal(f.state.tickets.length, 0); assert.equal(f.state.row.Status, 'PENDING');
  }
});
test('failed decision audit rolls back ticket and status', async () => {
  const f = fixture(); f.state.failAudit = true;
  await assert.rejects(f.run(), /audit failed/); assert.equal(f.state.tickets.length, 0);
  assert.equal(f.state.row.Status, 'PENDING'); assert.equal(f.state.row.ConversionStatus, 'PENDING_APPROVAL');
});
