'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getShipmentCustomerOverview } = require('../services/rebate-shipment-customer-overview');
const options = { epoch: { environment: 'uat', generation: 1, resetId: 'abc' },
  scope: { sql: 'SalesEmpId=@scopeEmp', inputs: { scopeEmp: 'E1' } },
  asOfDate: '2026-11-14', cutoff: '2026-01-01', cycleMonths: 12, limit: 2, search: 'ลูกค้า' };
test('overview pages by customer, preserves scope and uses verified queue including opening amounts', async () => {
  let sql, inputs; const calls = [];
  const query = async (text, params) => { sql = text; inputs = params; return { recordset: [
    { CustId: 1, CustCode: 'A', CustName: 'ลูกค้า A' }, { CustId: 2, CustCode: 'B', CustName: 'ลูกค้า B' },
    { CustId: 3, CustCode: 'C', CustName: 'ลูกค้า C' }] }; };
  const result = await getShipmentCustomerOverview(query, options, { getQueue: async (_q, o) => {
    calls.push(o.custId); assert.equal(o.scope, options.scope); assert.equal(o.cutoff, '2026-01-01');
    return { totalFifoEligibleBalance: o.custId * 100, openingEligibleBalance: 50 };
  } });
  assert.match(sql, /SalesEmpId=@scopeEmp/); assert.equal(inputs.scopeEmp, 'E1');
  assert.equal(inputs.search, 'ลูกค้า'); assert.equal(inputs.take, 3);
  assert.deepEqual(calls, [1, 2]); assert.equal(result.items[0].balance, 100);
  assert.equal(result.items[0].openingBalance, 50); assert.equal(result.nextAfter, 2);
});
test('changed source is shown for review without fabricating zero; lock and infrastructure errors fail page', async () => {
  const query = async () => ({ recordset: [{ CustId: 1 }] });
  const result = await getShipmentCustomerOverview(query, options, { getQueue: async () => {
    throw Object.assign(new Error('source changed'), { code: 'REBATE_RESERVATION_SOURCE_CHANGED', status: 409 });
  } });
  assert.equal(result.items[0].status, 'needs_review'); assert.equal(result.items[0].balance, null);
  await assert.rejects(getShipmentCustomerOverview(query, options, { getQueue: async () => {
    throw Object.assign(new Error('lock'), { code: 'REBATE_RESERVATION_LOCK_UNAVAILABLE', status: 409 });
  } }), { code: 'REBATE_RESERVATION_LOCK_UNAVAILABLE' });
});
test('invalid input and partial or corrupt balances fail closed', async () => {
  const query = async () => ({ recordset: [{ CustId: 1 }] });
  await assert.rejects(getShipmentCustomerOverview(query, { ...options, limit: 100 }), { code: 'INVALID_REBATE_OVERVIEW' });
  await assert.rejects(getShipmentCustomerOverview(query, options, { getQueue: async () => ({ totalFifoEligibleBalance: 2, openingEligibleBalance: 3 }) }),
    { code: 'REBATE_OVERVIEW_SOURCE_INVALID' });
});
