'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers/route-harness.cjs').installDbStub(() => []);
const { runNativeDocumentsReport } = require('../routes/reports.js').__testing;

const chain = {
  SOID: 501, BookingNo: 'I69-00501', BookingAt: '2026-10-31 00:46', Line: 'I', CustName: 'Test Customer',
  ConfirmedById: 11, ConfirmedActorId: 11,
  AiNo: 'AI69-00001', AiUserId: 11, AiActorId: 11, AiSelf: true, AiAt: '2026-10-31 00:47',
  CreditState: 'CONSUMED', CreditUserId: 22, CreditActorId: 99, CreditSelf: false,
  DeliveryNo: 'I69-00601', CouponNo: 'C6900001', DeliveryUserId: 11, DeliveryActorId: 11, DeliveryAt: '2026-10-31 00:48',
  SlipNo: '9900501', SlipSource: 'SCALE', ExceptionRequired: false, RedemptionState: 'CONSUMED',
  RedReqUserId: 22, RedReqActorId: 22, RedApprUserId: 22, RedApprActorId: 22, RedSelf: true,
  RecorderEmp: 'EMP-T1', ApproverEmp: 'EMP-T1', RedemptionAt: '2026-10-31 00:50',
  InvoiceNo: 'J69-00701', InvoiceDate: '2026-10-31', InvoiceUserId: 22, InvoiceActorId: 22,
};
const users = [{ Id: 11, Username: 'sales.t', DisplayName: 'Sales T' }, { Id: 22, Username: 'acct.t', DisplayName: null }, { Id: 99, Username: 'admin.t', DisplayName: 'Admin T' }];

function fake(rows = [chain]) {
  const calls = [];
  const queryFn = async (text, inputs) => {
    calls.push({ text, inputs });
    if (/FROM wf\.AppUser WHERE Id IN/.test(text)) return { recordset: users };
    return { recordset: rows };
  };
  return { calls, queryFn };
}

test('the report follows each app booking through AI, 104, 116 and 107 with real actors', async () => {
  const f = fake();
  const { rows, meta } = await runNativeDocumentsReport({ from: '2026-10-30', to: '2026-10-31', book: 'i' }, { queryFn: f.queryFn });
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.Stage, '107 แล้ว');
  assert.equal(r.AiBy, 'Sales T (อนุมัติเอง)');
  assert.equal(r.CreditBy, 'acct.t · ทำแทนโดย Admin T');
  assert.equal(r.CreditStatus, 'ใช้แล้ว');
  assert.equal(r.SlipSource, 'ตาชั่ง (MoveBill)');
  assert.equal(r.SlipException, 'ไม่ใช่');
  assert.equal(r.RedemptionApprovedBy, 'acct.t (อนุมัติเอง)');
  assert.equal(r.RecorderEmp, 'EMP-T1');
  assert.deepEqual(meta, { from: '2026-10-30', to: '2026-10-31', book: 'I', isTruncated: false });
  const main = f.calls[0];
  assert.equal(main.inputs.book.value, 'I');
  assert.equal(main.inputs.from.value, '2026-10-30');
  assert.match(main.text, /FROM wf\.NativeBookingOrigin o/);
  assert.match(main.text, /LEFT JOIN wf\.NativeDocumentApproval na ON na\.DocuType=116/);
  assert.doesNotMatch(main.text, /\b(INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i);
  assert.match(f.calls[1].text, /WHERE Id IN \(11,22,99\)\)?$/);
});

test('stages, typed slips and unknown filters are reported safely', async () => {
  const typed = { ...chain, InvoiceNo: null, InvoiceUserId: null, SlipSource: 'MANUAL', ExceptionRequired: true, RedSelf: false, RedApprUserId: 44, RedApprActorId: 44 };
  const early = { ...chain, AiNo: null, AiUserId: null, DeliveryNo: null, SlipNo: null, SlipSource: null, ExceptionRequired: null, RedemptionAt: null, RedemptionState: null, InvoiceNo: null };
  const f = fake([typed, early]);
  const { rows } = await runNativeDocumentsReport({ book: 'X; DROP', limit: '999999' }, { queryFn: f.queryFn });
  assert.equal(rows[0].Stage, '116 แล้ว');
  assert.equal(rows[0].SlipSource, 'กรอกเอง');
  assert.equal(rows[0].SlipException, 'ใช่');
  assert.equal(rows[0].RedemptionApprovedBy, '#44');
  assert.equal(rows[1].Stage, 'ยืนยันทริปแล้ว');
  assert.equal(rows[1].SlipException, null);
  assert.equal(f.calls[0].inputs.book.value, '');
  assert.equal(f.calls[0].inputs.limit.value, 5000);
});
