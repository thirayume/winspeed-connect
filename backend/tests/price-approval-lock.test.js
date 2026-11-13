'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const db = h.installDbStub(({ text }) => {
  if (/SELECT \* FROM wf\.PriceApproval WHERE Id/.test(text)) return [{ Id: 9, SoId: 4, DocumentRevision: 2, RequestedBy: 19, Status: 'PENDING', GoodId: '17', RequestedPrice: 17800 }];
  if (/SELECT DocumentRevision, Status, DeliveryDate, RebateDiscountAmt FROM wf\.SalesOrder/.test(text)) return [{ DocumentRevision: 2, Status: 'DRAFT', DeliveryDate: null, RebateDiscountAmt: 0 }];
  if (/FROM wf\.SalesOrderLine WITH/.test(text)) return [{ GoodId: '17', QtyTon: 1, PricePerTon: 17800 }];
  if (/UPDATE wf\.PriceApproval\s+SET Status/.test(text)) return { recordset: [], rowsAffected: [1] };
  if (/SELECT COUNT\(\*\) AS Cnt FROM wf\.PriceApproval/.test(text)) return [{ Cnt: 0 }];
  if (/UPDATE wf\.SalesOrder SET PriceApprovalStatus/.test(text)) return { recordset: [], rowsAffected: [1] };
  return [];
}, { activeUserIds: h.TEST_USERS });
const costPath = require.resolve('../services/cost-authority');
let failCostCheck = false;
require.cache[costPath] = { id: costPath, filename: costPath, loaded: true, exports: { assertPricesAboveCost: async () => { if (failCostCheck) throw Object.assign(new Error('blocked'), { status: 422 }); } } };
let app;
test.before(async () => { app = await h.startApp([['/api/edit-requests', '../../routes/edit-requests']]); });
test.after(async () => app.close());

for (const action of ['approve', 'reject']) test(`${action} locks the draft until the decision commits`, async () => {
  const before = db.calls.length;
  const response = await app.call('PATCH', `/api/edit-requests/price-approvals/9/${action}`, {
    user: { sub: 1, role: 'ADMIN' }, body: { note: 'test reason' },
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const calls = db.calls.slice(before);
  const header = calls.find(c => /SELECT DocumentRevision, Status, DeliveryDate, RebateDiscountAmt FROM wf\.SalesOrder/.test(c.text));
  const lines = calls.find(c => /FROM wf\.SalesOrderLine WITH/.test(c.text));
  const write = calls.find(c => /UPDATE wf\.PriceApproval\s+SET Status/.test(c.text));
  assert.equal(header.kind, 'tx');
  assert.match(header.text, /WITH \(UPDLOCK, HOLDLOCK\)/);
  assert.ok(calls.indexOf(header) < calls.indexOf(write));
  if (action === 'approve') {
    assert.equal(lines.kind, 'tx');
    assert.match(lines.text, /WITH \(HOLDLOCK\)/);
    assert.doesNotMatch(lines.text, /NOLOCK/);
    assert.ok(calls.indexOf(header) < calls.indexOf(lines) && calls.indexOf(lines) < calls.indexOf(write));
  } else assert.equal(lines, undefined);
});

test('a below-cost request may be rejected but cannot be approved', async () => {
  failCostCheck = true;
  try {
    const options = { user: { sub: 1, role: 'ADMIN' }, body: { note: 'test reason' } };
    assert.equal((await app.call('PATCH', '/api/edit-requests/price-approvals/9/approve', options)).status, 422);
    assert.equal((await app.call('PATCH', '/api/edit-requests/price-approvals/9/reject', options)).status, 200);
  } finally { failCostCheck = false; }
});
