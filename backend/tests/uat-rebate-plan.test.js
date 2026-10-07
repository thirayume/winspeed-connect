'use strict';

/**
 * UAT batch 6 (APV-03) — a rebate plan reaches APPROVED only through its approval chain:
 *  ACTIVE follows APPROVED (it was settable straight from a draft), nothing signed can be edited after submit,
 *  and a budget is allocated from an approved plan only. Accrual tags approved plans too (it matched ACTIVE only).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const plans = { 1: 'DRAFT', 2: 'TIER2_PENDING', 3: 'APPROVED', 4: 'REJECTED' };
h.installDbStub(({ text, inputs }) => {
  if (/SELECT Status FROM wf\.RebatePlan WHERE PlanId = @id/.test(text)) return plans[inputs.id] ? [{ Status: plans[inputs.id] }] : [];
  if (/FROM wf\.RebatePool WHERE SalesUserId/.test(text)) return [{ Id: 9 }];
  if (/UPDATE wf\.RebatePlan SET/.test(text)) return { recordset: [], rowsAffected: [1] };
  return [];
});

let app;
test.before(async () => { app = await h.startApp([['/api/rebate', '../../routes/rebate']]); });
test.after(async () => { await app.close(); });
const mgr = { sub: 25, role: 'MANAGER' };

test('ACTIVE only after APPROVED', async () => {
  assert.equal((await app.call('PATCH', '/api/rebate/plans/1', { body: { status: 'ACTIVE' }, user: mgr })).status, 409);
  assert.equal((await app.call('PATCH', '/api/rebate/plans/3', { body: { status: 'ACTIVE' }, user: mgr })).status, 200);
});

test('the plan definition is editable only as a draft or when returned', async () => {
  assert.equal((await app.call('PATCH', '/api/rebate/plans/2', { body: { netPrice: 1 }, user: mgr })).status, 409);
  assert.equal((await app.call('PATCH', '/api/rebate/plans/3', { body: { allocatedAmount: 999999 }, user: mgr })).status, 409);
  assert.equal((await app.call('PATCH', '/api/rebate/plans/4', { body: { netPrice: 19000 }, user: mgr })).status, 200);
  assert.equal((await app.call('PATCH', '/api/rebate/plans/3', { body: { title: 'ชื่อใหม่' }, user: mgr })).status, 200);
});

test('a budget comes from an approved plan only', async () => {
  assert.equal((await app.call('POST', '/api/rebate/plans/1/allocate', { body: { salesUserId: 43, amount: 1000 }, user: mgr })).status, 409);
  assert.equal((await app.call('POST', '/api/rebate/plans/3/allocate', { body: { salesUserId: 43, amount: 1000 }, user: mgr })).status, 200);
  assert.equal((await app.call('POST', '/api/rebate/plans/3/allocate', { body: { salesUserId: 43, amount: -5 }, user: mgr })).status, 400);
});
