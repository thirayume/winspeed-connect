'use strict';

/**
 * Owner, 3 November 2026: the scale record closes a bill by itself; when it does not check out, the bill stays open for a
 * person to decide, and the reason is kept as a rule incident. A truck leaving before WinSpeed approves is allowed and
 * recorded.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

const bill = { Id: '289040', Status: 'PENDING_APPROVAL', SalesUserId: 43, WfRef: 'I69-05300', CustId: '1086', ImportedDocuNo: 'I69-05300', TruckPlate: 'UAT2-QA91', TripId: 17 };
const event = {
  EventSource: 'WGHD', EventId: 4600, MoveBill: '9989040', TruckPlate: 'UAT2-QA91', GrossKg: 11004, TareKg: 10000, NetKg: 1004,
  PlannedTon: 1, ScaleNo: 1, WeighOutAt: '2026-11-03T10:00:00Z',
};
let current = bill;
let scaleRows = [event];
let tripStatus = 'WAREHOUSE_ACK';
const incidents = [];
const db = h.installDbStub(({ text, inputs }) => {
  if (/FROM wf\.v_AllSalesOrders WHERE CAST\(Id AS INT\) = @id/.test(text)) return [current];
  if (/NativeBookingApproval/.test(text)) return [{ HasAiReceipts: 0 }];
  if (/FROM dbo\.WGHD w WITH \(NOLOCK\)/.test(text) && /TOP 1/.test(text)) return scaleRows;
  if (/FROM wf\.SalesOrderExt WHERE SOID/.test(text) || /FROM wf\.SalesOrderExt WITH/.test(text)) return [{ SOID: '289040', TripId: 17, SalesUserId: 43 }];
  if (/SELECT LoadPlanStatus FROM wf\.SalesTrip/.test(text)) return [{ LoadPlanStatus: tripStatus }];
  if (/FROM wf\.SalesTrip WITH \(UPDLOCK/.test(text)) return [{ LoadPlanStatus: tripStatus }];
  if (/FROM wf\.SalesTrip WHERE TripId/.test(text)) return [{ TripId: 17, LoadPlanStatus: tripStatus }];
  if (/FROM wf\.SystemSetting/.test(text)) return [];
  if (/INSERT INTO wf\.RuleIncident/.test(text)) { incidents.push(inputs.type?.value ?? inputs.type); return []; }
  return [];
}, { activeUserIds: h.TEST_USERS });

const so = require('../routes/so');
const sync = require('../services/scale-ship-sync');
const { plateMatches } = require('../services/rule-incidents');

let app;
test.before(async () => { app = await h.startApp([['/api/so', '../../routes/so'], ['/api/incidents', '../../routes/incidents']]); });
test.after(async () => { await app.close(); });

const tolerance = { minPct: -2, maxPct: 2 };
const row = (extra = {}) => ({ ...event, SOID: 289040, DocuNo: 'I69-05300', BillPlate: 'UAT2-QA91', BillTon: 1, ...extra });
const types = list => list.map(p => p.type);

test('a record that checks out has no problems', () => {
  assert.deepEqual(sync.scaleProblems(row(), tolerance), []);
});

test('weight beyond 2% stops the automatic close, at both ends', () => {
  assert.deepEqual(types(sync.scaleProblems(row({ NetKg: 1030 }), tolerance)), ['WEIGHT_OUT_OF_TOLERANCE']);
  assert.deepEqual(types(sync.scaleProblems(row({ NetKg: 970 }), tolerance)), ['WEIGHT_OUT_OF_TOLERANCE']);
  assert.deepEqual(sync.scaleProblems(row({ NetKg: 1020 }), tolerance), []);
  assert.deepEqual(sync.scaleProblems(row({ NetKg: 980 }), tolerance), []);
});

test('another truck, or other tons, stops the automatic close', () => {
  assert.deepEqual(types(sync.scaleProblems(row({ BillPlate: 'XX-1' }), tolerance)), ['PLATE_MISMATCH']);
  assert.deepEqual(types(sync.scaleProblems(row({ BillTon: 2 }), tolerance)), ['SCALE_TONS_MISMATCH']);
});

test('plates ignore spacing and a bill with no plate named', () => {
  assert.equal(plateMatches('70-1234', '70 1234'), true);
  assert.equal(plateMatches('70-1234', 'ยังไม่ระบุรถ'), true);
  assert.equal(plateMatches('70-1234', '70-9999'), false);
});

test('the scale closes a bill that WinSpeed has not approved yet', async () => {
  const before = db.calls.length;
  const r = await so.autoShipFromScale('289040', event);
  assert.equal(r.shipped, true);
  const calls = db.calls.slice(before);
  const ticket = calls.find(c => /INSERT INTO wf\.WeighTicket/.test(c.text));
  assert.ok(ticket);
  assert.equal(ticket.inputs.shipSource?.value ?? ticket.inputs.shipSource, 'SCALE_AUTO');
  assert.equal(ticket.inputs.scaleEventId?.value ?? ticket.inputs.scaleEventId, 4600);
  assert.ok(calls.some(c => /UPDATE wf\.SalesOrderExt SET WeighOutWeight/.test(c.text)));
});

test('a bill already shipped, cancelled or under edit is left alone', async () => {
  for (const Status of ['SHIPPED', 'CANCELLED', 'DRAFT']) {
    current = { ...bill, Status };
    assert.equal((await so.autoShipFromScale('289040', event)).shipped, false, Status);
  }
  current = bill;
});

test('a truck gone before the warehouse acknowledged the plan is kept as an incident', async () => {
  tripStatus = 'SALE_CONFIRMED';
  incidents.length = 0;
  try {
    await so.autoShipFromScale('289040', event);
    assert.ok(incidents.includes('SHIP_BEFORE_LOAD_ACK'));
  } finally { tripStatus = 'WAREHOUSE_ACK'; }
});

test('the warehouse can confirm from the scale record at any open stage', async () => {
  current = { ...bill, Status: 'CONFIRMED' };
  try {
    const r = await app.call('PATCH', '/api/so/289040/ship', { body: {}, user: { sub: 50, role: 'WAREHOUSE' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.netKg, 1004);
  } finally { current = bill; }
});

test('without a scale record the warehouse is refused at an early stage', async () => {
  current = { ...bill, Status: 'CONFIRMED' };
  scaleRows = [];
  try {
    const r = await app.call('PATCH', '/api/so/289040/ship', { body: {}, user: { sub: 50, role: 'WAREHOUSE' } });
    assert.equal(r.status, 400);
  } finally { current = bill; scaleRows = [event]; }
});

test('a manager can overrule a wrong scale record with weights, a reason and evidence', async () => {
  current = { ...bill, Status: 'LOADED' };
  const before = db.calls.length;
  try {
    const r = await app.call('PATCH', '/api/so/289040/ship', {
      body: { weighOutWeight: 12000, tareKg: 11000, overrideReason: 'บันทึกชั่งผิดคัน ตรวจจากใบชั่ง', evidencePhotoUrl: 'https://example.test/a.jpg' },
      user: { sub: 25, role: 'MANAGER' },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.netKg, 1000);
    const ticket = db.calls.slice(before).find(c => /INSERT INTO wf\.WeighTicket/.test(c.text));
    assert.equal(ticket.inputs.shipSource?.value ?? ticket.inputs.shipSource, 'MANAGER');
  } finally { current = bill; }
});

test('the incident list is limited to the roles of its menu, and review needs a note', async () => {
  assert.equal((await app.call('GET', '/api/incidents', { user: { sub: 43, role: 'SALES' } })).status, 403);
  assert.equal((await app.call('GET', '/api/incidents', { user: { sub: 12, role: 'ACCOUNTING' } })).status, 200);
  assert.equal((await app.call('PATCH', '/api/incidents/1/ack', { body: { note: 'x' }, user: { sub: 12, role: 'ACCOUNTING' } })).status, 400);
  assert.equal((await app.call('PATCH', '/api/incidents/1/ack', { body: { note: 'ตรวจแล้ว ถูกต้อง' }, user: { sub: 50, role: 'WAREHOUSE' } })).status, 403);
});

test('migration 167 sets the tolerance only where nobody changed it, and stays in wf', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { splitBatches } = require('../run_migrations');
  const { assertNoCrossDbWrite } = require('../safety-validator');
  const text = fs.readFileSync(path.join(__dirname, '../migrations/167_scale_ship_incidents.sql'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(text, /SettingValue = '-2\.0'[\s\S]*SettingValue IN \('2\.0','2'\)/);
  assert.match(text, /SettingValue = '2\.0'[\s\S]*SettingValue IN \('5\.0','5'\)/);
  assert.doesNotMatch(text, /\b(CREATE|ALTER|DROP)\s+(TABLE|VIEW|PROCEDURE|FUNCTION|TRIGGER|INDEX)\s+(\[?dbo\]?\.)/i);
  assert.doesNotMatch(text, /CREATE\s+OR\s+ALTER|\bTHROW\b|dbwins_worldfert/i);
  for (const batch of splitBatches(text)) assert.doesNotThrow(() => assertNoCrossDbWrite(batch));
});
