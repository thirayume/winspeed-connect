'use strict';

/**
 * UAT batch 4 approvals — fixes found live:
 *  APV-07 new-customer request answers 201 with the new id (it saved the row, then threw and answered 500);
 *  APV-06 approval policies resolve on the Bangkok business date (UTC hid "effective today" before 07:00);
 *  APV-02 an unlock request is taken only for a bill in PICKING (the only stage the approver can unlock).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const bills = { 701: 'PICKING', 702: 'CONFIRMED' };
const db = h.installDbStub(({ text, inputs }) => {
  if (/INSERT INTO wf\.CustomerRequest/.test(text)) return [{ Id: 55 }];
  if (/FROM wf\.ApprovalPolicy/.test(text)) return [{ Id: 5, RequiredRole: 'MANAGER' }];
  if (/FROM wf\.v_AllSalesOrders WHERE CAST\(Id AS INT\) = @id/.test(text)) {
    return bills[inputs.id] ? [{ Id: inputs.id, Status: bills[inputs.id], SalesUserId: 34, ImportedDocuNo: null, WfRef: 'I69-07' + inputs.id }] : [];
  }
  return [];
});

let app;
test.before(async () => { app = await h.startApp([['/api/master', '../../routes/master'], ['/api/so', '../../routes/so']]); });
test.after(async () => { await app.close(); });

test('APV-07: a new-customer request answers 201 with its id', async () => {
  const r = await app.call('POST', '/api/master/customer-requests', { body: { CustName: 'ร้านทดสอบ' }, user: { sub: 34, role: 'SALES' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.id, 55);
});

test('APV-06: the policy lookup uses the Bangkok business date', async () => {
  const { resolveApprovalPolicy } = require('../services/approval');
  const before = db.calls.length;
  await resolveApprovalPolicy('CREDIT_OVERRIDE');
  const call = db.calls.slice(before).find(c => /FROM wf\.ApprovalPolicy/.test(c.text));
  const bkk = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  assert.equal(new Date(call.inputs.d).toISOString().slice(0, 10), bkk);
});

test('APV-02: an unlock request is refused unless the bill is in PICKING', async () => {
  const no = await app.call('POST', '/api/so/702/unlock-request', { body: { reason: 'ขอปลดล็อกทดสอบ', reqType: 'UNLOCK' }, user: { sub: 34, role: 'SALES' } });
  assert.equal(no.status, 409);
  const yes = await app.call('POST', '/api/so/701/unlock-request', { body: { reason: 'ขอปลดล็อกทดสอบ', reqType: 'UNLOCK' }, user: { sub: 34, role: 'SALES' } });
  assert.equal(yes.status, 200, JSON.stringify(yes.body));
});
