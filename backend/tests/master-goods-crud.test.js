'use strict';
// Owner, 18 Nov 2026: Sale-App creates, changes and deletes WinSpeed goods, goods groups and giveaway goods,
// through the wf procedures of migration 248 only (docs/sale-app/handover/WINSPEED-MASTER-DATA-RULES.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const h = require('./helpers/route-harness.cjs');

let procResult = {};
const db = h.installDbStub(({ text }) => {
  const proc = /EXEC (wf\.\w+)/.exec(text)?.[1];
  if (proc) {
    const r = procResult[proc];
    if (r instanceof Error) throw r;
    return { recordset: [], output: r || {} };
  }
  if (/LIKE 'PM\[0-9\]/.test(text)) return [{ N: 22 }];
  if (/FROM dbo\.EMGood WITH \(NOLOCK\) WHERE GoodID = @id/.test(text)) return [{ GoodCode: 'G1', GoodName: 'ปุ๋ยเดิม', GoodGroupID: 1003 }];
  return [];
}, { activeUserIds: h.TEST_USERS });

const admin = { sub: 1, role: 'ADMIN' };
let app;
test.before(async () => { app = await h.startApp([['/api/master', '../../routes/master']]); });
test.after(async () => { await app.close(); });
const procCalls = before => db.calls.slice(before).filter(c => /^EXEC wf\./.test(c.text));

test('a new good goes through wf.sp_MasterCreateGood and its Sale-App extras in the same transaction', async () => {
  procResult = { 'wf.sp_MasterCreateGood': { NewGoodID: 31105 } };
  const before = db.calls.length;
  const r = await app.call('POST', '/api/master/goods', { user: admin, body: { GoodCode: ' NEW-1 ', GoodName: 'ปุ๋ยใหม่', GoodGroupID: 1003, BagPerTon: 20, WeightKgPerBag: 50 } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.GoodID, 31105);
  const [call] = procCalls(before);
  assert.equal(call.text, 'EXEC wf.sp_MasterCreateGood');
  assert.equal(call.inputs.GoodCode, 'NEW-1');
  assert.equal(call.inputs.GoodGroupID, 1003);
  assert.equal(call.inputs.UserId, 1);
  assert.ok(db.calls.slice(before).some(c => /wf\.GoodExtra/.test(c.text) && c.inputs.id === '31105'));
});

test('a giveaway is a good of group 1005 with the next PM code when none is given', async () => {
  procResult = { 'wf.sp_MasterCreateGood': { NewGoodID: 31106 } };
  const before = db.calls.length;
  const r = await app.call('POST', '/api/master/giveaways', { user: admin, body: { GoodName: 'เสื้อทดสอบ', MainGoodUnitID: 3004 } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const [call] = procCalls(before);
  assert.equal(call.inputs.GoodGroupID, 1005);
  assert.equal(call.inputs.GoodCode, 'PM00023');
  assert.equal(call.inputs.MainGoodUnitID, 3004);
});

test('duplicates and WinSpeed refusals come back as clear Thai messages', async () => {
  procResult = { 'wf.sp_MasterCreateGood': Object.assign(new Error('MASTER_GOOD_CODE_DUPLICATE'), { number: 50000, class: 16 }) };
  let r = await app.call('POST', '/api/master/goods', { user: admin, body: { GoodCode: 'X', GoodName: 'X', GoodGroupID: 1003 } });
  assert.equal(r.status, 409);
  assert.equal(r.body.message, 'รหัสสินค้านี้มีอยู่แล้วใน WinSpeed');
  procResult = { 'wf.sp_MasterDeleteGoodGroup': new Error('Cannot DELETE EMGoodGroup because ICPriceHD exists.') };
  r = await app.call('DELETE', '/api/master/good-groups/2001', { user: admin });
  assert.equal(r.status, 409);
  assert.match(r.body.message, /WinSpeed ไม่อนุญาต: ยังมีข้อมูลใน ICPriceHD/);
});

test('a good in use is not deleted; an unused one is', async () => {
  procResult = { 'wf.sp_MasterDeleteGood': { Affected: 0, UsedBy: 'dbo.SODT' } };
  let r = await app.call('DELETE', '/api/master/goods/1091/permanent', { user: admin });
  assert.equal(r.status, 409);
  assert.match(r.body.message, /ลบไม่ได้ เพราะสินค้านี้ถูกใช้แล้วในใบสั่งจองหรือใบสั่งขายใน WinSpeed/);
  procResult = { 'wf.sp_MasterDeleteGood': { Affected: 1, UsedBy: null } };
  r = await app.call('DELETE', '/api/master/goods/31105/permanent', { user: admin });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test('changing code, name or group uses wf.sp_MasterUpdateGood; status uses wf.sp_MasterSetGoodStatus', async () => {
  procResult = { 'wf.sp_MasterUpdateGood': { Affected: 1 }, 'wf.sp_MasterSetGoodStatus': { Affected: 1 } };
  let before = db.calls.length;
  let r = await app.call('PATCH', '/api/master/goods/1091', { user: admin, body: { GoodCode: 'G1-NEW', GoodGroupID: 1004 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  let [call] = procCalls(before);
  assert.equal(call.text, 'EXEC wf.sp_MasterUpdateGood');
  assert.equal(call.inputs.GoodName, 'ปุ๋ยเดิม');
  before = db.calls.length;
  r = await app.call('PATCH', '/api/master/goods/1091/status', { user: admin, body: { inactive: 'A' } });
  assert.equal(r.status, 200);
  [call] = procCalls(before);
  assert.equal(call.text, 'EXEC wf.sp_MasterSetGoodStatus');
  assert.equal(call.inputs.Status, 'A');
});

test('only ADMIN and C_LEVEL write master data; groups and units are readable', async () => {
  for (const [method, url] of [['POST', '/api/master/goods'], ['POST', '/api/master/giveaways'], ['POST', '/api/master/good-groups'],
    ['DELETE', '/api/master/goods/1/permanent'], ['DELETE', '/api/master/good-groups/2001']]) {
    const r = await app.call(method, url, { user: { sub: 43, role: 'SALES' }, body: {} });
    assert.equal(r.status, 403, `${method} ${url}`);
  }
  assert.equal((await app.call('GET', '/api/master/good-groups', { user: { sub: 43, role: 'SALES' } })).status, 200);
  assert.equal((await app.call('GET', '/api/master/good-units', { user: { sub: 43, role: 'SALES' } })).status, 200);
});

test('migration 248 keeps WinSpeed rules: transaction, triggers on, locked next id, no duplicates, audit', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'migrations', '248_master_goods_crud_procs.sql'), 'utf8');
  assert.match(text, /^-- @transaction/);
  const statements = text.split(/\r?\n/).filter(l => !/^\s*--/.test(l)).join('\n');
  assert.doesNotMatch(statements, /DISABLE TRIGGER|\bTHROW\b|\bCONCAT\s*\(|TRY_CAST|\bIIF\s*\(|CREATE\s+OR\s+ALTER/i);
  assert.match(text, /MAX\(GoodID\), 999\) \+ 1 FROM dbo\.EMGood WITH \(UPDLOCK, HOLDLOCK\)/);
  assert.match(text, /INSERT INTO dbo\.EMGoodMultiUnit/);
  for (const code of ['MASTER_GOOD_CODE_DUPLICATE', 'MASTER_GOOD_NAME_DUPLICATE', 'MASTER_GROUP_CODE_DUPLICATE', 'MASTER_GROUP_NAME_DUPLICATE']) assert.match(text, new RegExp(code));
  assert.equal((text.match(/INSERT wf\.ChangeEvent/g) || []).length, 6);
});

test('migration 249 aligns giveaways to group 1005 exactly, keeps history and can be rolled back', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'migrations', '249_giveaway_goods_canonical_1005.sql'), 'utf8');
  const statements = text.split(/\r?\n/).filter(l => !/^\s*--/.test(l)).join('\n');
  assert.match(text, /^-- @transaction/);
  assert.doesNotMatch(statements, /LIKE\s+N?'%/i, 'no partial-name matching');
  assert.doesNotMatch(statements, /UPDATE\s+\w*\s*SET[^;]*ItemName|UPDATE\s+w\b|wf\.GiveawayWithdrawal\s+SET/i, 'quota keys and withdrawal history stay');
  assert.match(statements, /LTRIM\(RTRIM\(n\.GoodName1\)\) = LTRIM\(RTRIM\(o\.GoodName1\)\)/);
  assert.match(statements, /= 1\s+AND \(SELECT COUNT\(\*\) FROM dbo\.EMGood o2/, 'one-to-one pairs only');
  assert.match(statements, /INSERT INTO wf\.GiveawayAlignLog/);
  assert.match(statements, /ga\.OldGoodId = w\.GoodId AND ga\.NewGoodId = b\.GoodId/, 'older withdrawals still count');
  const down = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'down', '249_giveaway_goods_canonical_1005.down.sql'), 'utf8');
  assert.match(down, /Kind = 'BUDGET_RELINKED'/);
  assert.match(down, /Kind = 'MAPPING_ADDED'/);
  const master = fs.readFileSync(path.join(__dirname, '..', 'routes', 'master.js'), 'utf8');
  assert.match(master, /NOT EXISTS \(SELECT 1 FROM wf\.GiveawayGoodAlias ga WITH \(NOLOCK\) WHERE ga\.OldGoodId = CONVERT\(VARCHAR\(50\), g\.GoodID\)\)/);
});
