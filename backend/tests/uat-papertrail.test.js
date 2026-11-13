'use strict';

/**
 * UAT batch 5, SHP-04 — Paper Trail:
 *  - printing again returns the same 4-colour set (same QR, scan history kept); it used to delete the copies and
 *    scans every time the print preview opened;
 *  - the paper set of a bill is visible/printable only inside the user's own + team scope;
 *  - scanning is for the roles that handle the paper.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/route-harness.cjs');
const windowPath = require.resolve('../services/global-data-window-store');
require.cache[windowPath] = {id:windowPath,filename:windowPath,loaded:true,exports:{readGlobalDataWindow:async()=>({businessDate:'2026-01-01',utcInstant:new Date('2025-12-31T17:00:00Z')})}};

const copies = [];
let multiRoleFixture = false;
let copiesBeforeWindow = false;
const db = h.installDbStub(({ text, inputs }) => {
  if (multiRoleFixture && /AS PolicySchemaMissing/.test(text)) return [{ Role: 'SALES', RoleCode: 'SALES', AuthVersion: 0, IsActive: 1 }];
  if (multiRoleFixture && /FROM wf\.vUserRole u/.test(text)) return Number(inputs.id) === 64
    ? [{ Code: 'SALES', BaseRole: 'SALES', PermissionCode: 'access-as' }]
    : [{ Code: 'SALES', BaseRole: 'SALES', PermissionCode: null }, { Code: 'WAREHOUSE', BaseRole: 'WAREHOUSE', PermissionCode: null }];
  if (/SELECT Id, EmpId, PositionCode FROM wf\.AppUser WHERE Id = @id/.test(text)) return [{ Id: inputs.id, EmpId: String(7000 + inputs.id), PositionCode: null }];
  if (/SELECT TOP 1 so\.SalesUserId, CAST\(h\.EmpID AS VARCHAR\(20\)\) AS EmpID/.test(text)) return inputs.id === '900' ? [{ SalesUserId: 43, EmpID: '7043' }] : [];
  if (/SELECT TOP 1 WfRef FROM wf\.v_AllSalesOrders WHERE Id = @id/.test(text)) return [{ WfRef: 'I69-09000' }];
  if (/SELECT CopyColor, CopyLabel, QrNonce, CASE WHEN PrintedAt/.test(text)) return copies.map(c => ({ CopyColor: c.color, CopyLabel: c.label, QrNonce: c.nonce, InWindow: copiesBeforeWindow ? 0 : 1 }));
  if (/INSERT INTO wf\.PaperCopy/.test(text)) { copies.push({ color: inputs.col, label: inputs.lbl, nonce: inputs.nonce }); return []; }
  return [];
}, { activeUserIds: h.TEST_USERS });

let app;
test.before(async () => { app = await h.startApp([['/api/papertrail', '../../routes/papertrail']]); });
test.after(async () => { await app.close(); });

test('SHP-04: a second print returns the same set and deletes nothing', async () => {
  const first = await app.call('POST', '/api/papertrail/900/print', { body: { docType: 'ISSUE' }, user: { sub: 43, role: 'SALES' } });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.copies.length, 4);
  const before = db.calls.length;
  const again = await app.call('POST', '/api/papertrail/900/print', { body: { docType: 'ISSUE' }, user: { sub: 64, role: 'COUNTER_SALES' } });
  assert.equal(again.status, 200);
  assert.equal(again.body.reused, true);
  assert.deepEqual(again.body.copies.map(c => c.qrNonce), first.body.copies.map(c => c.qrNonce));
  assert.ok(!db.calls.slice(before).some(c => /DELETE FROM wf\.Paper/.test(c.text)), 'no copy or scan deleted');
});

test('SHP-04: another salesperson cannot open or print the set (404); SALES cannot scan (403)', async () => {
  assert.equal((await app.call('POST', '/api/papertrail/900/print', { body: {}, user: { sub: 19, role: 'SALES' } })).status, 404);
  assert.equal((await app.call('GET', '/api/papertrail/document/900', { user: { sub: 19, role: 'SALES' } })).status, 404);
  assert.equal((await app.call('POST', '/api/papertrail/scan', { body: { qrNonce: 'x', action: 'LOST' }, user: { sub: 43, role: 'SALES' } })).status, 403);
});

test('old or missing bills cannot be opened or printed even by an administrator', async () => {
  const before = db.calls.length;
  const user = { sub: 12, role: 'ADMIN' };
  assert.equal((await app.call('GET', '/api/papertrail/document/901', { user })).status, 404);
  assert.equal((await app.call('POST', '/api/papertrail/901/print', { body: {}, user })).status, 404);
  const calls = db.calls.slice(before);
  const guard = calls.find(c => /SELECT TOP 1 so\.SalesUserId/.test(c.text));
  assert.match(guard.text, /so\.CreatedAt >= @globalStartUtc/);
  assert.match(guard.text, /h\.DocuDate >= @globalStartDate/);
  assert.equal(guard.inputs.globalStartUtc.toISOString(), '2025-12-31T17:00:00.000Z');
  assert.equal(guard.inputs.globalStartDate, '2026-01-01');
  assert.ok(!calls.some(c => /INSERT INTO wf\.PaperCopy|DELETE FROM wf\.Paper/i.test(c.text)));
});

test('paper copies and lost alerts apply the date window and scope', async () => {
  const before = db.calls.length;
  const user = { sub: 12, role: 'ADMIN' };
  assert.equal((await app.call('GET', '/api/papertrail/900/copies', { user })).status, 200);
  assert.equal((await app.call('GET', '/api/papertrail/lost', { user })).status, 200);
  const calls = db.calls.slice(before);
  const copiesQuery = calls.find(c => /FROM wf\.PaperCopy pc LEFT JOIN wf\.AppUser/.test(c.text) && /pc\.SoId = @id/.test(c.text));
  assert.match(copiesQuery.text, /pc\.PrintedAt >= @globalStartUtc/);
  const lostQuery = calls.find(c => /DATEDIFF\(day, pc\.UpdatedAt/.test(c.text));
  assert.match(lostQuery.text, /pc\.PrintedAt >= @globalStartUtc/);
  assert.match(lostQuery.text, /so\.CreatedAt >= @globalStartUtc/);
  assert.match(lostQuery.text, /h\.DocuDate >= @globalStartDate/);
});

test('an old paper set is not exposed, deleted or recreated by print preview', async () => {
  copiesBeforeWindow = true;
  try {
    const before = db.calls.length;
    const response = await app.call('POST', '/api/papertrail/900/print', { body: { reissue: true }, user: { sub: 12, role: 'ADMIN' } });
    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.ok(!db.calls.slice(before).some(c => /DELETE FROM wf\.Paper|INSERT INTO wf\.PaperCopy/i.test(c.text)));
  } finally { copiesBeforeWindow = false; }
});

test('SHP-04: a reissue by SALES is refused once a set exists', async () => {
  const r = await app.call('POST', '/api/papertrail/900/print', { body: { docType: 'ISSUE', reissue: true }, user: { sub: 43, role: 'SALES' } });
  assert.equal(r.status, 403);
});

test('paper reissue accepts an assigned operational role even when SALES is primary', async () => {
  multiRoleFixture = true;
  try {
    const r = await app.call('POST', '/api/papertrail/900/print', {
      body: { docType: 'ISSUE', reissue: true }, user: { sub: 43, role: 'SALES' },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const acting = await app.call('POST', '/api/papertrail/900/print', {
      body: { docType: 'ISSUE', reissue: true }, user: { sub: 43, role: 'SALES', actorSub: 64 },
    });
    // The real actor cannot see this other salesperson's SO, so the scope
    // guard hides it before the reissue permission check is reached.
    assert.equal(acting.status, 404, JSON.stringify(acting.body));
  } finally { multiRoleFixture = false; }
});

// UAT batch 5, SO-11 — a reservation made by the person saving, or by the bill's salesperson, may be drawn
test('SO-11: the counter keying a bill for a salesperson can draw the coupon it reserved', async () => {
  const { validateAndLockCouponReservations } = require('../services/coupon-service');
  const row = { Id: 1, CouponId: 9, CouponNo: 'C6906911', GoodId: 1156, GoodUnit: 'ตัน', ReservedQty: 1, Status: 'RESERVED', BeneficiaryCustId: '1158', OwnerCustId: '1158', CarrierSoId: null, ExpiresAt: null, CreatedBy: 64 };
  const tx = { request: () => ({ input() { return this; }, query: async () => ({ recordset: [row] }) }) };
  const lines = [{ couponReservationId: 1, goodId: '1156', qtyTon: 1, goodUnit: 'ตัน' }];
  await validateAndLockCouponReservations(tx, lines, '1158', null, { userId: 64, altUserIds: [36], role: 'COUNTER_SALES' }, 'I');
  await assert.rejects(validateAndLockCouponReservations(tx, lines, '1158', null, { userId: 36, altUserIds: [], role: 'SALES' }, 'I'), /ถูกสร้างโดยผู้ใช้อื่น/);
  row.CreatedBy = 36;
  await validateAndLockCouponReservations(tx, lines, '1158', null, { userId: 64, altUserIds: [36], role: 'COUNTER_SALES' }, 'I');
});

// UAT batch 6 — the board shows bills still waiting for WinSpeed approval in their own column (same rule as
// wf.v_AllSalesOrders), and the remark scan for drawn tons runs for control tickets only (8.8 s → 0.7 s)
test('board: WinSpeed-pending column and a drawn-tons scan limited to control tickets', async () => {
  const before = db.calls.length;
  const r = await app.call('GET', '/api/papertrail/board', { user: { sub: 12, role: 'ACCOUNTING' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.stages.slice(0, 3), ['DRAFT', 'PENDING_APPROVAL', 'CONFIRMED']);
  const sqlText = db.calls.slice(before).find(c => /WITH Orders AS/.test(c.text)).text;
  const boardCall = db.calls.slice(before).find(c => /WITH Orders AS/.test(c.text));
  assert.match(sqlText, /so\.CreatedAt >= @globalStartUtc/);
  assert.match(sqlText, /hd\.DocuDate >= @globalStartDate/);
  assert.equal(boardCall.inputs.globalStartDate,'2026-01-01');
  assert.equal(boardCall.inputs.globalStartUtc.toISOString(),'2025-12-31T17:00:00.000Z');
  assert.match(sqlText, /WHEN hd\.AppvFlag = 'W' AND hd\.AppvDocuNo IS NULL THEN 'PENDING_APPROVAL'/);
  assert.match(sqlText, /CASE WHEN so\.ImportedDocuNo IS NOT NULL\s+AND \(so\.SoPrefix = 'AI' OR so\.TruckPlate = N'ตั๋วคุม' OR so\.NoTruckRequired = 1\) THEN \(/);
});

// UAT batch 6 — two print previews opened together each found no set and each issued one (8 copies); the check and
// the insert now run in one transaction under a lock per bill and document
test('print: the existing-set check runs under a per-bill lock inside the transaction', async () => {
  copies.length = 0;
  const before = db.calls.length;
  const r = await app.call('POST', '/api/papertrail/900/print', { body: { docType: 'ISSUE' }, user: { sub: 43, role: 'SALES' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const calls = db.calls.slice(before);
  const lock = calls.findIndex(c => /sp_getapplock/.test(c.text));
  const check = calls.findIndex(c => /SELECT CopyColor, CopyLabel, QrNonce, CASE WHEN PrintedAt/.test(c.text));
  assert.ok(lock >= 0 && check > lock, 'lock first, then the check');
  assert.equal(calls[lock].kind, 'tx');
  assert.equal(calls[check].kind, 'tx');
  assert.equal(calls[lock].inputs.res, 'PaperSet_900_ISSUE');
});
