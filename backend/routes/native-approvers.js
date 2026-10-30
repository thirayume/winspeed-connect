'use strict';
/**
 * Master Data — รายชื่อผู้อนุมัติเอกสาร WinSpeed (wf.NativeApproverEmployee)
 *
 * ทำไมต้องมีรายการนี้ (owner decision 30/10/2569)
 *   ใบ 116 ที่แอปสร้างไม่เขียน AppvEmpID แล้ว (WinSpeed เองแทบไม่เคยใช้ช่องนี้)
 *   พนักงานผู้อนุมัติจึงเก็บไว้ใน wf.NativeDocumentApproval แทน และต้องเป็นพนักงาน
 *   ที่เปิดใช้อยู่ในรายการนี้ migration 160 ใส่พนักงานทุกคนจาก dbo.EMEmp ไว้ก่อน
 *   เจ้าของกระบวนการคัดออกเองจากหน้านี้
 *
 * สิ่งที่จงใจไม่ให้ทำ
 *   - ลบแถว — ประวัติการอนุมัติอ้างถึงพนักงานคนนี้ ให้ปิดใช้แทน
 *   - แก้ข้อมูลพนักงานใน dbo.EMEmp — หน้านี้อ่านอย่างเดียว ข้อมูลพนักงานแก้ใน WinSpeed
 * ทุกการเปลี่ยนแปลงเก็บผู้ทำจริง (รวม Access As) ใน wf.NativeApproverEmployeeHistory
 */
const router = require('express').Router();
const { sql, wfQuery, wfTransaction } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

const view = r => ({
  empId: r.EmpID, empCode: r.EmpCode, empName: r.EmpName, empType: r.EmpType, empStatus: r.EmpStatus,
  listed: Boolean(r.Listed), enabled: Boolean(r.IsEnabled), note: r.Note || null, updatedAt: r.UpdatedAt || null,
  approvalCount: Number(r.ApprovalCount || 0), appUserCount: Number(r.AppUserCount || 0),
});

// GET /api/master/native-approvers — พนักงาน WinSpeed ทุกคน พร้อมสถานะในรายชื่อผู้อนุมัติ
router.get('/', requireRole('ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const r = await wfQuery(`
      SELECT e.EmpID, e.EmpCode, e.EmpName, e.EmpType, e.EmpStatus,
             CASE WHEN a.EmpID IS NULL THEN 0 ELSE 1 END AS Listed,
             CASE WHEN a.IsEnabled = 1 THEN 1 ELSE 0 END AS IsEnabled,
             a.Note, a.UpdatedAt,
             (SELECT COUNT(*) FROM wf.NativeDocumentApproval d WHERE d.ApproverEmpID = e.EmpID) AS ApprovalCount,
             (SELECT COUNT(*) FROM wf.AppUser u WHERE u.EmpId = CONVERT(varchar(30), e.EmpID)) AS AppUserCount
      FROM dbo.EMEmp e
      LEFT JOIN wf.NativeApproverEmployee a ON a.EmpID = e.EmpID
      ORDER BY e.EmpCode`);
    res.json({ data: (r.recordset || []).map(view) });
  } catch (e) {
    console.error('[native-approvers]', e);
    res.status(500).json({ message: 'โหลดรายชื่อผู้อนุมัติไม่สำเร็จ' });
  }
});

// PUT /api/master/native-approvers/:empId — เปิด/ปิดพนักงานในรายชื่อผู้อนุมัติ
router.put('/:empId', requireRole('ADMIN', 'C_LEVEL'), async (req, res) => {
  const empId = Number(req.params.empId);
  const { enabled, note } = req.body || {};
  if (!Number.isSafeInteger(empId) || empId <= 0) return res.status(400).json({ message: 'รหัสพนักงานไม่ถูกต้อง' });
  if (typeof enabled !== 'boolean') return res.status(400).json({ message: 'ต้องระบุว่าจะเปิดหรือปิดใช้' });
  if (note != null && (typeof note !== 'string' || note.length > 255)) return res.status(400).json({ message: 'หมายเหตุยาวได้ไม่เกิน 255 ตัวอักษร' });
  const userId = Number(req.user?.sub), actorId = Number(req.user?.actorSub || req.user?.sub);
  if (![userId, actorId].every(v => Number.isSafeInteger(v) && v > 0)) return res.status(401).json({ message: 'ไม่พบผู้ใช้' });
  try {
    const result = await wfTransaction(async tx => {
      const run = (text, inputs) => {
        const q = tx.request();
        for (const [k, [type, value]] of Object.entries(inputs)) q.input(k, type, value);
        return q.query(text);
      };
      const inputs = {
        emp: [sql.Int, empId], on: [sql.Bit, enabled ? 1 : 0], note: [sql.NVarChar(255), note == null ? null : note.trim() || null],
        user: [sql.Int, userId], actor: [sql.Int, actorId],
      };
      const found = (await run('SELECT EmpID FROM dbo.EMEmp WHERE EmpID=@emp', { emp: inputs.emp })).recordset || [];
      if (found.length !== 1) return null;
      await run(`
        UPDATE wf.NativeApproverEmployee WITH(UPDLOCK,HOLDLOCK)
        SET IsEnabled=@on, Note=COALESCE(@note,Note), UpdatedAt=GETUTCDATE(), UpdatedById=@user, UpdatedByActorId=@actor
        WHERE EmpID=@emp;
        IF @@ROWCOUNT=0
          INSERT INTO wf.NativeApproverEmployee(EmpID,IsEnabled,Note,UpdatedAt,UpdatedById,UpdatedByActorId)
          VALUES(@emp,@on,@note,GETUTCDATE(),@user,@actor);
        INSERT INTO wf.NativeApproverEmployeeHistory(EmpID,IsEnabled,Note,ChangedById,ChangedByActorId)
        VALUES(@emp,@on,@note,@user,@actor);`, inputs);
      return { empId, enabled };
    });
    if (!result) return res.status(404).json({ message: 'ไม่พบพนักงานนี้ใน WinSpeed' });
    res.json({ ...result, message: enabled ? 'เพิ่มในรายชื่อผู้อนุมัติแล้ว' : 'นำออกจากรายชื่อผู้อนุมัติแล้ว' });
  } catch (e) {
    console.error('[native-approvers:update]', e);
    res.status(500).json({ message: 'บันทึกไม่สำเร็จ' });
  }
});

module.exports = router;
