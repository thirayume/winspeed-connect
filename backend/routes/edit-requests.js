/**
 * ขอแก้ไขใบสั่งขายหลังยืนยัน + Hold รถ (เฟส 5)
 *
 * ทำไมต้องมีของใหม่ ทั้งที่มี wf.UnlockRequest อยู่แล้ว
 *   ของเดิมรับ "เหตุผล" เป็นข้อความอิสระ และไม่รู้ว่าตอนนี้รถอยู่ขั้นไหน
 *   Document Flow ที่ตกลงกันกำหนดว่าการแก้ไขในแต่ละขั้นมีน้ำหนักไม่เท่ากัน
 *     ยืนยันแล้ว        — ขออนุมัติพร้อมเหตุผล
 *     รถลงทะเบียนแล้ว   — ขออนุมัติ และบางเหตุผลต้อง Hold รถ
 *     กำลังโหลดสินค้า   — เหมือนกัน แต่เหตุผลที่ใช้ได้แคบลง
 *     ชั่งออกแล้ว        — ปิดการแก้ไข ส่งต่อ WINSpeed ไป Post Invoice
 *   จึงต้องมีรายการเหตุผลที่จัดการได้ (wf.EditReason) ผูกกับขั้นตอน
 *   ของเดิมไม่ถูกแทนที่ — คำขอที่อนุมัติแล้วยังไปจบที่กลไกปลดล็อกเดิม
 *   (`wf.SalesOrderExt.IsUnlocked`) เพื่อไม่ให้มีสองแหล่งความจริงว่าใบไหนแก้ได้
 *
 * ⚠ ขั้นตอนต้องคำนวณจาก dbo.WGHD ที่ฝั่ง server เท่านั้น ห้ามเชื่อค่าที่ client ส่งมา
 *   ไม่งั้นคนขอจะเลี่ยงการ Hold ได้ด้วยการอ้างว่ายังอยู่ขั้น CONFIRMED
 *
 * ⚠ "Hold รถ" ที่นี่คือธงฝั่งแอป ไม่ได้สั่งเครื่องชั่งให้หยุด
 *   เราเขียน dbo ไม่ได้ตามข้อกำหนด ระบบจึงทำได้แค่แสดงให้คนคุมลานเห็น
 *   และกันไม่ให้แอปเดินงานต่อ — การหยุดรถจริงยังเป็นขั้นตอนของคน
 */
const router = require('express').Router();
const { sql, wfQuery } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { broadcast } = require('../services/socket');

router.use(requireAuth);

const APPROVER_ROLES = ['APPROVER', 'ADMIN', 'MANAGER', 'ACCOUNTING', 'C_LEVEL'];
const REQUESTER_ROLES = ['SALES', 'COUNTER_SALES', 'WAREHOUSE', 'ADMIN', 'MANAGER', 'C_LEVEL'];

const camel = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const camelizeRow = (row) => {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[camel(k)] = v;
  return out;
};
const camelizeRows = (rows) => (rows || []).map(camelizeRow);

/**
 * เทียบว่าเป็นผู้ใช้คนเดียวกันไหม
 *
 * ห้ามใช้ === เทียบ id ที่มาจาก driver กับ id ที่มาจาก JWT โดยตรง
 * ค่าจาก SQL Server ผ่าน msnodesqlv8 บน Windows กลับมาเป็นสตริงบ้างตัวเลขบ้าง
 * ไม่สม่ำเสมอแม้แต่ระหว่างคอลัมน์ในตารางเดียวกัน ส่วน tedious บน Linux คืนเป็นตัวเลข
 * ด่านความปลอดภัยที่เทียบด้วย === จึงกลายเป็นด่านที่ไม่เคยทำงานโดยไม่มีสัญญาณเตือน
 */
const sameUser = (a, b) => {
  const x = Number(a), y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) && x === y;
};

const STAGE_LABEL = {
  CONFIRMED:  'ยืนยันแล้ว',
  REGISTERED: 'รถลงทะเบียนแล้ว',
  LOADING:    'กำลังโหลดสินค้า',
  SHIPPED:    'ชั่งออกแล้ว',
};

/**
 * ขั้นตอนปัจจุบันของใบสั่งขาย อ่านจาก dbo.WGHD เท่านั้น
 *
 * WGHD.Status กลับมาเป็นสตริงจาก driver ต้อง Number() ก่อนเทียบเสมอ
 * รถคันเดียวมีได้หลายใบชั่ง ใช้ค่าสูงสุดเป็นตัวแทนความคืบหน้า
 */
async function resolveStage(soid) {
  const r = await wfQuery(`
    SELECT MAX(CAST(w.Status AS INT)) AS MaxStatus, COUNT(*) AS Rows
    FROM dbo.WGHD w
    WHERE w.SPID = @soid`, { soid: { type: sql.Int, value: Number(soid) } });

  const row = r.recordset[0] || {};
  const n = Number(row.Rows || 0);
  if (n === 0) return { stage: 'CONFIRMED', editable: true, weighRows: 0 };

  switch (Number(row.MaxStatus)) {
    case 1:  return { stage: 'REGISTERED', editable: true,  weighRows: n };
    case 2:  return { stage: 'LOADING',    editable: true,  weighRows: n };
    case 3:  return { stage: 'SHIPPED',    editable: false, weighRows: n };
    default: return { stage: 'CONFIRMED',  editable: true,  weighRows: n };
  }
}

/** ใบสั่งขายมีอยู่จริงไหม และผูกกับเที่ยวไหน */
async function loadTarget(soid) {
  const r = await wfQuery(`
    SELECT TOP 1 CAST(s.SOID AS VARCHAR(50)) AS SOID, RTRIM(s.DocuNo) AS DocuNo,
           CAST(s.CustID AS VARCHAR(50)) AS CustId, RTRIM(c.CustName) AS CustName,
           e.TripId, t.TripCode, t.TransRegistration
    FROM   dbo.SOHD s
    LEFT   JOIN dbo.EMCust c ON c.CustID = s.CustID
    LEFT   JOIN wf.SalesOrderExt e ON TRY_CAST(e.SOID AS INT) = s.SOID
    LEFT   JOIN wf.SalesTrip t ON t.TripId = e.TripId
    WHERE  s.SOID = @soid AND s.DocuType = 103`,
    { soid: { type: sql.Int, value: Number(soid) } });
  return camelizeRow(r.recordset[0]);
}

// ── GET /api/edit-requests/reasons?stage=CONFIRMED ────────────
// รายการเหตุผลที่ใช้ได้ในขั้นนั้น มาจาก wf.EditReason (จัดการผ่าน Master Settings)
router.get('/reasons', async (req, res) => {
  try {
    const { stage } = req.query;
    const inputs = {};
    let where = 'WHERE IsActive = 1';
    if (stage) {
      // AppliesTo เก็บเป็นรายการคั่นด้วยจุลภาค เช่น 'CONFIRMED,REGISTERED'
      // ครอบด้วยจุลภาคทั้งสองข้างก่อนค้นหา กัน REGISTERED ไปแมตช์คำอื่นที่ขึ้นต้นเหมือนกัน
      where += " AND ',' + AppliesTo + ',' LIKE '%,' + @stage + ',%'";
      inputs.stage = { type: sql.VarChar(20), value: String(stage).toUpperCase() };
    }
    const r = await wfQuery(`
      SELECT ReasonCode, ReasonText, AppliesTo, RequiresHold, SortOrder
      FROM wf.EditReason ${where}
      ORDER BY SortOrder, ReasonCode`, inputs);
    res.json({ data: camelizeRows(r.recordset || []) });
  } catch (e) {
    console.error('[edit-requests/reasons]', e);
    res.status(500).json({ message: e.message });
  }
});

// ── GET /api/edit-requests/stage/:soid ────────────────────────
// ให้หน้าจอถามได้ว่าใบนี้อยู่ขั้นไหน แก้ได้ไหม และมีคำขอค้างอยู่หรือเปล่า
router.get('/stage/:soid', async (req, res) => {
  try {
    const target = await loadTarget(req.params.soid);
    if (!target) return res.status(404).json({ message: 'ไม่พบใบสั่งขายนี้' });

    const st = await resolveStage(req.params.soid);
    const pending = await wfQuery(`
      SELECT TOP 1 Id, ReasonCode, HoldTruck, RequestedAt
      FROM wf.EditRequest
      WHERE SOID = @soid AND Status = 'PENDING'
      ORDER BY Id DESC`, { soid: { type: sql.VarChar(50), value: String(req.params.soid) } });

    res.json({
      ...target,
      ...st,
      stageLabel: STAGE_LABEL[st.stage],
      requiresRequest: true,          // หลังยืนยันแล้วต้องขออนุมัติเสมอ
      pendingRequest: camelizeRow(pending.recordset[0]) || null,
    });
  } catch (e) {
    console.error('[edit-requests/stage]', e);
    res.status(500).json({ message: e.message });
  }
});

// ── GET /api/edit-requests ────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { status, soid, tripId, mine } = req.query;
    const inputs = {};
    let where = 'WHERE 1=1';
    if (status) { where += ' AND r.Status = @status'; inputs.status = { type: sql.VarChar(20), value: String(status).toUpperCase() }; }
    if (soid)   { where += ' AND r.SOID = @soid';     inputs.soid   = { type: sql.VarChar(50), value: String(soid) }; }
    if (tripId) { where += ' AND r.TripId = @tripId'; inputs.tripId = { type: sql.Int, value: Number(tripId) }; }
    if (String(mine) === '1') { where += ' AND r.RequestedBy = @me'; inputs.me = { type: sql.Int, value: req.user.sub }; }

    const r = await wfQuery(`
      SELECT r.*, rs.ReasonText, rs.RequiresHold AS ReasonRequiresHold,
             ru.DisplayName AS RequestedByName, rv.DisplayName AS ReviewedByName,
             RTRIM(s.DocuNo) AS DocuNo, RTRIM(c.CustName) AS CustName,
             t.TripCode, t.TransRegistration
      FROM   wf.EditRequest r
      LEFT   JOIN wf.EditReason rs ON rs.ReasonCode = r.ReasonCode
      LEFT   JOIN wf.AppUser  ru ON ru.Id = r.RequestedBy
      LEFT   JOIN wf.AppUser  rv ON rv.Id = r.ReviewedBy
      LEFT   JOIN dbo.SOHD    s  ON s.SOID = TRY_CAST(r.SOID AS INT) AND s.DocuType = 103
      LEFT   JOIN dbo.EMCust  c  ON c.CustID = s.CustID
      LEFT   JOIN wf.SalesTrip t ON t.TripId = r.TripId
      ${where}
      ORDER BY CASE WHEN r.Status = 'PENDING' THEN 0 ELSE 1 END, r.Id DESC`, inputs);

    res.json({ data: camelizeRows(r.recordset || []) });
  } catch (e) {
    console.error('[edit-requests/list]', e);
    res.status(500).json({ message: e.message });
  }
});

// ── POST /api/edit-requests ───────────────────────────────────
router.post('/', requireRole(...REQUESTER_ROLES), async (req, res) => {
  try {
    const { soid, reasonCode, reasonDetail } = req.body || {};
    if (!soid)       return res.status(400).json({ message: 'ต้องระบุใบสั่งขาย' });
    if (!reasonCode) return res.status(400).json({ message: 'ต้องเลือกเหตุผล' });

    const target = await loadTarget(soid);
    if (!target) return res.status(404).json({ message: 'ไม่พบใบสั่งขายนี้' });

    // ขั้นตอนคำนวณที่ server เสมอ ไม่รับค่าจาก client
    const st = await resolveStage(soid);
    if (!st.editable) {
      return res.status(409).json({
        message: `ใบนี้${STAGE_LABEL[st.stage]} ปิดการแก้ไข — ส่งต่อให้ WINSpeed ออกใบกำกับ`,
        stage: st.stage,
      });
    }

    const reason = (await wfQuery(`
      SELECT ReasonCode, ReasonText, AppliesTo, RequiresHold
      FROM wf.EditReason WHERE ReasonCode = @code AND IsActive = 1`,
      { code: { type: sql.VarChar(30), value: String(reasonCode) } })).recordset[0];
    if (!reason) return res.status(400).json({ message: 'ไม่พบเหตุผลนี้ หรือถูกปิดใช้งานแล้ว' });

    const applies = String(reason.AppliesTo || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!applies.includes(st.stage)) {
      return res.status(400).json({
        message: `เหตุผล "${reason.ReasonText}" ใช้กับขั้น${STAGE_LABEL[st.stage]}ไม่ได้`,
        stage: st.stage, appliesTo: applies,
      });
    }

    const detail = String(reasonDetail || '').trim();
    if (reason.ReasonCode === 'OTHER' && detail.length < 5)
      return res.status(400).json({ message: 'เลือก "อื่น ๆ" ต้องระบุรายละเอียดอย่างน้อย 5 ตัวอักษร' });

    const dup = (await wfQuery(`
      SELECT TOP 1 Id FROM wf.EditRequest WHERE SOID = @soid AND Status = 'PENDING'`,
      { soid: { type: sql.VarChar(50), value: String(soid) } })).recordset[0];
    if (dup) return res.status(409).json({ message: `ใบนี้มีคำขอ #${dup.Id} รออนุมัติอยู่แล้ว` });

    // เหตุผลเป็นตัวกำหนดว่าต้อง Hold ไหม ไม่ใช่ผู้ขอ
    // และไม่ Hold เลยเมื่อยังไม่มีรถเข้ามา เพราะไม่มีอะไรให้หยุด
    const hold = reason.RequiresHold && st.stage !== 'CONFIRMED' ? 1 : 0;

    const ins = await wfQuery(`
      INSERT INTO wf.EditRequest (SOID, TripId, StageAtRequest, ReasonCode, ReasonDetail, HoldTruck, RequestedBy)
      OUTPUT inserted.Id
      VALUES (@soid, @tripId, @stage, @code, @detail, @hold, @by)`, {
        soid:   { type: sql.VarChar(50),   value: String(soid) },
        tripId: { type: sql.Int,           value: target.tripId ? Number(target.tripId) : null },
        stage:  { type: sql.VarChar(20),   value: st.stage },
        code:   { type: sql.VarChar(30),   value: reason.ReasonCode },
        detail: { type: sql.NVarChar(1000), value: detail || null },
        hold:   { type: sql.Bit,           value: hold },
        by:     { type: sql.Int,           value: req.user.sub },
      });

    const id = ins.recordset[0].Id;
    broadcast('edit_request', { id, soid: String(soid), action: 'created', hold: !!hold });

    res.json({
      id, stage: st.stage, stageLabel: STAGE_LABEL[st.stage], holdTruck: !!hold,
      message: hold
        ? `ส่งคำขอ #${id} แล้ว — รถถูก Hold จนกว่าจะมีการอนุมัติ`
        : `ส่งคำขอ #${id} แล้ว รออนุมัติ`,
    });
  } catch (e) {
    console.error('[edit-requests/create]', e);
    res.status(500).json({ message: e.message });
  }
});

// ── PATCH /api/edit-requests/:id/approve ──────────────────────
router.patch('/:id/approve', requireRole(...APPROVER_ROLES), async (req, res) => {
  try {
    const { note } = req.body || {};
    const r = (await wfQuery(`SELECT * FROM wf.EditRequest WHERE Id = @id`,
      { id: { type: sql.Int, value: Number(req.params.id) } })).recordset[0];
    if (!r) return res.status(404).json({ message: 'ไม่พบคำขอนี้' });
    if (r.Status !== 'PENDING')
      return res.status(409).json({ message: `คำขอนี้ถูก${r.Status === 'APPROVED' ? 'อนุมัติ' : 'ปิด'}ไปแล้ว` });
    // ⚠ ต้องเทียบเชิงตัวเลข ห้ามใช้ === กับค่าดิบจาก driver
    //   driver คืนชนิดไม่สม่ำเสมอแม้ในตารางเดียวกัน (EditRequest.Id เป็นสตริง
    //   แต่ RequestedBy เป็นตัวเลข) และ sub ใน JWT ก็ขึ้นกับว่าใครสร้าง token
    //   ถ้าเทียบด้วย === ด่านนี้จะ "ไม่ฟ้องอะไรเลย" แล้วปล่อยให้อนุมัติงานตัวเองผ่าน
    if (sameUser(r.RequestedBy, req.user.sub))
      return res.status(403).json({ message: 'อนุมัติคำขอของตัวเองไม่ได้' });

    await wfQuery(`
      UPDATE wf.EditRequest
      SET Status = 'APPROVED', ReviewedBy = @by, ReviewedAt = SYSUTCDATETIME(), ReviewNote = @note
      WHERE Id = @id AND Status = 'PENDING'`, {
        id:   { type: sql.Int, value: Number(req.params.id) },
        by:   { type: sql.Int, value: req.user.sub },
        note: { type: sql.NVarChar(1000), value: note || null },
      });

    // อนุมัติแล้วต้องทำให้ใบแก้ไขได้จริง — ใช้ธงเดิมที่ทั้งระบบอ่านอยู่แล้ว
    // (`ext.IsUnlocked = 1 THEN 'DRAFT'` มีอยู่ใน so.js · reports.js · papertrail.js)
    // จึงไม่เกิดแหล่งความจริงที่สองว่าใบไหนแก้ได้
    let unlocked = false;
    if (r.SOID) {
      const up = await wfQuery(`
        UPDATE wf.SalesOrderExt SET IsUnlocked = 1, UpdatedAt = GETUTCDATE() WHERE SOID = @soid`,
        { soid: { type: sql.VarChar(50), value: String(r.SOID) } });
      unlocked = (up.rowsAffected[0] || 0) > 0;
    }

    broadcast('edit_request', { id: r.Id, soid: r.SOID, action: 'approved' });
    res.json({
      id: r.Id, status: 'APPROVED', unlocked,
      message: unlocked
        ? 'อนุมัติแล้ว ใบสั่งขายกลับมาแก้ไขได้'
        : 'อนุมัติแล้ว — แต่ยังไม่มีแถวฝั่ง wf ของใบนี้ ต้องเปิดใบผ่านแอปก่อนจึงจะปลดล็อกอัตโนมัติได้',
    });
  } catch (e) {
    console.error('[edit-requests/approve]', e);
    res.status(500).json({ message: e.message });
  }
});

// ── PATCH /api/edit-requests/:id/reject ───────────────────────
router.patch('/:id/reject', requireRole(...APPROVER_ROLES), async (req, res) => {
  try {
    const { note } = req.body || {};
    if (!note || String(note).trim().length < 5)
      return res.status(400).json({ message: 'ปฏิเสธคำขอต้องระบุเหตุผลอย่างน้อย 5 ตัวอักษร' });

    const up = await wfQuery(`
      UPDATE wf.EditRequest
      SET Status = 'REJECTED', ReviewedBy = @by, ReviewedAt = SYSUTCDATETIME(), ReviewNote = @note
      WHERE Id = @id AND Status = 'PENDING'`, {
        id:   { type: sql.Int, value: Number(req.params.id) },
        by:   { type: sql.Int, value: req.user.sub },
        note: { type: sql.NVarChar(1000), value: String(note).trim() },
      });
    if (!(up.rowsAffected[0] || 0))
      return res.status(409).json({ message: 'ไม่พบคำขอที่รออนุมัติ (อาจถูกปิดไปแล้ว)' });

    broadcast('edit_request', { id: Number(req.params.id), action: 'rejected' });
    res.json({ id: Number(req.params.id), status: 'REJECTED', message: 'ปฏิเสธคำขอแล้ว — ยกเลิก Hold รถ' });
  } catch (e) {
    console.error('[edit-requests/reject]', e);
    res.status(500).json({ message: e.message });
  }
});

// ── PATCH /api/edit-requests/:id/cancel ───────────────────────
// คนขอถอนคำขอเอง (หรือผู้ดูแล) — Hold ถูกยกเลิกไปด้วย
router.patch('/:id/cancel', async (req, res) => {
  try {
    const r = (await wfQuery(`SELECT * FROM wf.EditRequest WHERE Id = @id`,
      { id: { type: sql.Int, value: Number(req.params.id) } })).recordset[0];
    if (!r) return res.status(404).json({ message: 'ไม่พบคำขอนี้' });
    if (r.Status !== 'PENDING') return res.status(409).json({ message: 'คำขอนี้ถูกปิดไปแล้ว' });

    const isOwner = sameUser(r.RequestedBy, req.user.sub);
    const isAdmin = ['ADMIN', 'C_LEVEL'].includes(req.user.role);
    if (!isOwner && !isAdmin)
      return res.status(403).json({ message: 'ถอนได้เฉพาะคำขอของตัวเอง' });

    await wfQuery(`
      UPDATE wf.EditRequest
      SET Status = 'CANCELLED', ReviewedBy = @by, ReviewedAt = SYSUTCDATETIME(),
          ReviewNote = @note
      WHERE Id = @id AND Status = 'PENDING'`, {
        id:   { type: sql.Int, value: Number(req.params.id) },
        by:   { type: sql.Int, value: req.user.sub },
        note: { type: sql.NVarChar(1000), value: (req.body && req.body.note) || 'ผู้ขอถอนคำขอเอง' },
      });

    broadcast('edit_request', { id: r.Id, soid: r.SOID, action: 'cancelled' });
    res.json({ id: r.Id, status: 'CANCELLED', message: 'ถอนคำขอแล้ว — ยกเลิก Hold รถ' });
  } catch (e) {
    console.error('[edit-requests/cancel]', e);
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;
