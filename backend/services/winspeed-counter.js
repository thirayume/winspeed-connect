'use strict';
/**
 * winspeed-counter.js — เดินตัวนับเลขที่เอกสารของ WINSpeed หลังแอปออกเลขไปแล้ว
 *
 * ปัญหาที่แก้
 *   แอปออกเลขใบสั่งขายเองจาก MAX+1 (ดู allocateWorkflowRef) แล้วเขียนลง dbo.SOHD
 *   แต่ไม่เคยบอก dbo.EMRunBrch ซึ่งเป็นตัวนับที่หน้าจอ WINSpeed ใช้เสนอเลขถัดไป
 *
 *   วัดจริงบน UAT — ยืนยันใบจากแอปสองใบ (I69-02424, I69-02427) แล้ว
 *   RunCode 103 ยังค้างที่ I69-02422 · พนักงานที่เปิดใบใหม่ใน WINSpeed จะได้
 *   I69-02423 ซึ่งถูกใช้ไปแล้ว และจะไล่ชนต่อไปทุกใบจนตัวนับตามทัน
 *
 *   เป็นกลไกเดียวกับที่ทำให้ J69-02806 ชนกันเมื่อ 18 ส.ค. ต่างกันแค่คราวนั้น
 *   เกิดจากสคริปต์แทรกข้อมูล คราวนี้เกิดจากตัวแอปเอง
 *
 * ⚠ นี่คือการ **แก้ค่าเดิมใน dbo** ซึ่งหนักกว่าการเพิ่มแถวแบบ SMAudit
 *   จึงจำกัดขอบเขตไว้แคบที่สุด
 *     • แตะเฉพาะคอลัมน์ LastNo ของแถวที่คุมชุดเลขนั้นเท่านั้น
 *     • **ไม่เคยถอยหลัง** — อัปเดตเมื่อเลขใหม่มากกว่าค่าเดิมเท่านั้น
 *       ถ้าพนักงานคีย์ใน WINSpeed แซงหน้าไปแล้ว ค่าของเขาชนะเสมอ
 *     • เทียบเป็นข้อความได้เพราะรูปแบบเป็นความกว้างคงที่ (Iyy-00000)
 *     • ล้มเหลวไม่ทำให้การยืนยันคำสั่งขายล้มตาม แต่ต้องขึ้น log
 */
const { sql, dboWrite } = require('../db');

// ชุดอักษรนำหน้า → RunCode ที่คุมชุดนั้นใน dbo.EMRunBrch
// ตรวจจากฐานจริง: RunCode 103 = Iyy-00000 · RunCode 104 = Kyy-00000
const RUN_CODE_BY_PREFIX = { I: '103', K: '104' };

async function advanceDocuNoCounter(docuNo) {
  const no = String(docuNo || '').trim();
  const runCode = RUN_CODE_BY_PREFIX[no.charAt(0).toUpperCase()];
  if (!runCode || !/^[IK]\d{2}-\d{5}$/.test(no)) {
    // เลขที่ไม่ตรงรูปแบบมาตรฐาน (เช่น เอกสารทดสอบ) — ไม่แตะตัวนับ
    return { updated: false, reason: 'รูปแบบเลขที่ไม่เข้าเกณฑ์' };
  }

  try {
    const r = await dboWrite(`
      UPDATE dbo.EMRunBrch
      SET LastNo = @no
      WHERE RunCode = @rc
        AND BrchID = 1
        AND (LastNo IS NULL OR RTRIM(LastNo) < @no)`,
      {
        no: { type: sql.VarChar(30), value: no },
        rc: { type: sql.VarChar(30), value: runCode },
      });
    const updated = (r.rowsAffected?.[0] || 0) > 0;
    if (updated) console.log(`[emrunbrch] เดินตัวนับ RunCode ${runCode} → ${no}`);
    return { updated, runCode };
  } catch (e) {
    console.error(`[emrunbrch] เดินตัวนับไม่สำเร็จ (${no}): ${e.message}`);
    return { updated: false, error: e.message };
  }
}

module.exports = { advanceDocuNoCounter, RUN_CODE_BY_PREFIX };
