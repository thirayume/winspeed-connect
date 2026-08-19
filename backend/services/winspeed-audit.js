'use strict';
/**
 * winspeed-audit.js — เขียนรอยการทำงานของแอปลง dbo.SMAudit
 *
 * ทำไมต้องเขียนลงตารางของ WINSpeed
 *   WINSpeed บันทึกทุกการกระทำของผู้ใช้ไว้ที่ dbo.SMAudit (586,753 แถว ปี 2564–2569)
 *   ผู้ตรวจ ISO ที่เปิดดูรายงาน audit ฝั่ง WINSpeed จะเห็นเอกสารที่แอปเราสร้างขึ้น
 *   แต่ไม่เห็นว่าใครสร้าง เมื่อไร ด้วยเครื่องอะไร — กลายเป็นเอกสารที่อธิบายที่มาไม่ได้
 *
 * ขอบเขต — เขียนเฉพาะจังหวะที่แอป **เปลี่ยนข้อมูลใน dbo จริง** และการส่งของ
 *   ไม่ได้ย้ายบันทึกของแอปมาที่นี่ · wf.SalesOrderAudit ยังเป็นบันทึกหลักเหมือนเดิม
 *   เพราะเก็บการเปลี่ยนสถานะได้ละเอียดกว่าที่โครงของ SMAudit รองรับ
 *
 * ข้อเท็จจริงที่ตรวจจากฐานจริงก่อนออกแบบ
 *   • ไม่มี trigger ตัวไหนเขียน SMAudit — โปรแกรม WINSpeed เขียนเองจากฝั่ง client
 *     (ค้น trigger ทั้ง 1,289 ตัวใน dbo แล้ว)
 *   • audit_id **ไม่ใช่ IDENTITY** ต้องคำนวณ MAX+1 เอง เหมือน SOID/SOInvID
 *     จึงต้องมีการลองใหม่เมื่อชนคีย์ ไม่งั้นสองคำขอพร้อมกันจะล้มหนึ่งอัน
 *   • audit_screen ที่ WINSpeed ใช้มี 76 ค่า · ช่วง 900000000–999999999 **ว่างสนิท**
 *     จึงจองช่วงนี้ให้แอป แยกออกจากของเดิมชัดเจนและกรองออกจากรายงานได้
 *   • audit_system ที่ใช้อยู่: 1,2,3,5,19,20,21,22,415,431,548,-1,10540045 → เลือก 990
 *
 * ⚠ นี่คือการ INSERT ลง schema dbo ซึ่งเป็นข้อยกเว้นเดียวที่ได้รับอนุมัติ
 *   เป็นการ "เพิ่มแถวบันทึก" เท่านั้น ไม่แก้และไม่ลบข้อมูลเดิมแม้แต่แถวเดียว
 */
const os = require('os');
const { sql, dboWrite } = require('../db');

// รหัสหน้าจอของแอป — จองช่วง 9900000xx ซึ่ง WINSpeed ไม่ได้ใช้
const SCREEN = {
  SO_CONFIRM: 990000001,   // ยืนยันใบสั่งขาย → sp_ConfirmSalesOrder เขียน dbo.SOHD
  SO_PICKING: 990000002,   // จัดสินค้า      → dbo.SOHD.PkgStatus = 'Y'
  SO_UNLOCK:  990000003,   // ปลดล็อก        → dbo.SOHD.PkgStatus = 'N'
  SO_SHIP:    990000004,   // ชั่งออก/ส่งของ
};

const AUDIT_SYSTEM = 990;
const MAX_ATTEMPTS = 5;
let appVersion = null;
function version() {
  if (appVersion === null) {
    try { appVersion = `WF ${require('../package.json').version}`; }
    catch { appVersion = 'WF'; }
  }
  return appVersion;
}

/**
 * เขียนหนึ่งแถวลง dbo.SMAudit
 *
 * ไม่โยน error ออกไปหาผู้เรียก — การบันทึกรอยล้มต้องไม่ทำให้การชั่งออกหรือ
 * การยืนยันคำสั่งขายล้มตาม เพราะ wf.SalesOrderAudit บันทึกไว้แล้วในเส้นทางเดียวกัน
 * แต่ต้องเห็นใน log เสมอเพื่อให้ตามแก้ได้
 */
async function writeAudit({ screen, action, docuNo, docuDate, refId, username, note }) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // MAX+1 ต้องอยู่ในคำสั่งเดียวกับ INSERT เพื่อให้ช่วงเวลาที่ชนกันแคบที่สุด
      const r = await dboWrite(`
        DECLARE @id INT = (SELECT ISNULL(MAX(audit_id), 0) + 1 FROM dbo.SMAudit);
        INSERT INTO dbo.SMAudit
          (audit_id, audit_system, audit_screen, audit_datetime, audit_username,
           audit_action, audit_docuno, audit_docudate, audit_columnid, brchid,
           audit_computername, audit_query, Version)
        VALUES
          (@id, @sys, @scr, GETDATE(), @user,
           @act, @docuno, @docudate, @colid, 1,
           @machine, @note, @ver);
        SELECT @id AS auditId;`,
        {
          sys:      { type: sql.Int,            value: AUDIT_SYSTEM },
          scr:      { type: sql.Int,            value: screen },
          user:     { type: sql.NVarChar(100),  value: String(username || 'wf-app').slice(0, 100) },
          act:      { type: sql.Char(10),       value: action },
          docuno:   { type: sql.NVarChar(50),   value: docuNo ? String(docuNo).slice(0, 50) : null },
          docudate: { type: sql.DateTime,       value: docuDate ? new Date(docuDate) : null },
          colid:    { type: sql.Int,            value: Number.isFinite(Number(refId)) ? Number(refId) : null },
          machine:  { type: sql.NVarChar(255),  value: os.hostname().slice(0, 255) },
          note:     { type: sql.NVarChar(255),  value: note ? String(note).slice(0, 255) : null },
          ver:      { type: sql.NVarChar(25),   value: version().slice(0, 25) },
        });
      return r.recordset?.[0]?.auditId ?? null;
    } catch (e) {
      // audit_id ไม่ใช่ IDENTITY — คำขอพร้อมกันจึงคว้าเลขเดียวกันได้ ลองใหม่ได้เลย
      const isDup = /PRIMARY KEY|duplicate key|UNIQUE KEY/i.test(e.message || '');
      if (isDup && attempt < MAX_ATTEMPTS) continue;
      console.error(`[smaudit] เขียนรอยลง dbo.SMAudit ไม่สำเร็จ (${action} ${docuNo}): ${e.message}`);
      return null;
    }
  }
  return null;
}

/** ชื่อผู้ใช้ที่จะปรากฏใน SMAudit — ติดคำนำหน้าให้แยกออกจากผู้ใช้ WINSpeed ได้ทันที */
function auditUser(reqUser) {
  const name = reqUser?.username || reqUser?.displayName || reqUser?.sub || 'unknown';
  return `wf:${name}`;
}

module.exports = { writeAudit, auditUser, SCREEN };
