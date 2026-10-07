'use strict';

/**
 * UAT batch 6, F-02 — cancelling a bill gives back the rebate it used (only delete and bulk cancel did, for drafts):
 *  a claim applied to a draft is free again; a claim advanced to CN_ISSUED on a confirmed bill returns to APPROVED;
 *  accrual consumed by the bill's discount returns to the ledger through a reversing usage row.
 * An unlocked native bill reads DRAFT but is cancelled in WinSpeed (it took the draft branch and stayed live).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const bills = {
  900: { Id: 900, Status: 'DRAFT', SalesUserId: 34, ImportedDocuNo: null, WfRef: 'I69-09000', CustId: '1078' },
  278100: { Id: '278100', Status: 'PENDING_APPROVAL', SalesUserId: 34, ImportedDocuNo: 'I69-05000', WfRef: 'I69-05000', CustId: '1078' },
  278101: { Id: '278101', Status: 'DRAFT', SalesUserId: 34, ImportedDocuNo: 'I69-05001', WfRef: 'I69-05001', CustId: '1078' },
};
const db = h.installDbStub(({ text, inputs }) => {
  if (/FROM wf\.v_AllSalesOrders WHERE CAST\(Id AS INT\) = @id/.test(text)) return bills[inputs.id] ? [bills[inputs.id]] : [];
  if (/FROM wf\.EditReason\s+WHERE ReasonCode = @code/.test(text)) {
    return inputs.code === 'SO_CANCELLED' ? [{ ReasonCode: 'SO_CANCELLED', ReasonText: 'ลูกค้ายกเลิก', AppliesTo: 'SO_CANCEL,SO_DELETE', IsActive: 1 }] : [];
  }
  return [];
});

let app;
test.before(async () => { app = await h.startApp([['/api/so', '../../routes/so']]); });
test.after(async () => { await app.close(); });
const cancel = (id) => app.call('PATCH', `/api/so/${id}/cancel`, { body: { reasonCode: 'SO_CANCELLED', reason: 'UAT ยกเลิก' }, user: { sub: 34, role: 'SALES' } });
const callsOf = async (id) => { const before = db.calls.length; const r = await cancel(id); assert.equal(r.status, 200, JSON.stringify(r.body)); return db.calls.slice(before); };

test('a draft: the applied claim is released', async () => {
  const calls = await callsOf(900);
  const rel = calls.find(c => /UPDATE wf\.RebateClaim/.test(c.text));
  assert.equal(rel.kind, 'tx');
  assert.equal(rel.inputs.draft, 1);
  assert.equal(rel.inputs.soId, 900);
  assert.ok(!calls.some(c => /INSERT INTO wf\.RebateUsage/.test(c.text)), 'no ledger reversal for a draft');
});

test('a confirmed bill: the CN_ISSUED claim returns to APPROVED and consumed accrual is reversed', async () => {
  const calls = await callsOf(278100);
  const rel = calls.find(c => /Status = 'APPROVED', RemainingAmt = ClaimAmt/.test(c.text));
  assert.equal(rel.inputs.draft, 0);
  assert.equal(rel.inputs.docuNo, 'I69-05000');
  assert.equal(rel.inputs.custId, '1078');
  const usage = calls.find(c => /INSERT INTO wf\.RebateUsage[\s\S]*-SUM\(DeductedAmt\)/.test(c.text));
  assert.equal(usage.inputs.soid, '278100');
  assert.ok(calls.some(c => /UPDATE dbo\.SOHD SET DocuStatus='C'/.test(c.text)));
});

test('an unlocked native bill (reads DRAFT) is cancelled in WinSpeed, not as a draft', async () => {
  const calls = await callsOf(278101);
  assert.ok(calls.some(c => /UPDATE dbo\.SOHD SET DocuStatus='C'/.test(c.text)), 'native document cancelled');
  assert.ok(!calls.some(c => /UPDATE wf\.SalesOrder SET Status='CANCELLED'/.test(c.text)));
});
