'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { retryOnDeadlock } = require('../services/db-retry');

const deadlock = () => Object.assign(new Error('was deadlocked ... chosen as the deadlock victim'), { number: 1205 });

test('a read that loses a deadlock runs again', async () => {
  let calls = 0;
  const out = await retryOnDeadlock(async () => {
    calls += 1;
    if (calls < 3) throw deadlock();
    return 'rows';
  }, { waitMs: 1 });
  assert.equal(out, 'rows');
  assert.equal(calls, 3);
});

test('it stops after the last try and reports the deadlock', async () => {
  let calls = 0;
  await assert.rejects(retryOnDeadlock(async () => { calls += 1; throw deadlock(); }, { tries: 2, waitMs: 1 }), /deadlock/);
  assert.equal(calls, 2);
});

test('other errors are not run again', async () => {
  let calls = 0;
  await assert.rejects(retryOnDeadlock(async () => { calls += 1; throw new Error('Invalid column name'); }), /Invalid column/);
  assert.equal(calls, 1);
});
