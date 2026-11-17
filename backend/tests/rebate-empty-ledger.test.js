'use strict';
// After a Rebate reset the shipment ledger is empty. On UAT (17 Nov 2026) every customer then read as
// "out of scope" (404) and the bill form told sales the Rebate check failed on every bill. A customer
// with nothing in the new generation must read as "no Rebate", but only for a caller who may see that
// customer, and a customer whose lots belong to someone else's scope must still read as 404.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getShipmentCustomerQueueOrEmpty, assertEmptyQueueVisible } = require('../services/rebate-empty-ledger');

const epoch = { environment: 'uat', generation: 1, resetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', lastResetAtUtc: new Date('2026-11-17T08:08:53Z') };
const params = { epoch, custId: 123, asOfDate: '2026-11-17', cutoff: '2026-01-01', scope: { sql: '1=1', inputs: {} }, cycleMonths: 12 };
const outOfScope = () => Object.assign(new Error('REBATE_CUSTOMER_OUT_OF_SCOPE'), { code: 'REBATE_CUSTOMER_OUT_OF_SCOPE', status: 404 });

function accrualQuery(rows) {
  const calls = [];
  const query = async (text, inputs) => { calls.push({ text, inputs }); return { recordset: rows }; };
  return { query, calls };
}

test('a normal queue passes through untouched and asks nothing more', async () => {
  const { query, calls } = accrualQuery([]);
  const queue = { custId: 123, totalFifoEligibleBalance: 500 };
  assert.equal(await getShipmentCustomerQueueOrEmpty(query, params, { getQueue: async () => queue }), queue);
  assert.equal(calls.length, 0);
});

test('no accrual for the customer in this generation reads as an empty queue', async () => {
  const { query, calls } = accrualQuery([]);
  const queue = await getShipmentCustomerQueueOrEmpty(query, params, { getQueue: async () => { throw outOfScope(); } });
  assert.equal(queue.emptyLedger, true);
  assert.equal(queue.custId, 123);
  assert.equal(queue.totalFifoEligibleBalance, 0);
  assert.equal(queue.openingEligibleBalance, 0);
  assert.deepEqual(queue.eligibleLedgers, []);
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /FROM wf\.RebateShipmentAccrual a WITH\(HOLDLOCK\)/);
  assert.match(calls[0].text, /a\.EnvironmentKind=@environment AND a\.ResetId=@resetId AND a\.Generation=@generation AND a\.CustId=@custId/);
  // the existence check ignores the caller's scope on purpose: it only asks whether any lot exists
  assert.doesNotMatch(calls[0].text, /SalesEmpId|scope/i);
  assert.deepEqual(calls[0].inputs, { environment: 'uat', resetId: epoch.resetId, generation: 1, custId: 123 });
});

test('lots that exist but sit outside the caller scope keep the 404', async () => {
  const { query } = accrualQuery([{ Id: 9 }]);
  await assert.rejects(getShipmentCustomerQueueOrEmpty(query, params, { getQueue: async () => { throw outOfScope(); } }),
    e => e.code === 'REBATE_CUSTOMER_OUT_OF_SCOPE' && e.status === 404);
});

test('any other queue failure is passed on without a second query', async () => {
  const { query, calls } = accrualQuery([]);
  const changed = Object.assign(new Error('changed'), { code: 'REBATE_RESERVATION_SOURCE_CHANGED', status: 409 });
  await assert.rejects(getShipmentCustomerQueueOrEmpty(query, params, { getQueue: async () => { throw changed; } }), e => e === changed);
  assert.equal(calls.length, 0);
});

test('an empty queue is shown only to a caller who may see the customer', async () => {
  const user = { sub: 2, role: 'SALES' };
  const empty = { custId: 123, emptyLedger: true, totalFifoEligibleBalance: 0 };
  const seen = [];
  assert.equal(await assertEmptyQueueVisible(user, empty, { customerVisible: async (u, id) => { seen.push([u, id]); return true; } }), empty);
  assert.deepEqual(seen, [[user, 123]]);
  await assert.rejects(assertEmptyQueueVisible(user, empty, { customerVisible: async () => false }),
    e => e.code === 'REBATE_CUSTOMER_OUT_OF_SCOPE' && e.status === 404);
  // a real queue never triggers the visibility check
  const real = { custId: 123, totalFifoEligibleBalance: 10 };
  assert.equal(await assertEmptyQueueVisible(user, real, { customerVisible: async () => { throw new Error('not expected'); } }), real);
});

test('the bill-form check, the balance and the Rebate page queue all use it', () => {
  const so = fs.readFileSync(path.join(__dirname, '../routes/so.js'), 'utf8');
  const availability = so.slice(so.indexOf("router.get('/rebate-availability/:custId'"), so.indexOf("router.get('/rebate-balance/:custId'"));
  assert.match(availability, /getShipmentCustomerQueueOrEmpty\(q,\{epoch,custId,scope,cutoff,cycleMonths,/);
  assert.match(availability, /assertEmptyQueueVisible\(req\.user,queue\);\s*if\(!Number\.isFinite\(queue\.totalFifoEligibleBalance\)/);
  assert.doesNotMatch(availability, /rebate-shipment-queue'\)\.getShipmentCustomerQueue/);
  const balance = so.slice(so.indexOf("router.get('/rebate-balance/:custId'"), so.indexOf("router.get('/shipped-today'"));
  assert.match(balance, /getShipmentCustomerQueueOrEmpty\(q, \{/);
  assert.match(balance, /assertEmptyQueueVisible\(req\.user, queue\);/);
  const pool = fs.readFileSync(path.join(__dirname, '../routes/rebate-pool.js'), 'utf8');
  const page = pool.slice(pool.indexOf("router.get('/queue/:custId'"), pool.indexOf("router.get('/alerts'"));
  assert.match(page, /getShipmentCustomerQueueOrEmpty\(q,\{epoch,custId,asOfDate,cutoff,scope,cycleMonths:months\}\)/);
  assert.match(page, /res\.json\(await require\('\.\.\/services\/rebate-empty-ledger'\)\.assertEmptyQueueVisible\(req\.user,queue\)\)/);
});
