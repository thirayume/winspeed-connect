'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
h.installDbStub(() => []);
const { initialBookingAi, nativeFingerprint, captureBookingOrigin, aiHttpError, POLICY } = require('../services/initial-booking-ai');
const { capabilitiesFor } = require('../services/role-capabilities');
const user = { sub: 11, role: 'SALES', actorSub: 99, actorRole: 'ADMIN' };
const requestId = '11111111-2222-4333-8444-555555555555';
function fixture(overrides = {}) {
  const calls = [], events = [];
  const state = { currentXml: '<source>exact-decimal=1.0000</source>', origin: true, receipt: null, procCalls: 0,
    head: { SOID: 501, DocuNo: 'TEST', EmpID: 101, SalesUserId: 11, AppvFlag: 'W' },
    accounts: [{ Id: 11, Role: 'SALES', IsActive: true, MustChangePassword: false, EmpId: '101' },
      { Id: 99, Role: 'ADMIN', IsActive: true, MustChangePassword: false, EmpId: null }], ...overrides };
  const query = async (text, inputs = {}) => {
    calls.push({ text, inputs });
    const rows = (r) => ({ recordset: r });
    if (/SERVERPROPERTY/.test(text)) return rows([{ ServerName: 'AMYOU-YOGA7\\V2008R2', DbName: state.dbName || 'dbwins_worldfert9_uat2', DbId: 10 }]);
    if (/SELECT Id,Role,IsActive/.test(text)) return rows(state.accounts);
    if (/sp_getapplock/.test(text)) return rows([{ LockResult: state.lockResult ?? 0 }]);
    if (/SELECT h.SOID/.test(text)) return rows(state.head ? [state.head] : []);
    if (/SELECT Id, EmpId, PositionCode/.test(text)) return rows([{ Id: 11, EmpId: '101', PositionCode: null }]);
    if (/SELECT \* FROM wf.NativeBookingApproval/.test(text)) return rows(state.receipt ? [state.receipt] : []);
    if (/SELECT \* FROM wf.NativeBookingOrigin/.test(text)) return rows(state.origin ? [{ Fingerprint: state.originHash, PolicyVersion: POLICY, ConfirmedActorId: 99 }] : []);
    if (/FOR XML RAW/.test(text)) return rows([{ Snapshot: state.currentXml }]);
    if (/OBJECT_ID/.test(text)) return rows([{ OriginTable: state.originTable ?? 152 }]);
    if (/INSERT INTO wf.NativeBookingOrigin/.test(text)) return rows([]);
    if (/EXEC wf.usp_ApproveInitialBooking/.test(text)) {
      state.procCalls++;
      if (state.procError) throw new Error(state.procError);
      if (inputs.preview.value) return rows([{ Eligible: 1 }]);
      state.receipt = { SOID: 501, RequestId: requestId, Fingerprint: state.originHash, ApprovalNo: 'AI69-00001',
        ApproverId: 11, ApproverActorId: 99, ApproverEmpId: 101, SelfApproval: true, PolicyVersion: POLICY };
      return rows([state.receipt]);
    }
    throw new Error('Unrecognized fixture query');
  };
  const tx = { request: () => { const inputs = {}; return {
    input(k, type, value) { inputs[k] = { type, value }; return this; }, query: text => query(text, inputs),
  }; } };
  const transaction = async fn => { events.push('begin'); try { const r = await fn(tx); events.push('commit'); return r; }
    catch (e) { events.push('rollback'); throw e; } };
  const ready = async () => { state.originHash = await nativeFingerprint(query, 501); calls.length = 0; };
  return { state, calls, events, query, ready, options: { transaction, enabled: true } };
}
test('feature is closed by default, including advertised capability', async () => {
  const saved = process.env.NATIVE_BOOKING_AI_ENABLED;
  delete process.env.NATIVE_BOOKING_AI_ENABLED;
  try {
    assert.ok(!capabilitiesFor('SALES').actions.includes('so.approve-native'));
    await assert.rejects(initialBookingAi({ soid: 501, user, preview: true }), { code: 'AI_NOT_ENABLED' });
  } finally { if (saved === undefined) delete process.env.NATIVE_BOOKING_AI_ENABLED; else process.env.NATIVE_BOOKING_AI_ENABLED = saved; }
});
test('preview validates without reserving a number; actual and effective identities remain distinct', async () => {
  const f = fixture(); await f.ready();
  const result = await initialBookingAi({ soid: 501, user, preview: true }, f.options);
  assert.equal(result.selfApproval, true); assert.equal(result.actualApproverId, 99); assert.equal(result.effectiveApproverId, 11);
  assert.equal(result.fingerprint, f.state.originHash); assert.equal(result.approvalNo, undefined);
  assert.equal(f.calls.find(c => /EXEC wf.usp_/.test(c.text)).inputs.preview.value, true);
  assert.deepEqual(f.events, ['begin', 'commit']);
});
test('empty optional remark sets are valid fingerprint components; missing result sets fail closed', async () => {
  const empty = await nativeFingerprint(async () => ({ recordset: [{ Snapshot: '' }] }), 501);
  assert.match(empty, /^[a-f0-9]{64}$/);
  await assert.rejects(nativeFingerprint(async () => ({ recordset: [] }), 501), { code: 'AI_SNAPSHOT_UNAVAILABLE' });
});
test('first approval and same-request replay produce only one native write', async () => {
  const f = fixture(); await f.ready();
  const command = { soid: 501, user, requestId, fingerprint: f.state.originHash };
  const first = await initialBookingAi(command, f.options);
  assert.equal(first.replayed, false); assert.equal(first.approvalNo, 'AI69-00001');
  Object.assign(f.state.head, { AppvFlag: 'Y', AppvDocuNo: first.approvalNo, Appvid: 101 });
  assert.equal((await initialBookingAi(command, f.options)).replayed, true);
  assert.equal(f.state.procCalls, 1);
  for (const changed of [{ requestId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }, { fingerprint: 'f'.repeat(64) },
    { user: { ...user, actorSub: 11, actorRole: 'SALES' } }]) {
    await assert.rejects(initialBookingAi({ ...command, ...changed }, f.options), { code: 'AI_REQUEST_CONFLICT' });
  }
  assert.equal(f.state.procCalls, 1);
});
test('a native edit after commit invalidates receipt replay rather than silently reapproving', async () => {
  const f = fixture(); await f.ready();
  const command = { soid: 501, user, requestId, fingerprint: f.state.originHash };
  await initialBookingAi(command, f.options);
  await assert.rejects(initialBookingAi(command, f.options), { code: 'AI_RECEIPT_DIVERGED' });
  assert.equal(f.state.procCalls, 1);
});
test('foreign scoped booking is concealed even when the actual actor is ADMIN', async () => {
  const f = fixture({ head: { SOID: 501, EmpID: 102, SalesUserId: 12 } }); await f.ready();
  await assert.rejects(initialBookingAi({ soid: 501, user, preview: true }, f.options), { code: 'AI_BOOKING_NOT_FOUND', status: 404 });
  assert.equal(f.state.procCalls, 0); assert.ok(!f.calls.some(c => /NativeBookingOrigin/.test(c.text)));
});
test('changed native content, legacy origin and stale previews cannot reach apply', async () => {
  for (const change of ['native', 'origin', 'client']) {
    const f = fixture(); await f.ready(); const fingerprint = f.state.originHash;
    if (change === 'native') f.state.currentXml += '<remark>changed</remark>';
    if (change === 'origin') f.state.origin = false;
    await assert.rejects(initialBookingAi({ soid: 501, user, requestId, fingerprint: change === 'client' ? 'a'.repeat(64) : fingerprint }, f.options),
      { code: { native: 'AI_BOOKING_CHANGED', origin: 'AI_ORIGIN_REQUIRED', client: 'AI_PREVIEW_STALE' }[change] });
    assert.equal(f.state.procCalls, 0); assert.deepEqual(f.events, ['begin', 'rollback']);
  }
});
test('current disabled/stale-role/unmapped employee checks precede native writes', async () => {
  for (const [mutate, code] of [
    [s => { s.accounts[1].IsActive = false; }, 'AI_ACTOR_UNAVAILABLE'],
    [s => { s.accounts[0].MustChangePassword = true; }, 'AI_ACTOR_UNAVAILABLE'],
    [s => { s.accounts[0].Role = 'ACCOUNTING'; }, 'AI_ROLE_CHANGED'],
    [s => { s.accounts[0].EmpId = null; }, 'AI_APPROVER_EMPLOYEE_REQUIRED'],
  ]) {
    const f = fixture(); await f.ready(); mutate(f.state);
    await assert.rejects(initialBookingAi({ soid: 501, user, preview: true }, f.options), { code });
    assert.equal(f.state.procCalls, 0);
  }
});
test('unsupported targets and failed locks do not enter the writer', async () => {
  for (const [options, code] of [[{ dbName: 'foreign' }, 'AI_TARGET_NOT_SUPPORTED'], [{ lockResult: -1 }, 'AI_BUSY']]) {
    const f = fixture(options); await f.ready();
    await assert.rejects(initialBookingAi({ soid: 501, user, preview: true }, f.options), { code });
    assert.equal(f.state.procCalls, 0); assert.equal(f.events.at(-1), 'rollback');
  }
});
test('procedure failures reach the transaction owner; public errors cannot expose raw SQL', async () => {
  const f = fixture({ procError: 'private audit failure with connection information' }); await f.ready();
  let error;
  try { await initialBookingAi({ soid: 501, user, requestId, fingerprint: f.state.originHash }, f.options); } catch (e) { error = e; }
  assert.deepEqual(f.events, ['begin', 'rollback']);
  assert.deepEqual(aiHttpError(error), { status: 503, code: 'AI_APPROVAL_FAILED' });
  assert.deepEqual(aiHttpError(new Error('AI_COUNTER_UNSUPPORTED')), { status: 409, code: 'AI_COUNTER_UNSUPPORTED' });
});
test('invalid IDs and missing preview tokens cannot start a transaction', async () => {
  const f = fixture();
  for (const soid of ['501x', 0, -1, 'SO501']) await assert.rejects(initialBookingAi({ soid, user, preview: true }, f.options), { code: 'AI_BOOKING_ID_INVALID' });
  await assert.rejects(initialBookingAi({ soid: 501, user }, f.options), { code: 'AI_REQUEST_INVALID' });
  assert.deepEqual(f.events, []);
});
test('origin capture is opt-in and failure propagates to confirmation transaction', async () => {
  const saved = process.env.NATIVE_BOOKING_AI_ENABLED;
  const f = fixture();
  try {
    delete process.env.NATIVE_BOOKING_AI_ENABLED;
    assert.equal(await captureBookingOrigin({ query: f.query }), false); assert.equal(f.calls.length, 0);
    process.env.NATIVE_BOOKING_AI_ENABLED = 'true';
    await captureBookingOrigin({ query: f.query, soid: 501, sourceDraftId: 5, salesUserId: 11, user });
    const insert = f.calls.find(c => /INSERT INTO wf.NativeBookingOrigin/.test(c.text));
    assert.equal(insert.inputs.actor.value, 99); assert.equal(insert.inputs.effective.value, 11);
    assert.match(insert.inputs.fingerprint.value, /^[a-f0-9]{64}$/);
    f.state.originTable = 0;
    await assert.rejects(captureBookingOrigin({ query: f.query, soid: 502, user }), { code: 'AI_ORIGIN_REQUIRED' });
  } finally { if (saved === undefined) delete process.env.NATIVE_BOOKING_AI_ENABLED; else process.env.NATIVE_BOOKING_AI_ENABLED = saved; }
});
