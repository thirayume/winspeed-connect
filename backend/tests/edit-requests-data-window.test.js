'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

let raceFixture = false;
const db = h.installDbStub(({ text, inputs }) => {
  if (raceFixture && /SELECT 1 AS ok FROM wf\.EditRequest/.test(text)) return [{ ok: 1 }];
  if (raceFixture && /SELECT \* FROM wf\.EditRequest WHERE Id/.test(text)) return [{ Id: 1, Status: 'PENDING', RequestedBy: 12, SOID: null }];
  if (raceFixture && /UPDATE\s+wf\.EditRequest/i.test(text)) return { recordset: [], rowsAffected: [0] };
  if (/FROM\s+wf\.(EditRequest r|PriceApproval pa|TripMultiCustomerApproval a)/.test(text) && /@globalStartUtc/.test(text)) {
    const rows = [
      { Id: 1, When: new Date('2025-12-31T16:59:59Z') },
      { Id: 2, When: new Date('2025-12-31T17:00:00Z') },
    ];
    return rows.filter(row => row.When >= inputs.globalStartUtc);
  }
  return [];
}, { activeUserIds: h.TEST_USERS });
let app;
test.before(async () => { app = await h.startApp([['/api/edit-requests', '../../routes/edit-requests']]); });
test.after(async () => { await app.close(); });

test('request and approval lists use the same Bangkok midnight boundary', async () => {
  const user = { sub: 12, role: 'ADMIN' };
  const routes = [
    ['/api/edit-requests', /r\.RequestedAt >= @globalStartUtc/],
    ['/api/edit-requests/price-approvals', /pa\.CreatedAt >= @globalStartUtc/],
    ['/api/edit-requests/trip-approvals', /a\.CreatedAt >= @globalStartUtc/],
  ];
  for (const [url, predicate] of routes) {
    const start = db.calls.length;
    const response = await app.call('GET', url, { user });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(response.body.data.map(row => row.id), [2]);
    const query = db.calls.slice(start).find(call => predicate.test(call.text));
    assert.ok(query, `${url} must apply cutoff in SQL`);
    assert.equal(query.inputs.globalStartUtc.toISOString(), '2025-12-31T17:00:00.000Z');
  }
});

test('a concurrent status change prevents approval and cancellation side effects', async () => {
  raceFixture = true;
  try {
    for (const [action, id] of [['approve', 19], ['cancel', 12]]) {
      const before = db.calls.length;
      const response = await app.call('PATCH', `/api/edit-requests/1/${action}`, { user: { sub: id, role: 'ADMIN' }, body: {} });
      assert.equal(response.status, 409, JSON.stringify(response.body));
      const calls = db.calls.slice(before);
      const update = calls.find(call => /UPDATE\s+wf\.EditRequest/i.test(call.text));
      assert.match(update.text, /RequestedAt >= @globalStartUtc/);
      assert.ok(!calls.some(call => /UPDATE\s+wf\.SalesOrderExt/i.test(call.text)));
    }
  } finally { raceFixture = false; }
});

test('Access As cannot approve the actual actor’s own request', async () => {
  raceFixture = true;
  try {
    const before = db.calls.length;
    const response = await app.call('PATCH', '/api/edit-requests/1/approve', {
      user: { sub: 19, role: 'ADMIN', actorSub: 12, actorRole: 'ADMIN' }, body: {},
    });
    assert.equal(response.status, 403, JSON.stringify(response.body));
    assert.ok(!db.calls.slice(before).some(call => /UPDATE\s+wf\.EditRequest/i.test(call.text)));
  } finally { raceFixture = false; }
});

test('old bookings cannot be opened or used to create a new edit request by direct ID', async () => {
  const user = { sub: 12, role: 'ADMIN' };
  for (const [method, url, body] of [
    ['GET', '/api/edit-requests/stage/123', undefined],
    ['POST', '/api/edit-requests', { soid: 123, reasonCode: 'TEST' }],
  ]) {
    const before = db.calls.length;
    const response = await app.call(method, url, { user, body });
    assert.equal(response.status, 404, JSON.stringify(response.body));
    const query = db.calls.slice(before).find(call => /s\.DocuDate >= @globalStartDate/.test(call.text));
    assert.ok(query);
    assert.equal(query.inputs.globalStartDate, '2026-01-01');
  }
});

test('direct review and cancellation of an older request fail without updating it', async () => {
  const user = { sub: 12, role: 'ADMIN' };
  for (const action of ['approve', 'reject', 'cancel']) {
    const before = db.calls.length;
    const response = await app.call('PATCH', `/api/edit-requests/1/${action}`, { user, body: { note: 'Test only' } });
    assert.equal(response.status, 404, JSON.stringify(response.body));
    const calls = db.calls.slice(before);
    assert.ok(calls.some(call => /RequestedAt >= @globalStartUtc/.test(call.text)));
    assert.ok(!calls.some(call => /UPDATE\s+wf\.EditRequest/i.test(call.text)));
  }
});

test('old price and trip approvals cannot be reviewed through a direct URL', async () => {
  const user = { sub: 12, role: 'ADMIN' };
  for (const kind of ['price-approvals', 'trip-approvals']) {
    for (const action of ['approve', 'reject']) {
      const before = db.calls.length;
      const response = await app.call('PATCH', `/api/edit-requests/${kind}/1/${action}`, { user, body: { note: 'test rejection' } });
      assert.equal(response.status, 404, JSON.stringify(response.body));
      const calls = db.calls.slice(before);
      assert.ok(calls.some(call => /SELECT \* FROM wf\.(PriceApproval|TripMultiCustomerApproval) WHERE Id = @id AND CreatedAt >= @globalStartUtc/.test(call.text)));
      assert.ok(!calls.some(call => /UPDATE\s+wf\.(PriceApproval|TripMultiCustomerApproval)/i.test(call.text)));
    }
  }
});
