'use strict';
// The background poll must not run the legacy 1 November conversion alert job. That job
// works on the standalone wf.RebateTransactionLedger, and its manual route is closed with
// REBATE_SHARED_ALERT_UNAVAILABLE until a notification job exists for the shared balance.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadPolling() {
  const seen = { modules: [], sql: [], errors: [], warnings: [] };
  const record = text => { seen.sql.push(String(text)); return Promise.resolve([]); };
  const sandbox = {
    module: { exports: {} },
    console: { log() {}, warn(...a) { seen.warnings.push(a.join(' ')); }, error(...a) { seen.errors.push(a.join(' ')); } },
    setInterval, clearInterval, Date, Promise,
    require(name) {
      seen.modules.push(name);
      if (name === '../db') return { query: record, wfQuery: record };
      if (name === './socket') return { broadcast() {} };
      if (name === './pricebook-winspeed-sync') return { reconcileFromWinSpeed: async () => ({ changed: false }) };
      throw new Error(`unexpected module: ${name}`);
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/polling.js'), 'utf8'), sandbox);
  return { poll: sandbox.module.exports.pollOnce, seen };
}

test('a poll round does not load or run the legacy rebate conversion alert job', async () => {
  const { poll, seen } = loadPolling();
  await poll();
  await poll();
  assert.ok(!seen.modules.includes('./rebate-conversion-service'), 'the legacy conversion service must not be loaded by the poll');
  assert.deepEqual(seen.errors, [], 'a poll round must not log an error');
  assert.ok(seen.sql.length > 0, 'the other poll checks still query the database');
  for (const text of seen.sql) {
    assert.doesNotMatch(text, /RebateTransactionLedger|RebateConversionAlert/i);
    assert.doesNotMatch(text, /\b(UPDATE|INSERT|DELETE)\b/i, 'the poll only reads');
  }
});

test('the manual route of the same legacy job stays closed', () => {
  const route = fs.readFileSync(path.join(__dirname, '../routes/rebate-pool.js'), 'utf8');
  const start = route.indexOf("router.post('/alerts/check'");
  assert.ok(start > 0);
  const body = route.slice(start, route.indexOf('});', start));
  assert.match(body, /REBATE_SHARED_ALERT_UNAVAILABLE/);
  assert.doesNotMatch(body, /runNovember1ConversionAlertCheck/);
});
