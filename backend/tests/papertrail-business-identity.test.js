'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');

// Inject only what the trusted auth middleware would attach after a reviewed
// binding. This test deliberately does not send identityMapping in a token.
let currentUser;
let failScanInsert = false;
let failAuditInsert = false;
let simulatedStatus = 'SIGNED';
const authPath = require.resolve('../middleware/auth');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  requireAuth: (req, _res, next) => { req.user = currentUser; next(); },
  requireRole: () => (_req, _res, next) => next(),
} };

const db = h.installDbStub(({ text }) => {
  if (/SELECT TOP 1 so\.SalesUserId/.test(text)) return [{ SalesUserId: 103, EmpID: '1' }];
  if (/SELECT TOP 1 WfRef FROM wf\.v_AllSalesOrders/.test(text)) return [{ WfRef: 'TEST-900' }];
  if (/SELECT CopyColor, CopyLabel, QrNonce, CASE WHEN PrintedAt/.test(text)) return [];
  if (/SELECT \* FROM wf\.PaperCopy WHERE QrNonce/.test(text))
    return [{ Id: 7, SoId: '900', Status: 'PRINTED', CopyColor: 'WHITE' }];
  if (/SELECT Id, SoId, Status FROM wf\.PaperCopy WITH/.test(text))
    return [{ Id: 7, SoId: '900', Status: simulatedStatus }];
  if (/UPDATE wf\.PaperCopy SET Status/.test(text)) {
    simulatedStatus = 'IN_TRANSIT';
    return { recordset: [], rowsAffected: [1] };
  }
  if (/INSERT INTO wf\.PaperScan/.test(text) && failScanInsert) throw new Error('test scan insert failed');
  if (/INSERT INTO wf\.SalesOrderAudit/.test(text) && failAuditInsert) throw new Error('test audit insert failed');
  return [];
});
const underlyingTransaction = db.stub.wfTransaction;
db.stub.wfTransaction = async fn => {
  const before = simulatedStatus;
  try { return await underlyingTransaction(fn); }
  catch (error) { simulatedStatus = before; throw error; }
};

const mapping = () => ({ primaryActorUserId: 12, primaryEffectiveUserId: 43,
  businessActorUserId: 102, businessEffectiveUserId: 103 });
let app;
test.before(async () => { app = await h.startApp([['/api/papertrail', '../../routes/papertrail']]); });
test.after(async () => { await app.close(); });

test('print and scan use the reviewed business effective ID during Access As', async () => {
  currentUser = { sub: 43, id: 43, actorSub: 12, role: 'ADMIN', actorRole: 'ADMIN', isImpersonating: true, identityMapping: mapping() };
  const start = db.calls.length;
  const printed = await app.call('POST', '/api/papertrail/900/print', { body: {} });
  assert.equal(printed.status, 200);
  const inserts = db.calls.slice(start).filter(c => /INSERT INTO wf\.PaperCopy/.test(c.text));
  assert.equal(inserts.length, 4);
  for (const call of inserts) assert.equal(call.inputs.uid, 103);
  const printAudit = db.calls.slice(start).find(c => /INSERT INTO wf\.SalesOrderAudit/.test(c.text));
  assert.equal(printAudit.kind, 'tx');
  assert.equal(printAudit.inputs.actor, 102);
  assert.equal(printAudit.inputs.effective, 103);
  assert.match(printAudit.inputs.note, /primaryActor=12; primaryEffective=43/);
  const beforeScan = db.calls.length;
  const scanned = await app.call('POST', '/api/papertrail/scan', { body: { qrNonce: 'TEST', action: 'TRANSIT' } });
  assert.equal(scanned.status, 200);
  const changes = db.calls.slice(beforeScan).filter(c => /UPDATE wf\.PaperCopy|INSERT INTO wf\.PaperScan/.test(c.text));
  assert.equal(changes.length, 2);
  for (const call of changes) { assert.equal(call.inputs.uid, 103); assert.equal(call.kind, 'tx'); }
  assert.equal(changes.find(c => /INSERT INTO wf\.PaperScan/.test(c.text)).inputs.fr, 'SIGNED');
  const scanAudit = db.calls.slice(beforeScan).find(c => /INSERT INTO wf\.SalesOrderAudit/.test(c.text));
  assert.equal(scanAudit.kind, 'tx');
  assert.equal(scanAudit.inputs.actor, 102);
  assert.equal(scanAudit.inputs.effective, 103);
  assert.match(scanAudit.inputs.note, /primaryActor=12; primaryEffective=43/);
});

test('scan log failure rolls back the holder/status change', async () => {
  currentUser = { sub: 43, id: 43, actorSub: 12, role: 'ADMIN', actorRole: 'ADMIN', isImpersonating: true, identityMapping: mapping() };
  simulatedStatus = 'SIGNED';
  failScanInsert = true;
  try {
    const result = await app.call('POST', '/api/papertrail/scan', { body: { qrNonce: 'TEST', action: 'TRANSIT' } });
    assert.equal(result.status, 500);
    assert.equal(simulatedStatus, 'SIGNED');
  } finally { failScanInsert = false; }
});

test('an audit write failure rolls back the scan state change', async () => {
  currentUser = { sub: 43, id: 43, actorSub: 12, role: 'ADMIN', actorRole: 'ADMIN', isImpersonating: true, identityMapping: mapping() };
  simulatedStatus = 'SIGNED';
  failAuditInsert = true;
  try {
    const result = await app.call('POST', '/api/papertrail/scan', { body: { qrNonce: 'TEST', action: 'TRANSIT' } });
    assert.equal(result.status, 500);
    assert.equal(simulatedStatus, 'SIGNED');
  } finally { failAuditInsert = false; }
});

test('Access As cannot exceed the real actor scope in details, scans or lists', async () => {
  currentUser = { sub: 43, id: 43, actorSub: 12, role: 'ADMIN', actorRole: 'SALES',
    isImpersonating: true, identityMapping: mapping() };
  let start = db.calls.length;
  assert.equal((await app.call('POST', '/api/papertrail/900/print', { body: {} })).status, 404);
  assert.equal((await app.call('POST', '/api/papertrail/scan', { body: { qrNonce: 'TEST', action: 'TRANSIT' } })).status, 404);
  assert.ok(!db.calls.slice(start).some(c => /INSERT INTO wf\.Paper|UPDATE wf\.Paper|DELETE FROM wf\.Paper/.test(c.text)));
  start = db.calls.length;
  assert.equal((await app.call('GET', '/api/papertrail/board')).status, 200);
  assert.equal((await app.call('GET', '/api/papertrail/lost')).status, 200);
  const board = db.calls.slice(start).find(c => /WITH Orders AS/.test(c.text));
  const lost = db.calls.slice(start).find(c => /DATEDIFF\(day, pc\.UpdatedAt/.test(c.text));
  assert.equal(board.inputs.ptActorU0, 102);
  assert.equal(lost.inputs.lostActorU0, 102);
  assert.match(board.text, /SalesUserId IN \(@ptActorU0\)/);
  assert.match(lost.text, /so\.SalesUserId IN \(@lostActorU0\)/);
});

test('invalid binding fails closed before paper records are written', async () => {
  currentUser = { sub: 43, id: 43, actorSub: 12, role: 'ADMIN', actorRole: 'ADMIN', isImpersonating: true,
    identityMapping: { ...mapping(), primaryEffectiveUserId: 44 } };
  const start = db.calls.length;
  assert.equal((await app.call('POST', '/api/papertrail/900/print', { body: {} })).status, 409);
  assert.equal((await app.call('POST', '/api/papertrail/scan', { body: { qrNonce: 'TEST', action: 'TRANSIT' } })).status, 409);
  assert.ok(!db.calls.slice(start).some(c => /INSERT INTO wf\.Paper|UPDATE wf\.Paper|DELETE FROM wf\.Paper/.test(c.text)));
});
