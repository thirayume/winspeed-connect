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
const { sql, wfQuery, wfTransaction } = require('../db');
const { requireAuth, requireRole, requireCapability } = require('../middleware/auth');
const { getVisibleScope, scopeFilter, inScope } = require('../services/visible-scope');
const { broadcast } = require('../services/socket');
const truckHold = require('../services/truck-hold');
const { findIssuedDelivery } = require('../services/native-status');
const {
  computeTripCustomerSnapshot,
  canUserApproveMultiCustTrip,
} = require('../services/trip-multi-cust-approval');
const { assertPricesAboveCost } = require('../services/cost-authority');
const { approvalIdentity, bothHaveRole, isSubmitter, adminApprovesOwn } = require('../services/approval-identity');
const { businessIds } = require('../services/business-identity');
const { currentActorId, hasColumn } = require('../services/request-context');

async function ensureScopedAuditIdentity(user) {
  const ids = businessIds(user);
  if (!ids.actor || !ids.effective) throw Object.assign(new Error('ไม่สามารถยืนยันตัวตนผู้บันทึกได้'), { status: 401 });
  if (ids.actor !== ids.effective && (currentActorId() !== ids.actor || !await hasColumn(wfQuery, 'wf.ChangeEvent', 'ActorUserId')))
    throw Object.assign(new Error('ไม่สามารถบันทึกตัวตนผู้ทำรายการแทนได้'), { status: 503 });
  return ids;
}
async function auditScopedChange(tx, req, { entityType, id, action, before, after, note }) {
  const ids = await ensureScopedAuditIdentity(req.user);
  await require('../services/policy-contract').logChangeEvent(tx, { entityType, entityId: String(id), action,
    beforeJson: before, afterJson: after, reasonText: note || null,
    userId: ids.effective, ipAddress: req.ip });
}
async function auditApprovalDecision(tx, req, entityType, id, status, note) {
  return auditScopedChange(tx, req, { entityType, id, action: status, before: { status: 'PENDING' }, after: { status }, note });
}

router.use(requireAuth);

const APPROVER_ROLES = ['APPROVER', 'ADMIN', 'MANAGER', 'ACCOUNTING', 'C_LEVEL'];
const REQUESTER_ROLES = ['SALES', 'COUNTER_SALES', 'WAREHOUSE', 'ADMIN', 'MANAGER', 'C_LEVEL'];

// Direct action URLs must not bypass the date boundary applied to the list.
async function requireCurrentEditRequest(req, res, next) {
  try {
    const dataWindow = await require('../services/global-data-window-store').readGlobalDataWindow();
    const row = await wfQuery('SELECT 1 AS ok FROM wf.EditRequest WHERE Id = @id AND RequestedAt >= @globalStartUtc', {
      id: { type: sql.Int, value: Number(req.params.id) || 0 },
      globalStartUtc: { type: sql.DateTime2, value: dataWindow.utcInstant },
    });
    if (!row.recordset?.[0]) return res.status(404).json({ message: 'ไม่พบคำขอนี้' });
    req.editRequestStartUtc = dataWindow.utcInstant;
    next();
  } catch (e) { res.status(500).json({ message: e.message }); }
}

// R12 O-4: a team-scoped approver (a MANAGER placed on the org chart) acts only on requests
// from its own + team scope, or on bills owned by them — the same rows its list shows.
// Out-of-scope ids answer 404, as if the request did not exist.
async function requireEditRequestInScope(req, res, next) {
  try {
    const scope = await getVisibleScope(req.user);
    const actor = require('../services/business-identity').actorPerspective(req.user);
    const actorScope = actor === req.user ? scope : await getVisibleScope(actor);
    if (scope.all && actorScope.all) return next();
    const r = (await wfQuery(`
      SELECT r.RequestedBy, CAST(s.EmpID AS VARCHAR(20)) AS EmpID
      FROM wf.EditRequest r
      LEFT JOIN dbo.SOHD s WITH (NOLOCK) ON s.SOID = CASE
        WHEN LTRIM(RTRIM(r.SOID)) NOT LIKE '%[^0-9]%' AND LEN(LTRIM(RTRIM(r.SOID))) BETWEEN 1 AND 9
        THEN CAST(LTRIM(RTRIM(r.SOID)) AS INT) END
      WHERE r.Id = @id`, { id: { type: sql.Int, value: Number(req.params.id) } })).recordset?.[0];
    const owner = r && { userId: r.RequestedBy, empId: r.EmpID };
    if (!r || !inScope(scope, owner) || !inScope(actorScope, owner)) {
      return res.status(404).json({ message: 'ไม่พบคำขอนี้' });
    }
    next();
  } catch (e) { res.status(500).json({ message: e.message }); }
}

async function requirePriceApprovalInScope(req, res, next) {
  try {
    const scope = await getVisibleScope(req.user);
    const actor = require('../services/business-identity').actorPerspective(req.user);
    const actorScope = actor === req.user ? scope : await getVisibleScope(actor);
    if (scope.all && actorScope.all) return next();
    const r = (await wfQuery(`
      SELECT pa.RequestedBy, so.SalesUserId
      FROM wf.PriceApproval pa LEFT JOIN wf.SalesOrder so ON so.Id = pa.SoId
      WHERE pa.Id = @id`, { id: { type: sql.Int, value: Number(req.params.id) } })).recordset?.[0];
    const owner = { userId: r?.RequestedBy, extraUserIds: [r?.SalesUserId] };
    if (!r || !inScope(scope, owner) || !inScope(actorScope, owner)) {
      return res.status(404).json({ message: 'ไม่พบคำขออนุมัติราคานี้' });
    }
    next();
  } catch (e) { res.status(500).json({ message: e.message }); }
}

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
  const dataWindow = await require('../services/global-data-window-store').readGlobalDataWindow();
  const r = await wfQuery(`
    SELECT TOP 1 CAST(s.SOID AS VARCHAR(50)) AS SOID, RTRIM(s.DocuNo) AS DocuNo,
           CAST(s.CustID AS VARCHAR(50)) AS CustId, RTRIM(c.CustName) AS CustName,
           CAST(s.EmpID AS VARCHAR(20)) AS EmpId, e.SalesUserId,
           e.TripId, t.TripCode, t.TransRegistration
    FROM   dbo.SOHD s
    LEFT   JOIN dbo.EMCust c ON c.CustID = s.CustID
    LEFT   JOIN wf.SalesOrderExt e ON (
             CASE 
               WHEN e.SOID IS NOT NULL 
                AND LTRIM(RTRIM(e.SOID)) NOT LIKE '%[^0-9]%' 
                AND LTRIM(RTRIM(e.SOID)) <> '' 
                AND (
                  LEN(LTRIM(RTRIM(e.SOID))) <= 9 
                  OR (LEN(LTRIM(RTRIM(e.SOID))) = 10 AND CAST(LTRIM(RTRIM(e.SOID)) AS BIGINT) <= 2147483647)
                )
               THEN CAST(LTRIM(RTRIM(e.SOID)) AS INT) 
               ELSE NULL 
             END
           ) = s.SOID
    LEFT   JOIN wf.SalesTrip t ON t.TripId = e.TripId
    WHERE  s.SOID = @soid AND s.DocuType = 103 AND s.DocuDate >= @globalStartDate`,
    { soid: { type: sql.Int, value: Number(soid) }, globalStartDate: { type: sql.Date, value: dataWindow.businessDate } });
  return camelizeRow(r.recordset[0]);
}

async function canSeeEditTarget(user, target) {
  const { actorPerspective } = require('../services/business-identity');
  const effectiveScope = await getVisibleScope(user);
  const actor = actorPerspective(user);
  const actorScope = actor === user ? effectiveScope : await getVisibleScope(actor);
  const ownership = { userId: target.salesUserId, empId: target.empId };
  return inScope(effectiveScope, ownership) && inScope(actorScope, ownership);
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

// ── GET /api/edit-requests/hold-capability ────────────────────
// บอกว่า "Hold" ตอนนี้แปลว่าอะไรกันแน่ หน้าจอต้องใช้ค่านี้พูด
// ไม่ใช่สมมติเอาเองว่ารถถูกหยุดแล้ว
router.get('/hold-capability', async (req, res) => {
  try {
    res.json(await truckHold.getHoldCapability());
  } catch (e) {
    console.error('[edit-requests/hold-capability]', e);
    res.status(500).json({ message: e.message });
  }
});

// ── GET /api/edit-requests/stage/:soid ────────────────────────
// ให้หน้าจอถามได้ว่าใบนี้อยู่ขั้นไหน แก้ได้ไหม และมีคำขอค้างอยู่หรือเปล่า
router.get('/stage/:soid', async (req, res) => {
  try {
    const target = await loadTarget(req.params.soid);
    if (!target || !await canSeeEditTarget(req.user, target)) return res.status(404).json({ message: 'ไม่พบใบสั่งขายนี้' });

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
    const dataWindow = await require('../services/global-data-window-store').readGlobalDataWindow();
    const inputs = { globalStartUtc: { type: sql.DateTime2, value: dataWindow.utcInstant } };
    let where = 'WHERE r.RequestedAt >= @globalStartUtc';
    if (status) { where += ' AND r.Status = @status'; inputs.status = { type: sql.VarChar(20), value: String(status).toUpperCase() }; }
    if (soid)   { where += ' AND r.SOID = @soid';     inputs.soid   = { type: sql.VarChar(50), value: String(soid) }; }
    if (tripId) { where += ' AND r.TripId = @tripId'; inputs.tripId = { type: sql.Int, value: Number(tripId) }; }
    if (String(mine) === '1') { where += ' AND r.RequestedBy = @me'; inputs.me = { type: sql.Int, value: req.user.sub }; }
    // R12 O-4: requests by the user's own + team, or on bills owned by them
    const scope = await getVisibleScope(req.user);
    if (!scope.all) {
      const byReq = scopeFilter(scope, { userCol: 'r.RequestedBy', empCol: 's.EmpID', prefix: 'er' });
      where += ` AND ${byReq.sql}`;
      Object.assign(inputs, byReq.inputs);
    }

    const r = await wfQuery(`
      SELECT r.*, rs.ReasonText, rs.RequiresHold AS ReasonRequiresHold,
             ru.DisplayName AS RequestedByName, rv.DisplayName AS ReviewedByName,
             RTRIM(s.DocuNo) AS DocuNo, RTRIM(c.CustName) AS CustName,
             t.TripCode, t.TransRegistration
      FROM   wf.EditRequest r
      LEFT   JOIN wf.EditReason rs ON rs.ReasonCode = r.ReasonCode
      LEFT   JOIN wf.AppUser  ru ON ru.Id = r.RequestedBy
      LEFT   JOIN wf.AppUser  rv ON rv.Id = r.ReviewedBy
      LEFT   JOIN dbo.SOHD    s  ON s.SOID = (
               CASE 
                 WHEN r.SOID IS NOT NULL 
                  AND LTRIM(RTRIM(r.SOID)) NOT LIKE '%[^0-9]%' 
                  AND LTRIM(RTRIM(r.SOID)) <> '' 
                  AND (
                    LEN(LTRIM(RTRIM(r.SOID))) <= 9 
                    OR (LEN(LTRIM(RTRIM(r.SOID))) = 10 AND CAST(LTRIM(RTRIM(r.SOID)) AS BIGINT) <= 2147483647)
                  )
                 THEN CAST(LTRIM(RTRIM(r.SOID)) AS INT) 
                 ELSE NULL 
               END
             ) AND s.DocuType = 103
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
router.post('/', requireCapability('edit-request.create'), async (req, res) => {
  try {
    const { soid, reasonCode, reasonDetail } = req.body || {};
    if (!soid)       return res.status(400).json({ message: 'ต้องระบุใบสั่งขาย' });
    if (!reasonCode) return res.status(400).json({ message: 'ต้องเลือกเหตุผล' });

    const target = await loadTarget(soid);
    if (!target || !await canSeeEditTarget(req.user, target)) return res.status(404).json({ message: 'ไม่พบใบสั่งขายนี้' });

    const issued = await findIssuedDelivery(soid);
    if (issued) return res.status(409).json({ message: `บิลนี้ออกใบสั่งขาย ${issued} ใน WinSpeed แล้ว แก้ไขจาก Sale-App ไม่ได้ ต้องดำเนินการใน WinSpeed`, code: 'WINSPEED_DELIVERY_ISSUED' });

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

    // เหตุผลเป็นตัวกำหนด Hold แต่ยังเป็นเพียงการแจ้งเตือนในแอป
    const hold = reason.RequiresHold && st.stage !== 'CONFIRMED' ? 1 : 0;
    const ids = await ensureScopedAuditIdentity(req.user);
    const id = await wfTransaction(async tx => {
      const lockedReason = (await tx.request().input('code', sql.VarChar(30), reason.ReasonCode)
        .query('SELECT ReasonCode,AppliesTo,RequiresHold,IsActive FROM wf.EditReason WITH (UPDLOCK,HOLDLOCK) WHERE ReasonCode=@code')).recordset?.[0];
      if (!lockedReason || !lockedReason.IsActive || String(lockedReason.AppliesTo || '') !== String(reason.AppliesTo || '') ||
          Boolean(lockedReason.RequiresHold) !== Boolean(reason.RequiresHold))
        throw Object.assign(new Error('เหตุผลเปลี่ยนแปลงแล้ว กรุณาโหลดและเลือกใหม่'), { status: 409 });
      const dup = (await tx.request().input('soid', sql.VarChar(50), String(soid))
        .query("SELECT TOP 1 Id FROM wf.EditRequest WITH (UPDLOCK,HOLDLOCK) WHERE SOID=@soid AND Status='PENDING'")).recordset?.[0];
      if (dup) throw Object.assign(new Error('ใบนี้มีคำขอรออนุมัติอยู่แล้ว'), { status: 409 });
      const ins = await tx.request().input('soid', sql.VarChar(50), String(soid))
        .input('tripId', sql.Int, target.tripId ? Number(target.tripId) : null).input('stage', sql.VarChar(20), st.stage)
        .input('code', sql.VarChar(30), reason.ReasonCode).input('detail', sql.NVarChar(1000), detail || null)
        .input('hold', sql.Bit, hold).input('by', sql.Int, ids.effective)
        .query('INSERT INTO wf.EditRequest (SOID,TripId,StageAtRequest,ReasonCode,ReasonDetail,HoldTruck,RequestedBy) OUTPUT inserted.Id VALUES (@soid,@tripId,@stage,@code,@detail,@hold,@by)');
      const created = ins.recordset?.[0]?.Id;
      if (!created) throw new Error('EDIT_REQUEST_INSERT_ID_MISSING');
      await require('../services/policy-contract').logChangeEvent(tx, { entityType:'EDIT_REQUEST', entityId:String(created), action:'CREATE',
        afterJson:{ soid:String(soid), stage:st.stage, reasonCode:reason.ReasonCode, holdTruck:Boolean(hold) },
        reasonCode:'EDIT_REQUEST_CREATE', reasonText:detail ? detail.slice(0,500) : null, userId:String(ids.effective), ipAddress:req.ip });
      return created;
    }, { isolationLevel: sql.ISOLATION_LEVEL.SERIALIZABLE });

    let winspeedHold = null, holdWarning = null;
    if (hold) {
      try { winspeedHold = await truckHold.applyHold(soid, { editRequestId:id, note:reason.ReasonText, actedBy:ids.effective }); }
      catch (error) { console.error('[edit-requests/apply-hold]', error); holdWarning = 'ส่งคำขอแล้ว แต่บันทึก Hold ไม่สำเร็จ กรุณาให้ผู้ดูแลตรวจสอบ'; }
    }

    broadcast('edit_request', { id, soid: String(soid), action: 'created', hold: !!hold });

    res.json({
      id, stage: st.stage, stageLabel: STAGE_LABEL[st.stage], holdTruck: !!hold,
      winspeedHold, holdWarning,
      message: hold
        ? `ส่งคำขอ #${id} แล้ว — แสดงสถานะ Hold ในแอป กรุณาแจ้งพนักงานควบคุมรถ` +
          (holdWarning ? ` · ${holdWarning}` : '')
        : `ส่งคำขอ #${id} แล้ว รออนุมัติ`,
    });
  } catch (e) {
    console.error('[edit-requests/create]', e);
    res.status(e.status || 500).json({ message: e.message });
  }
});

// ── PATCH /api/edit-requests/:id/approve ──────────────────────
router.patch('/:id/approve', requireRole(...APPROVER_ROLES), requireCurrentEditRequest, requireEditRequestInScope, async (req, res) => {
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
    if (isSubmitter(approvalIdentity(req.user), r.RequestedBy) && !adminApprovesOwn(approvalIdentity(req.user)))
      return res.status(403).json({ message: 'อนุมัติคำขอของตัวเองไม่ได้' });
    const issued = r.SOID ? await findIssuedDelivery(r.SOID) : null;
    if (issued) return res.status(409).json({ message: `บิลนี้ออกใบสั่งขาย ${issued} ใน WinSpeed แล้ว แก้ไขจาก Sale-App ไม่ได้ ต้องดำเนินการใน WinSpeed`, code: 'WINSPEED_DELIVERY_ISSUED' });

    // Lock and commit the request, unlock flag and audit together. Recheck the
    // approval preconditions under the same lock rather than trusting the read
    // made before entering the transaction.
    const result = await wfTransaction(async tx => {
      const ids = await ensureScopedAuditIdentity(req.user);
      const current = (await tx.request().input('id', sql.Int, Number(req.params.id)).input('start', sql.DateTime2, req.editRequestStartUtc)
        .query('SELECT * FROM wf.EditRequest WITH (UPDLOCK,HOLDLOCK) WHERE Id=@id AND RequestedAt >= @start')).recordset?.[0];
      if (!current) throw Object.assign(new Error('ไม่พบคำขอนี้'), { status: 404 });
      if (current.Status !== 'PENDING') throw Object.assign(new Error('คำขอเปลี่ยนสถานะแล้ว กรุณาโหลดข้อมูลอีกครั้ง'), { status: 409 });
      if (isSubmitter(approvalIdentity(req.user), current.RequestedBy) && !adminApprovesOwn(approvalIdentity(req.user))) throw Object.assign(new Error('อนุมัติคำขอของตัวเองไม่ได้'), { status: 403 });
      // A different target or requester requires the scope/WinSpeed checks to be rerun.
      if (String(current.SOID || '') !== String(r.SOID || '') || Number(current.RequestedBy) !== Number(r.RequestedBy))
        throw Object.assign(new Error('ข้อมูลคำขอเปลี่ยนแล้ว กรุณาโหลดใหม่'), { status: 409 });
      const updated = await tx.request().input('id', sql.Int, current.Id).input('by', sql.Int, ids.effective)
        .input('note', sql.NVarChar(1000), note || null).input('start', sql.DateTime2, req.editRequestStartUtc)
        .query("UPDATE wf.EditRequest SET Status='APPROVED',ReviewedBy=@by,ReviewedAt=GETUTCDATE(),ReviewNote=@note WHERE Id=@id AND Status='PENDING' AND RequestedAt >= @start");
      if (!updated.rowsAffected?.[0]) throw Object.assign(new Error('คำขอเปลี่ยนสถานะแล้ว กรุณาโหลดข้อมูลอีกครั้ง'), { status: 409 });
      let unlocked = false;
      if (current.SOID) {
        const up = await tx.request().input('soid', sql.VarChar(50), String(current.SOID))
          .query('UPDATE wf.SalesOrderExt SET IsUnlocked=1,UpdatedAt=GETUTCDATE() WHERE SOID=@soid');
        unlocked = (up.rowsAffected?.[0] || 0) > 0;
      }
      await require('../services/policy-contract').logChangeEvent(tx, {
        entityType:'EDIT_REQUEST', entityId:String(current.Id), action:'APPROVE',
        beforeJson:{ status:current.Status, soid:current.SOID }, afterJson:{ status:'APPROVED', unlocked },
        reasonCode:'EDIT_REQUEST_APPROVAL', reasonText:note ? String(note).slice(0,500) : null,
        userId:String(ids.effective), ipAddress:req.ip,
      });
      return { unlocked, request: current };
    }, { isolationLevel: sql.ISOLATION_LEVEL.SERIALIZABLE });
    const unlocked = result.unlocked;
    // Release can invoke an optional WinSpeed integration; it is not in the SQL
    // transaction. Surface a failure instead of reporting a failed approval.
    let holdReleaseWarning = null;
    if (result.request.HoldTruck && result.request.SOID) {
      try { await truckHold.releaseHold(result.request.SOID, { editRequestId: result.request.Id, actedBy: req.user.sub }); }
      catch (error) { console.error('[edit-requests/release-hold]', error); holdReleaseWarning = 'อนุมัติแล้ว แต่ปลด Hold ไม่สำเร็จ กรุณาให้ผู้ดูแลตรวจสอบ'; }
    }

    broadcast('edit_request', { id: r.Id, soid: r.SOID, action: 'approved' });
    res.json({
      id: r.Id, status: 'APPROVED', unlocked, holdReleaseWarning,
      message: unlocked
        ? 'อนุมัติแล้ว ใบสั่งขายกลับมาแก้ไขได้'
        : 'อนุมัติแล้ว — แต่ยังไม่มีแถวฝั่ง wf ของใบนี้ ต้องเปิดใบผ่านแอปก่อนจึงจะปลดล็อกอัตโนมัติได้',
    });
  } catch (e) {
    console.error('[edit-requests/approve]', e);
    res.status(e.status || 500).json({ message: e.message });
  }
});

// Close requests and their transactional change-audit together. Hold release
// is a separate optional integration and failures are reported after commit.
async function closeEditRequest(req, status, note) {
  const ids = await ensureScopedAuditIdentity(req.user);
  return wfTransaction(async tx => {
    const current = (await tx.request().input('id', sql.Int, Number(req.params.id)).input('start', sql.DateTime2, req.editRequestStartUtc)
      .query('SELECT * FROM wf.EditRequest WITH (UPDLOCK,HOLDLOCK) WHERE Id=@id AND RequestedAt >= @start')).recordset?.[0];
    if (!current) throw Object.assign(new Error('ไม่พบคำขอนี้'), { status: 404 });
    if (current.Status !== 'PENDING') throw Object.assign(new Error('คำขอเปลี่ยนสถานะแล้ว กรุณาโหลดข้อมูลอีกครั้ง'), { status: 409 });
    if (status === 'CANCELLED') {
      const identity = approvalIdentity(req.user);
      const qualifies = (id, roles) => sameUser(current.RequestedBy, id) || roles.some(role => ['ADMIN','C_LEVEL'].includes(role));
      if (!qualifies(identity.effectiveId, identity.effectiveRoles) || !qualifies(identity.actorId, identity.actorRoles))
        throw Object.assign(new Error('ถอนได้เฉพาะคำขอของตัวเองหรือผู้ดูแล'), { status: 403 });
    }
    const changed = await tx.request().input('id', sql.Int, current.Id).input('by', sql.Int, ids.effective)
      .input('status', sql.VarChar(20), status).input('note', sql.NVarChar(1000), note)
      .input('start', sql.DateTime2, req.editRequestStartUtc)
      .query("UPDATE wf.EditRequest SET Status=@status,ReviewedBy=@by,ReviewedAt=GETUTCDATE(),ReviewNote=@note WHERE Id=@id AND Status='PENDING' AND RequestedAt >= @start");
    if (!changed.rowsAffected?.[0]) throw Object.assign(new Error('คำขอเปลี่ยนสถานะแล้ว กรุณาโหลดข้อมูลอีกครั้ง'), { status: 409 });
    await require('../services/policy-contract').logChangeEvent(tx, {
      entityType:'EDIT_REQUEST', entityId:String(current.Id), action:status === 'REJECTED' ? 'REJECT' : 'CANCEL',
      beforeJson:{ status:current.Status, soid:current.SOID }, afterJson:{ status }, reasonCode:'EDIT_REQUEST_REVIEW',
      reasonText:note ? String(note).slice(0,500) : null, userId:String(ids.effective), ipAddress:req.ip,
    });
    return current;
  }, { isolationLevel: sql.ISOLATION_LEVEL.SERIALIZABLE });
}
async function releaseClosedRequestHold(request, user) {
  if (!request.HoldTruck || !request.SOID) return null;
  try { await truckHold.releaseHold(request.SOID, { editRequestId: request.Id, actedBy: user.sub }); return null; }
  catch (error) { console.error('[edit-requests/release-hold]', error); return 'ปิดคำขอแล้ว แต่ปลด Hold ไม่สำเร็จ กรุณาให้ผู้ดูแลตรวจสอบ'; }
}

// ── PATCH /api/edit-requests/:id/reject ───────────────────────
router.patch('/:id/reject', requireRole(...APPROVER_ROLES), requireCurrentEditRequest, requireEditRequestInScope, async (req, res) => {
  try {
    const note = String(req.body?.note || '').trim();
    if (note.length < 5) return res.status(400).json({ message: 'ปฏิเสธคำขอต้องระบุเหตุผลอย่างน้อย 5 ตัวอักษร' });
    const current = await closeEditRequest(req, 'REJECTED', note);
    const holdReleaseWarning = await releaseClosedRequestHold(current, req.user);
    broadcast('edit_request', { id: current.Id, action: 'rejected' });
    res.json({ id: current.Id, status: 'REJECTED', holdReleaseWarning, message: 'ปฏิเสธคำขอแล้ว' });
  } catch (e) { console.error('[edit-requests/reject]', e); res.status(e.status || 500).json({ message: e.message }); }
});

// ── PATCH /api/edit-requests/:id/cancel ───────────────────────
router.patch('/:id/cancel', requireCurrentEditRequest, async (req, res) => {
  try {
    const note = (req.body && req.body.note) || 'ผู้ขอถอนคำขอเอง';
    const current = await closeEditRequest(req, 'CANCELLED', note);
    const holdReleaseWarning = await releaseClosedRequestHold(current, req.user);
    broadcast('edit_request', { id: current.Id, soid: current.SOID, action: 'cancelled' });
    res.json({ id: current.Id, status: 'CANCELLED', holdReleaseWarning, message: 'ถอนคำขอแล้ว' });
  } catch (e) { console.error('[edit-requests/cancel]', e); res.status(e.status || 500).json({ message: e.message }); }
});


// ═══════════════════════════════════════════════════════════════
// Master Settings — จัดการรายการเหตุผลการขอแก้ไข (wf.EditReason)
//
// ทำไมต้องมีหน้าจอ ไม่ใช่แก้ใน SQL
//   รายการนี้เป็นตัวกำหนดว่า "แก้ในขั้นไหนได้บ้าง" และ "เหตุผลไหนต้อง Hold รถ"
//   ซึ่งเป็นกติกาทางธุรกิจ ไม่ใช่โครงสร้างระบบ เจ้าของกระบวนการต้องปรับเองได้
//
// ⚠ ห้ามลบเหตุผลที่เคยถูกใช้
//   wf.EditRequest มี FK มาที่ตารางนี้ ถ้าลบทิ้ง ประวัติคำขอเดิมจะอ่านไม่ออก
//   ว่าเคยขอด้วยเหตุผลอะไร ให้ปิดใช้งาน (IsActive=0) แทน ซึ่งจะหายจาก
//   ตัวเลือกของผู้ขอ แต่ประวัติยังอ่านได้
// ═══════════════════════════════════════════════════════════════
const VALID_STAGES = ['CONFIRMED', 'REGISTERED', 'LOADING'];

/** ตรวจ AppliesTo ให้เหลือเฉพาะขั้นที่มีจริง ไม่ซ้ำ และเรียงตามลำดับกระบวนการ */
function normalizeStages(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(',');
  const seen = [];
  for (const raw of list) {
    const s = String(raw || '').trim().toUpperCase();
    if (!s) continue;
    if (!VALID_STAGES.includes(s)) return { error: `ขั้นตอน "${s}" ไม่ถูกต้อง` };
    if (!seen.includes(s)) seen.push(s);
  }
  if (seen.length === 0) return { error: 'ต้องเลือกอย่างน้อยหนึ่งขั้นตอน' };
  // เรียงตามลำดับจริงของกระบวนการ ไม่ใช่ตามที่ผู้ใช้กดเลือก
  // เพราะ AppliesTo ถูกอ่านด้วย LIKE ที่ครอบจุลภาค ลำดับจึงมีผลกับการอ่านของคน
  seen.sort((a, b) => VALID_STAGES.indexOf(a) - VALID_STAGES.indexOf(b));
  return { value: seen.join(',') };
}

// GET /api/edit-requests/admin/reasons — รวมตัวที่ปิดใช้งานแล้ว + จำนวนที่ถูกใช้
router.get('/admin/reasons', requireRole('ADMIN', 'C_LEVEL', 'MANAGER'), async (req, res) => {
  try {
    const r = await wfQuery(`
      SELECT e.ReasonCode, e.ReasonText, e.AppliesTo, e.RequiresHold,
             e.SortOrder, e.IsActive, e.CreatedAt,
             (SELECT COUNT(*) FROM wf.EditRequest q WHERE q.ReasonCode = e.ReasonCode) AS UsageCount,
             (SELECT COUNT(*) FROM wf.EditRequest q WHERE q.ReasonCode = e.ReasonCode AND q.Status = 'PENDING') AS PendingCount
      FROM wf.EditReason e
      ORDER BY e.SortOrder, e.ReasonCode`);
    res.json({ data: camelizeRows(r.recordset || []), validStages: VALID_STAGES });
  } catch (e) {
    console.error('[edit-requests/admin/reasons]', e);
    res.status(500).json({ message: e.message });
  }
});

// POST /api/edit-requests/admin/reasons
router.post('/admin/reasons', requireRole('ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const { reasonCode, reasonText, appliesTo, requiresHold, sortOrder, isActive } = req.body || {};
    const code = String(reasonCode || '').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{1,29}$/.test(code)) return res.status(400).json({ message: 'รหัสต้องเป็น A-Z 0-9 _ ขึ้นต้นด้วยตัวอักษร ยาว 2-30 ตัว' });
    if (!String(reasonText || '').trim()) return res.status(400).json({ message: 'ต้องระบุข้อความเหตุผล' });
    const stages = normalizeStages(appliesTo);
    if (stages.error) return res.status(400).json({ message: stages.error });
    const after = { reasonCode: code, reasonText: String(reasonText).trim(), appliesTo: stages.value,
      requiresHold: !!requiresHold, sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 100, isActive: isActive !== false };
    await wfTransaction(async tx => {
      const dup = (await tx.request().input('c', sql.VarChar(30), code)
        .query('SELECT ReasonCode FROM wf.EditReason WITH (UPDLOCK,HOLDLOCK) WHERE ReasonCode=@c')).recordset[0];
      if (dup) throw Object.assign(new Error(`รหัส ${code} มีอยู่แล้ว`), { status: 409 });
      await tx.request().input('c',sql.VarChar(30),code).input('t',sql.NVarChar(400),after.reasonText)
        .input('a',sql.VarChar(100),after.appliesTo).input('h',sql.Bit,after.requiresHold?1:0)
        .input('s',sql.SmallInt,after.sortOrder).input('i',sql.Bit,after.isActive?1:0)
        .query('INSERT INTO wf.EditReason (ReasonCode,ReasonText,AppliesTo,RequiresHold,SortOrder,IsActive) VALUES (@c,@t,@a,@h,@s,@i)');
      await auditScopedChange(tx,req,{entityType:'EDIT_REASON',id:code,action:'CREATE',before:null,after});
    }, { isolationLevel: sql.ISOLATION_LEVEL.SERIALIZABLE });
    res.json({ reasonCode: code, message: `เพิ่มเหตุผล ${code} แล้ว` });
  } catch(e) { console.error('[edit-requests/admin/reasons:create]',e); res.status(e.status || 500).json({message:e.message}); }
});

// Update and removal keep the reason and pending-reference check in one transaction.
router.put('/admin/reasons/:code', requireRole('ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const code=String(req.params.code || '').trim().toUpperCase();
    const { reasonText, appliesTo, requiresHold, sortOrder, isActive }=req.body || {};
    if (!String(reasonText || '').trim()) return res.status(400).json({message:'ต้องระบุข้อความเหตุผล'});
    const stages=normalizeStages(appliesTo);
    if(stages.error) return res.status(400).json({message:stages.error});
    await wfTransaction(async tx=>{
      const cur=(await tx.request().input('c',sql.VarChar(30),code)
        .query('SELECT * FROM wf.EditReason WITH (UPDLOCK,HOLDLOCK) WHERE ReasonCode=@c')).recordset[0];
      if(!cur)throw Object.assign(new Error('ไม่พบเหตุผลนี้'),{status:404});
      if(isActive===false){
        const open=(await tx.request().input('c',sql.VarChar(30),code)
          .query("SELECT COUNT(*) AS n FROM wf.EditRequest WITH (HOLDLOCK) WHERE ReasonCode=@c AND Status='PENDING'")).recordset[0];
        if(Number(open.n)>0)throw Object.assign(new Error(`ปิดใช้งานไม่ได้ — ยังมีคำขอที่ใช้เหตุผลนี้รออนุมัติอยู่ ${open.n} รายการ`),{status:409});
      }
      const after={reasonCode:code,reasonText:String(reasonText).trim(),appliesTo:stages.value,requiresHold:!!requiresHold,
        sortOrder:Number.isFinite(Number(sortOrder))?Number(sortOrder):cur.SortOrder,isActive:isActive!==false};
      await tx.request().input('c',sql.VarChar(30),code).input('t',sql.NVarChar(400),after.reasonText)
        .input('a',sql.VarChar(100),after.appliesTo).input('h',sql.Bit,after.requiresHold?1:0)
        .input('s',sql.SmallInt,after.sortOrder).input('i',sql.Bit,after.isActive?1:0)
        .query('UPDATE wf.EditReason SET ReasonText=@t,AppliesTo=@a,RequiresHold=@h,SortOrder=@s,IsActive=@i WHERE ReasonCode=@c');
      await auditScopedChange(tx,req,{entityType:'EDIT_REASON',id:code,action:'UPDATE',before:cur,after});
    }, { isolationLevel: sql.ISOLATION_LEVEL.SERIALIZABLE });
    res.json({reasonCode:code,message:'บันทึกแล้ว'});
  } catch(e) { console.error('[edit-requests/admin/reasons:update]',e); res.status(e.status || 500).json({message:e.message}); }
});

router.delete('/admin/reasons/:code', requireRole('ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const code=String(req.params.code || '').trim().toUpperCase();
    await wfTransaction(async tx=>{
      const cur=(await tx.request().input('c',sql.VarChar(30),code)
        .query('SELECT * FROM wf.EditReason WITH (UPDLOCK,HOLDLOCK) WHERE ReasonCode=@c')).recordset[0];
      if(!cur)throw Object.assign(new Error('ไม่พบเหตุผลนี้'),{status:404});
      const used=(await tx.request().input('c',sql.VarChar(30),code)
        .query('SELECT COUNT(*) AS n FROM wf.EditRequest WITH (HOLDLOCK) WHERE ReasonCode=@c')).recordset[0];
      if(Number(used.n)>0)throw Object.assign(new Error(`ลบไม่ได้ — เคยถูกใช้ไปแล้ว ${used.n} คำขอ ถ้าไม่ต้องการให้เลือกอีก ให้ปิดใช้งานแทน`),{status:409,usageCount:Number(used.n)});
      await tx.request().input('c',sql.VarChar(30),code).query('DELETE FROM wf.EditReason WHERE ReasonCode=@c');
      await auditScopedChange(tx,req,{entityType:'EDIT_REASON',id:code,action:'DELETE',before:cur,after:null});
    }, { isolationLevel: sql.ISOLATION_LEVEL.SERIALIZABLE });
    res.json({reasonCode:code,message:`ลบเหตุผล ${code} แล้ว`});
  } catch(e) { console.error('[edit-requests/admin/reasons:delete]',e); res.status(e.status || 500).json({message:e.message,...(e.usageCount?{usageCount:e.usageCount}:{})}); }
});

// ═══════════════════════════════════════════════════════════════
// Price Approvals — คำขออนุมัติราคาขายต่ำกว่าราคาประกาศ (P0)
// ═══════════════════════════════════════════════════════════════

// GET /api/edit-requests/price-approvals
router.get('/price-approvals', async (req, res) => {
  try {
    const { status, soId, custId, mine } = req.query;
    const dataWindow = await require('../services/global-data-window-store').readGlobalDataWindow();
    const inputs = { globalStartUtc: { type: sql.DateTime2, value: dataWindow.utcInstant } };
    let where = 'WHERE pa.CreatedAt >= @globalStartUtc AND so.CreatedAt >= @globalStartUtc';
    if (status) { where += ' AND pa.Status = @status'; inputs.status = { type: sql.VarChar(20), value: String(status).toUpperCase() }; }
    if (soId) { where += ' AND pa.SoId = @soId'; inputs.soId = { type: sql.Int, value: Number(soId) }; }
    if (custId) { where += ' AND pa.CustId = @custId'; inputs.custId = { type: sql.NVarChar(20), value: String(custId) }; }
    if (String(mine) === '1') { where += ' AND pa.RequestedBy = @me'; inputs.me = { type: sql.Int, value: businessIds(req.user).effective }; }
    // R12 O-4: approvals requested by the user's own + team, or on their bills
    const scope = await getVisibleScope(req.user);
    const actor = require('../services/business-identity').actorPerspective(req.user);
    const actorScope = actor === req.user ? scope : await getVisibleScope(actor);
    for (const [current, suffix] of [[scope, 'effective'], [actorScope, 'actor']]) {
      if (current.all) continue;
      const byReq = scopeFilter(current, { userCol: 'pa.RequestedBy', prefix: `pr_${suffix}` });
      const byBill = scopeFilter(current, { userCol: 'so.SalesUserId', prefix: `pb_${suffix}` });
      where += ` AND (${byReq.sql} OR ${byBill.sql})`;
      Object.assign(inputs, byReq.inputs, byBill.inputs);
    }

    const r = await wfQuery(`
      SELECT pa.*,
             ru.DisplayName AS RequestedByName,
             au.DisplayName AS ApprovedByName,
             so.WfRef AS SoWfRef, so.SoPrefix, so.ImportedDocuNo AS SoDocuNo, so.DeliveryDate
      FROM wf.PriceApproval pa
      LEFT JOIN wf.AppUser ru ON ru.Id = pa.RequestedBy
      LEFT JOIN wf.AppUser au ON au.Id = pa.ApprovedBy
      LEFT JOIN wf.SalesOrder so ON so.Id = pa.SoId
      ${where}
      ORDER BY CASE WHEN pa.Status = 'PENDING' THEN 0 ELSE 1 END, pa.Id DESC
    `, inputs);

    res.json({ data: camelizeRows(r.recordset || []) });
  } catch (e) {
    console.error('[price-approvals/list]', e);
    res.status(500).json({ message: e.message });
  }
});

// PATCH /api/edit-requests/price-approvals/:id/approve
router.patch('/price-approvals/:id/approve', requireRole(...APPROVER_ROLES), requirePriceApprovalInScope, async (req, res) => {
  try {
    const { note } = req.body || {};
    const approvalId = Number(req.params.id);
    const dataWindow = await require('../services/global-data-window-store').readGlobalDataWindow();
    const target = (await wfQuery(`SELECT * FROM wf.PriceApproval WHERE Id = @id AND CreatedAt >= @globalStartUtc AND EXISTS (SELECT 1 FROM wf.SalesOrder so WHERE so.Id = wf.PriceApproval.SoId AND so.CreatedAt >= @globalStartUtc)`, {
      id: { type: sql.Int, value: approvalId }, globalStartUtc: { type: sql.DateTime2, value: dataWindow.utcInstant },
    })).recordset[0];
    if (!target) return res.status(404).json({ message: 'ไม่พบคำขออนุมัติราคานี้' });
    if (target.Status !== 'PENDING') return res.status(409).json({ message: `คำขอนี้อยู่ในสถานะ ${target.Status} แล้ว` });

    const identity = approvalIdentity(req.user);
    if (isSubmitter(identity, target.RequestedBy) && !bothHaveRole(identity, ['ADMIN', 'C_LEVEL'])) {
      return res.status(403).json({ message: 'ไม่อนุญาตให้อนุมัติคำขอของตัวเอง' });
    }

    const decision = await wfTransaction(async tx => {
      // Validate current DocumentRevision of the sales order
      const soRes = await tx.request()
        .input('soId', sql.Int, target.SoId)
        .query('SELECT DocumentRevision, Status, DeliveryDate, RebateDiscountAmt FROM wf.SalesOrder WITH (UPDLOCK, HOLDLOCK) WHERE Id = @soId');
      const soRow = soRes.recordset[0];
      if (!soRow) throw new Error('ไม่พบใบสั่งขายที่ผูกกับคำขอนี้');
      if (Number(soRow.DocumentRevision) !== Number(target.DocumentRevision)) {
        const changed = await tx.request().input('id', sql.Int, approvalId)
          .input('globalStartUtc', sql.DateTime2, dataWindow.utcInstant)
          .query("UPDATE wf.PriceApproval SET Status = 'SUPERSEDED', UpdatedAt = SYSUTCDATETIME() WHERE Id = @id AND Status = 'PENDING' AND CreatedAt >= @globalStartUtc");
        if (!Number(changed?.rowsAffected?.[0] || 0)) throw Object.assign(new Error('สถานะคำขอเปลี่ยนแปลงไปแล้ว'), { status: 409 });
        await auditApprovalDecision(tx, req, 'PRICE_APPROVAL', approvalId, 'SUPERSEDED', null);
        return { superseded: true };
      }

      // Confidential safety guard: even price overrides cannot be approved below Costlist
      const txQ = async (text, inputs = {}) => {
        const r = new sql.Request(tx);
        for (const [k, v] of Object.entries(inputs)) r.input(k, v.type, v.value);
        return r.query(text);
      };
      const soLinesRes = await tx.request()
        .input('soId', sql.Int, target.SoId)
        .query(`
          SELECT GoodId, GoodCode, GoodName, QtyTon, PricePerTon, IsGiveaway,
                 IsCouponDrawn, CouponReservationId, RefCouponDocuNo,
                 IsControlTicketDrawn, RefControlTicketNo
          FROM wf.SalesOrderLine WITH (HOLDLOCK)
          WHERE SoId = @soId
        `);
      const soLines = (soLinesRes.recordset || []).map(l => (
        String(l.GoodId || '') === String(target.GoodId || '')
          ? { ...l, PricePerTon: Number(target.RequestedPrice ?? l.PricePerTon) }
          : l
      ));
      const linesToCheck = soLines.length > 0
        ? soLines
        : [{ goodId: target.GoodId, goodName: target.GoodName, qtyTon: target.QtyTon, pricePerTon: target.RequestedPrice }];
      await assertPricesAboveCost({
        lines: linesToCheck,
        asOfDate: soRow.DeliveryDate || null,
        rebateDiscountAmt: Number(soRow.RebateDiscountAmt || 0),
        queryFn: txQ,
      });

      const updateRes = await tx.request()
        .input('id', sql.Int, approvalId)
        .input('by', sql.Int, businessIds(req.user).effective)
        .input('note', sql.NVarChar(500), note || null)
        .input('globalStartUtc', sql.DateTime2, dataWindow.utcInstant)
        .query(`
          UPDATE wf.PriceApproval
          SET Status = 'APPROVED', ApprovedBy = @by, ApprovedAt = SYSUTCDATETIME(), ApprovalNote = @note, UpdatedAt = SYSUTCDATETIME()
          WHERE Id = @id AND Status = 'PENDING' AND CreatedAt >= @globalStartUtc
        `);

      if (Number(updateRes?.rowsAffected?.[0] || 0) === 0) {
        throw new Error('ไม่สามารถอนุมัติได้เนื่องจากสถานะคำขอเปลี่ยนแปลงไปแล้ว');
      }

      // Check if any other PENDING items remain for this SoId at current revision
      const remainingPending = (await tx.request()
        .input('soId', sql.Int, target.SoId)
        .input('rev', sql.Int, target.DocumentRevision)
        .query(`SELECT COUNT(*) AS Cnt FROM wf.PriceApproval WHERE SoId = @soId AND DocumentRevision = @rev AND Status = 'PENDING'`)).recordset[0].Cnt;

      if (remainingPending === 0) {
        const remainingRejected = (await tx.request()
          .input('soId', sql.Int, target.SoId)
          .input('rev', sql.Int, target.DocumentRevision)
          .query(`SELECT COUNT(*) AS Cnt FROM wf.PriceApproval WHERE SoId = @soId AND DocumentRevision = @rev AND Status = 'REJECTED'`)).recordset[0].Cnt;

        const finalStatus = remainingRejected > 0 ? 'REJECTED' : 'APPROVED';
        await tx.request()
          .input('soId', sql.Int, target.SoId)
          .input('status', sql.VarChar(20), finalStatus)
          .query(`UPDATE wf.SalesOrder SET PriceApprovalStatus = @status WHERE Id = @soId`);
      }
      await auditApprovalDecision(tx, req, 'PRICE_APPROVAL', approvalId, 'APPROVED', note);
    });

    if (decision?.superseded) return res.status(409).json({ code: 'APPROVAL_SUPERSEDED', message: 'ใบสั่งขายเปลี่ยนแปลงแล้ว กรุณาส่งคำขออนุมัติราคาใหม่' });

    broadcast('price_approval', { id: approvalId, soId: target.SoId, action: 'approved' });
    res.json({ id: approvalId, status: 'APPROVED', message: 'อนุมัติราคาขายสำเร็จ' });
  } catch (e) {
    console.error('[price-approvals/approve]', e);
    res.status(e.status || e.statusCode || 500).json({ message: e.message, code: e.code });
  }
});

// PATCH /api/edit-requests/price-approvals/:id/reject
router.patch('/price-approvals/:id/reject', requireRole(...APPROVER_ROLES), requirePriceApprovalInScope, async (req, res) => {
  try {
    const { note } = req.body || {};
    if (!note || String(note).trim().length < 5) {
      return res.status(400).json({ message: 'ปฏิเสธคำขอต้องระบุเหตุผลอย่างน้อย 5 ตัวอักษร' });
    }
    const approvalId = Number(req.params.id);
    const dataWindow = await require('../services/global-data-window-store').readGlobalDataWindow();
    const target = (await wfQuery(`SELECT * FROM wf.PriceApproval WHERE Id = @id AND CreatedAt >= @globalStartUtc AND EXISTS (SELECT 1 FROM wf.SalesOrder so WHERE so.Id = wf.PriceApproval.SoId AND so.CreatedAt >= @globalStartUtc)`, {
      id: { type: sql.Int, value: approvalId }, globalStartUtc: { type: sql.DateTime2, value: dataWindow.utcInstant },
    })).recordset[0];
    if (!target) return res.status(404).json({ message: 'ไม่พบคำขออนุมัติราคานี้' });
    if (target.Status !== 'PENDING') return res.status(409).json({ message: `คำขอนี้อยู่ในสถานะ ${target.Status} แล้ว` });

    const identity = approvalIdentity(req.user);
    if (isSubmitter(identity, target.RequestedBy) && !bothHaveRole(identity, ['ADMIN', 'C_LEVEL'])) {
      return res.status(403).json({ message: 'ไม่อนุญาตให้ปฏิเสธคำขอของตัวเอง' });
    }

    const decision = await wfTransaction(async tx => {
      // Validate current DocumentRevision of the sales order
      const soRes = await tx.request()
        .input('soId', sql.Int, target.SoId)
        .query('SELECT DocumentRevision, Status, DeliveryDate, RebateDiscountAmt FROM wf.SalesOrder WITH (UPDLOCK, HOLDLOCK) WHERE Id = @soId');
      const soRow = soRes.recordset[0];
      if (!soRow) throw new Error('ไม่พบใบสั่งขายที่ผูกกับคำขอนี้');
      if (Number(soRow.DocumentRevision) !== Number(target.DocumentRevision)) {
        const changed = await tx.request().input('id', sql.Int, approvalId)
          .input('globalStartUtc', sql.DateTime2, dataWindow.utcInstant)
          .query("UPDATE wf.PriceApproval SET Status = 'SUPERSEDED', UpdatedAt = SYSUTCDATETIME() WHERE Id = @id AND Status = 'PENDING' AND CreatedAt >= @globalStartUtc");
        if (!Number(changed?.rowsAffected?.[0] || 0)) throw Object.assign(new Error('สถานะคำขอเปลี่ยนแปลงไปแล้ว'), { status: 409 });
        await auditApprovalDecision(tx, req, 'PRICE_APPROVAL', approvalId, 'SUPERSEDED', null);
        return { superseded: true };
      }

      const updateRes = await tx.request()
        .input('id', sql.Int, approvalId)
        .input('by', sql.Int, businessIds(req.user).effective)
        .input('note', sql.NVarChar(500), String(note).trim())
        .input('globalStartUtc', sql.DateTime2, dataWindow.utcInstant)
        .query(`
          UPDATE wf.PriceApproval
          SET Status = 'REJECTED', ApprovedBy = @by, ApprovedAt = SYSUTCDATETIME(), ApprovalNote = @note, UpdatedAt = SYSUTCDATETIME()
          WHERE Id = @id AND Status = 'PENDING' AND CreatedAt >= @globalStartUtc
        `);

      if (Number(updateRes?.rowsAffected?.[0] || 0) === 0) {
        throw new Error('ไม่สามารถปฏิเสธได้เนื่องจากสถานะคำขอเปลี่ยนแปลงไปแล้ว');
      }

      await tx.request()
        .input('soId', sql.Int, target.SoId)
        .query(`UPDATE wf.SalesOrder SET PriceApprovalStatus = 'REJECTED' WHERE Id = @soId`);
      await auditApprovalDecision(tx, req, 'PRICE_APPROVAL', approvalId, 'REJECTED', note);
    });

    if (decision?.superseded) return res.status(409).json({ code: 'APPROVAL_SUPERSEDED', message: 'ใบสั่งขายเปลี่ยนแปลงแล้ว กรุณาส่งคำขออนุมัติราคาใหม่' });

    broadcast('price_approval', { id: approvalId, soId: target.SoId, action: 'rejected' });
    res.json({ id: approvalId, status: 'REJECTED', message: 'ปฏิเสธราคาขายเรียบร้อย' });
  } catch (e) {
    console.error('[price-approvals/reject]', e);
    res.status(e.status || 500).json({ message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// Multi-Customer Sale Trip Approvals (MULTI_CUST_TRIP)
// ═══════════════════════════════════════════════════════════════

async function requireTripApprovalInScope(req, res, next) {
  try {
    const scope = await getVisibleScope(req.user);
    const actor = require('../services/business-identity').actorPerspective(req.user);
    const actorScope = actor === req.user ? scope : await getVisibleScope(actor);
    if (scope.all && actorScope.all) return next();
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ message: 'ไม่พบคำขออนุมัติทริปนี้' });

    const r = (await wfQuery(`
      SELECT a.TripId, a.RequestedBy, st.CreatedBy AS TripCreatedBy
      FROM wf.TripMultiCustomerApproval a
      LEFT JOIN wf.SalesTrip st ON st.TripId = a.TripId
      WHERE a.Id = @id
    `, { id: { type: sql.Int, value: id } })).recordset?.[0];
    if (!r) return res.status(404).json({ message: 'ไม่พบคำขออนุมัติทริปนี้' });

    for (const [current, suffix] of [[scope, 'effective'], [actorScope, 'actor']]) {
      if(!current.all){
        const foreign=scopeFilter(current,{userCol:'m.SalesUserId',prefix:'tripApprovalOutside_'+suffix});
        const outside=(await wfQuery(`SELECT TOP 1 1 AS ForeignMember FROM wf.v_TripMember m WHERE m.TripId=@tid AND CASE WHEN ${foreign.sql} THEN 0 ELSE 1 END=1`,{tid:{type:sql.Int,value:Number(r.TripId)},...foreign.inputs})).recordset?.[0];
        if(outside)return res.status(404).json({message:'ไม่พบคำขออนุมัติทริปนี้'});
      }
      if (inScope(current, { userId: r.RequestedBy, extraUserIds: [r.TripCreatedBy] })) continue;
      const memberFilter = scopeFilter(current, { userCol: 'm.SalesUserId', prefix: `tm_${suffix}` });
      const memberHit = (await wfQuery(`
        SELECT TOP 1 1 AS ok FROM wf.v_TripMember m
        WHERE m.TripId = @tid AND ${memberFilter.sql}
      `, { tid: { type: sql.Int, value: Number(r.TripId) }, ...memberFilter.inputs })).recordset?.[0];
      if (!memberHit) return res.status(404).json({ message: 'ไม่พบคำขออนุมัติทริปนี้' });
    }
    next();
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
}

// GET /api/edit-requests/trip-approvals
router.get('/trip-approvals', async (req, res) => {
  try {
    const { status, tripId, mine } = req.query;
    const dataWindow = await require('../services/global-data-window-store').readGlobalDataWindow();
    const inputs = { globalStartUtc: { type: sql.DateTime2, value: dataWindow.utcInstant } };
    let where = 'WHERE a.CreatedAt >= @globalStartUtc';
    if (status) { where += ' AND a.Status = @status'; inputs.status = { type: sql.VarChar(20), value: String(status).toUpperCase() }; }
    if (tripId) { where += ' AND a.TripId = @tripId'; inputs.tripId = { type: sql.Int, value: Number(tripId) }; }
    if (String(mine) === '1') { where += ' AND a.RequestedBy = @me'; inputs.me = { type: sql.Int, value: businessIds(req.user).effective }; }

    const scope = await getVisibleScope(req.user);
    const actor = require('../services/business-identity').actorPerspective(req.user);
    const actorScope = actor === req.user ? scope : await getVisibleScope(actor);
    for (const [current, suffix] of [[scope, 'effective'], [actorScope, 'actor']]) {
      if (current.all) continue;
      const byReq = scopeFilter(current, { userCol: 'a.RequestedBy', prefix: `tar_${suffix}` });
      const byTripCreator = scopeFilter(current, { userCol: 'st.CreatedBy', prefix: `tac_${suffix}` });
      const byMember = scopeFilter(current, { userCol: 'm.SalesUserId', prefix: `tam_${suffix}` });
      where += ` AND (${byReq.sql} OR ${byTripCreator.sql} OR EXISTS (SELECT 1 FROM wf.v_TripMember m WHERE m.TripId = a.TripId AND ${byMember.sql}))`;
      where += ` AND NOT EXISTS(SELECT 1 FROM wf.v_TripMember m WHERE m.TripId=a.TripId AND CASE WHEN ${byMember.sql} THEN 0 ELSE 1 END=1)`;
      Object.assign(inputs, byReq.inputs, byTripCreator.inputs, byMember.inputs);
    }

    let rows = [];
    try {
      const r = await wfQuery(`
        SELECT a.*,
               ru.DisplayName AS RequestedByName,
               au.DisplayName AS ApprovedByName,
               st.TransRegistration,
               st.DriverName,
               st.PickupDueDate,
               st.Status AS TripStatus,
               st.DocumentRevision AS CurrentTripRevision
        FROM wf.TripMultiCustomerApproval a
        LEFT JOIN wf.AppUser ru ON ru.Id = a.RequestedBy
        LEFT JOIN wf.AppUser au ON au.Id = a.ApprovedBy
        LEFT JOIN wf.SalesTrip st ON st.TripId = a.TripId
        ${where}
        ORDER BY CASE WHEN a.Status = 'PENDING' THEN 0 ELSE 1 END, a.Id DESC
      `, inputs);
      rows = camelizeRows(r.recordset || []).map(row => {
        let customerIds = [];
        if (typeof row.customerIdsJson === 'string') {
          try { customerIds = JSON.parse(row.customerIdsJson); } catch { customerIds = []; }
        }
        return { ...row, customerIds };
      });
    } catch (e) {
      if (!/Invalid object name/i.test(String(e.message || ''))) throw e;
    }

    const authInfo = await canUserApproveMultiCustTrip(req.user, null);
    res.json({
      data: rows,
      requiredRole: authInfo.requiredRole,
      canApproveRole: authInfo.allowed,
    });
  } catch (e) {
    console.error('[trip-approvals/list]', e);
    res.status(500).json({ message: e.message });
  }
});

// PATCH /api/edit-requests/trip-approvals/:id/approve
router.patch('/trip-approvals/:id/approve', requireRole(...APPROVER_ROLES), requireTripApprovalInScope, async (req, res) => {
  try {
    const approvalId = Number(req.params.id);
    if (!Number.isInteger(approvalId) || approvalId <= 0) {
      return res.status(400).json({ message: 'รหัสคำขอไม่ถูกต้อง' });
    }
    const { note } = req.body || {};
    const dataWindow = await require('../services/global-data-window-store').readGlobalDataWindow();
    const target = (await wfQuery(`SELECT * FROM wf.TripMultiCustomerApproval WHERE Id = @id AND CreatedAt >= @globalStartUtc`, {
      id: { type: sql.Int, value: approvalId },
      globalStartUtc: { type: sql.DateTime2, value: dataWindow.utcInstant },
    })).recordset?.[0];
    if (!target) return res.status(404).json({ message: 'ไม่พบคำขออนุมัติทริปนี้' });
    if (target.Status !== 'PENDING') return res.status(409).json({ message: `คำขอนี้อยู่ในสถานะ ${target.Status} แล้ว` });

    const roleCheck = await canUserApproveMultiCustTrip(req.user, target.TotalAmount);
    if (!roleCheck.allowed) {
      return res.status(403).json({ message: roleCheck.reason || 'ไม่มีสิทธิ์อนุมัติทริปหลายลูกค้า' });
    }
    const identity = approvalIdentity(req.user);
    if (isSubmitter(identity, target.RequestedBy) && !bothHaveRole(identity, ['ADMIN', 'C_LEVEL'])) {
      return res.status(403).json({ message: 'ไม่อนุญาตให้อนุมัติคำขอของตัวเอง' });
    }

    const decision = await wfTransaction(async tx => {
      const tripRes = await tx.request().input('tid', sql.Int, Number(target.TripId))
        .query(`SELECT TripId, Status, DocumentRevision FROM wf.SalesTrip WITH (UPDLOCK, HOLDLOCK) WHERE TripId = @tid`);
      const tripRow = tripRes.recordset?.[0];
      if (!tripRow || tripRow.Status === 'DELETED') {
        throw Object.assign(new Error('ไม่พบเที่ยวรถที่ผูกกับคำขอนี้'), { status: 404 });
      }

      const membersRes = await tx.request().input('tid', sql.Int, Number(target.TripId))
        .query(`SELECT MemberKind, MemberId, DocuNo, CustId, CustCode, CustName, Status FROM wf.v_TripMember WHERE TripId = @tid`);
      const liveSnapshot = computeTripCustomerSnapshot(membersRes.recordset || []);
      let targetCustomerIds = [];
      try { targetCustomerIds = JSON.parse(target.CustomerIdsJson || '[]'); } catch { targetCustomerIds = []; }

      const allRequestedPresent = targetCustomerIds.length > 0 && targetCustomerIds.every(cid => liveSnapshot.customerIds.includes(String(cid)));
      if (!allRequestedPresent) {
        const changed = await tx.request().input('id', sql.Int, approvalId)
          .input('globalStartUtc', sql.DateTime2, dataWindow.utcInstant)
          .query(`UPDATE wf.TripMultiCustomerApproval SET Status = 'SUPERSEDED', UpdatedAt = SYSUTCDATETIME() WHERE Id = @id AND Status = 'PENDING' AND CreatedAt >= @globalStartUtc`);
        if (!Number(changed?.rowsAffected?.[0] || 0)) throw Object.assign(new Error('สถานะคำขอเปลี่ยนแปลงไปแล้ว'), { status: 409 });
        await auditApprovalDecision(tx, req, 'TRIP_APPROVAL', approvalId, 'SUPERSEDED', null);
        return { superseded: true };
      }

      const updRes = await tx.request()
        .input('id', sql.Int, approvalId)
        .input('by', sql.Int, businessIds(req.user).effective)
        .input('note', sql.NVarChar(500), note ? String(note).trim() : null)
        .input('globalStartUtc', sql.DateTime2, dataWindow.utcInstant)
        .query(`
          UPDATE wf.TripMultiCustomerApproval
          SET Status = 'APPROVED', ApprovedBy = @by, ApprovedAt = SYSUTCDATETIME(), ApprovalNote = @note, UpdatedAt = SYSUTCDATETIME()
          WHERE Id = @id AND Status = 'PENDING' AND CreatedAt >= @globalStartUtc
        `);
      if (Number(updRes?.rowsAffected?.[0] || 0) === 0) {
        throw Object.assign(new Error('ไม่สามารถอนุมัติได้เนื่องจากสถานะคำขอเปลี่ยนแปลงไปแล้ว'), { status: 409 });
      }
      await auditApprovalDecision(tx, req, 'TRIP_APPROVAL', approvalId, 'APPROVED', note);
    });

    if (decision?.superseded) return res.status(409).json({ code: 'APPROVAL_SUPERSEDED', message: 'รายชื่อลูกค้าในทริปเปลี่ยนแปลง กรุณาส่งคำขอใหม่' });

    broadcast('trip_multi_cust_approval', { id: approvalId, tripId: target.TripId, action: 'approved' });
    broadcast('trip_updated', { tripId: target.TripId, action: 'multi_cust_approval_approved' });
    res.json({ id: approvalId, tripId: target.TripId, status: 'APPROVED', message: 'อนุมัติเปิด Sale Trip หลายลูกค้าเรียบร้อยแล้ว' });
  } catch (e) {
    console.error('[trip-approvals/approve]', e);
    res.status(e.status || 500).json({ message: e.message });
  }
});

// PATCH /api/edit-requests/trip-approvals/:id/reject
router.patch('/trip-approvals/:id/reject', requireRole(...APPROVER_ROLES), requireTripApprovalInScope, async (req, res) => {
  try {
    const approvalId = Number(req.params.id);
    if (!Number.isInteger(approvalId) || approvalId <= 0) {
      return res.status(400).json({ message: 'รหัสคำขอไม่ถูกต้อง' });
    }
    const { note } = req.body || {};
    if (!note || String(note).trim().length < 5) {
      return res.status(400).json({ message: 'ปฏิเสธคำขอต้องระบุเหตุผลอย่างน้อย 5 ตัวอักษร' });
    }

    const dataWindow = await require('../services/global-data-window-store').readGlobalDataWindow();
    const target = (await wfQuery(`SELECT * FROM wf.TripMultiCustomerApproval WHERE Id = @id AND CreatedAt >= @globalStartUtc`, {
      id: { type: sql.Int, value: approvalId },
      globalStartUtc: { type: sql.DateTime2, value: dataWindow.utcInstant },
    })).recordset?.[0];
    if (!target) return res.status(404).json({ message: 'ไม่พบคำขออนุมัติทริปนี้' });
    if (target.Status !== 'PENDING') return res.status(409).json({ message: `คำขอนี้อยู่ในสถานะ ${target.Status} แล้ว` });

    const roleCheck = await canUserApproveMultiCustTrip(req.user, target.TotalAmount);
    if (!roleCheck.allowed) {
      return res.status(403).json({ message: roleCheck.reason || 'ไม่มีสิทธิ์ปฏิเสธทริปหลายลูกค้า' });
    }
    const identity = approvalIdentity(req.user);
    if (isSubmitter(identity, target.RequestedBy) && !bothHaveRole(identity, ['ADMIN', 'C_LEVEL'])) {
      return res.status(403).json({ message: 'ไม่อนุญาตให้ปฏิเสธคำขอของตัวเอง' });
    }

    await wfTransaction(async tx => {
      const updRes = await tx.request()
        .input('id', sql.Int, approvalId)
        .input('by', sql.Int, businessIds(req.user).effective)
        .input('note', sql.NVarChar(500), String(note).trim())
        .input('globalStartUtc', sql.DateTime2, dataWindow.utcInstant)
        .query(`UPDATE wf.TripMultiCustomerApproval
          SET Status = 'REJECTED', ApprovedBy = @by, ApprovedAt = SYSUTCDATETIME(), ApprovalNote = @note, UpdatedAt = SYSUTCDATETIME()
          WHERE Id = @id AND Status = 'PENDING' AND CreatedAt >= @globalStartUtc`);
      if (Number(updRes?.rowsAffected?.[0] || 0) === 0)
        throw Object.assign(new Error('ไม่สามารถปฏิเสธได้เนื่องจากสถานะคำขอเปลี่ยนแปลงไปแล้ว'), { status: 409 });
      await auditApprovalDecision(tx, req, 'TRIP_APPROVAL', approvalId, 'REJECTED', note);
    });

    broadcast('trip_multi_cust_approval', { id: approvalId, tripId: target.TripId, action: 'rejected' });
    broadcast('trip_updated', { tripId: target.TripId, action: 'multi_cust_approval_rejected' });
    res.json({ id: approvalId, tripId: target.TripId, status: 'REJECTED', message: 'ปฏิเสธคำขออนุมัติทริปหลายลูกค้าเรียบร้อย' });
  } catch (e) {
    console.error('[trip-approvals/reject]', e);
    res.status(e.status || 500).json({ message: e.message });
  }
});

module.exports = router;
