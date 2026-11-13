'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readRebateCycleMonths } = require('../services/rebate-cycle-policy');

test('cycle policy reads the selected database, locks when requested, and defaults only when absent', async () => {
  const query = async text => { assert.match(text, /WITH \(HOLDLOCK\)/); return { recordset: [{ SettingValue: '6' }] }; };
  assert.equal(await readRebateCycleMonths(query, { lock: true }), 6);
  assert.equal(await readRebateCycleMonths(async () => ({ recordset: [] })), 12);
});

test('invalid or unavailable cycle policy fails closed', async () => {
  await assert.rejects(readRebateCycleMonths(async () => ({ recordset: [{ SettingValue: '12x' }] })), { code: 'INVALID_REBATE_CYCLE' });
  await assert.rejects(readRebateCycleMonths(async () => { throw Error('DB unavailable'); }), /DB unavailable/);
});
