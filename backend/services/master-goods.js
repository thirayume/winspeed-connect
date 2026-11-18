'use strict';
/**
 * Create, change and delete WinSpeed goods, goods groups and giveaway goods (group 1005) from Sale-App.
 * Owner, 18 Nov 2026. Rules: docs/sale-app/handover/WINSPEED-MASTER-DATA-RULES.md.
 *
 * Every write runs one wf procedure (migration 248) inside one transaction, with the Sale-App-only
 * attributes (wf.GoodExtra) in the same transaction. The procedures keep WinSpeed's triggers on, take
 * the next id under lock, refuse duplicates and audit to wf.ChangeEvent. Nothing here writes dbo directly.
 */
const { sql, wfTransaction, wfQuery } = require('../db');
const { businessIds } = require('./business-identity');

const GIVEAWAY_GROUP_ID = 1005;

const PROC_MESSAGES = {
  MASTER_TRANSACTION_REQUIRED: [500, 'ระบบบันทึกข้อมูลหลักผิดพลาด กรุณาลองใหม่'],
  MASTER_GROUP_CODE_NAME_REQUIRED: [400, 'กรุณาระบุรหัสและชื่อกลุ่มสินค้า'],
  MASTER_GROUP_CODE_DUPLICATE: [409, 'รหัสกลุ่มสินค้านี้มีอยู่แล้ว'],
  MASTER_GROUP_NAME_DUPLICATE: [409, 'ชื่อกลุ่มสินค้านี้มีอยู่แล้ว'],
  MASTER_GROUP_NOT_FOUND: [404, 'ไม่พบกลุ่มสินค้านี้'],
  MASTER_GROUP_HAS_GOODS: [409, 'ลบกลุ่มนี้ไม่ได้ เพราะยังมีสินค้าอยู่ในกลุ่ม ย้ายหรือลบสินค้าก่อน'],
  MASTER_GOOD_CODE_NAME_REQUIRED: [400, 'กรุณาระบุรหัสและชื่อสินค้า'],
  MASTER_GOOD_CODE_DUPLICATE: [409, 'รหัสสินค้านี้มีอยู่แล้วใน WinSpeed'],
  MASTER_GOOD_NAME_DUPLICATE: [409, 'ชื่อนี้มีสินค้าที่ยังขายอยู่ในกลุ่มเดียวกันแล้ว'],
  MASTER_GOOD_TEMPLATE_REQUIRED: [400, 'กลุ่มนี้ยังไม่มีสินค้าให้คัดลอกค่าตั้งต้น กรุณาเลือกสินค้าต้นแบบ'],
  MASTER_GOOD_UNIT_NOT_FOUND: [400, 'ไม่พบหน่วยนับนี้ใน WinSpeed'],
  MASTER_GOOD_STATUS_INVALID: [400, 'สถานะสินค้าไม่ถูกต้อง'],
};

const USED_BY_LABEL = {
  'dbo.SODT': 'ใบสั่งจองหรือใบสั่งขายใน WinSpeed',
  'dbo.SOInvDT': 'ใบส่งของหรือใบกำกับใน WinSpeed',
  'dbo.ICStockDT': 'เอกสารคลังสินค้าใน WinSpeed',
  'dbo.EMSetPriceDT': 'ตารางราคาใน WinSpeed',
  'dbo.WFCoupon': 'ตั๋วปุ๋ยใน WinSpeed',
};

/** A procedure or WinSpeed trigger refusal as { status, message }; anything else is rethrown. */
function toHttpError(e) {
  const text = String(e?.message || '');
  const code = Object.keys(PROC_MESSAGES).find(k => text.includes(k));
  if (code) {
    const [status, message] = PROC_MESSAGES[code];
    return Object.assign(new Error(message), { status, code });
  }
  // WinSpeed's own RI triggers: "Cannot DELETE EMGood because SODT exists." and the like
  const ri = /Cannot\s+(DELETE|INSERT|UPDATE)\s+(\w+)\s+because\s+(\w+)\s+(exists|does not exist)/i.exec(text);
  if (ri) {
    const message = ri[4].toLowerCase() === 'exists'
      ? `WinSpeed ไม่อนุญาต: ยังมีข้อมูลใน ${ri[3]} ใช้รายการนี้อยู่ ให้ใช้ "งดจำหน่าย" แทนการลบ`
      : `WinSpeed ไม่อนุญาต: ไม่พบข้อมูลที่ต้องอ้างถึงใน ${ri[3]}`;
    return Object.assign(new Error(message), { status: 409, code: 'WINSPEED_REFUSED' });
  }
  return e;
}

function actors(user) {
  const ids = businessIds(user);
  if (!ids.actor || !ids.effective) throw Object.assign(new Error('ไม่พบตัวตนผู้ใช้สำหรับบันทึกประวัติ'), { status: 403 });
  return { UserId: Number(ids.effective), ActorUserId: Number(ids.actor) };
}

async function exec(tx, proc, inputs, outputs) {
  const req = new sql.Request(tx);
  for (const [k, [type, value]] of Object.entries(inputs)) req.input(k, type, value);
  for (const [k, type] of Object.entries(outputs)) req.output(k, type);
  return (await req.execute(proc)).output;
}

async function run(fn) {
  try { return await wfTransaction(fn); } catch (e) { throw toHttpError(e); }
}

async function upsertExtra(tx, goodId, { BagPerTon, WeightKgPerBag, ImageUrl } = {}) {
  if (BagPerTon === undefined && WeightKgPerBag === undefined && ImageUrl === undefined) return;
  const req = new sql.Request(tx);
  req.input('id', sql.NVarChar(40), String(goodId));
  req.input('bpt', sql.Int, BagPerTon === undefined || BagPerTon === null || BagPerTon === '' ? null : Number(BagPerTon));
  req.input('kgb', sql.Decimal(10, 4), WeightKgPerBag === undefined || WeightKgPerBag === null || WeightKgPerBag === '' ? null : Number(WeightKgPerBag));
  req.input('img', sql.NVarChar(sql.MAX), ImageUrl === undefined ? null : (ImageUrl || null));
  await req.query(`
    IF EXISTS (SELECT 1 FROM wf.GoodExtra WITH (UPDLOCK, HOLDLOCK) WHERE GoodId = @id)
      UPDATE wf.GoodExtra SET BagPerTon = COALESCE(@bpt, BagPerTon), WeightKgPerBag = COALESCE(@kgb, WeightKgPerBag),
             ImageUrl = COALESCE(@img, ImageUrl) WHERE GoodId = @id
    ELSE
      INSERT INTO wf.GoodExtra (GoodId, BagPerTon, WeightKgPerBag, ImageUrl) VALUES (@id, ISNULL(@bpt, 20), ISNULL(@kgb, 50.0), @img)`);
}

const text = (v, max) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));
const intOrNull = v => (v === undefined || v === null || v === '' ? null : (Number.isSafeInteger(Number(v)) ? Number(v) : NaN));
function bad(message) { return Object.assign(new Error(message), { status: 400 }); }

async function listGroups() {
  return (await wfQuery(`
    SELECT gg.GoodGroupID, RTRIM(gg.GoodGroupCode) AS GoodGroupCode, RTRIM(gg.GoodGroupName) AS GoodGroupName,
           RTRIM(gg.GoodGroupNameEng) AS GoodGroupNameEng, RTRIM(gg.Remark) AS Remark,
           (SELECT COUNT(*) FROM dbo.EMGood g WITH (NOLOCK) WHERE g.GoodGroupID = gg.GoodGroupID) AS GoodsCount,
           (SELECT COUNT(*) FROM dbo.EMGood g WITH (NOLOCK) WHERE g.GoodGroupID = gg.GoodGroupID AND ISNULL(g.Inactive, 'A') = 'A') AS ActiveCount
    FROM dbo.EMGoodGroup gg WITH (NOLOCK)
    ORDER BY gg.GoodGroupID`)).recordset || [];
}

async function listUnits() {
  return (await wfQuery(`SELECT GoodUnitID, RTRIM(GoodUnitCode) AS GoodUnitCode, RTRIM(GoodUnitName) AS GoodUnitName
    FROM dbo.EMGoodUnit WITH (NOLOCK) ORDER BY GoodUnitName`)).recordset || [];
}

/** A group's current code, or the next free numeric code for a new group (WinSpeed numbers them 1, 3 … 12). */
async function groupCode(id, given) {
  if (given) return given;
  if (id != null) {
    const cur = (await wfQuery(`SELECT RTRIM(GoodGroupCode) AS C FROM dbo.EMGoodGroup WITH (NOLOCK) WHERE GoodGroupID = @id`,
      { id: { type: sql.Int, value: Number(id) } })).recordset?.[0];
    if (!cur) throw Object.assign(new Error('ไม่พบกลุ่มสินค้านี้'), { status: 404 });
    return cur.C;
  }
  const r = (await wfQuery(`SELECT MAX(CAST(LTRIM(RTRIM(GoodGroupCode)) AS INT)) AS N FROM dbo.EMGoodGroup WITH (NOLOCK)
    WHERE LTRIM(RTRIM(GoodGroupCode)) NOT LIKE '%[^0-9]%' AND LEN(LTRIM(RTRIM(GoodGroupCode))) BETWEEN 1 AND 9`)).recordset?.[0];
  return String(Number(r?.N || 0) + 1);
}

async function saveGroup(user, id, body) {
  const name = text(body.GoodGroupName, 255);
  if (!name) throw bad('กรุณาระบุชื่อกลุ่มสินค้า');
  const code = await groupCode(id, text(body.GoodGroupCode, 25));
  const who = actors(user);
  return run(async tx => {
    const out = await exec(tx, 'wf.sp_MasterSaveGoodGroup', {
      GoodGroupID: [sql.Int, id == null ? null : Number(id)], GoodGroupCode: [sql.VarChar(25), code], GoodGroupName: [sql.NVarChar(255), name],
      GoodGroupNameEng: [sql.NVarChar(255), text(body.GoodGroupNameEng, 255) || null], Remark: [sql.NVarChar(255), text(body.Remark, 255) || null],
      UserId: [sql.Int, who.UserId], ActorUserId: [sql.Int, who.ActorUserId],
    }, { SavedID: sql.Int });
    return { GoodGroupID: out.SavedID, GoodGroupCode: code, GoodGroupName: name };
  });
}

async function deleteGroup(user, id) {
  const who = actors(user);
  return run(async tx => {
    const out = await exec(tx, 'wf.sp_MasterDeleteGoodGroup', {
      GoodGroupID: [sql.Int, Number(id)], UserId: [sql.Int, who.UserId], ActorUserId: [sql.Int, who.ActorUserId],
    }, { Affected: sql.Int });
    if (!out.Affected) throw Object.assign(new Error('ไม่พบกลุ่มสินค้านี้'), { status: 404 });
    return { ok: true };
  });
}

async function createGood(user, body, { groupId } = {}) {
  const code = text(body.GoodCode, 50), name = text(body.GoodName, 255);
  const group = intOrNull(groupId ?? body.GoodGroupID), unit = intOrNull(body.MainGoodUnitID), template = intOrNull(body.TemplateGoodID);
  if (!code || !name) throw bad('กรุณาระบุรหัสและชื่อสินค้า');
  if (!group || Number.isNaN(group)) throw bad('กรุณาเลือกกลุ่มสินค้า');
  if (Number.isNaN(unit) || Number.isNaN(template)) throw bad('หน่วยนับหรือสินค้าต้นแบบไม่ถูกต้อง');
  const weight = body.GoodWeight === undefined || body.GoodWeight === '' || body.GoodWeight === null ? null : Number(body.GoodWeight);
  if (weight !== null && !(weight >= 0)) throw bad('น้ำหนักต่อหน่วยไม่ถูกต้อง');
  const who = actors(user);
  return run(async tx => {
    const out = await exec(tx, 'wf.sp_MasterCreateGood', {
      GoodCode: [sql.VarChar(50), code], GoodName: [sql.NVarChar(255), name], GoodGroupID: [sql.Int, group],
      MainGoodUnitID: [sql.Int, unit], TemplateGoodID: [sql.Int, template], GoodWeight: [sql.Money, weight],
      UserId: [sql.Int, who.UserId], ActorUserId: [sql.Int, who.ActorUserId],
    }, { NewGoodID: sql.Int });
    await upsertExtra(tx, out.NewGoodID, body);
    return { GoodID: out.NewGoodID, GoodCode: code, GoodName: name, GoodGroupID: group };
  });
}

/** Next free giveaway code in WinSpeed's own pattern for group 1005 (PM00001 …). */
async function nextGiveawayCode() {
  const r = (await wfQuery(`
    SELECT MAX(CAST(SUBSTRING(LTRIM(RTRIM(GoodCode)), 3, 20) AS INT)) AS N
    FROM dbo.EMGood WITH (NOLOCK)
    WHERE LTRIM(RTRIM(GoodCode)) LIKE 'PM[0-9][0-9][0-9][0-9][0-9]' `)).recordset?.[0];
  return `PM${String(Number(r?.N || 0) + 1).padStart(5, '0')}`;
}

async function createGiveaway(user, body) {
  const code = text(body.GoodCode, 50) || await nextGiveawayCode();
  return createGood(user, { ...body, GoodCode: code }, { groupId: GIVEAWAY_GROUP_ID });
}

async function updateGood(user, id, body) {
  const current = (await wfQuery(`SELECT RTRIM(GoodCode) AS GoodCode, RTRIM(GoodName1) AS GoodName, GoodGroupID FROM dbo.EMGood WITH (NOLOCK) WHERE GoodID = @id`,
    { id: { type: sql.Int, value: Number(id) } })).recordset?.[0];
  if (!current) throw Object.assign(new Error('ไม่พบรหัสสินค้านี้'), { status: 404 });
  const code = body.GoodCode === undefined ? current.GoodCode : text(body.GoodCode, 50);
  const name = body.GoodName === undefined ? current.GoodName : text(body.GoodName, 255);
  const group = body.GoodGroupID === undefined ? current.GoodGroupID : intOrNull(body.GoodGroupID);
  const masterChanged = code !== current.GoodCode || name !== current.GoodName || group !== current.GoodGroupID;
  if (masterChanged && (!code || !name)) throw bad('กรุณาระบุรหัสและชื่อสินค้า');
  if (masterChanged && (!group || Number.isNaN(group))) throw bad('กรุณาเลือกกลุ่มสินค้า');
  const who = actors(user);
  return run(async tx => {
    if (masterChanged) {
      await exec(tx, 'wf.sp_MasterUpdateGood', {
        GoodID: [sql.Int, Number(id)], GoodCode: [sql.VarChar(50), code], GoodName: [sql.NVarChar(255), name], GoodGroupID: [sql.Int, group],
        UserId: [sql.Int, who.UserId], ActorUserId: [sql.Int, who.ActorUserId],
      }, { Affected: sql.Int });
    }
    await upsertExtra(tx, id, body);
    return { ok: true };
  });
}

async function setStatus(user, id, status) {
  const who = actors(user);
  return run(async tx => {
    const out = await exec(tx, 'wf.sp_MasterSetGoodStatus', {
      GoodID: [sql.Int, Number(id)], Status: [sql.Char(1), status], UserId: [sql.Int, who.UserId], ActorUserId: [sql.Int, who.ActorUserId],
    }, { Affected: sql.Int });
    if (!out.Affected) throw Object.assign(new Error('ไม่พบรหัสสินค้านี้'), { status: 404 });
    return { ok: true, status };
  });
}

async function deleteGood(user, id) {
  const who = actors(user);
  return run(async tx => {
    const out = await exec(tx, 'wf.sp_MasterDeleteGood', {
      GoodID: [sql.Int, Number(id)], UserId: [sql.Int, who.UserId], ActorUserId: [sql.Int, who.ActorUserId],
    }, { Affected: sql.Int, UsedBy: sql.NVarChar(200) });
    if (out.UsedBy) {
      const where = USED_BY_LABEL[out.UsedBy] || `ข้อมูลของ Sale-App (${out.UsedBy})`;
      throw Object.assign(new Error(`ลบไม่ได้ เพราะสินค้านี้ถูกใช้แล้วใน${where} ให้ใช้ "งดจำหน่าย" แทน`), { status: 409, code: 'MASTER_GOOD_IN_USE' });
    }
    if (!out.Affected) throw Object.assign(new Error('ไม่พบรหัสสินค้านี้'), { status: 404 });
    return { ok: true };
  });
}

module.exports = {
  GIVEAWAY_GROUP_ID, listGroups, listUnits, saveGroup, deleteGroup, createGood, createGiveaway, nextGiveawayCode,
  updateGood, setStatus, deleteGood, toHttpError,
};
