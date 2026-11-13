'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
const { stub: db } = h.installDbStub(() => [], { activeUserIds: h.TEST_USERS });
let persisted = [];
db.wfTransaction = async fn => {
  const before = [...persisted];
  const tx = { request() {
    const inputs = {};
    return { input(name, type, value) { inputs[name] = value; return this; }, async query(text) {
      if (/wf\.Oct31StandingPrice/.test(text)) {
        if (inputs.goodId === 2) throw new Error('simulated second-item failure');
        persisted.push(inputs.goodId);
        return { recordset: [{ Id: 1, StandingYear: 2026, GoodId: inputs.goodId, BasePrice: inputs.basePrice }] };
      }
      return { recordset: [] };
    } };
  } };
  try { return await fn(tx); } catch (error) { persisted = before; throw error; }
};
let app;
test.before(async () => { app = await h.startApp([['/api/rebate-pool', '../../routes/rebate-pool']]); });
test.after(async () => app.close());

test('a failed item rolls back all manually entered standing prices', async () => {
  const response = await app.call('POST', '/api/rebate-pool/oct31-prices/snapshot', {
    user: { sub: 1, role: 'ADMIN' },
    body: { standingYear: 2026, entries: [{ goodId: 1, basePrice: 100 }, { goodId: 2, basePrice: 200 }] },
  });
  assert.equal(response.status, 500);
  assert.deepEqual(persisted, []);
});
