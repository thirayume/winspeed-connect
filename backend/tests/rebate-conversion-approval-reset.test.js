'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cancelPendingConversionRequestsForReset } = require('../services/rebate-conversion-approval-reset');
const previous = { generation: 1, resetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
const input = { environment: 'uat', actorId: 1, effectiveId: 1, businessActorId: 11, businessEffectiveId: 11 };
function fixture() {
  const state = { schema: 1, broken: false, stale: false, row: { Id: 8, CustId: 7, ConversionId: 10,
    ConversionStatus: 'PENDING_APPROVAL', ConvertedValueBaht: '100.00', Status: 'PENDING' },
    reservations: [{ Id: 5, AmountBaht: '100.00', Status: 'ACTIVE' }], tickets: ['ISSUED'], failDecision: false };
  const query = async (sql, p) => {
    if (/OBJECT_ID\('wf.RebateConversionApprovalRequest'/.test(sql)) return { recordset: [{ HasSchema: state.schema }] };
    if (/SELECT TOP 1 Id FROM wf.RebateConversionApprovalRequest/.test(sql)) return { recordset: state.stale ? [{ Id: 8 }] : [] };
    if (/SELECT TOP 1 r.Id/.test(sql)) return { recordset: state.broken ? [{ Id: 8 }] : [] };
    if (/SELECT r.Id,r.CustId,r.ConversionId/.test(sql)) return { recordset: state.row.Status === 'PENDING' ? [state.row] : [] };
    if (/SET ANSI_NULLS/.test(sql)) return {};
    if (/sp_getapplock/.test(sql)) return { recordset: [{ LockResult: 0 }] };
    if (/SELECT Id,AmountBaht,Status/.test(sql)) return { recordset: state.reservations };
    if (/UPDATE wf.RebateShipmentReservation/.test(sql)) { state.reservations.forEach(r => r.Status = 'RELEASED'); return { rowsAffected: [1] }; }
    if (/UPDATE wf.FertilizerTicketConversion/.test(sql)) { state.row.ConversionStatus = 'CANCELLED'; return { rowsAffected: [1] }; }
    if (/UPDATE wf.RebateConversionApprovalRequest/.test(sql)) {
      if (state.failDecision) throw Error('audit failure');
      Object.assign(state.row, { Status: 'CANCELLED', actor: p.actor, actorBusiness: p.actorBusiness, reason: p.reason }); return { rowsAffected: [1] };
    }
    throw Error('unexpected query');
  };
  const run = async (params = input) => { const before = structuredClone(state);
    try { return await cancelPendingConversionRequestsForReset(query, params, previous); }
    catch (e) { Object.assign(state, before); throw e; } };
  return { state, run };
}
test('reset cancels pending requests and releases reservations while keeping issued tickets', async () => {
  const f = fixture(); assert.deepEqual(await f.run(), { cancelled: 1 });
  assert.equal(f.state.row.Status, 'CANCELLED'); assert.equal(f.state.row.actorBusiness, 11);
  assert.equal(f.state.reservations[0].Status, 'RELEASED'); assert.deepEqual(f.state.tickets, ['ISSUED']);
  assert.deepEqual(await f.run(), { cancelled: 0 });
});
test('missing mapped identity or inconsistent records stop reset without releasing funds', async () => {
  let f = fixture(); await assert.rejects(f.run({ ...input, businessActorId: undefined }), { code: 'REBATE_RESET_BUSINESS_IDENTITY_UNAVAILABLE' });
  assert.equal(f.state.reservations[0].Status, 'ACTIVE');
  f = fixture(); f.state.broken = true; await assert.rejects(f.run(), { code: 'REBATE_RESET_CONVERSION_INVALID' });
  f = fixture(); f.state.stale = true; await assert.rejects(f.run(), { code: 'REBATE_RESET_CONVERSION_EPOCH_MISMATCH' });
  f = fixture(); f.state.reservations[0].AmountBaht = '99.00'; await assert.rejects(f.run(), { code: 'REBATE_RESET_CONVERSION_INVALID' });
});
test('failure to record cancellation rolls everything back', async () => {
  const f = fixture(); f.state.failDecision = true; await assert.rejects(f.run(), /audit failure/);
  assert.equal(f.state.row.Status, 'PENDING'); assert.equal(f.state.row.ConversionStatus, 'PENDING_APPROVAL');
  assert.equal(f.state.reservations[0].Status, 'ACTIVE');
});
