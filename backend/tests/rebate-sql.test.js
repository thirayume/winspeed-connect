'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
const db = h.installDbStub(({ text }) => {
  if (/FROM dbo\.SOInvHD i/.test(text)) return [{ MaxOverdueDays: 0, MissingDateCount: 0 }];
  if (/FROM wf\.FertilizerTicket WITH \(UPDLOCK/.test(text)) return [];
  return [];
});
const { redeemTickets } = require('../services/rebate-ticket-service');
const { normalizeInputs } = require('../services/rebate-sql');
const sql = require('../db').sql;

test('default rebate transaction uses tx.request and binds raw parameters', async () => {
  await assert.rejects(redeemTickets(undefined, { custId: 1, requestedTonnage: 1, actorUser: { id: 1, role: 'ADMIN' } }), { code: 'NO_ACTIVE_TICKETS' });
  const query = db.calls.find(c => c.kind === 'tx' && /FROM wf\.FertilizerTicket WITH \(UPDLOCK/.test(c.text));
  assert.ok(query); assert.equal(query.inputs.custId, 1);
});

test('adapter accepts explicitly typed and raw parameters and rejects non-finite values', () => {
  const values = normalizeInputs(sql, { id: 7, qty: 1.25, text: 'test', none: null, active: true,
    explicit: { type: sql.Int, value: 2 } });
  assert.equal(values.id.value, 7); assert.equal(values.qty.value, 1.25);
  assert.equal(values.explicit.type, sql.Int); assert.equal(values.none.value, null);
  assert.throws(() => normalizeInputs(sql, { qty: Infinity }), /Invalid numeric/);
});
