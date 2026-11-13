'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
let timelineFixture = false;
const db = h.installDbStub(({ text, inputs }) => {
  if (/SELECT \* FROM wf\.RuleIncident/.test(text)) return timelineFixture ? [{ Id: 1, SOID: 1, DocuNo: 'old-ref' }] : [];
  if (timelineFixture && /SELECT RTRIM\(h\.DocuNo\).*AppvDocuNo/s.test(text)) return [{ DocuNo: 'old-ref', AppvDocuNo: 'AI', DocuDate: new Date('2025-12-31T00:00:00Z') }];
  if (timelineFixture && /FROM wf\.SalesOrderAudit a/.test(text)) return [
    { CreatedAt: new Date('2025-12-31T16:59:59Z'), Action: 'CREATED' },
    { CreatedAt: new Date('2025-12-31T17:00:00Z'), Action: 'CONFIRMED' },
  ];
  if (timelineFixture && /SELECT RTRIM\(d\.DocuNo\).*d\.SOID/s.test(text)) return [
    { DocuNo: 'old-delivery', SOID: 2, DocuDate: new Date('2025-12-31T00:00:00Z') },
    { DocuNo: 'new-delivery', SOID: 3, DocuDate: new Date('2026-01-01T00:00:00Z') },
  ];
  if (timelineFixture && /SELECT RTRIM\(i\.DocuNo\).*i\.Docutype/s.test(text)) return [
    { DocuNo: 'old-invoice', DocuDate: new Date('2025-12-31T00:00:00Z') },
    { DocuNo: 'new-invoice', DocuDate: new Date('2026-01-01T00:00:00Z') },
  ];
  if (timelineFixture && /FROM dbo\.WGHD w/.test(text)) return [{ MoveBill: 'truck', DateIn: new Date('2025-12-31T23:00:00Z'), DateOut: new Date('2026-01-01T01:00:00Z') }];
  if (/UPDATE wf\.RuleIncident SET Status/.test(text)) return [{ Affected: 0 }];
  return [];
}, { activeUserIds: h.TEST_USERS });
let app;
test.before(async () => { app = await h.startApp([['/api/incidents', '../../routes/incidents']]); });
test.after(async () => { await app.close(); });

test('incident list, direct lookup and review share the UTC boundary', async () => {
  const user = { sub: 12, role: 'ACCOUNTING' };
  const before = db.calls.length;
  assert.equal((await app.call('GET', '/api/incidents', { user })).status, 200);
  assert.equal((await app.call('GET', '/api/incidents/1', { user })).status, 404);
  assert.equal((await app.call('PATCH', '/api/incidents/1/ack', { user, body: { note: 'Reviewed item' } })).status, 409);
  const calls = db.calls.slice(before).filter(c => /@globalStartUtc/.test(c.text));
  assert.equal(calls.length, 3);
  for (const c of calls) assert.equal(c.inputs.globalStartUtc.toISOString(), '2025-12-31T17:00:00.000Z');
});

test('incident date filters use Bangkok midnight and an exclusive next day', async () => {
  const before = db.calls.length;
  const response = await app.call('GET', '/api/incidents?from=2026-01-01&to=2026-01-01', { user: { sub: 12, role: 'ACCOUNTING' } });
  assert.equal(response.status, 200);
  const call = db.calls.slice(before).find(c => /FROM wf\.RuleIncident i/.test(c.text));
  assert.equal(call.inputs.from.toISOString(), '2025-12-31T17:00:00.000Z');
  assert.equal(call.inputs.toExclusive.toISOString(), '2026-01-01T17:00:00.000Z');
});

test('a recent incident does not expose historical linked records or timeline events', async () => {
  timelineFixture = true;
  try {
    const response = await app.call('GET', '/api/incidents/1', { user: { sub: 12, role: 'ACCOUNTING' } });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const timeline = response.body.timeline;
    assert.equal(timeline.booking, null);
    assert.deepEqual(timeline.deliveries.map(x => x.DocuNo), ['new-delivery']);
    assert.deepEqual(timeline.invoices.map(x => x.DocuNo), ['new-invoice']);
    assert.equal(timeline.scales.length, 1);
    assert.equal(timeline.scales[0].DateIn, null);
    assert.ok(timeline.scales[0].DateOut);
    assert.ok(timeline.steps.every(step => new Date(step.at) >= new Date('2025-12-31T17:00:00Z')));
    assert.ok(timeline.steps.some(step => step.step.includes('ยืนยันบิล')));
  } finally { timelineFixture = false; }
});
