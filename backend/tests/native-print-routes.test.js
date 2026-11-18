'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

// W2: print WinSpeed 104 / 116 / 107 from Sale-App — read-only, role- and scope-guarded, duplicates refused
const head116 = { RedemtionID: 501, DocuNo: '9900001', DocuDate: '2026-10-31', Receiver: 'UAT2 TEST', Plate: 'UAT2-TEST',
  SumGoodQty: 1, DocuStatus: 'N', IsCheckAll: 'Y', RecorderCode: 'EMP-T1', RecorderName: 'Test One', NativeApproverCode: null, NativeApproverName: null };
const item116 = { Listno: 1, CouponNo: 'CP-T1', GoodCode: 'G-T1', GoodName: 'Test good', InveName: 'WH', LocaName: 'L1', GoodQty: 1, RemaQty: 0,
  PostInv: 'N', DeliveryNo: 'D-T1', SalesEmpID: 7001, CustName: 'Test customer', CustCode: 'C-T1', InvoiceNo: null, BookingNo: 'B-T1', BookingSOID: 301 };
const head107 = { SOInvID: 601, DocuNo: 'T69-00001', DocuDate: '2026-10-31', CustCode: 'C-T1', CustName: 'Test customer', NetAmnt: 107, SalesEmpID: 7002 };
const head104 = { SOID: 701, DocuNo: 'D-T1', DocuDate: '2026-10-31', CustCode: 'C-T1', CustName: 'Test customer', SalesEmpID: 7001,
  CouponNo: 'CP-T1, CP-T2', CarLicense: 'UAT2-TEST', RefNo: 'Q-T1', BookingSOID: 301, SumGoodAmnt: 100, NetAmnt: 100 };
const state = { heads104: [head104], heads116: [head116], heads107: [head107], scale: [], printed: [] };

const db = h.installDbStub(call => {
  const t = call.text;
  if (/FROM dbo\.SOHD h/.test(t) && /DocuType=104 AND h\.DocuNo=@no AND ISNULL\(h\.ClearSO,'N'\)<>'Y'/.test(t)) return state.heads104;
  if (/FROM dbo\.SODT d$/m.test(t)) return [{ ListNo: 1, GoodQty2: 1, UnitName: 'TON', GoodCode: 'G-T1', GoodName: 'Test good', GoodPrice2: 100, GoodAmnt: 100 }];
  if (/FROM dbo\.WFRedemtionHD h/.test(t) && /DocuType=116 AND h\.DocuNo=@no/.test(t)) return state.heads116;
  if (/FROM dbo\.WFRedemtionDT d/.test(t)) return [item116];
  if (/FROM dbo\.WGHD WHERE WGType='SO'/.test(t)) return state.scale;
  if (/FROM wf\.NativeDocumentApproval na/.test(t)) return [{ ApproverCode: 'EMP-T2', ApproverName: 'Test Two', SlipSource: 'SCALE', ExceptionRequired: false, SelfApproval: true }];
  if (/FROM dbo\.SOInvHD h/.test(t)) return state.heads107;
  if (/FROM dbo\.SOInvDT d/.test(t)) return [{ ListNo: 1, GoodCode: 'G-T1', GoodName: 'Test good', GoodQty2: 1, UnitName: 'TON', GoodPrice2: 100, GoodAmnt: 100, RefDocuNo: 'D-T1' }];
  if (/SELECT DISTINCT RTRIM\(r\.DocuNo\) AS SlipNo, RTRIM\(rd\.CouponNo\) AS CouponNo, RTRIM\(r\.CarLicense\) AS Plate/.test(t))
    return [{ SlipNo: '9900001', CouponNo: 'CP-T1', Plate: 'UAT2-TEST' }, { SlipNo: '9900001', CouponNo: 'CP-T2', Plate: 'UAT2-TEST' }];
  if (/SELECT Id, EmpId, PositionCode FROM wf\.AppUser/.test(t)) return [{ Id: call.inputs.id, EmpId: '7001', PositionCode: 'TEAM-T' }];
  if (/WITH tree AS/.test(t)) return [{ Id: call.inputs.id, EmpId: '7001' }];
  if (/SELECT SalesUserId FROM wf\.SalesOrderExt/.test(t)) return [];
  if (/^INSERT INTO wf\.NativePrintLog /.test(t.trim())) { state.printed.push(call.inputs); return []; }
  if (/FROM wf\.NativePrintLog WHERE DocType=@type AND DocId=@id/.test(t)) {
    const mine = state.printed.filter(p => p.type === call.inputs.type && p.id === call.inputs.id);
    return [{ count: mine.length, lastAt: mine.length ? '2026-11-01 09:30' : null }];
  }
  return [];
}, { activeUserIds: [11] });

let app;
test.before(async () => { app = await h.startApp([['/api/native-print', '../../routes/native-print']]); });
test.after(async () => { await app.close(); });

const as = role => ({ user: { sub: 11, role } });

test('who may print each document follows the capability map', async () => {
  for (const role of ['SALES', 'APPROVER']) assert.equal((await app.call('GET', '/api/native-print/116/9900001', as(role))).status, 403);
  for (const role of ['SALES', 'APPROVER', 'WAREHOUSE', 'WEIGHBRIDGE']) assert.equal((await app.call('GET', '/api/native-print/107/T69-00001', as(role))).status, 403);
  for (const role of ['WAREHOUSE', 'WEIGHBRIDGE', 'COUNTER_SALES', 'ACCOUNTING', 'C_LEVEL', 'ADMIN'])
    assert.equal((await app.call('GET', '/api/native-print/116/9900001', as(role))).status, 200, role);
  assert.equal((await app.call('GET', '/api/native-print/116/9900001')).status, 401);
});

test('104 prints the delivery-order data of the WinSpeed pre-printed form, for the same roles as the slip', async () => {
  for (const role of ['SALES', 'APPROVER']) assert.equal((await app.call('GET', '/api/native-print/104/D-T1', as(role))).status, 403);
  const r = await app.call('GET', '/api/native-print/104/D-T1', as('WAREHOUSE'));
  assert.equal(r.status, 200);
  assert.equal(r.body.type, 104); assert.equal(r.body.CouponNo, 'CP-T1, CP-T2'); assert.equal(r.body.CarLicense, 'UAT2-TEST');
  assert.equal(r.body.items.length, 1); assert.equal(r.body.items[0].GoodCode, 'G-T1');
  assert.equal((await app.call('GET', '/api/native-print/104/D-T1', as('MANAGER'))).status, 200, 'own team (EmpID 7001)');
  state.heads104 = [head104, { ...head104, SOID: 702 }];
  assert.equal((await app.call('GET', '/api/native-print/104/D-T1', as('ADMIN'))).status, 409);
  state.heads104 = [head104];
});

test('116 returns the slip with recorder, lines, app approval and only an unambiguous scale record', async () => {
  state.scale = [{ Id: 9, CarNo: 'UAT2-TEST', WeightIn: 10000, WeightOut: 11000, WeightNet: 1000 }];
  let r = await app.call('GET', '/api/native-print/116/9900001', as('WAREHOUSE'));
  assert.equal(r.status, 200);
  assert.equal(r.body.type, 116); assert.equal(r.body.DocuNo, '9900001'); assert.equal(r.body.RecorderCode, 'EMP-T1');
  assert.equal(r.body.items.length, 1); assert.equal(r.body.scale.Id, 9); assert.equal(r.body.appApproval.SlipSource, 'SCALE');
  state.scale = [{ Id: 9 }, { Id: 10 }];
  r = await app.call('GET', '/api/native-print/116/9900001', as('WAREHOUSE'));
  assert.equal(r.body.scale, null);
  state.scale = [];
});

test('107 returns the WinSpeed delivery-note fields: lines, linked slip, coupons, plate and company header', async () => {
  const r = await app.call('GET', '/api/native-print/107/T69-00001', as('ACCOUNTING'));
  assert.equal(r.status, 200);
  assert.equal(r.body.type, 107); assert.equal(r.body.items[0].RefDocuNo, 'D-T1');
  assert.deepEqual(r.body.slips, ['9900001']);
  assert.deepEqual(r.body.coupons, ['CP-T1', 'CP-T2']);
  assert.deepEqual(r.body.plates, ['UAT2-TEST']);
  assert.ok('company' in r.body);
});

test('bad numbers, missing and duplicate documents are refused', async () => {
  const user = as('ADMIN');
  for (const no of ['ab', 'x'.repeat(26), "1'--", 'a%20b'])
    assert.equal((await app.call('GET', '/api/native-print/116/' + encodeURIComponent(no), user)).status, 400, no);
  state.heads116 = [];
  assert.equal((await app.call('GET', '/api/native-print/116/9900002', user)).body.code, 'DOC_NOT_FOUND');
  state.heads116 = [head116, { ...head116, RedemtionID: 502 }];
  const dup = await app.call('GET', '/api/native-print/116/9900001', user);
  assert.equal(dup.status, 409); assert.equal(dup.body.code, 'DOC_AMBIGUOUS');
  state.heads116 = [head116];
  state.heads107 = [head107, { ...head107, SOInvID: 602 }];
  assert.equal((await app.call('GET', '/api/native-print/107/T69-00001', user)).status, 409);
  state.heads107 = [head107];
});

test('documents before the configured date cannot be opened or logged as printed', async () => {
  const before = state.printed.length;
  const cases = [
    [104, 'D-T1', 'heads104', head104],
    [116, '9900001', 'heads116', head116],
    [107, 'T69-00001', 'heads107', head107],
  ];
  try {
    for (const [type, no, key, head] of cases) {
      state[key] = [{ ...head, DocuDate: '2025-12-31' }];
      const path = `/api/native-print/${type}/${no}`;
      assert.equal((await app.call('GET', path, as('ADMIN'))).status, 404, path);
      assert.equal((await app.call('POST', path + '/printed', as('ADMIN'))).status, 404, path);
      state[key] = [{ ...head, DocuDate: '2026-01-01' }];
      assert.equal((await app.call('GET', path, as('ADMIN'))).status, 200, path);
    }
    assert.equal(state.printed.length, before);
  } finally {
    state.heads104 = [head104]; state.heads116 = [head116]; state.heads107 = [head107];
  }
});

test('a team-scoped manager sees only documents of their team', async () => {
  // MANAGER on the Organization Chart: team = own EmpID 7001 only
  assert.equal((await app.call('GET', '/api/native-print/116/9900001', as('MANAGER'))).status, 200);
  const other = await app.call('GET', '/api/native-print/107/T69-00001', as('MANAGER'));
  assert.equal(other.status, 404); assert.equal(other.body.code, 'DOC_NOT_FOUND');
});

test('opening a document only reads, and shows how often Sale-App printed it', async () => {
  const before = db.calls.length;
  const r = await app.call('GET', '/api/native-print/104/D-T1', as('WAREHOUSE'));
  assert.deepEqual(r.body.printLog, { count: 0, lastAt: null });
  const writes = db.calls.slice(before).filter(c => c.kind !== 'wfQuery' || /\b(INSERT|UPDATE|DELETE|MERGE)\b|\bEXEC\b(?! sp_executesql N\x27SELECT )/i.test(c.text));
  assert.deepEqual(writes, []);
});

test('pressing print logs one wf row per press, like the SMAudit print row of WinSpeed', async () => {
  const before = db.calls.length;
  let r = await app.call('POST', '/api/native-print/104/D-T1/printed', as('WAREHOUSE'));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.printLog, { count: 1, lastAt: '2026-11-01 09:30' });
  r = await app.call('POST', '/api/native-print/104/D-T1/printed', as('WAREHOUSE'));
  assert.equal(r.body.printLog.count, 2);
  assert.deepEqual(state.printed.map(p => [p.type, p.id, p.no, p.user]), [[104, 701, 'D-T1', 11], [104, 701, 'D-T1', 11]]);
  assert.equal((await app.call('GET', '/api/native-print/104/D-T1', as('ADMIN'))).body.printLog.count, 2);
  const writes = db.calls.slice(before).filter(c => c.kind !== 'wfQuery' || /\b(INSERT|UPDATE|DELETE|MERGE)\b|\bEXEC\b(?! sp_executesql N\x27SELECT )/i.test(c.text));
  assert.equal(writes.length, 2);
  for (const w of writes) assert.match(w.text, /^\s*INSERT INTO wf\.NativePrintLog \(DocType, DocId, DocuNo, PrintedBy\)/);
});

test('the print log follows the same capability, scope and duplicate rules as opening', async () => {
  const count = state.printed.length;
  assert.equal((await app.call('POST', '/api/native-print/107/T69-00001/printed', as('WAREHOUSE'))).status, 403);
  assert.equal((await app.call('POST', '/api/native-print/107/T69-00001/printed', as('MANAGER'))).status, 404, 'other team');
  assert.equal((await app.call('POST', '/api/native-print/116/' + encodeURIComponent("1'--") + '/printed', as('ADMIN'))).status, 400);
  state.heads116 = [head116, { ...head116, RedemtionID: 502 }];
  assert.equal((await app.call('POST', '/api/native-print/116/9900001/printed', as('ADMIN'))).status, 409);
  state.heads116 = [head116];
  assert.equal((await app.call('POST', '/api/native-print/116/9900001/printed')).status, 401);
  assert.equal(state.printed.length, count, 'nothing logged for refused requests');
  assert.equal((await app.call('POST', '/api/native-print/107/T69-00001/printed', as('ACCOUNTING'))).status, 200);
  assert.equal(state.printed.at(-1).id, 601);
});
