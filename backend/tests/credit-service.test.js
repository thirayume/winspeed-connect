const test = require('node:test');
const assert = require('node:assert/strict');
const { checkCustomerCreditAndAging, fmt } = require('../services/credit-service');

test('fmt: formats currency numbers accurately in Thai locale', () => {
  assert.equal(fmt(1000), '1,000.00');
  assert.equal(fmt(1234567.89), '1,234,567.89');
  assert.equal(fmt(0), '0.00');
});

test('checkCustomerCreditAndAging: returns clean empty structure on blank custId', async () => {
  const res = await checkCustomerCreditAndAging('');
  assert.equal(res.ok, true);
  assert.equal(res.blocked, false);
  assert.equal(res.warnings.length, 0);
  assert.equal(res.anomalies.length, 0);
});

