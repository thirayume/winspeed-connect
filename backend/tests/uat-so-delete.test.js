'use strict';

/**
 * UAT batch 4, SO-14 — deleting a draft closes its open price approvals in the same transaction, so the
 * manager's approval queue never shows a request for a bill that no longer exists.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const db = h.installDbStub(({ text, inputs }) => {
  if (/FROM wf\.v_AllSalesOrders WHERE CAST\(Id AS INT\) = @id/.test(text)) {
    return inputs.id === 900 ? [{ Id: 900, Status: 'DRAFT', SalesUserId: 34, ImportedDocuNo: null, WfRef: 'I69-09000' }] : [];
  }
  if (/FROM wf\.EditReason\s+WHERE ReasonCode = @code/.test(text)) {
    return inputs.code === 'SO_DELETED' ? [{ ReasonCode: 'SO_DELETED', ReasonText: 'ลบบิล', AppliesTo: 'SO_DELETE', IsActive: 1 }] : [];
  }
  return [];
});

let app;
test.before(async () => { app = await h.startApp([['/api/so', '../../routes/so']]); });
test.after(async () => { await app.close(); });

test('SO-14: delete draft → its PENDING price approvals are superseded before the draft row goes', async () => {
  const before = db.calls.length;
  const r = await app.call('DELETE', '/api/so/900', { body: { reasonCode: 'SO_DELETED', reason: 'UAT' }, user: { sub: 34, role: 'SALES' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const calls = db.calls.slice(before);
  const close = calls.findIndex(c => /UPDATE wf\.PriceApproval SET Status = 'SUPERSEDED'.*WHERE SoId = @id AND Status = 'PENDING'/s.test(c.text));
  const drop = calls.findIndex(c => /DELETE FROM wf\.SalesOrder WHERE Id=@id/.test(c.text));
  assert.ok(close >= 0, 'approvals closed');
  assert.ok(drop > close, 'closed before the draft is deleted');
  assert.equal(calls[close].kind, 'tx', 'inside the delete transaction');
});
