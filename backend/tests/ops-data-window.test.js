'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
let failErrors = false;
const db = h.installDbStub(({ text }) => {
  if (/FROM wf\.ErrorLog/.test(text) && failErrors) throw new Error('database unavailable');
  if (/FROM wf\.OutboxEvent GROUP BY Status/.test(text)) return [{ Status: 'PENDING', n: 2 }];
  if (/FROM wf\.ErrorLog/.test(text)) return [{ Id: 2 }];
  return [];
}, { activeUserIds: h.TEST_USERS });
const windowPath = require.resolve('../services/global-data-window-store');
let windowUnavailable = false;
require.cache[windowPath].exports.readGlobalDataWindow = async () => {
  if (windowUnavailable) throw new Error('setting unavailable');
  return require('../services/data-window').boundaries('2026-01-01');
};
const obs = require('../services/observability');
let app;
const admin = { sub: 1, role: 'ADMIN' };
test.before(async () => { app = await h.startApp([['/api/ops', '../../routes/ops']]); });
test.after(async () => app.close());
test.beforeEach(() => { db.calls.length = 0; failErrors = false; windowUnavailable = false; });

test('error history applies the Bangkok boundary in SQL', async () => {
  const r = await app.call('GET', '/api/ops/errors?limit=10', { user: admin });
  assert.equal(r.status, 200);
  const call = db.calls.find(c => /FROM wf\.ErrorLog/.test(c.text));
  assert.match(call.text, /OccurredAt >= @globalStartUtc/);
  assert.equal(call.inputs.globalStartUtc.toISOString(), '2025-12-31T17:00:00.000Z');
});

test('error fallback does not expose older or undated memory entries', async () => {
  const original = obs.getRecentErrors;
  obs.getRecentErrors = () => [
    { at: '2025-12-31T16:59:59.000Z', message: 'old' },
    { at: '2025-12-31T17:00:00.000Z', message: 'new' },
    { at: 'invalid', message: 'unknown' },
  ];
  failErrors = true;
  try {
    const r = await app.call('GET', '/api/ops/errors', { user: admin });
    assert.equal(r.status, 200);
    assert.equal(r.body.source, 'memory');
    assert.deepEqual(r.body.errors.map(item => item.message), ['new']);
  } finally { obs.getRecentErrors = original; }
});

test('missing cutoff fails closed without returning memory or querying history', async () => {
  windowUnavailable = true;
  const r = await app.call('GET', '/api/ops/errors', { user: admin });
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'DATA_WINDOW_UNAVAILABLE');
  assert.ok(!db.calls.some(c => /FROM wf\.ErrorLog/.test(c.text)));
  const outbox = await app.call('GET', '/api/ops/outbox', { user: admin });
  assert.equal(outbox.status, 503);
  assert.equal(outbox.body.code, 'DATA_WINDOW_UNAVAILABLE');
  assert.ok(!db.calls.some(c => /FROM wf\.OutboxEvent/.test(c.text)));
});

test('outbox keeps all pending work in summary while bounding the history', async () => {
  const r = await app.call('GET', '/api/ops/outbox', { user: admin });
  assert.equal(r.status, 200);
  assert.equal(r.body.summary[0].n, 2);
  const summary = db.calls.find(c => /FROM wf\.OutboxEvent GROUP BY/.test(c.text));
  const recent = db.calls.find(c => /FROM wf\.OutboxEvent WHERE/.test(c.text));
  assert.doesNotMatch(summary.text, /globalStart/);
  assert.match(recent.text, /CreatedAt >= @globalStartUtc/);
  assert.equal(recent.inputs.globalStartUtc.toISOString(), '2025-12-31T17:00:00.000Z');
});

test('activity rejects old and invalid dates before reading activity', async () => {
  const original = obs.getUserActivity;
  let calls = 0;
  obs.getUserActivity = async date => { calls++; return { date }; };
  try {
    assert.equal((await app.call('GET', '/api/ops/user-activity?date=2025-12-31', { user: admin })).status, 400);
    assert.equal((await app.call('GET', '/api/ops/user-activity?date=2026-02-30', { user: admin })).status, 400);
    assert.equal(calls, 0);
    const r = await app.call('GET', '/api/ops/user-activity?date=2026-01-01', { user: admin });
    assert.equal(r.status, 200); assert.equal(r.body.date, '2026-01-01'); assert.equal(calls, 1);
  } finally { obs.getUserActivity = original; }
});
