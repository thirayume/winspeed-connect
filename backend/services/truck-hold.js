/**
 * Hold รถให้มีผลถึงฝั่ง WINSpeed
 *
 * คันโยกเดียวที่มี
 *   `dbo.SOHD.OnHold` — ฟิลด์ของ WINSpeed เองสำหรับพักใบสั่งขาย
 *   เราเขียนเฉพาะคอลัมน์นี้กับ `StatusRemark` เท่านั้น
 *
 * สิ่งที่ห้ามแตะเด็ดขาด
 *   `dbo.WGHD` · `dbo.WGDT` · `dbo.WGDTReport` — ข้อกำหนดโครงการกำหนดให้
 *   อ่านอย่างเดียว และทั้งสามตารางเป็น state machine ของ TruckScale เอง
 *   เขียนแทรกเสี่ยงทำให้การชั่งจริงพัง
 *
 * 🔴 ปิดคำถามแล้ว 5 ก.ย. 2569 — **TruckScale ไม่ได้ใช้ฟิลด์ OnHold**
 *   ทีม TruckScale ยืนยันเองเมื่อสอบถามไป
 *   เดิมเราตั้งข้อสังเกตว่า "ยังพิสูจน์ไม่ได้" เพราะทุกแถวใน SOHD เป็น 'N' มาตลอด
 *   จึงไม่มีพฤติกรรมให้สังเกต และอ่าน source ของ TruckScale ไม่ได้
 *   ตอนนี้ได้คำตอบจากคนที่เป็นเจ้าของระบบนั้นแล้ว
 *
 *   **ผลคือการเขียน OnHold='Y' ไม่ได้หยุดรถที่เครื่องชั่ง**
 *   มันแค่เปลี่ยนค่าในคอลัมน์ของ WINSpeed ที่ไม่มีใครอ่านในเส้นทางการชั่ง
 *   Hold ในระบบนี้จึงเป็น **การแจ้งเตือนในแอปเท่านั้น**
 *   ห้ามให้หน้าจอหรือเอกสารสื่อว่ารถจะถูกหยุดโดยอัตโนมัติ
 *   ถ้าต้องหยุดรถจริง ต้องมีคนไปบอกพนักงานเครื่องชั่ง
 *
 * ⚠ TRUCK_HOLD_WRITE_WINSPEED ปิดไว้เป็นค่าเริ่มต้น และ**ควรปิดต่อไป**
 *   เปิดแล้วได้แต่ความเสี่ยงจากการเขียนตาราง WINSpeed โดยไม่ได้ประโยชน์
 *   เก็บกลไกไว้เผื่อวันหนึ่ง WINSpeed หรือ TruckScale เริ่มอ่านฟิลด์นี้
 *   ตอนปิดอยู่ ระบบยังบันทึกเจตนาลง wf.TruckHoldLog (Applied = 0)
 *   ซึ่งเป็นร่องรอยการตรวจสอบว่าใครสั่ง Hold เมื่อไร ด้วยเหตุผลอะไร
 *
 * ⚠ TRUCK_HOLD_VERIFIED เลิกใช้แล้ว
 *   มันมีไว้รอผลทดสอบกับรถจริง ซึ่งตอนนี้ได้คำตอบมาทางอื่นแล้วว่า "ไม่อ่าน"
 *   ต่อให้ตั้งเป็น true ก็ไม่ทำให้รถหยุด โค้ดจึงไม่ใช้ค่านี้ตัดสินใจอะไรอีก
 */
const { sql, wfQuery } = require('../db');

const SETTING_ENABLED  = 'TRUCK_HOLD_WRITE_WINSPEED';
const SETTING_PREFIX   = 'TRUCK_HOLD_REMARK_PREFIX';
const SETTING_VERIFIED = 'TRUCK_HOLD_VERIFIED';

async function getSetting(key, fallback) {
  const r = await wfQuery(`SELECT SettingValue FROM wf.SystemSetting WHERE SettingKey = @k`,
    { k: { type: sql.VarChar(100), value: key } });
  const v = r.recordset[0] ? r.recordset[0].SettingValue : null;
  return v === null || v === undefined ? fallback : String(v);
}

const isOn = (v) => String(v).trim().toLowerCase() === 'true';

/** สถานะของกลไกนี้ ให้หน้าจอบอกผู้ใช้ได้ตรงความจริง */
async function getHoldCapability() {
  const [enabled, verified] = await Promise.all([
    getSetting(SETTING_ENABLED, 'false'),
    getSetting(SETTING_VERIFIED, 'false'),
  ]);
  return {
    writesToWinspeed: isOn(enabled),
    verifiedOnRealTruck: isOn(verified),
    // ทีม TruckScale ยืนยัน 5 ก.ย. 2569 ว่าไม่ได้อ่านฟิลด์นี้
    // ค่านี้เป็นค่าคงที่โดยตั้งใจ ไม่ใช่การตั้งค่า — จะเป็น true ได้ก็ต่อเมื่อ
    // มีใครไปทำให้ TruckScale อ่าน OnHold จริง ซึ่งเราแก้ระบบนั้นไม่ได้
    winspeedFieldIsRead: false,
    // ข้อความที่หน้าจอควรใช้ — เขียนไว้ที่เดียวกันกับตรรกะ จะได้ไม่เพี้ยน
    // ไม่ว่าสวิตช์จะเปิดหรือปิด รถก็ไม่ถูกหยุดโดยอัตโนมัติ ห้ามสื่อเป็นอย่างอื่น
    label: !isOn(enabled)
      ? 'Hold เป็นการแจ้งเตือนในแอปเท่านั้น — ต้องแจ้งพนักงานเครื่องชั่งด้วยตัวเอง'
      : 'Hold เขียน OnHold ลง WINSpeed แล้ว แต่เครื่องชั่งไม่ได้อ่านฟิลด์นี้ '
        + '(ทีม TruckScale ยืนยัน) — รถจะไม่หยุดเอง ต้องแจ้งพนักงานเครื่องชั่ง',
  };
}

/** อ่านค่าปัจจุบันจาก SOHD ก่อนจะเขียนทับ */
async function readCurrent(soid) {
  const r = await wfQuery(`
    SELECT TOP 1 s.OnHold, CAST(s.StatusRemark AS VARCHAR(255)) AS StatusRemark
    FROM dbo.SOHD s WHERE s.SOID = @soid AND s.DocuType = 103`,
    { soid: { type: sql.Int, value: Number(soid) } });
  return r.recordset[0] || null;
}

async function log(entry) {
  await wfQuery(`
    INSERT INTO wf.TruckHoldLog
      (SOID, EditRequestId, Action, PrevOnHold, NewOnHold, PrevRemark, NewRemark, Applied, SkipReason, ActedBy)
    VALUES (@soid, @req, @act, @po, @no, @pr, @nr, @ap, @sk, @by)`, {
      soid: { type: sql.VarChar(50),   value: String(entry.soid) },
      req:  { type: sql.Int,           value: entry.editRequestId != null ? Number(entry.editRequestId) : null },
      act:  { type: sql.VarChar(20),   value: entry.action },
      po:   { type: sql.Char(1),       value: entry.prevOnHold || null },
      no:   { type: sql.Char(1),       value: entry.newOnHold || null },
      pr:   { type: sql.VarChar(255),  value: entry.prevRemark || null },
      nr:   { type: sql.VarChar(255),  value: entry.newRemark || null },
      ap:   { type: sql.Bit,           value: entry.applied ? 1 : 0 },
      sk:   { type: sql.NVarChar(200), value: entry.skipReason || null },
      by:   { type: sql.Int,           value: Number(entry.actedBy) },
    });
}

/**
 * สั่งพักใบสั่งขายฝั่ง WINSpeed
 * คืน { applied, reason } — applied=false ไม่ใช่ error แต่แปลว่ายังไม่ได้เขียน
 */
async function applyHold(soid, { editRequestId, note, actedBy }) {
  const cur = await readCurrent(soid);
  if (!cur) {
    await log({ soid, editRequestId, action: 'HOLD', applied: false,
      skipReason: 'ไม่พบใบสั่งขายใน dbo.SOHD', actedBy });
    return { applied: false, reason: 'ไม่พบใบสั่งขายนี้' };
  }

  const enabled = isOn(await getSetting(SETTING_ENABLED, 'false'));
  if (!enabled) {
    await log({ soid, editRequestId, action: 'HOLD', applied: false,
      prevOnHold: cur.OnHold, prevRemark: cur.StatusRemark,
      skipReason: 'สวิตช์ TRUCK_HOLD_WRITE_WINSPEED ปิดอยู่', actedBy });
    return { applied: false, reason: 'สวิตช์ส่ง Hold ถึง WINSpeed ปิดอยู่ — Hold มีผลเฉพาะในแอป' };
  }

  if (cur.OnHold === 'Y') {
    await log({ soid, editRequestId, action: 'HOLD', applied: false,
      prevOnHold: cur.OnHold, prevRemark: cur.StatusRemark,
      skipReason: 'ใบนี้ถูกพักอยู่แล้วก่อนหน้า', actedBy });
    return { applied: false, reason: 'ใบนี้ถูกพักอยู่แล้ว' };
  }

  const prefix = await getSetting(SETTING_PREFIX, 'WF-HOLD');
  const remark = `${prefix}#${editRequestId || '-'} ${String(note || '').trim()}`.slice(0, 255);

  // เขียนเฉพาะสองคอลัมน์นี้ ไม่แตะคีย์ จึงไม่ปลุกตรรกะ cascade ใน tU_SOHD
  const up = await wfQuery(`
    UPDATE dbo.SOHD SET OnHold = 'Y', StatusRemark = @rm
    WHERE SOID = @soid AND DocuType = 103 AND ISNULL(OnHold,'N') <> 'Y'`, {
      soid: { type: sql.Int, value: Number(soid) },
      rm:   { type: sql.VarChar(255), value: remark },
    });

  const ok = (up.rowsAffected[0] || 0) > 0;
  await log({ soid, editRequestId, action: 'HOLD', applied: ok,
    prevOnHold: cur.OnHold, newOnHold: ok ? 'Y' : null,
    prevRemark: cur.StatusRemark, newRemark: ok ? remark : null,
    skipReason: ok ? null : 'UPDATE ไม่โดนแถวใด', actedBy });

  return ok
    ? { applied: true, reason: 'ตั้ง OnHold=Y ใน WINSpeed แล้ว' }
    : { applied: false, reason: 'เขียนไม่สำเร็จ — ไม่มีแถวถูกอัปเดต' };
}

/**
 * ปลดพัก — คืนค่าเดิมจากบันทึก ไม่ใช่เดาว่าเดิมเป็น 'N'
 * ถ้าไม่เคยเขียนสำเร็จ ก็ไม่ต้องคืนอะไร
 */
async function releaseHold(soid, { editRequestId, actedBy }) {
  const last = (await wfQuery(`
    SELECT TOP 1 PrevOnHold, PrevRemark
    FROM wf.TruckHoldLog
    WHERE SOID = @soid AND Action = 'HOLD' AND Applied = 1
    ORDER BY Id DESC`, { soid: { type: sql.VarChar(50), value: String(soid) } })).recordset[0];

  if (!last) {
    await log({ soid, editRequestId, action: 'RELEASE', applied: false,
      skipReason: 'ไม่เคยเขียน Hold ลง WINSpeed จึงไม่มีอะไรให้คืน', actedBy });
    return { applied: false, reason: 'ไม่มีการพักฝั่ง WINSpeed ที่ต้องคืน' };
  }

  const cur = await readCurrent(soid);
  const prevOnHold = last.PrevOnHold || 'N';

  const up = await wfQuery(`
    UPDATE dbo.SOHD SET OnHold = @oh, StatusRemark = @rm
    WHERE SOID = @soid AND DocuType = 103`, {
      soid: { type: sql.Int, value: Number(soid) },
      oh:   { type: sql.Char(1), value: prevOnHold },
      rm:   { type: sql.VarChar(255), value: last.PrevRemark || null },
    });

  const ok = (up.rowsAffected[0] || 0) > 0;
  await log({ soid, editRequestId, action: 'RELEASE', applied: ok,
    prevOnHold: cur ? cur.OnHold : null, newOnHold: prevOnHold,
    prevRemark: cur ? cur.StatusRemark : null, newRemark: last.PrevRemark || null,
    skipReason: ok ? null : 'UPDATE ไม่โดนแถวใด', actedBy });

  return ok
    ? { applied: true, reason: `คืนค่า OnHold=${prevOnHold} ให้ WINSpeed แล้ว` }
    : { applied: false, reason: 'คืนค่าไม่สำเร็จ' };
}

module.exports = { applyHold, releaseHold, getHoldCapability };
