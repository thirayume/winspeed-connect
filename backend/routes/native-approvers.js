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
const { readGlobalDataWindow } = require('../services/global-data-window-store');
const { businessIds } = require('../services/business-identity');

router.use(requireAuth);

const view = r => ({
  empId: r.EmpID, empCode: r.EmpCode, empName: r.EmpName, empType: r.EmpType, empStatus: r.EmpStatus,
  listed: Boolean(r.Listed), enabled: Boolean(r.IsEnabled), note: r.Note || null, updatedAt: r.UpdatedAt || null,
  approvalCount: Number(r.ApprovalCount || 0), appUserCount: Number(r.AppUserCount || 0),
});

// GET /api/master/native-approvers — พนักงาน WinSpeed ทุกคน พร้อมสถานะในรายชื่อผู้อนุมัติ
router.get('/', requireRole('ADMIN', 'C_LEVEL'), async (req, res) => {
  let dataWindow;
  try { dataWindow = await readGlobalDataWindow(); }
  catch { return res.status(503).json({ code: 'DATA_WINDOW_UNAVAILABLE', message: 'ไม่สามารถอ่านวันเริ่มข้อมูลได้' }); }
  try {
    const r = await wfQuery(`
      SELECT e.EmpID, e.EmpCode, e.EmpName, e.EmpType, e.EmpStatus,
             CASE WHEN a.EmpID IS NULL THEN 0 ELSE 1 END AS Listed,
             CASE WHEN a.IsEnabled = 1 THEN 1 ELSE 0 END AS IsEnabled,
             a.Note, a.UpdatedAt,
             (SELECT COUNT(*) FROM wf.NativeDocumentApproval d WHERE d.ApproverEmpID = e.EmpID AND d.RecordedAt >= @globalStartUtc) AS ApprovalCount,
             (SELECT COUNT(*) FROM wf.AppUser u WHERE u.EmpId = CONVERT(varchar(30), e.EmpID)) AS AppUserCount
      FROM dbo.EMEmp e
      LEFT JOIN wf.NativeApproverEmployee a ON a.EmpID = e.EmpID
      ORDER BY e.EmpCode`, { globalStartUtc: { type: sql.DateTime2, value: dataWindow.utcInstant } });
    res.json({ data: (r.recordset || []).map(view) });
  } catch (e) {
    console.error('[native-approvers]', e);
    res.status(500).json({ message: 'โหลดรายชื่อผู้อนุมัติไม่สำเร็จ' });
  }
});

// GET /api/master/native-approvers/history — ประวัติการเปิด/ปิดผู้อนุมัติใบ 116
router.get('/history', requireRole('ADMIN', 'C_LEVEL'), async (req, res) => {
  let dataWindow;
  try { dataWindow = await readGlobalDataWindow(); }
  catch { return res.status(503).json({ code: 'DATA_WINDOW_UNAVAILABLE', message: 'ไม่สามารถอ่านวันเริ่มข้อมูลได้' }); }
  try {
    const r = await wfQuery(`
      SELECT TOP (100) h.HistoryId AS Id, h.EmpID, e.EmpCode, e.EmpName, h.IsEnabled, h.Note, h.ChangedAt AS CreatedAt,
             u.DisplayName AS ChangedByName, u.Username AS ChangedByUsername,
             a.DisplayName AS ChangedByActorName, a.Username AS ChangedByActorUsername
      FROM wf.NativeApproverEmployeeHistory h
      LEFT JOIN dbo.EMEmp e ON e.EmpID = h.EmpID
      LEFT JOIN wf.AppUser u ON u.Id = h.ChangedById
      LEFT JOIN wf.AppUser a ON a.Id = h.ChangedByActorId
      WHERE h.ChangedAt >= @globalStartUtc
      ORDER BY h.HistoryId DESC
    `, { globalStartUtc: { type: sql.DateTime2, value: dataWindow.utcInstant } });
    res.json({ data: r.recordset || [] });
  } catch (e) {
    console.error('[native-approvers:history]', e);
    res.status(500).json({ message: 'โหลดประวัติผู้อนุมัติไม่สำเร็จ' });
  }
});

// PUT /api/master/native-approvers/:empId — เปิด/ปิดพนักงานในรายชื่อผู้อนุมัติ
router.put('/:empId', requireRole('ADMIN', 'C_LEVEL'), async (req, res) => {
  const empId = Number(req.params.empId);
  const { enabled, note, expectedEnabled } = req.body || {};
  if (!Number.isSafeInteger(empId) || empId <= 0) return res.status(400).json({ message: 'รหัสพนักงานไม่ถูกต้อง' });
  if (typeof enabled !== 'boolean') return res.status(400).json({ message: 'ต้องระบุว่าจะเปิดหรือปิดใช้' });
  if (note != null && (typeof note !== 'string' || note.length > 255)) return res.status(400).json({ message: 'หมายเหตุยาวได้ไม่เกิน 255 ตัวอักษร' });
  try {
    const { effective: userId, actor: actorId } = businessIds(req.user);
    if (![userId, actorId].every(v => Number.isSafeInteger(v) && v > 0)) return res.status(401).json({ message: 'ไม่พบผู้ใช้' });
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

      const existing = (await run('SELECT IsEnabled FROM wf.NativeApproverEmployee WITH (UPDLOCK,HOLDLOCK) WHERE EmpID=@emp', { emp: inputs.emp })).recordset?.[0];
      if (expectedEnabled !== undefined) {
        const currentEnabled = existing ? Boolean(existing.IsEnabled) : false;
        if (currentEnabled !== expectedEnabled) {
          const err = new Error('สถานะของผู้อนุมัติเปลี่ยนไปแล้ว กรุณาโหลดข้อมูลใหม่ก่อนบันทึก');
          err.statusCode = 409;
          throw err;
        }
      }

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
    if (e.code === 'IDENTITY_BINDING_INVALID') return res.status(409).json({ code: e.code, message: 'ไม่สามารถยืนยันตัวตนในฐานข้อมูลนี้ได้' });
    if (e.statusCode === 409) return res.status(409).json({ message: e.message });
    console.error('[native-approvers:update]', e);
    res.status(500).json({ message: 'บันทึกไม่สำเร็จ' });
  }
});

// POST /api/master/native-approvers/batch-toggle — เปิด/ปิดผู้อนุมัติแบบชุด
router.post('/batch-toggle', requireRole('ADMIN', 'C_LEVEL'), async (req, res) => {
  const { empIds, enabled, note } = req.body || {};
  if (!Array.isArray(empIds) || empIds.length === 0) {
    return res.status(400).json({ message: 'ต้องระบุ empIds เป็น array' });
  }
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ message: 'ต้องระบุว่าจะเปิดหรือปิดใช้ (enabled)' });
  }
  const cleanEmpIds = empIds.map(Number).filter(id => Number.isSafeInteger(id) && id > 0);
  if (cleanEmpIds.length === 0) {
    return res.status(400).json({ message: 'ไม่มีรหัสพนักงานที่ถูกต้อง' });
  }
  if (note != null && (typeof note !== 'string' || note.length > 255)) {
    return res.status(400).json({ message: 'หมายเหตุยาวได้ไม่เกิน 255 ตัวอักษร' });
  }
  const cleanNote = note != null ? String(note).trim().slice(0, 255) || null : null;

  try {
    const { effective: userId, actor: actorId } = businessIds(req.user);
    if (![userId, actorId].every(v => Number.isSafeInteger(v) && v > 0)) return res.status(401).json({ message: 'ไม่พบผู้ใช้' });
    await wfTransaction(async tx => {
      for (const empId of cleanEmpIds) {
        const reqObj = tx.request();
        reqObj.input('emp', sql.Int, empId);
        reqObj.input('on', sql.Bit, enabled ? 1 : 0);
        reqObj.input('note', sql.NVarChar(255), cleanNote);
        reqObj.input('user', sql.Int, userId);
        reqObj.input('actor', sql.Int, actorId);

        await reqObj.query(`
          UPDATE wf.NativeApproverEmployee WITH (UPDLOCK, HOLDLOCK)
          SET IsEnabled = @on, Note = COALESCE(@note, Note), UpdatedAt = GETUTCDATE(), UpdatedById = @user, UpdatedByActorId = @actor
          WHERE EmpID = @emp;
          IF @@ROWCOUNT = 0
            INSERT INTO wf.NativeApproverEmployee (EmpID, IsEnabled, Note, UpdatedAt, UpdatedById, UpdatedByActorId)
            VALUES (@emp, @on, @note, GETUTCDATE(), @user, @actor);
          INSERT INTO wf.NativeApproverEmployeeHistory (EmpID, IsEnabled, Note, ChangedById, ChangedByActorId)
          VALUES (@emp, @on, @note, @user, @actor);
        `);
      }
    });

    res.json({ ok: true, count: cleanEmpIds.length, enabled, message: `${enabled ? 'เปิดใช้อนุมัติ' : 'ปิดการใช้อนุมัติ'} ${cleanEmpIds.length} ท่านสำเร็จ` });
  } catch (e) {
    if (e.code === 'IDENTITY_BINDING_INVALID') return res.status(409).json({ code: e.code, message: 'ไม่สามารถยืนยันตัวตนในฐานข้อมูลนี้ได้' });
    console.error('[native-approvers:batch-toggle]', e);
    res.status(500).json({ message: 'บันทึกสถานะผู้อนุมัติแบบชุดไม่สำเร็จ' });
  }
});

module.exports = router;
