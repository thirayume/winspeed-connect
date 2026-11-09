'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const obs = require('../services/observability');
const db = require('../db');

test.after(async () => {
  await db.closeAll();
});

test('recordUserActivity and getUserActivity slot calculation', async () => {
  obs.recordUserActivity(101);
  obs.recordUserActivity(101);
  obs.recordUserActivity(102);

  const summary = await obs.getUserActivity();
  assert.ok(summary);
  assert.ok(Array.isArray(summary.slots));
  assert.equal(summary.slots.length, 96);
  assert.ok(summary.date);
});

test('clearErrors resets error counters', async () => {
  obs.recordError({ level: 'ERROR', message: 'Test error', status: 500 });
  assert.ok(obs.getStatus().errors > 0);

  const res = await obs.clearErrors();
  assert.equal(res.ok, true);
  assert.equal(obs.getStatus().errors, 0);
  assert.equal(obs.getRecentErrors().length, 0);
});
