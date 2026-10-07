const { validateBookingNotes } = require('../services/booking-notes');
/**
 * so.js — wf.SalesOrder state machine
 * DRAFT → CONFIRMED → PICKING → SHIPPED → IMPORTED | CANCELLED
 *
 * Native writes use reviewed WinSpeed procedures and scoped table permissions.
 */
const router = require('express').Router();
const { sql, wfQuery, wfTransaction, getTarget } = require('../db');
const { toHttpError } = require('../services/error-adapter');
const { requireAuth, requireRole, requireCapability, requireRebateAmountAccess, canViewAllRebateAmounts } = require('../middleware/auth');

// Rebate on bills (amounts, discount at create/edit): the roles the bill editor shows it to. SALES lost rebate
// visibility at go-live (frontend permissions.ts REBATE_OWN_ROLES = []); the API used the wider rebate-report rule
// and still accepted a SALES discount sent directly (UAT batch 4, SO-20).
const canViewRebateAmounts = canViewAllRebateAmounts;
const { generateImportFiles } = require('../services/winspeed-import.service');
const { broadcast } = require('../services/socket');
const { enqueue } = require('../services/outbox');
const { writeAudit, auditUser, SCREEN } = require('../services/winspeed-audit');
const { evaluateLinePrice, createPriceApprovalRequest, calculatePricingFingerprint, resolveAuthoritativePrice } = require('../services/price-authority');

let _has141Cache = null;
async function checkMigration141() {
  if (_has141Cache === true) return true;
  try {
    const res = await wfQuery(`
      SELECT 1 FROM sys.columns 
      WHERE object_id = OBJECT_ID('wf.SalesOrder') AND name = 'AppliedRebateClaimId'
    `);
    _has141Cache = Boolean(res.recordset?.length > 0);
  } catch {
    _has141Cache = false;
  }
  return _has141Cache;
}

router.use(requireAuth);

// PascalCase → camelCase (DB คอลัมน์เป็น PascalCase, frontend type เป็น camelCase)
const camel = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const camelizeRow = (row) => {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[camel(k)] = v;
  if ('truckPlate' in out) {
    out.isControlTicket = Boolean(out.truckPlate === 'ตั๋วคุม');
  }
  return out;
};
const camelizeRows = (rows) => (rows || []).map(camelizeRow);

function normalizeRebateDiscount(req, value) {
  return canViewRebateAmounts(req.user) ? Number(value) || 0 : 0;
}

function toSqlDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toBit(value) {
  return value ? 1 : 0;
}

// Keep workflow references compatible with WINSpeed DocuNo while avoiding
// collisions with both existing native documents and concurrent app drafts.
const {allocateWorkflowRef,confirmDraft,lockConfirmationResource}=require('../services/draft-confirmation');

let giveawayApprovalColumns = null;
async function hasGiveawayApprovalColumns() {
  if (giveawayApprovalColumns !== null) return giveawayApprovalColumns;
  const r = await wfQuery(`
    SELECT CASE
      WHEN COL_LENGTH('wf.SalesOrderLine', 'GiveawayApprovalStatus') IS NULL THEN 0
      WHEN COL_LENGTH('wf.SalesOrderLineExt', 'GiveawayApprovalStatus') IS NULL THEN 0
      ELSE 1
    END AS HasColumns
  `);
  giveawayApprovalColumns = Number(r.recordset?.[0]?.HasColumns || 0) === 1;
  return giveawayApprovalColumns;
}

const quoteSourceTableCache = new Map();
async function hasQuoteSourceTable() {
  const target = getTarget();
  if (quoteSourceTableCache.has(target)) return quoteSourceTableCache.get(target);
  const r = await wfQuery(`SELECT CASE WHEN OBJECT_ID('wf.QuotationSourceSO', 'U') IS NULL THEN 0 ELSE 1 END AS HasTable`);
  const value = Number(r.recordset?.[0]?.HasTable || 0) === 1;
  quoteSourceTableCache.set(target, value);
  return value;
}

function quoteSourceSoId(id) {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function getPendingQuoteForSo(soId) {
  if (!(await hasQuoteSourceTable())) return null;
  const sourceSoId = quoteSourceSoId(soId);
  if (!sourceSoId) return null;
  const r = await wfQuery(`
    SELECT TOP 1 q.Id, q.QuoteNo, q.Status, q.Remark, q.ValidUntil
    FROM wf.QuotationSourceSO src WITH (NOLOCK)
    INNER JOIN wf.Quotation q WITH (NOLOCK) ON q.Id = src.QuoteId
    WHERE src.SoId = @soId
      AND q.Status IN ('DRAFT', 'SENT', 'EXPIRED')
    ORDER BY q.Id DESC
  `, { soId: { type: sql.Int, value: sourceSoId } });
  return r.recordset?.[0] || null;
}

function giveawayApprovalStatusForLine(req, line) {
  if (!line?.isGiveaway) return null;
  if (['ADMIN', 'MANAGER'].includes(req.user?.role) && line.giveawayApprovalStatus === 'APPROVED') return 'APPROVED';
  return 'PENDING';
}

function addGiveawayApprovalInputs(request, req, line, hasColumns) {
  if (!hasColumns) return;
  const status = giveawayApprovalStatusForLine(req, line);
  request.input('giveawayApprovalStatus', sql.NVarChar(20), status);
  request.input('giveawayApprovedBy', sql.Int, status === 'APPROVED' ? req.user.sub : null);
  request.input('giveawayApprovedAt', sql.DateTime2, status === 'APPROVED' ? new Date() : null);
  request.input('giveawayApprovalNote', sql.NVarChar(300), line.giveawayApprovalNote || null);
}

function giveawayApprovalInsertColumns(hasColumns) {
  return hasColumns ? ', GiveawayApprovalStatus, GiveawayApprovedBy, GiveawayApprovedAt, GiveawayApprovalNote' : '';
}

function giveawayApprovalInsertValues(hasColumns) {
  return hasColumns ? ', @giveawayApprovalStatus, @giveawayApprovedBy, @giveawayApprovedAt, @giveawayApprovalNote' : '';
}

function redactRebateFields(row) {
  if (!row || canViewRebateAmounts({ role: row.__viewerRole })) return row;
  const out = { ...row };
  for (const key of ['RebatePerTon', 'RebateAmount', 'RemainingAmt', 'RebateDiscountAmt', 'rebatePerTon', 'rebateAmount', 'remainingAmt', 'rebateDiscountAmt']) {
    if (key in out) out[key] = null;
  }
  return out;
}

function redactSoForRole(req, so) {
  if (canViewRebateAmounts(req.user)) return so;
  const scrub = (row) => redactRebateFields({ ...row, __viewerRole: req.user?.role });
  const redacted = scrub(so);
  delete redacted.__viewerRole;
  if (Array.isArray(redacted.lines)) {
    redacted.lines = redacted.lines.map(line => {
      const clean = scrub(line);
      delete clean.__viewerRole;
      return clean;
    });
  }
  return redacted;
}

function firstAuditAt(auditRows, predicate) {
  const row = (auditRows || [])
    .slice()
    .sort((a, b) => new Date(a.CreatedAt).getTime() - new Date(b.CreatedAt).getTime())
    .find(predicate);
  return row?.CreatedAt || null;
}

function buildStatusTimeline(so, auditRows, weighTicket) {
  return [
    {
      status: 'DRAFT',
      label: 'สร้างบิล',
      at: firstAuditAt(auditRows, a => a.Action === 'CREATED') || so.CreatedAt,
    },
    {
      status: 'CONFIRMED',
      label: 'ยืนยันบิล',
      at: firstAuditAt(auditRows, a => a.ToStatus === 'CONFIRMED' || a.Action === 'CONFIRMED'),
    },
    {
      status: 'PICKING',
      label: 'เริ่มรับสินค้า',
      at: firstAuditAt(auditRows, a => a.ToStatus === 'PICKING' || a.Action === 'PICKING'),
    },
    {
      status: 'LOADED',
      label: 'โหลดสินค้า',
      at: firstAuditAt(auditRows, a => a.ToStatus === 'LOADED' || a.Action === 'LOADED'),
    },
    {
      status: 'SHIPPED',
      label: 'ส่งออก',
      at: weighTicket?.WeighOutAt || firstAuditAt(auditRows, a => a.ToStatus === 'SHIPPED' || a.Action === 'SHIPPED'),
      source: weighTicket?.WeighOutAt ? 'weigh_ticket' : 'audit',
    },
    {
      status: 'IMPORTED',
      label: 'นำเข้า WINSpeed',
      at: so.ImportedAt || firstAuditAt(auditRows, a => a.ToStatus === 'IMPORTED' || a.Action === 'IMPORTED'),
    },
    {
      status: 'CANCELLED',
      label: 'ยกเลิก',
      at: firstAuditAt(auditRows, a => a.ToStatus === 'CANCELLED' || a.Action === 'CANCELLED'),
    },
  ];
}

// ── helpers ──────────────────────────────────────────────────
async function getSoOrThrow(id, expectedStatus = null) {
  if (id === 'undefined' || id === null || id === undefined || String(id).trim() === '' || Number.isNaN(id)) {
    throw Object.assign(new Error(`Invalid SO id: ${id}`), { status: 400 });
  }
  const isString = typeof id === 'string' && isNaN(Number(id));
  const idValue = isString ? id : Number(id);
  const idCol = isString ? 'Id' : 'CAST(Id AS INT)';
  const idType = isString ? sql.VarChar(50) : sql.Int;

  let r = await wfQuery(
    `SELECT * FROM wf.v_AllSalesOrders WHERE ${idCol} = @id`,
    { id: { type: idType, value: idValue } }
  );
  let so = r.recordset?.[0];

  // If not found, try to see if this ID was deduplicated out. Find the actual active SOID for its DocuNo.
  if (!so) {
    const docLookup = await wfQuery(`
      SELECT DocuNo FROM dbo.SOHD WITH (NOLOCK) WHERE SOID = @id
      UNION
      SELECT ISNULL(ImportedDocuNo, WfRef) AS DocuNo FROM wf.SalesOrder WITH (NOLOCK) WHERE Id = @id
    `, { id: { type: sql.Int, value: Number(id) || 0 } });
    
    if (docLookup.recordset?.length > 0) {
       const docuNo = docLookup.recordset[0].DocuNo;
       if (docuNo) {
         r = await wfQuery(
           `SELECT * FROM wf.v_AllSalesOrders WHERE WfRef = @docuNo OR ImportedDocuNo = @docuNo`,
           { docuNo: { type: sql.VarChar(50), value: docuNo } }
         );
         so = r.recordset?.[0];
       }
    }
  }

  if (!so) throw Object.assign(new Error(`SO id ${id} ไม่พบ`), { status: 404 });
  if (expectedStatus) {
    const allowed = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
    if (!allowed.includes(so.Status)) {
      throw Object.assign(new Error(`SO ต้องอยู่ใน ${allowed.join(' หรือ ')} (ปัจจุบัน: ${so.Status})`), { status: 400 });
    }
  }
  return so;
}

/**
 * Validate and lock coupon reservations in transaction before writing SO lines.
 * Checks:
 * - Duplicate reservation IDs in the order lines (prevent reuse in multiple lines)
 * - Existence and Status = 'RESERVED'
 * - Active unexpired (ExpiresAt > NOW if set)
 * - BeneficiaryCustId matches order customer
 * - GoodId matches order line GoodId
 * - ReservedQty matches order line QtyTon
 * - CarrierSoId is either null, starts with 'DRAFT:', 'SO-TEST-', or matches current SO ID
 */
const { validateAndLockCouponReservations } = require('../services/coupon-service');
const { checkGiveawayQuota, quotaErrorMessage, linePieces } = require('../services/giveaway-quota');
const { getVisibleScope, scopeFilter, inScope } = require('../services/visible-scope');

// R12 O-4: is this bill (draft or native) inside the user's own + team scope?
async function soVisibleTo(user, so, knownScope = null) {
  const scope = knownScope || await getVisibleScope(user);
  if (scope.all) return true;
  if (inScope(scope, { userId: so.SalesUserId })) return true;
  if (!so.ImportedDocuNo || !scope.empIds.length) return false;
  // The owner of a native bill is the EmpID of that very document (SOID). DocuNo is not unique:
  // a 103 booking and a 104 sales order can carry the same number for different salespeople
  // (live finding SR-6: I69-03697 is 7004's booking and 4000's sales order).
  const r = await wfQuery(
    `SELECT TOP 1 CAST(EmpID AS VARCHAR(20)) AS EmpID FROM dbo.SOHD WITH (NOLOCK)
     WHERE SOID = @soid AND DocuNo = @no AND DocuType IN (103, 104)`,
    {
      soid: { type: sql.Int, value: Number(so.Id) || 0 },
      no: { type: sql.NVarChar(30), value: String(so.ImportedDocuNo) },
    }
  );
  return inScope(scope, { empId: r.recordset?.[0]?.EmpID });
}

// R12 O-4: actions by id obey the detail view's scope — a bill outside the user's own + team
// scope answers 404 to edit / verify / confirm / cancel / approve just as it does to GET
async function requireSoInScope(req, res, next) {
  try {
    const scope = await getVisibleScope(req.user);
    if (scope.all) return next();
    const so = await getSoOrThrow(req.params.id);
    if (!(await soVisibleTo(req.user, so, scope))) return res.status(404).json({ message: `SO id ${req.params.id} ไม่พบ` });
    next();
  } catch (e) {
    res.status(e.status || 500).json({ message: e.message });
  }
}

// (sqlText, inputs) runner bound to an open transaction, for services that take a query function
function txQueryFn(tx) {
  return (text, inputs = {}) => {
    const r = tx.request();
    for (const [k, v] of Object.entries(inputs)) r.input(k, v.type, v.value);
    return r.query(text);
  };
}

/**
 * R6-1: Sanitizes order lines at request boundary by removing any client-supplied _-prefixed fields.
 */
function stripPrivateLineFields(lines) {
  if (!Array.isArray(lines)) return;
  for (const l of lines) {
    if (l && typeof l === 'object') {
      for (const k of Object.keys(l)) {
        if (k.startsWith('_')) {
          delete l[k];
        }
      }
    }
  }
}
router.stripPrivateLineFields = stripPrivateLineFields;
router.validateAndLockCouponReservations = validateAndLockCouponReservations;


/**
 * สร้างแถว wf.SalesOrderExt ให้ใบที่เกิดใน WINSpeed ถ้ายังไม่มี
 *
 * ใบที่เปิดจากแอปได้แถวนี้มาจาก wf.sp_ConfirmSalesOrder ตอนกดยืนยัน
 * แต่ใบที่พนักงานคีย์ใน WINSpeed โดยตรง — ซึ่งเป็นใบ **ส่วนใหญ่ของระบบจริง** —
 * ไม่มีใครสร้างให้เลย
 *
 * ผลคือขั้นโหลดสินค้าสั่ง `UPDATE wf.SalesOrderExt SET IsLoaded=1` แล้วโดน 0 แถว
 * โดยไม่มี error ใด ๆ สถานะจึงค้างที่ PICKING ตลอดไป และขั้นชั่งออกซึ่งบังคับ
 * ให้อยู่ในสถานะ LOADED ก็ตอบ 400 ทุกครั้ง = ใบที่คีย์จาก WINSpeed เดินไม่จบสาย
 *
 * SalesUserId เทียบจาก dbo.SOHD.EmpID → wf.AppUser.EmpId เพื่อให้รีเบทเข้าของ
 * พนักงานขายเจ้าของใบ ไม่ใช่คนที่กดปุ่มชั่งออก (ดูหมายเหตุที่ขั้น SHIPPED)
 *
 * **อ่าน dbo อย่างเดียว** — คัดลอกค่าเริ่มต้นออกมา ไม่เขียนกลับแม้แต่คอลัมน์เดียว
 * ทำงานซ้ำได้ (idempotent): ถ้ามีแถวอยู่แล้วจะไม่แตะของเดิม
 */
async function ensureSalesOrderExt(soid) {
  const r = await wfQuery(`
    INSERT INTO wf.SalesOrderExt (SOID, WfRef, SoPrefix, SalesUserId, CreditDays, TruckRemark, BillRemark, TranspId)
    SELECT CONVERT(VARCHAR(50), hd.SOID),
           hd.DocuNo,
           CASE WHEN LEFT(hd.DocuNo, 2) = 'AI'          THEN 'AI'
                WHEN LEFT(hd.DocuNo, 1) IN ('I', 'K')   THEN LEFT(hd.DocuNo, 1)
                ELSE 'W' END,
           u.Id, hd.CreditDays, hd.Desc1, hd.Desc2, hd.TranspID
    FROM dbo.SOHD hd WITH (NOLOCK)
    OUTER APPLY (
      SELECT TOP 1 a.Id FROM wf.AppUser a
      WHERE RTRIM(a.EmpId) = RTRIM(CONVERT(NVARCHAR(20), hd.EmpID))
      ORDER BY a.IsActive DESC, a.Id
    ) u
    WHERE CONVERT(VARCHAR(50), hd.SOID) = @id
      AND NOT EXISTS (SELECT 1 FROM wf.SalesOrderExt e WHERE e.SOID = CONVERT(VARCHAR(50), hd.SOID))`,
    { id: { type: sql.VarChar(50), value: String(soid) } }
  ).catch(err => {
    // คำขอสองรายการพร้อมกันอาจ insert ชนกันที่ primary key — ถือว่าสำเร็จ
    if (/PRIMARY KEY|duplicate key/i.test(err.message)) return { rowsAffected: [0] };
    throw err;
  });
  const created = (r.rowsAffected?.[0] || 0) > 0;
  if (created) console.log(`[so] สร้าง wf.SalesOrderExt ให้ใบที่คีย์จาก WINSpeed (SOID ${soid})`);

  // ผู้เรียกมักถือ so ที่อ่านมาก่อนแถวนี้จะเกิด ค่า SalesUserId ในมือจึงเป็น null
  // ส่งค่าที่เพิ่งได้กลับไปด้วย เพื่อไม่ให้ตกไปใช้ผู้ใช้ที่กดปุ่มแทนเจ้าของใบ
  const cur = await wfQuery(`SELECT SalesUserId FROM wf.SalesOrderExt WHERE SOID=@id`,
    { id: { type: sql.VarChar(50), value: String(soid) } });
  return { created, salesUserId: cur.recordset?.[0]?.SalesUserId ?? null };
}

async function getLines(soId) {
  const isString = typeof soId === 'string' && isNaN(Number(soId));
  const idValue = isString ? soId : Number(soId);
  const idCol = isString ? 'SoId' : 'CAST(SoId AS INT)';
  const idType = isString ? sql.VarChar(50) : sql.Int;

  let r = await wfQuery(
    `SELECT * FROM wf.v_AllSalesOrderLines WHERE ${idCol} = @soId ORDER BY LineNum`,
    { soId: { type: idType, value: idValue } }
  );
  if (!r.recordset || r.recordset.length === 0) {
    const numId = Number(idValue);
    if (!isNaN(numId)) {
      r = await wfQuery(
        `SELECT CAST(SoId AS VARCHAR(50)) AS SoId, LineNum, GoodId, GoodCode, GoodName, QtyTon, QtyBag, PricePerTon, NetPricePerTon, IsGiveaway, RebateBooked, RefControlTicketNo, IsControlTicketDrawn, CouponReservationId, RefCouponDocuNo, IsCouponDrawn, MasterQty, ChildQty, LoadSequence
         FROM wf.SalesOrderLine WHERE SoId = @soId ORDER BY LineNum`,
        { soId: { type: sql.Int, value: numId } }
      );
    }
  }

  // Enrich with Coupon and Beneficiary fields from wf.SalesOrderLine & wf.CouponReservation (Q7)
  if (r.recordset && r.recordset.length > 0) {
    const numId = Number(idValue);
    if (!isNaN(numId)) {
      const couponLines = (await wfQuery(`
        SELECT 
          cl.LineNum, cl.CouponReservationId, cl.RefCouponDocuNo, cl.IsCouponDrawn,
          cr.BeneficiaryCustId, cr.OwnerCustId,
          ben.CustCode AS BeneficiaryCustCode, ben.CustName AS BeneficiaryCustName,
          own.CustCode AS OwnerCustCode, own.CustName AS OwnerCustName
        FROM wf.SalesOrderLine cl WITH (NOLOCK)
        LEFT JOIN wf.CouponReservation cr WITH (NOLOCK) ON cr.Id = cl.CouponReservationId
        LEFT JOIN dbo.EMCust ben WITH (NOLOCK) ON ben.CustID = CASE WHEN ISNUMERIC(cr.BeneficiaryCustId) = 1 THEN CAST(cr.BeneficiaryCustId AS INT) END
        LEFT JOIN dbo.EMCust own WITH (NOLOCK) ON own.CustID = CASE WHEN ISNUMERIC(cr.OwnerCustId) = 1 THEN CAST(cr.OwnerCustId AS INT) END
        WHERE cl.SoId = @soId
      `, { soId: { type: sql.Int, value: numId } })).recordset || [];
      
      if (couponLines.length > 0) {
        const cMap = new Map(couponLines.map(cl => [cl.LineNum, cl]));
        for (const line of r.recordset) {
          const match = cMap.get(line.LineNum);
          if (match) {
            line.CouponReservationId = match.CouponReservationId;
            line.RefCouponDocuNo = match.RefCouponDocuNo;
            line.IsCouponDrawn = match.IsCouponDrawn;
            line.BeneficiaryCustId = match.BeneficiaryCustId;
            line.BeneficiaryCustCode = match.BeneficiaryCustCode;
            line.BeneficiaryCustName = match.BeneficiaryCustName;
            line.OwnerCustId = match.OwnerCustId;
            line.OwnerCustCode = match.OwnerCustCode;
            line.OwnerCustName = match.OwnerCustName;
          }
        }
      }
    }
  }

  return r.recordset || [];
}

// audit — เขียน log การเปลี่ยนสถานะ (immutable). รองรับ transaction เมื่อส่ง tx เข้ามา
async function audit(tx, soId, userId, action, fromStatus, toStatus, note, ipAddress) {
  // R12 item 4: record the Access As actor next to the effective user (column from migration 144)
  const { currentActorId, hasColumn } = require('../services/request-context');
  const withActor = await hasColumn(wfQuery, 'wf.SalesOrderAudit', 'ActorUserId');
  const sqlStr = withActor ? `
    INSERT INTO wf.SalesOrderAudit (SoId, UserId, Action, FromStatus, ToStatus, Note, IpAddress, ActorUserId)
    VALUES (@soId, @userId, @action, @fromStatus, @toStatus, @note, @ip, @actorUserId)
  ` : `
    INSERT INTO wf.SalesOrderAudit (SoId, UserId, Action, FromStatus, ToStatus, Note, IpAddress)
    VALUES (@soId, @userId, @action, @fromStatus, @toStatus, @note, @ip)
  `;
  const params = {
    ...(withActor ? { actorUserId: { type: sql.Int, value: currentActorId() ?? userId } } : {}),
    soId:       { type: sql.VarChar(50),  value: String(soId) },
    userId:     { type: sql.Int,          value: userId },
    action:     { type: sql.NVarChar(50), value: action },
    fromStatus: { type: sql.NVarChar(20), value: fromStatus || null },
    toStatus:   { type: sql.NVarChar(20), value: toStatus || null },
    note:       { type: sql.NVarChar(500),value: note || null },
    ip:         { type: sql.NVarChar(45), value: ipAddress || null },
  };

  if (tx && typeof tx.request === 'function') {
    const req = tx.request();
    for (const [k, { type, value }] of Object.entries(params)) req.input(k, type, value);
    await req.query(sqlStr);
  } else {
    await wfQuery(sqlStr, params);
  }
}

// ── GET /api/so/stats — สรุปจำนวนตามสถานะ (Dashboard) ────────
// Cache 5 นาที เพื่อลด load จาก 107k rows scan บน dbo.SOHD
let _statsCache = null;
let _statsCacheAt = 0;
const STATS_TTL = 5 * 60 * 1000;

router.delete('/stats/cache', requireRole('ADMIN', 'C_LEVEL'), (req, res) => {
  _statsCache = null; _statsCacheAt = 0;
  res.json({ ok: true, message: 'Stats cache cleared' });
});

router.get('/stats', async (req, res) => {
  try {
    const now = Date.now();
    const bust = req.query.bust === '1';
    // R12 O-4: a scoped user's counts cover only their own and their team's bills
    const scope = await getVisibleScope(req.user);
    if (!scope.all) {
      const f = scopeFilter(scope, { userCol: 'q.SalesUserId', prefix: 'sc' });
      const e = scopeFilter({ ...scope, userIds: [] }, { empCol: 'h.EmpID', prefix: 'se' });
      const sr = await wfQuery(`
        SELECT q.Status, COUNT(*) AS Cnt
        FROM wf.v_AllSalesOrders q
        WHERE ${f.sql}
           OR (q.ImportedDocuNo IS NOT NULL AND EXISTS (
                SELECT 1 FROM dbo.SOHD h WITH (NOLOCK)
                WHERE h.DocuNo = q.ImportedDocuNo AND h.DocuType IN (103, 104) AND ${e.sql}))
        GROUP BY q.Status`, { ...f.inputs, ...e.inputs });
      const byStatus = {};
      for (const row of sr.recordset || []) byStatus[row.Status] = row.Cnt;
      return res.json({ byStatus, total: Object.values(byStatus).reduce((t, n) => t + n, 0), scope: scope.basis, cachedAt: new Date().toISOString() });
    }
    if (!bust && _statsCache && now - _statsCacheAt < STATS_TTL) return res.json(_statsCache);

    const extCountResult = await wfQuery(`SELECT COUNT_BIG(*) AS Cnt FROM wf.SalesOrderExt WITH (NOLOCK)`);
    const hasWinspeedExt = Number(extCountResult.recordset?.[0]?.Cnt || 0) > 0;
    const winspeedStatsSql = hasWinspeedExt ? `
      WITH WfDraft AS (
        SELECT Status, COUNT(*) AS Cnt
        FROM wf.SalesOrder WITH (NOLOCK)
        GROUP BY Status
      ),
      WinspeedBase AS (
        SELECT
          CASE
            WHEN hd.DocuStatus = 'C' THEN 'CANCELLED'
            WHEN hd.DocuType = 104 THEN 'IMPORTED'
            WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
            WHEN hd.DocuType = 103 AND ISNULL(hd.DocuStatus, 'N') = 'N' THEN 'DRAFT'
            ELSE 'CONFIRMED'
          END AS Status,
          COUNT_BIG(*) AS Cnt
        FROM dbo.SOHD hd WITH (NOLOCK)
        WHERE hd.DocuType IN (103, 104)
        GROUP BY
          CASE
            WHEN hd.DocuStatus = 'C' THEN 'CANCELLED'
            WHEN hd.DocuType = 104 THEN 'IMPORTED'
            WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
            WHEN hd.DocuType = 103 AND ISNULL(hd.DocuStatus, 'N') = 'N' THEN 'DRAFT'
            ELSE 'CONFIRMED'
          END
      ),
      WinspeedExtAdjust AS (
        SELECT OldStatus AS Status, CAST(-COUNT_BIG(*) AS BIGINT) AS Cnt
        FROM (
          SELECT
            CASE
              WHEN hd.DocuStatus = 'C' THEN 'CANCELLED'
              WHEN hd.DocuType = 104 THEN 'IMPORTED'
              WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
              WHEN hd.DocuType = 103 AND ISNULL(hd.DocuStatus, 'N') = 'N' THEN 'DRAFT'
              ELSE 'CONFIRMED'
            END AS OldStatus,
            CASE
              WHEN hd.DocuStatus = 'C' THEN 'CANCELLED'
              WHEN ext.WeighOutWeight IS NOT NULL OR hd.clearflag = 'Y' THEN 'SHIPPED'
              WHEN hd.DocuType = 104 THEN 'IMPORTED'
              WHEN ext.IsLoaded = 1 THEN 'LOADED'
              WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
              WHEN ext.IsUnlocked = 1 THEN 'DRAFT'
              ELSE 'CONFIRMED'
            END AS NewStatus
          FROM wf.SalesOrderExt ext WITH (NOLOCK)
          JOIN dbo.SOHD hd WITH (NOLOCK)
            ON ext.SOID = CONVERT(VARCHAR(50), hd.SOID)
          WHERE hd.DocuType IN (103, 104)
        ) adjusted
        WHERE OldStatus <> NewStatus
        GROUP BY OldStatus

        UNION ALL

        SELECT NewStatus AS Status, COUNT_BIG(*) AS Cnt
        FROM (
          SELECT
            CASE
              WHEN hd.DocuStatus = 'C' THEN 'CANCELLED'
              WHEN hd.DocuType = 104 THEN 'IMPORTED'
              WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
              WHEN hd.DocuType = 103 AND ISNULL(hd.DocuStatus, 'N') = 'N' THEN 'DRAFT'
              ELSE 'CONFIRMED'
            END AS OldStatus,
            CASE
              WHEN hd.DocuStatus = 'C' THEN 'CANCELLED'
              WHEN ext.WeighOutWeight IS NOT NULL OR hd.clearflag = 'Y' THEN 'SHIPPED'
              WHEN hd.DocuType = 104 THEN 'IMPORTED'
              WHEN ext.IsLoaded = 1 THEN 'LOADED'
              WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
              WHEN ext.IsUnlocked = 1 THEN 'DRAFT'
              ELSE 'CONFIRMED'
            END AS NewStatus
          FROM wf.SalesOrderExt ext WITH (NOLOCK)
          JOIN dbo.SOHD hd WITH (NOLOCK)
            ON ext.SOID = CONVERT(VARCHAR(50), hd.SOID)
          WHERE hd.DocuType IN (103, 104)
        ) adjusted
        WHERE OldStatus <> NewStatus
        GROUP BY NewStatus
      )
      SELECT Status, CAST(SUM(Cnt) AS INT) AS Cnt
      FROM (
        SELECT Status, Cnt FROM WfDraft
        UNION ALL
        SELECT Status, Cnt FROM WinspeedBase
        UNION ALL
        SELECT Status, Cnt FROM WinspeedExtAdjust
      ) x
      GROUP BY Status
    ` : `
      WITH WfDraft AS (
        SELECT Status, COUNT(*) AS Cnt
        FROM wf.SalesOrder WITH (NOLOCK)
        GROUP BY Status
      ),
      WinspeedBase AS (
        SELECT
          CASE
            WHEN hd.DocuStatus = 'C' THEN 'CANCELLED'
            WHEN hd.DocuType = 104 THEN 'IMPORTED'
            WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
            WHEN hd.DocuType = 103 AND ISNULL(hd.DocuStatus, 'N') = 'N' THEN 'DRAFT'
            ELSE 'CONFIRMED'
          END AS Status,
          COUNT_BIG(*) AS Cnt
        FROM dbo.SOHD hd WITH (NOLOCK)
        WHERE hd.DocuType IN (103, 104)
        GROUP BY
          CASE
            WHEN hd.DocuStatus = 'C' THEN 'CANCELLED'
            WHEN hd.DocuType = 104 THEN 'IMPORTED'
            WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
            WHEN hd.DocuType = 103 AND ISNULL(hd.DocuStatus, 'N') = 'N' THEN 'DRAFT'
            ELSE 'CONFIRMED'
          END
      )
      SELECT Status, CAST(SUM(Cnt) AS INT) AS Cnt
      FROM (
        SELECT Status, Cnt FROM WfDraft
        UNION ALL
        SELECT Status, Cnt FROM WinspeedBase
      ) x
      GROUP BY Status
    `;
    const r = await wfQuery(winspeedStatsSql);
    const byStatus = {};
    for (const row of r.recordset || []) byStatus[row.Status] = row.Cnt;
    const total = Object.values(byStatus).reduce((s, n) => s + n, 0);
    _statsCache = { byStatus, total, cachedAt: new Date().toISOString() };
    _statsCacheAt = now;
    res.json(_statsCache);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// ── GET /api/so ───────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { status, custId, search, dateFrom, dateTo, page = 1, limit = 50 } = req.query;
    const conditions = [];
    const inputs = {};
    if (status)  { conditions.push(`q.Status = @status`);  inputs.status  = { type: sql.NVarChar(20), value: status }; }
    if (custId)  { conditions.push(`q.CustId = @custId`);  inputs.custId  = { type: sql.NVarChar(20), value: custId }; }
    if (search)  { 
      conditions.push(`(q.WfRef LIKE '%' + @search + '%' OR q.CustName LIKE '%' + @search + '%' OR q.TruckPlate LIKE '%' + @search + '%' OR q.ImportedDocuNo LIKE '%' + @search + '%')`);
      inputs.search = { type: sql.NVarChar(100), value: search }; 
    }
    if (dateFrom || dateTo) {
      const dateFields = ['q.CreatedAt', 'q.DeliveryDate', 'q.RequestedAt', 'q.ImportedAt'];
      const perField = dateFields.map(field => {
        if (dateFrom && dateTo) return `(CAST(${field} AS DATE) BETWEEN @dateFrom AND @dateTo)`;
        if (dateFrom) return `(CAST(${field} AS DATE) >= @dateFrom)`;
        return `(CAST(${field} AS DATE) <= @dateTo)`;
      });
      conditions.push(`(${perField.join(' OR ')})`);
      if (dateFrom) inputs.dateFrom = { type: sql.Date, value: new Date(String(dateFrom)) };
      if (dateTo) inputs.dateTo = { type: sql.Date, value: new Date(String(dateTo)) };
    }
    // R12 O-4: own records + team (org chart) — ADMIN/C_LEVEL/ACCOUNTING see all
    const scope = await getVisibleScope(req.user);
    if (!scope.all) {
      const f = scopeFilter(scope, { userCol: 'q.SalesUserId', empCol: 'q.OwnerEmpId', prefix: 'sc' });
      conditions.push(f.sql);
      Object.assign(inputs, f.inputs);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const pageNumber = Math.max(1, Number.parseInt(String(page), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(limit), 10) || 50));
    const offset = (pageNumber - 1) * pageSize;

    const countResult = await wfQuery(`
      WITH Orders AS (
        SELECT
          CAST(so.Id AS VARCHAR(50)) AS Id,
          so.WfRef,
          so.CustId,
          so.CustName,
          so.TruckPlate,
          so.Status,
          so.ImportedDocuNo,
          so.CreatedAt,
          so.DeliveryDate,
          so.RequestedAt,
          so.ImportedAt,
          so.SalesUserId,
          CAST(NULL AS VARCHAR(20)) AS OwnerEmpId
        FROM wf.SalesOrder so WITH (NOLOCK)

        UNION ALL

        SELECT
          CAST(hd.SOID AS VARCHAR(50)) AS Id,
          ISNULL(ext.WfRef, hd.DocuNo) AS WfRef,
          hd.CustID AS CustId,
          hd.CustName,
          hd.TransRegistration AS TruckPlate,
          CASE
            WHEN hd.DocuStatus = 'C' THEN 'CANCELLED'
            WHEN ext.WeighOutWeight IS NOT NULL OR hd.clearflag = 'Y' THEN 'SHIPPED'
            WHEN hd.DocuType = 104 THEN 'IMPORTED'
            WHEN ext.IsLoaded = 1 THEN 'LOADED'
            WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
            WHEN ext.IsUnlocked = 1 THEN 'DRAFT'
            ELSE 'CONFIRMED'
          END AS Status,
          hd.DocuNo AS ImportedDocuNo,
          CAST(hd.DocuDate AS DATETIME2) AS CreatedAt,
          ext.DeliveryDate,
          ext.RequestedAt,
          ext.ImportedAt,
          ext.SalesUserId,
          CAST(hd.EmpID AS VARCHAR(20)) AS OwnerEmpId
        FROM dbo.SOHD hd WITH (NOLOCK)
        LEFT JOIN wf.SalesOrderExt ext WITH (NOLOCK)
          ON CONVERT(VARCHAR(50), ext.SOID) = CONVERT(VARCHAR(50), hd.SOID)
        WHERE hd.DocuType IN (103, 104)
      )
      SELECT COUNT_BIG(*) AS TotalCount
      FROM Orders q
      ${where}
    `, inputs);

    const total = Number(countResult.recordset?.[0]?.TotalCount || 0);

    const r = await wfQuery(`
      WITH Orders AS (
        SELECT
          CAST(so.Id AS VARCHAR(50)) AS Id,
          so.WfRef,
          so.SoPrefix,
          so.CustId,
          so.CustName,
          so.TruckPlate,
          so.ControlTicketNo,
          so.DeliveryDate,
          so.RequestedAt,
          so.IsOwnTruck,
          so.NoTruckRequired,
          so.PSling,
          so.Remark,
          so.Status,
          so.SalesUserId,
          so.ImportFilePath,
          so.ImportedDocuNo,
          so.ImportedAt,
          so.CreatedAt,
          so.UpdatedAt,
          ISNULL(so.RebateDiscountAmt, 0) AS RebateDiscountAmt,
          CAST(0 AS BIT) AS IsLoaded,
          CAST(NULL AS DECIMAL(10,2)) AS WeighOutWeight,
          so.CreditDays,
          so.TruckRemark,
          so.BillRemark,
          so.TranspId,
          so.TripId,
          ISNULL(so.RequiresPriceApproval, 0) AS RequiresPriceApproval,
          ISNULL(so.PriceApprovalStatus, 'NONE') AS PriceApprovalStatus,
          pq.Id AS LinkedQuoteId,
          pq.QuoteNo AS LinkedQuoteNo,
          pq.Status AS LinkedQuoteStatus,
          pq.Remark AS LinkedQuoteRemark,
          pq.ValidUntil AS LinkedQuoteValidUntil,
          CASE WHEN pq.Id IS NOT NULL THEN 'Waiting for quotation ' + ISNULL(pq.QuoteNo, '') + ' confirmation' ELSE NULL END AS QuotationLockReason,
          CAST(NULL AS VARCHAR(20)) AS OwnerEmpId
        FROM wf.SalesOrder so WITH (NOLOCK)
        OUTER APPLY (
          SELECT TOP 1 q.Id, q.QuoteNo, q.Status, q.Remark, q.ValidUntil
          FROM wf.QuotationSourceSO src WITH (NOLOCK)
          INNER JOIN wf.Quotation q WITH (NOLOCK) ON q.Id = src.QuoteId
          WHERE src.SoId = so.Id
            AND q.Status IN ('DRAFT', 'SENT', 'EXPIRED')
          ORDER BY q.Id DESC
        ) pq

        UNION ALL

        SELECT
          CAST(hd.SOID AS VARCHAR(50)) AS Id,
          ISNULL(ext.WfRef, hd.DocuNo) AS WfRef,
          ISNULL(ext.SoPrefix, CASE WHEN LEFT(hd.DocuNo, 2) = 'AI' THEN 'AI' WHEN LEFT(hd.DocuNo, 1) IN ('I', 'K') THEN LEFT(hd.DocuNo, 1) ELSE 'W' END) AS SoPrefix,
          hd.CustID AS CustId,
          hd.CustName,
          hd.TransRegistration AS TruckPlate,
          ext.ControlTicketNo,
          ext.DeliveryDate,
          ext.RequestedAt,
          ISNULL(ext.IsOwnTruck, 0) AS IsOwnTruck,
          ISNULL(ext.NoTruckRequired, 0) AS NoTruckRequired,
          ISNULL(ext.PSling, 0) AS PSling,
          hd.Remark,
          CASE
            WHEN hd.DocuStatus = 'C' THEN 'CANCELLED'
            WHEN ext.WeighOutWeight IS NOT NULL OR hd.clearflag = 'Y' THEN 'SHIPPED'
            WHEN hd.DocuType = 104 THEN 'IMPORTED'
            WHEN ext.IsLoaded = 1 THEN 'LOADED'
            WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
            WHEN ext.IsUnlocked = 1 THEN 'DRAFT'
            ELSE 'CONFIRMED'
          END AS Status,
          ext.SalesUserId,
          ext.ImportFilePath,
          hd.DocuNo AS ImportedDocuNo,
          ext.ImportedAt,
          CAST(hd.DocuDate AS DATETIME2) AS CreatedAt,
          ext.UpdatedAt,
          ISNULL(ext.RebateDiscountAmt, 0) AS RebateDiscountAmt,
          ISNULL(ext.IsLoaded, 0) AS IsLoaded,
          ext.WeighOutWeight,
          ISNULL(ext.CreditDays, hd.CreditDays) AS CreditDays,
          ISNULL(ext.TruckRemark, hd.Desc1) AS TruckRemark,
          ISNULL(ext.BillRemark, hd.Desc2) AS BillRemark,
          ISNULL(ext.TranspId, hd.TranspID) AS TranspId,
          CAST(NULL AS INT) AS TripId,
          CAST(0 AS BIT) AS RequiresPriceApproval,
          CAST('NONE' AS VARCHAR(20)) AS PriceApprovalStatus,
          pq.Id AS LinkedQuoteId,
          pq.QuoteNo AS LinkedQuoteNo,
          pq.Status AS LinkedQuoteStatus,
          pq.Remark AS LinkedQuoteRemark,
          pq.ValidUntil AS LinkedQuoteValidUntil,
          CASE WHEN pq.Id IS NOT NULL THEN 'Waiting for quotation ' + ISNULL(pq.QuoteNo, '') + ' confirmation' ELSE NULL END AS QuotationLockReason,
          CAST(hd.EmpID AS VARCHAR(20)) AS OwnerEmpId
        FROM dbo.SOHD hd WITH (NOLOCK)
        LEFT JOIN wf.SalesOrderExt ext WITH (NOLOCK)
          ON CONVERT(VARCHAR(50), ext.SOID) = CONVERT(VARCHAR(50), hd.SOID)
        OUTER APPLY (
          SELECT TOP 1 q.Id, q.QuoteNo, q.Status, q.Remark, q.ValidUntil
          FROM wf.QuotationSourceSO src WITH (NOLOCK)
          INNER JOIN wf.Quotation q WITH (NOLOCK) ON q.Id = src.QuoteId
          WHERE src.SoId = CASE
              WHEN hd.SOID IS NOT NULL
               AND LTRIM(RTRIM(CONVERT(VARCHAR(50), hd.SOID))) NOT LIKE '%[^0-9]%'
               AND LTRIM(RTRIM(CONVERT(VARCHAR(50), hd.SOID))) <> ''
               AND (
                 LEN(LTRIM(RTRIM(CONVERT(VARCHAR(50), hd.SOID)))) <= 9
                 OR (LEN(LTRIM(RTRIM(CONVERT(VARCHAR(50), hd.SOID)))) = 10 AND CAST(LTRIM(RTRIM(CONVERT(VARCHAR(50), hd.SOID))) AS BIGINT) <= 2147483647)
               )
              THEN CAST(hd.SOID AS INT)
              ELSE NULL
            END
            AND q.Status IN ('DRAFT', 'SENT', 'EXPIRED')
          ORDER BY q.Id DESC
        ) pq
        WHERE hd.DocuType IN (103, 104)
      ),
      FilteredOrders AS (
        SELECT q.*, u.DisplayName AS SalesName,
               ROW_NUMBER() OVER (ORDER BY q.CreatedAt DESC, q.Id DESC) AS RowNum
        FROM Orders q
        LEFT JOIN wf.AppUser u WITH (NOLOCK) ON u.Id = q.SalesUserId
        ${where}
      )
      SELECT *
      FROM FilteredOrders
      WHERE RowNum > ${offset} AND RowNum <= (${offset} + ${pageSize})
      ORDER BY RowNum ASC
    `, inputs);
    const rows = r.recordset || [];

    // attach lines for each order on this page
    const orders = camelizeRows(rows);
    if (orders.length) {
      const ids = rows.map(x => x.Id).filter(id => id != null && id !== 'undefined');
      if (ids.length === 0) {
        for (const o of orders) o.lines = [];
        res.json({ data: orders.map(o => redactSoForRole(req, o)), total, page: pageNumber, limit: pageSize });
        return;
      }
      const idParams = ids.map((_, i) => `@id${i}`).join(',');
      const lr = await wfQuery(
        `
        SELECT
          CAST(sol.SoId AS VARCHAR(50)) AS SoId,
          sol.LineNum,
          sol.GoodId,
          sol.GoodCode,
          sol.GoodName,
          sol.QtyTon,
          sol.QtyBag,
          sol.MasterQty,
          sol.ChildQty,
          sol.PricePerTon,
          sol.NetPricePerTon,
          CAST(sol.QtyTon * sol.PricePerTon AS DECIMAL(18,2)) AS LineAmount,
          CAST((sol.PricePerTon - sol.NetPricePerTon) AS DECIMAL(18,2)) AS RebatePerTon,
          CAST((sol.PricePerTon - sol.NetPricePerTon) * sol.QtyTon AS DECIMAL(18,2)) AS RebateAmount,
          sol.IsGiveaway,
          sol.GiveawayApprovalStatus,
          sol.GiveawayApprovedBy,
          sol.GiveawayApprovedAt,
          sol.GiveawayApprovalNote,
          sol.RefControlTicketNo,
          sol.IsControlTicketDrawn,
          sol.LoadSequence
        FROM wf.SalesOrderLine sol WITH (NOLOCK)
        WHERE CONVERT(VARCHAR(50), sol.SoId) IN (${idParams})

        UNION ALL

        SELECT
          CAST(dt.SOID AS VARCHAR(50)) AS SoId,
          dt.ListNo AS LineNum,
          CAST(dt.GoodID AS NVARCHAR(20)) AS GoodId,
          ISNULL(g.GoodCode, CAST(dt.GoodID AS NVARCHAR(50))) AS GoodCode,
          ISNULL(NULLIF(dt.GoodName, ''), g.GoodName1) AS GoodName,
          CAST(ISNULL(dt.GoodQty2, 0) AS DECIMAL(12,3)) AS QtyTon,
          CAST(0 AS INT) AS QtyBag,
          dt.MasterQty,
          dt.ChildQty,
          CAST(ISNULL(dt.GoodPrice2, 0) AS DECIMAL(12,2)) AS PricePerTon,
          CAST(ISNULL(ext.NetPricePerTon, dt.GoodPrice2) AS DECIMAL(12,2)) AS NetPricePerTon,
          CAST(ISNULL(dt.GoodAmnt, ISNULL(dt.GoodQty2, 0) * ISNULL(dt.GoodPrice2, 0)) AS DECIMAL(18,2)) AS LineAmount,
          CAST(ISNULL(dt.GoodPrice2, 0) - ISNULL(ext.NetPricePerTon, dt.GoodPrice2) AS DECIMAL(18,2)) AS RebatePerTon,
          CAST((ISNULL(dt.GoodPrice2, 0) - ISNULL(ext.NetPricePerTon, dt.GoodPrice2)) * ISNULL(dt.GoodQty2, 0) AS DECIMAL(18,2)) AS RebateAmount,
          CAST(CASE WHEN ISNULL(ext.IsGiveaway, 0) = 1 OR ISNULL(dt.FreeFlag, 'N') = 'Y' THEN 1 ELSE 0 END AS BIT) AS IsGiveaway,
          ext.GiveawayApprovalStatus,
          ext.GiveawayApprovedBy,
          ext.GiveawayApprovedAt,
          ext.GiveawayApprovalNote,
          ext.RefControlTicketNo,
          ext.IsControlTicketDrawn,
          ext.LoadSequence
        FROM dbo.SODT dt WITH (NOLOCK)
        LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = dt.GoodID
        LEFT JOIN wf.SalesOrderLineExt ext WITH (NOLOCK)
          ON CONVERT(VARCHAR(50), ext.SOID) = CONVERT(VARCHAR(50), dt.SOID)
         AND ext.ListNo = dt.ListNo
        WHERE CONVERT(VARCHAR(50), dt.SOID) IN (${idParams})
        ORDER BY SoId, LineNum
        `,
        Object.fromEntries(ids.map((id, i) => [`id${i}`, { type: sql.VarChar(50), value: String(id) }]))
      );
      const linesByso = {};
      for (const line of camelizeRows(lr.recordset)) {
        (linesByso[line.soId] ??= []).push(line);
      }
      for (const o of orders) o.lines = linesByso[o.id] || [];
    }
    res.json({ data: orders.map(o => redactSoForRole(req, o)), total, page: pageNumber, limit: pageSize });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// ── GET /api/so/rebate-balance/:custId ─────────────────────────
router.get('/rebate-balance/:custId', requireRebateAmountAccess, async (req, res) => {
  try {
    const r = await wfQuery(
      `SELECT ISNULL(SUM(RemainingAmt), 0) AS AvailableRebate 
       FROM wf.RebateLedger 
       WHERE CustId = @custId AND Status = 'PENDING' AND RemainingAmt > 0 AND ReversedFlag = 0`,
      { custId: { type: sql.VarChar(20), value: req.params.custId } }
    );
    res.json({ availableRebate: Number(r.recordset[0]?.AvailableRebate || 0) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: e.message });
  }
});

// ── GET /api/so/debug-sohd ──────────────────────────────────
router.get('/debug-sohd', async (req, res) => {
  try {
    const r = await wfQuery(`SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='SOHD'`);
    res.json(r.recordset);
  } catch(e) { res.status(500).json({msg: e.message}); }
});

// ── GET /api/so/shipped-today — ออกของวันนี้ (สำหรับ Accounting)
// returns dbo.SOHD records with DocuDate = today or clearflag set today
router.get('/shipped-today', requireAuth, async (req, res) => {
  try {
    const dateStr = req.query.date || new Date().toISOString().substring(0, 10);
    const r = await wfQuery(`
      SELECT TOP 200
             hd.SOID AS Id, hd.DocuNo AS WfRef, hd.CustName,
             CONVERT(VARCHAR(10), hd.DocuDate, 120) AS DocuDate,
             hd.DocuStatus,
             CAST(ISNULL(SUM(dt.GoodQty2), 0) AS DECIMAL(12,2)) AS TotalTon,
             COUNT(dt.ListNo) AS LineCount,
             hd.TransRegistration AS TruckPlate
      FROM dbo.SOHD hd
      LEFT JOIN dbo.SODT dt ON dt.SOID = hd.SOID
      WHERE CAST(hd.DocuDate AS DATE) = @d
        AND hd.DocuType = 103
      GROUP BY hd.SOID, hd.DocuNo, hd.CustName, hd.DocuDate, hd.DocuStatus, hd.TransRegistration
      ORDER BY hd.DocuDate DESC, hd.SOID DESC
    `, { d: { type: sql.Date, value: new Date(dateStr) } });
    res.json(r.recordset || []);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// ── Unlock Request flow (FR-006/007) ─────────────────────────

// GET /api/so/unlock-reasons?type=EDIT — Fetch historical reasons
router.get('/unlock-reasons', async (req, res) => {
  try {
    const { type } = req.query;
    if (!type) return res.status(400).json({ message: 'Missing type' });
    const r = await wfQuery(`
      SELECT DISTINCT TOP 20 Reason
      FROM wf.UnlockRequest
      WHERE ReqType = @type
        AND Reason NOT IN ('🚚 เปลี่ยนรถ', '📦 สินค้าผิด/เปลี่ยนสินค้า', '📅 เลื่อนวันส่ง', '❌ ลูกค้ายกเลิก', '✍️ อื่นๆ')
      ORDER BY Reason
    `, { type: { type: sql.NVarChar(20), value: type } });
    res.json(r.recordset.map(row => row.Reason));
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: e.message });
  }
});

// GET /api/so/unlock-requests?status=PENDING — สำหรับ Approver
router.get('/unlock-requests', requireRole('APPROVER', 'ADMIN', 'MANAGER', 'ACCOUNTING', 'C_LEVEL'), async (req, res) => {
  try {
    const { status } = req.query;
    const conds = [];
    const inputs = {};
    if (status) { conds.push('r.Status=@st'); inputs.st = { type: sql.NVarChar(20), value: status }; }
    // R12 O-4: a MANAGER sees unlock requests of their own team only
    const scope = await getVisibleScope(req.user);
    if (!scope.all) {
      const f = scopeFilter(scope, { userCol: 'r.RequesterId', prefix: 'ur' });
      conds.push(f.sql);
      Object.assign(inputs, f.inputs);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await wfQuery(`
      SELECT r.*, ru.DisplayName AS RequesterName, au.DisplayName AS ApproverName
      FROM wf.UnlockRequest r
      LEFT JOIN wf.AppUser ru ON ru.Id = r.RequesterId
      LEFT JOIN wf.AppUser au ON au.Id = r.ApproverId
      ${where} ORDER BY r.RequestedAt DESC
    `, inputs);
    res.json(r.recordset || []);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// PATCH /api/so/unlock-requests/:reqId/resolve — Approver อนุมัติ/ปฏิเสธ
router.patch('/unlock-requests/:reqId/resolve', requireRole('APPROVER', 'ADMIN', 'MANAGER', 'ACCOUNTING', 'C_LEVEL'), async (req, res) => {
  try {
    const { approve, note } = req.body || {};
    const reqRow = (await wfQuery(`SELECT * FROM wf.UnlockRequest WHERE Id=@id`,
      { id: { type: sql.Int, value: Number(req.params.reqId) } })).recordset[0];
    if (!reqRow) return res.status(404).json({ message: 'ไม่พบคำขอ' });
    // R12 O-4: the same team rule as the list above — a manager on the org chart answers the team's requests only
    if (!inScope(await getVisibleScope(req.user), { userId: reqRow.RequesterId })) return res.status(404).json({ message: 'ไม่พบคำขอ' });
    if (reqRow.Status !== 'PENDING') return res.status(400).json({ message: 'คำขอถูกดำเนินการแล้ว' });

    if (approve) {
      // reverse rebate accrual
      await wfQuery(
        `UPDATE wf.RebateLedger SET ReversedFlag=1, ReversedAt=GETUTCDATE(), ReversedNote=@note, Status='REVERSED'
         WHERE SoId=@soId AND ReversedFlag=0`,
        { soId: { type: sql.VarChar(50), value: reqRow.SoId }, note: { type: sql.NVarChar(300), value: note || 'Request approved' } });
      await wfQuery(`UPDATE wf.SalesOrderLineExt SET RebateBooked=0 WHERE SOID=@soId`, { soId: { type: sql.VarChar(50), value: reqRow.SoId } });
      
      const targetStatus = reqRow.ReqType === 'CANCEL' ? 'CANCELLED' : 'DRAFT';
      
      // Update PkgStatus in SOHD depending on targetStatus
      if (targetStatus === 'CANCELLED') {
        await wfQuery(`UPDATE dbo.SOHD SET PkgStatus='C' WHERE SOID=@id`, { id: { type: sql.VarChar(50), value: reqRow.SoId } });
      } else {
        // DRAFT
        await wfQuery(`UPDATE dbo.SOHD SET PkgStatus='N' WHERE SOID=@id`, { id: { type: sql.VarChar(50), value: reqRow.SoId } });
        // Set IsUnlocked flag so view considers it DRAFT
        await wfQuery(`UPDATE wf.SalesOrderExt SET IsUnlocked=1 WHERE SOID=@id`, { id: { type: sql.VarChar(50), value: reqRow.SoId } });
      }

      await audit(null, reqRow.SoId, req.user.sub, reqRow.ReqType === 'CANCEL' ? 'CANCELLED' : 'EDIT_UNLOCKED', null, targetStatus, note, req.ip);
    }
    await wfQuery(`UPDATE wf.UnlockRequest SET Status=@st, ApproverId=@uid, ResponseNote=@note, RespondedAt=GETUTCDATE() WHERE Id=@id`,
      {
        st: { type: sql.NVarChar(20), value: approve ? 'APPROVED' : 'REJECTED' },
        uid:{ type: sql.Int, value: req.user.sub },
        note:{ type: sql.NVarChar(300), value: note || null },
        id: { type: sql.Int, value: reqRow.Id },
      });
    broadcast('so_updated', { id: reqRow.SoId, action: 'unlock_resolved' });
    res.json({ id: reqRow.Id, status: approve ? 'APPROVED' : 'REJECTED' });
  } catch (e) { console.error(e); res.status(e.status || 500).json({ message: e.message }); }
});

// ── GET /api/so/:id/weigh — WeighTicket ของ SO ───────────────
router.get('/:id/weigh', requireSoInScope, async (req, res) => {
  try {
    const r = await wfQuery(`SELECT TOP 1 * FROM wf.WeighTicket WHERE SoId=@id ORDER BY Id DESC`,
      { id: { type: sql.NVarChar(50), value: String(req.params.id) } });
    res.json(r.recordset?.[0] || null);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ── GET /api/so/:id ──────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const so = await getSoOrThrow(req.params.id);
    if (!(await soVisibleTo(req.user, so))) return res.status(404).json({ message: `SO id ${req.params.id} ไม่พบ` });
    const lines = await getLines(so.Id);
    const auditR = await wfQuery(
      `SELECT a.*, u.DisplayName FROM wf.SalesOrderAudit a JOIN wf.AppUser u ON u.Id = a.UserId WHERE a.SoId = @id ORDER BY a.CreatedAt DESC`,
      { id: { type: sql.VarChar(50), value: String(so.Id) } }
    );
    const weighR = await wfQuery(
      `SELECT TOP 1 * FROM wf.WeighTicket WHERE SoId=@id ORDER BY Id DESC`,
      { id: { type: sql.NVarChar(50), value: String(so.Id) } }
    );
    const auditRows = auditR.recordset || [];
    const weighTicket = weighR.recordset?.[0] || null;
    const pendingQuote = await getPendingQuoteForSo(so.Id);

    // printed documents name the bill's salesperson and the customer's own address: the A4 booking showed the
    // person printing as salesperson, the tax id as address and phone, or the company's own address (UAT RPT-06)
    const party = (await wfQuery(`
      SELECT (SELECT TOP 1 DisplayName FROM wf.AppUser WHERE Id = @uid) AS SalesName,
             c.CustAddr1, c.CustAddr2, c.Amphur, c.Province, c.PostCode, c.ContTel, c.ContTel1
      FROM (SELECT 1 AS x) one
      LEFT JOIN dbo.EMCust c WITH (NOLOCK) ON c.CustID = @cid`, {
      uid: { type: sql.Int, value: so.SalesUserId ? Number(so.SalesUserId) : null },
      cid: { type: sql.Int, value: /^\d+$/.test(String(so.CustId || '')) ? Number(so.CustId) : null },
    })).recordset?.[0] || {};
    const phone = [party.ContTel1, party.ContTel].map(v => String(v || '').trim()).find(v => v && !/^tax/i.test(v)) || null;
    const custAddress = [party.CustAddr1, party.CustAddr2, party.Amphur, party.Province, party.PostCode]
      .map(v => String(v || '').trim()).filter(Boolean).join(' ') || null;

    const { evaluatePickupTiming } = require('../services/so-pickup-policy');
    const pickupEvaluation = {
      in: evaluatePickupTiming(so.ActualWeighInAt, so.PickupDueDate),
      out: evaluatePickupTiming(so.ActualWeighOutAt, so.PickupDueDate),
    };

    res.json(redactSoForRole(req, {
      ...camelizeRow(so),
      salesName: party.SalesName || null,
      custAddress,
      custTel: phone,
      pickupEvaluation,
      linkedQuoteId: pendingQuote?.Id || null,
      linkedQuoteNo: pendingQuote?.QuoteNo || null,
      linkedQuoteStatus: pendingQuote?.Status || null,
      linkedQuoteRemark: pendingQuote?.Remark || null,
      linkedQuoteValidUntil: pendingQuote?.ValidUntil || null,
      quotationLockReason: pendingQuote ? `Waiting for quotation ${pendingQuote.QuoteNo} confirmation` : null,
      lines: camelizeRows(lines),
      auditLogs: camelizeRows(auditRows),
      weighOutAt: weighTicket?.WeighOutAt || null,
      statusTimeline: camelizeRows(buildStatusTimeline(so, auditRows, weighTicket)),
    }));
  } catch (e) { res.status(e.status || 500).json({ message: e.message }); }
});

// ── POST /api/so — Create DRAFT (Supports Single or Grouped Multi-Bill) ──
// GET /api/so/giveaways/pending — list all pending giveaways
router.get('/giveaways/pending', requireRole('MANAGER', 'ADMIN', 'C_LEVEL', 'APPROVER'), async (req, res) => {
  try {
    if (!(await hasGiveawayApprovalColumns())) return res.json([]);
    // R12 O-4: a manager on the org chart approves only the team's giveaways
    const sf = scopeFilter(await getVisibleScope(req.user), { userCol: 's.SalesUserId', prefix: 'gp' });
    const r = await wfQuery(`
      SELECT l.SoId, l.LineNum, l.GoodName, l.QtyTon, l.QtyBag, 
             ISNULL(l.QtyBag, CAST(l.QtyTon AS INT)) AS QtyPiece,
             l.GiveawayApprovalNote,
             s.WfRef, s.CustName, s.CreatedAt, u.DisplayName AS CreatedByName
      FROM wf.SalesOrderLine l
      INNER JOIN wf.SalesOrder s ON s.Id = l.SoId
      LEFT JOIN wf.AppUser u ON u.Id = s.SalesUserId
      WHERE l.IsGiveaway = 1 AND ISNULL(l.GiveawayApprovalStatus, 'PENDING') = 'PENDING' AND s.Status = 'DRAFT'
        AND ${sf.sql}
      ORDER BY s.CreatedAt ASC
    `, sf.inputs);
    res.json(r.recordset || []);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// PATCH /api/so/:id/giveaway-lines/:lineNum/approve — manager approval for giveaway line
router.patch('/:id/giveaway-lines/:lineNum/approve', requireRole('MANAGER', 'ADMIN', 'C_LEVEL'), requireSoInScope, async (req, res) => {
  try {
    if (!(await hasGiveawayApprovalColumns())) {
      return res.status(400).json({ message: 'ยังไม่ได้ apply migration สำหรับอนุมัติของแถมรายบรรทัด' });
    }
    const so = await getSoOrThrow(req.params.id);
    const lineNum = Number(req.params.lineNum);
    const note = req.body?.note || null;
    // an unlocked native bill reads DRAFT too, but its lines live in SalesOrderLineExt
    const isDraft = so.Status === 'DRAFT' && !so.ImportedDocuNo;
    const targetTable = isDraft ? 'wf.SalesOrderLine' : 'wf.SalesOrderLineExt';
    const idColumn = isDraft ? 'SoId' : 'SOID';
    const lineColumn = isDraft ? 'LineNum' : 'ListNo';
    const idType = isDraft ? sql.Int : sql.VarChar(50);
    const idValue = isDraft ? Number(so.Id) : String(so.Id);

    // R11 U-7/U-8: ตรวจโควต้าอีกครั้งตอนอนุมัติ — บิลอื่นอาจใช้โควต้าไปแล้วหลังบันทึกบิลนี้
    if (isDraft) {
      const draftLines = (await wfQuery(
        `SELECT LineNum, GoodId, GoodName, QtyTon, QtyBag, IsGiveaway FROM wf.SalesOrderLine WHERE SoId = @soId ORDER BY LineNum`,
        { soId: { type: sql.Int, value: Number(so.Id) } }
      )).recordset || [];
      const quota = await checkGiveawayQuota({ queryFn: wfQuery, salesUserId: so.SalesUserId, lines: draftLines, excludeSoId: so.Id });
      if (!quota.ok) {
        return res.status(400).json({ message: quotaErrorMessage(quota.problems), code: 'GIVEAWAY_OVER_QUOTA', problems: quota.problems });
      }
    }

    const r = await wfQuery(`
      UPDATE ${targetTable}
      SET GiveawayApprovalStatus='APPROVED',
          GiveawayApprovedBy=@uid,
          GiveawayApprovedAt=GETUTCDATE(),
          GiveawayApprovalNote=@note
      WHERE ${idColumn}=@soId AND ${lineColumn}=@lineNum AND IsGiveaway=1;
      SELECT @@ROWCOUNT AS Affected;
    `, {
      soId: { type: idType, value: idValue },
      lineNum: { type: sql.Int, value: lineNum },
      uid: { type: sql.Int, value: req.user.sub },
      note: { type: sql.NVarChar(300), value: note },
    });
    if (!Number(r.recordset?.[0]?.Affected || 0)) return res.status(404).json({ message: 'ไม่พบบรรทัดของแถมที่ต้องอนุมัติ' });
    await audit(null, so.Id, req.user.sub, 'GIVEAWAY_APPROVED', so.Status, so.Status, `Line ${lineNum}${note ? `: ${note}` : ''}`, req.ip);
    broadcast('so_updated', { id: so.Id, action: 'giveaway_approved' });
    res.json({ id: so.Id, lineNum, status: 'APPROVED' });
  } catch (e) { console.error(e); res.status(e.status || 500).json({ message: e.message }); }
});

/**
 * บทบาทที่เปิดใบ "แทน" พนักงานขายคนอื่นได้
 *
 * เจ้าของระบบระบุว่ายอดขายต้องเข้าพนักงานขายตามที่ระบุไว้ ไม่ใช่คนที่นั่งคีย์
 * เช่นเคาน์เตอร์ขายคีย์แทนพนักงานขายภาค ใบต้องเป็นของพนักงานขายภาค
 *
 * SALES คีย์แทน SALES ด้วยกันไม่ได้ — ยอดและรีเบทจะไหลไปผิดคน
 * และไม่มีทางรู้ทีหลังว่าตั้งใจหรือพลาด
 */
const CAN_ENTER_FOR_OTHERS = ['ADMIN', 'C_LEVEL', 'MANAGER', 'COUNTER_SALES'];

/**
 * ตัดสินว่าใบนี้เป็นยอดของใคร และคนคีย์คือใคร
 * โยน 403 เมื่อผู้ใช้ระบุคนอื่นทั้งที่ไม่มีสิทธิ์ — เงียบแล้วบันทึกเป็นชื่อตัวเองอันตรายกว่า
 * เพราะยอดจะเข้าผิดคนโดยไม่มีใครเห็น
 */
function resolveSalesOwner(req, impersonatedId) {
  const enteredBy = req.user.sub;
  const wanted = impersonatedId ? Number(impersonatedId) : null;
  if (!wanted || wanted === enteredBy) return { salesUserId: enteredBy, enteredByUserId: enteredBy };
  if (!CAN_ENTER_FOR_OTHERS.includes(req.user.role)) {
    const e = new Error('บทบาทของคุณเปิดใบแทนพนักงานขายคนอื่นไม่ได้');
    e.status = 403;
    throw e;
  }
  return { salesUserId: wanted, enteredByUserId: enteredBy };
}

/**
 * เตือนเมื่อพนักงานขายของใบยังไม่ขึ้นทะเบียนใน dbo.EMSales
 *
 * WINSpeed ปฏิเสธใบตอนกดอนุมัติด้วย "Salesman is not vaid!" ถ้า EmpID ไม่อยู่ในทะเบียน
 * เดิมผู้เปิดใบไม่รู้ตัวจนใบไปค้างที่ขั้นอนุมัติ · วัดเมื่อ 20/08/2569 พบพนักงานขาย
 * 11 จาก 27 คนอยู่ในสภาพนี้ จึงต้องบอกตั้งแต่ตอนเปิดใบ
 *
 * เตือนอย่างเดียว ไม่บล็อก — ใบยังมีประโยชน์และผู้อนุมัติเลือกพนักงานขายบนหน้าจอเองได้
 */
async function salesmanWarning(salesUserId) {
  try {
    const r = await wfQuery(
      `SELECT TOP 1 DisplayName, Username, IsRegistered, Reason FROM wf.v_SalesmanStatus WHERE UserId = @id`,
      { id: { type: sql.Int, value: Number(salesUserId) } });
    const row = r.recordset?.[0];
    if (!row || row.IsRegistered) return null;
    const who = (row.DisplayName || row.Username || '').trim();
    return `${who} ${row.Reason} — WINSpeed จะไม่ยอมให้อนุมัติใบนี้จนกว่าจะขึ้นทะเบียนพนักงานขายให้เรียบร้อย`;
  } catch (e) {
    // การเตือนล้มต้องไม่ทำให้เปิดใบไม่ได้ แต่ต้องเห็นใน log เสมอ
    console.error('[so] ตรวจทะเบียนพนักงานขายไม่สำเร็จ:', e.message);
    return null;
  }
}

/**
 * เตือนเมื่อใบนี้ทำให้ลูกค้าเกินวงเงินเครดิต
 *
 * WINSpeed เตือนสองจุด ("Sale Order Confirm Over Approve Credit AR" ตอนบันทึกใบส่งของ
 * และ "Sale Exceed Receiptable Credit Term" ตอนออกใบแจ้งหนี้) แต่ยอมให้บันทึกต่อได้
 * เราเตือนตั้งแต่ตอนจองเพื่อให้รู้เร็วกว่า และไม่บล็อกเหมือนกัน
 *
 * **เตือนเฉพาะเมื่อมีการกำหนดวงเงินไว้จริง**
 *   สำรวจเมื่อ 20/08/2569: dbo.EMCust.CreditAmnt = 0 ทั้ง 823 ราย ·
 *   วงเงินระดับกลุ่มใน EMCustGroup เป็น NULL ทุกกลุ่ม ·
 *   dbo.SOCreditApprov (วงเงินอนุมัติ) และ dbo.EMCustTempCreditDT (วงเงินชั่วคราว) ว่างเปล่า
 *   แปลว่าทั้งระบบยังไม่มีใครตั้งวงเงิน คำเตือนของ WINSpeed จึงขึ้นกับทุกใบของทุกราย
 *   ซึ่งเป็นเสียงรบกวน ไม่ใช่สัญญาณ
 *
 *   เจ้าของระบบสั่งไว้ว่า "ถ้ายังไม่มีการกำหนด Limit ไม่ต้องเตือน" — โค้ดนี้จึงเงียบสนิท
 *   จนกว่าจะมีคนตั้ง CreditAmnt ให้ลูกค้ารายใดรายหนึ่ง แล้วจึงเริ่มทำงานเองทันที
 */
async function creditWarning(custId, orderAmount) {
  try {
    const r = await wfQuery(`
      SELECT TOP 1
        c.CreditAmnt AS CustLimit,
        g.CreditAmnt AS GroupLimit,
        -- ⚠ ห้ามเขียน SUM(i.NetAmnt - (SELECT SUM(...))) — SQL Server ปฏิเสธด้วย
        --   "Cannot perform an aggregate function on an expression containing
        --    an aggregate or a subquery" ทำให้ฟังก์ชันนี้โยน error ทุกครั้งและ
        --   คืน null เสมอ = คำเตือนวงเงินไม่เคยทำงานเลย (พบ 5 ก.ย. 2569 จาก log UAT)
        --   ต้องดึงยอดรับชำระออกมาเป็นคอลัมน์ด้วย OUTER APPLY ก่อน แล้วค่อย SUM
        ISNULL((SELECT SUM(CASE WHEN i.NetAmnt - ISNULL(r.Received, 0) > 0
                                THEN i.NetAmnt - ISNULL(r.Received, 0) ELSE 0 END)
                FROM dbo.SOInvHD i WITH (NOLOCK)
                OUTER APPLY (SELECT SUM(d.ReceAmnt) AS Received FROM dbo.ARReceDT d WITH (NOLOCK)
                             WHERE d.SOInvID = i.SOInvID) r
                WHERE i.CustID = c.CustID AND i.Docutype IN ('202','107')), 0) AS Outstanding
      FROM dbo.EMCust c WITH (NOLOCK)
      LEFT JOIN dbo.EMCustGroup g WITH (NOLOCK) ON g.CustGroupID = c.CustGroupID
      WHERE c.CustID = @cid`,
      { cid: { type: sql.NVarChar(20), value: String(custId) } });

    const row = r.recordset?.[0];
    if (!row) return null;

    // วงเงินของลูกค้ามาก่อน ถ้าไม่ได้ตั้งจึงใช้ของกลุ่ม · 0 หรือ NULL = ยังไม่ได้กำหนด
    const limit = Number(row.CustLimit) > 0 ? Number(row.CustLimit)
                : Number(row.GroupLimit) > 0 ? Number(row.GroupLimit)
                : 0;
    if (limit <= 0) return null;

    const outstanding = Number(row.Outstanding || 0);
    const total = outstanding + Number(orderAmount || 0);
    if (total <= limit) return null;

    const fmt = n => Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `เกินวงเงินเครดิต ${fmt(total - limit)} บาท `
         + `(วงเงิน ${fmt(limit)} · ค้างชำระ ${fmt(outstanding)} · ใบนี้ ${fmt(orderAmount)})`;
  } catch (e) {
    console.error('[so] ตรวจวงเงินเครดิตไม่สำเร็จ:', e.message);
    return null;
  }
}

router.post('/', requireCapability('so.create'), async (req, res) => {
  try {
    const orders = Array.isArray(req.body) ? req.body : [req.body];
    if (orders.length === 0) return res.status(400).json({ message: 'ไม่มีข้อมูลคำสั่งซื้อ' });

    for (const order of orders) {
      validateBookingNotes(order);
      if (!order.custId || !order.lines?.length) return res.status(400).json({ message: 'custId และ lines จำเป็น' });
      if (!['I', 'K', 'AI'].includes(order.soPrefix)) return res.status(400).json({ message: 'soPrefix ต้องเป็น I / K / AI' });
      for (const l of order.lines) {
        const master = l.masterQty === undefined || l.masterQty === null ? Number(l.qtyTon) : Number(l.masterQty);
        const child = l.childQty === undefined || l.childQty === null ? 0 : Number(l.childQty);
        const qtyTon = Number(l.qtyTon);
        if (Math.abs(master + child - qtyTon) > 0.001) {
          return res.status(400).json({ message: 'ผลรวมยอดแม่ + ยอดลูก ต้องเท่ากับจำนวนตันในแต่ละรายการ' });
        }
      }
    }

    const createdIds = [];
    const createdRefs = [];
    const salesOwnerIds = new Set();
    const creditChecks = [];
    let anyNeedsApproval = false;

    await wfTransaction(async tx => {
      for (const order of orders) {
        const { soPrefix, custId, custName, controlTicketNo, deliveryDate, requestedAt, isOwnTruck, noTruckRequired, pSling, remark, lines, salesUserId: impersonatedId, rebateDiscountAmt, convertFromQuoteId, creditDays, truckRemark, billRemark, transpId, loadInOrder } = order;
        const truckPlate = order.truckPlate || null;

        // R6-1: Sanitize client-supplied lines by stripping private internal markers
        stripPrivateLineFields(lines);

        // Validate and lock all coupon reservations for this order before pricing and line generation
        // the person saving made the reservations in the coupon picker; when the counter keys a bill for a
        // salesperson, that salesperson's own reservations count too (UAT batch 5, SO-11)
        const actor = {
          userId: req.user?.sub || req.user?.id,
          altUserIds: impersonatedId ? [Number(impersonatedId)] : [],
          role: req.user?.role
        };
        const validatedLineIndexes = await validateAndLockCouponReservations(tx, lines, custId, null, actor, soPrefix);

        // Evaluate line prices against authoritative server master (dbo.EMSetPriceDT / HD)
        let orderNeedsApproval = false;
        const lineEvaluations = [];
        for (let lIdx = 0; lIdx < lines.length; lIdx++) {
          const l = lines[lIdx];
          const isCouponValidated = validatedLineIndexes instanceof Set && validatedLineIndexes.has(lIdx);
          const evalResult = await evaluateLinePrice(l, custId, deliveryDate || null, { isCouponValidated });
          lineEvaluations.push(evalResult);
          if (evalResult.requiresApproval) {
            orderNeedsApproval = true;
            anyNeedsApproval = true;
          }
        }

        // Generate a native-compatible reference above all used suffixes.
        const wfRef = await allocateWorkflowRef(tx, soPrefix);

        const soReq = tx.request();
        soReq.input('wfRef',            sql.NVarChar(30),  String(wfRef));
        soReq.input('soPrefix',         sql.NVarChar(5),   String(soPrefix));
        soReq.input('custId',           sql.NVarChar(20),  String(custId));
        soReq.input('custName',         sql.NVarChar(200), custName ? String(custName) : '');
        const isControlTicket = Boolean(order.isControlTicket || String(truckPlate || '').trim() === 'ตั๋วคุม' || soPrefix === 'AI');
        const effectiveTruckPlate = isControlTicket
          ? 'ตั๋วคุม'
          : (truckPlate && !['ยังไม่ระบุรถ','ตั๋วคุม','ไม่ระบุทะเบียนรถ'].includes(String(truckPlate).trim()) ? String(truckPlate).trim() || null : null);
        const effectiveNoTruckRequired = isControlTicket ? 1 : toBit(noTruckRequired);

        soReq.input('truckPlate',       sql.NVarChar(30),  effectiveTruckPlate);
        soReq.input('controlTicketNo',  sql.NVarChar(20),  controlTicketNo ? String(controlTicketNo) : null);
        soReq.input('deliveryDate',     sql.Date,          deliveryDate ? new Date(deliveryDate) : null);
        soReq.input('requestedAt',      sql.DateTime2,     toSqlDateTime(requestedAt));
        soReq.input('isOwnTruck',       sql.Bit,           toBit(isOwnTruck));
        soReq.input('noTruckRequired',  sql.Bit,           effectiveNoTruckRequired);
        soReq.input('pSling',           sql.Bit,           toBit(pSling));
        soReq.input('remark',           sql.NVarChar(500), remark || null);
        soReq.input('rebateDiscountAmt', sql.Decimal(12,2), normalizeRebateDiscount(req, rebateDiscountAmt));
        const { salesUserId: actualSalesUserId, enteredByUserId } = resolveSalesOwner(req, impersonatedId);
        soReq.input('salesUserId',      sql.Int,           actualSalesUserId);
        soReq.input('enteredByUserId',  sql.Int,           enteredByUserId);
        salesOwnerIds.add(actualSalesUserId);

        // R11 U-7/U-8: ของแถมต้องไม่เกินโควต้าของภาคผู้ขาย (นับรวมบิลร่างอื่นที่ยังไม่ยืนยัน)
        const quota = await checkGiveawayQuota({ queryFn: txQueryFn(tx), salesUserId: actualSalesUserId, lines });
        if (!quota.ok) {
          throw Object.assign(new Error(quotaErrorMessage(quota.problems)), { status: 400, code: 'GIVEAWAY_OVER_QUOTA', problems: quota.problems });
        }
        // ยอดของใบนี้ ใช้ตรวจวงเงินเครดิตหลัง commit — ของแถมไม่นับเป็นยอดขาย
        creditChecks.push({
          custId,
          amount: (lines || []).reduce(
            (sum, l) => sum + (l.isGiveaway ? 0 : Number(l.qtyTon || 0) * Number(l.pricePerTon || 0)), 0),
        });
        soReq.input('creditDays',       sql.Int,           creditDays || 30);
        const pricingFingerprint = calculatePricingFingerprint(lines);
        soReq.input('truckRemark',      sql.NVarChar(500), truckRemark || null);
        soReq.input('billRemark',       sql.NVarChar(500), billRemark || null);
        soReq.input('transpId',         sql.Int,           transpId || null);
        soReq.input('tripId',           sql.Int,           order.tripId ? Number(order.tripId) : null);
        soReq.input('requiresPriceApproval', sql.Bit,      orderNeedsApproval ? 1 : 0);
        soReq.input('priceApprovalStatus', sql.VarChar(20), orderNeedsApproval ? 'PENDING' : 'NONE');
        soReq.input('documentRevision', sql.Int,           1);
        soReq.input('pricingFingerprint', sql.VarChar(64), pricingFingerprint);

        const soR = await soReq.query(`
          INSERT INTO wf.SalesOrder
            (WfRef, SoPrefix, CustId, CustName, TruckPlate, ControlTicketNo, DeliveryDate, RequestedAt, IsOwnTruck, NoTruckRequired, PSling, Remark, SalesUserId, EnteredByUserId, RebateDiscountAmt, Status, CreditDays, TruckRemark, BillRemark, TranspId, TripId, RequiresPriceApproval, PriceApprovalStatus, DocumentRevision, PricingFingerprint)
            OUTPUT inserted.Id
          VALUES (@wfRef, @soPrefix, @custId, @custName, @truckPlate, @controlTicketNo, @deliveryDate, @requestedAt, @isOwnTruck, @noTruckRequired, @pSling, @remark, @salesUserId, @enteredByUserId, @rebateDiscountAmt, 'DRAFT', @creditDays, @truckRemark, @billRemark, @transpId, @tripId, @requiresPriceApproval, @priceApprovalStatus, @documentRevision, @pricingFingerprint)
        `);
        const soId = soR.recordset[0].Id;
        createdIds.push(soId);
        createdRefs.push(wfRef);

        // Record below-announced price approval requests
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          const ev = lineEvaluations[i];
          if (ev && ev.requiresApproval) {
            await createPriceApprovalRequest(tx, {
              soId,
              wfRef,
              custId,
              custName,
              goodId: l.goodId,
              goodCode: l.goodCode,
              goodName: l.goodName,
              qtyTon: l.qtyTon,
              announcedPrice: ev.announcedPrice || 0,
              requestedPrice: ev.requestedPrice || 0,
              priceDeviationPerTon: ev.deviationPerTon || 0,
              totalDeviationAmt: ev.totalDeviation || 0,
              priceSource: ev.priceSource || 'NONE',
              documentRevision: 1,
              requestedBy: req.user.sub,
              reasonText: ev.reason,
            });
          }
        }

        if (convertFromQuoteId) {
          const quoteId = Number(convertFromQuoteId);
          if (Number.isInteger(quoteId) && quoteId > 0) {
            await tx.request()
              .input('quoteId', sql.Int, quoteId)
              .input('soId', sql.Int, soId)
              .query(`UPDATE wf.Quotation SET Status='CONVERTED', ConvertedSoId=@soId, UpdatedAt=GETUTCDATE() WHERE Id=@quoteId`);
          } else if (Number.isInteger(quoteId) && quoteId < 0) {
            const nativeQuoteSoid = Math.abs(quoteId);
            const nativeQuote = (await tx.request()
              .input('soid', sql.Int, nativeQuoteSoid)
              .query(`
                SELECT TOP 1
                  CAST(qu.SOID AS INT) AS QuoteSOID,
                  qu.DocuNo AS QuoteNo,
                  CAST(qu.CustID AS NVARCHAR(20)) AS CustId,
                  qu.CustName,
                  CAST(qu.ExpireDate AS DATE) AS ValidUntil,
                  qu.Remark,
                  CAST(qc.SOID AS INT) AS ConfirmSOID,
                  qc.DocuNo AS ConfirmNo
                FROM dbo.SOHD qu WITH (NOLOCK)
                OUTER APPLY (
                  SELECT TOP 1 qc2.SOID, qc2.DocuNo
                  FROM dbo.SOHD qc2 WITH (NOLOCK)
                  WHERE qc2.DocuType = '113'
                    AND qc2.RefNo = qu.DocuNo
                    AND ISNULL(qc2.DocuStatus, 'N') <> 'C'
                  ORDER BY qc2.SOID DESC
                ) qc
                WHERE qu.DocuType = '102'
                  AND ISNUMERIC(CONVERT(VARCHAR(50), qu.SOID)) = 1
                  AND CAST(qu.SOID AS INT) = @soid
              `)).recordset?.[0];
            if (nativeQuote) {
              const existingQuote = (await tx.request()
                .input('quoteSoid', sql.Int, nativeQuote.QuoteSOID)
                .input('quoteNo', sql.NVarChar(30), nativeQuote.QuoteNo)
                .query(`SELECT TOP 1 Id FROM wf.Quotation WHERE WinspeedQuoteSOID=@quoteSoid OR QuoteNo=@quoteNo`)).recordset?.[0];
              if (existingQuote) {
                await tx.request()
                  .input('quoteId', sql.Int, existingQuote.Id)
                  .input('soId', sql.Int, soId)
                  .input('quoteSoid', sql.Int, nativeQuote.QuoteSOID)
                  .input('quoteNo', sql.NVarChar(30), nativeQuote.QuoteNo)
                  .input('confirmSoid', sql.Int, nativeQuote.ConfirmSOID || null)
                  .input('confirmNo', sql.NVarChar(30), nativeQuote.ConfirmNo || null)
                  .query(`
                    UPDATE wf.Quotation
                    SET Status='CONVERTED',
                        ConvertedSoId=@soId,
                        WinspeedQuoteSOID=COALESCE(WinspeedQuoteSOID, @quoteSoid),
                        WinspeedQuoteNo=COALESCE(WinspeedQuoteNo, @quoteNo),
                        WinspeedQuoteSyncedAt=COALESCE(WinspeedQuoteSyncedAt, SYSUTCDATETIME()),
                        WinspeedConfirmSOID=COALESCE(WinspeedConfirmSOID, @confirmSoid),
                        WinspeedConfirmNo=COALESCE(WinspeedConfirmNo, @confirmNo),
                        WinspeedConfirmSyncedAt=COALESCE(WinspeedConfirmSyncedAt, SYSUTCDATETIME()),
                        UpdatedAt=GETUTCDATE()
                    WHERE Id=@quoteId
                  `);
              } else {
                await tx.request()
                  .input('quoteNo', sql.NVarChar(30), nativeQuote.QuoteNo)
                  .input('custIdQ', sql.NVarChar(20), nativeQuote.CustId || custId)
                  .input('custNameQ', sql.NVarChar(200), nativeQuote.CustName || custName || '')
                  .input('validUntil', sql.Date, nativeQuote.ValidUntil || null)
                  .input('remarkQ', sql.NVarChar(500), nativeQuote.Remark || remark || null)
                  .input('salesUserIdQ', sql.Int, actualSalesUserId)
                  .input('soId', sql.Int, soId)
                  .input('quoteSoid', sql.Int, nativeQuote.QuoteSOID)
                  .input('confirmSoid', sql.Int, nativeQuote.ConfirmSOID || null)
                  .input('confirmNo', sql.NVarChar(30), nativeQuote.ConfirmNo || null)
                  .query(`
                    INSERT INTO wf.Quotation (
                      QuoteNo, CustId, CustName, ValidUntil, Remark, SalesUserId, Status, ConvertedSoId,
                      WinspeedQuoteSOID, WinspeedQuoteNo, WinspeedQuoteSyncedAt,
                      WinspeedConfirmSOID, WinspeedConfirmNo, WinspeedConfirmSyncedAt
                    )
                    VALUES (
                      @quoteNo, @custIdQ, @custNameQ, @validUntil, @remarkQ, @salesUserIdQ, 'CONVERTED', @soId,
                      @quoteSoid, @quoteNo, SYSUTCDATETIME(),
                      @confirmSoid, @confirmNo, CASE WHEN @confirmSoid IS NULL THEN NULL ELSE SYSUTCDATETIME() END
                    )
                  `);
              }
            }
          }
        }

        const hasGiveawayApproval = await hasGiveawayApprovalColumns();
        let tripLoadInOrder = Boolean(loadInOrder);

        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];

          // R9-2: Derive NET floor server-side from active price list; ignore client value
          let derivedNetPrice = null;
          const isCouponOrGiveaway = Boolean(l.isGiveaway || l.isCouponDrawn || l.couponReservationId || l.refCouponDocuNo || l.isControlTicketDrawn || l.refControlTicketNo);
          if (!isCouponOrGiveaway) {
            try {
              const auth = await resolveAuthoritativePrice({
                custId: custId,
                goodId: l.goodId,
                goodCode: l.goodCode,
                asOfDate: deliveryDate ? String(deliveryDate).slice(0, 10) : null
              });
              if (auth && auth.hasAnnouncedPrice && auth.announcedPrice > 0) {
                derivedNetPrice = Number(auth.announcedPrice);
              }
            } catch (err) {
              console.warn('[deriveNetPrice:create] Failed to resolve authoritative price:', err.message);
            }
          }

          let lineGoodCode = l.goodCode ? String(l.goodCode) : '';
          if (!lineGoodCode && l.couponReservationId && l.goodId) {
            try {
              const gRow = (await tx.request().input('gid', sql.NVarChar(20), String(l.goodId)).query('SELECT TOP 1 GoodCode FROM dbo.EMGood WHERE GoodID = @gid')).recordset?.[0];
              if (gRow?.GoodCode) lineGoodCode = gRow.GoodCode;
            } catch { /* non-fatal */ }
          }

          let lineSeq = l.loadSequence || null;
          if (tripLoadInOrder && !lineSeq) {
            lineSeq = i + 1; // FR-3: Auto-number lines in display order
          }

          // U-5: Giveaways are stored in pieces (QtyTon=0, MasterQty=0, QtyBag=piece count)
          const isGw = Boolean(l.isGiveaway);
          const pieceQty = isGw ? linePieces(l) : 0;
          const lineQtyTon = isGw ? 0 : Number(l.qtyTon);
          const lineQtyBag = isGw ? pieceQty : (Number(l.qtyBag) || Math.round(Number(l.qtyTon) * 20));
          const lineMasterQty = isGw ? 0 : (l.masterQty === undefined || l.masterQty === null ? Number(l.qtyTon) : Number(l.masterQty));
          const lineChildQty = isGw ? 0 : (l.childQty === undefined || l.childQty === null ? 0 : Number(l.childQty));

          const lr = tx.request();
          lr.input('soId',                 sql.Int,           soId);
          lr.input('lineNum',              sql.Int,           i + 1);
          lr.input('goodId',               sql.NVarChar(20),  String(l.goodId));
          lr.input('goodName',             sql.NVarChar(200), l.goodName ? String(l.goodName) : '');
          lr.input('goodCode',             sql.NVarChar(50),  lineGoodCode);
          lr.input('qtyTon',               sql.Decimal(12,3), lineQtyTon);
          lr.input('qtyBag',               sql.Int,           lineQtyBag);
          lr.input('masterQty',            sql.Decimal(12,3), lineMasterQty);
          lr.input('childQty',             sql.Decimal(12,3), lineChildQty);
          const boundNetPrice = derivedNetPrice !== null && derivedNetPrice !== undefined ? derivedNetPrice : 0;
          lr.input('pricePerTon',          sql.Decimal(12,2), isGw ? 0 : Number(l.pricePerTon));
          lr.input('netPricePerTon',       sql.Decimal(12,2), isGw ? 0 : boundNetPrice);
          lr.input('isGiveaway',           sql.Bit,           isGw ? 1 : 0);
          lr.input('refControlTicketNo',   sql.NVarChar(30),  l.refControlTicketNo || null);
          lr.input('isControlTicketDrawn', sql.Bit,           l.isControlTicketDrawn ? 1 : 0);
          lr.input('couponReservationId',   sql.Int,           l.couponReservationId ? Number(l.couponReservationId) : null);
          lr.input('refCouponDocuNo',       sql.VarChar(50),   l.refCouponDocuNo || null);
          lr.input('isCouponDrawn',         sql.Bit,           l.isCouponDrawn ? 1 : 0);
          addGiveawayApprovalInputs(lr, req, l, hasGiveawayApproval);
          lr.input('loadSequence',         sql.Int,           lineSeq);
          
          await lr.query(`
            INSERT INTO wf.SalesOrderLine
              (SoId, LineNum, GoodId, GoodName, GoodCode, QtyTon, QtyBag, MasterQty, ChildQty, PricePerTon, NetPricePerTon, IsGiveaway, RefControlTicketNo, IsControlTicketDrawn, CouponReservationId, RefCouponDocuNo, IsCouponDrawn, LoadSequence${giveawayApprovalInsertColumns(hasGiveawayApproval)})
            VALUES (@soId, @lineNum, @goodId, @goodName, @goodCode, @qtyTon, @qtyBag, @masterQty, @childQty, @pricePerTon, @netPricePerTon, @isGiveaway, @refControlTicketNo, @isControlTicketDrawn, @couponReservationId, @refCouponDocuNo, @isCouponDrawn, @loadSequence${giveawayApprovalInsertValues(hasGiveawayApproval)})
          `);

          if (l.couponReservationId) {
            const updRes = await tx.request()
              .input('resId', sql.Int, Number(l.couponReservationId))
              .input('soIdStr', sql.VarChar(50), String(soId))
              .input('wfRefStr', sql.VarChar(50), String(wfRef))
              .input('lineNum', sql.Int, i + 1)
              .input('tripIdVal', sql.Int, order.tripId ? Number(order.tripId) : null)
              .query(`
                UPDATE wf.CouponReservation
                SET CarrierSoId = @soIdStr,
                    CarrierDocuNo = @wfRefStr,
                    LineNum = @lineNum,
                    TripId = COALESCE(TripId, @tripIdVal),
                    UpdatedAt = GETUTCDATE()
                WHERE Id = @resId AND Status = 'RESERVED'
              `);
            if (updRes.rowsAffected[0] === 0) {
              throw Object.assign(new Error(`ไม่สามารถผูกการจองตั๋วรหัส ${l.couponReservationId} เข้ากับบิลได้ (สถานะเปลี่ยนไปแล้ว)`), { status: 409 });
            }
          }
        }
      }
    });

    for (const soId of createdIds) {
      await audit(null, soId, req.user.sub, 'CREATED', null, 'DRAFT', null, req.ip);
    }

    // เตือนหลัง commit — ใบเปิดสำเร็จแล้ว คำเตือนไม่ย้อนกลับไปยกเลิก
    const warnings = [];
    for (const ownerId of salesOwnerIds) {
      const w = await salesmanWarning(ownerId);
      if (w) warnings.push(w);
    }
    // รวมยอดต่อลูกค้าก่อน — สั่งหลายใบให้ลูกค้ารายเดียวกันต้องนับรวมกัน ไม่ใช่ตรวจทีละใบ
    const byCust = new Map();
    for (const c of creditChecks) byCust.set(c.custId, (byCust.get(c.custId) || 0) + c.amount);
    for (const [custId, amount] of byCust) {
      const w = await creditWarning(custId, amount);
      if (w) warnings.push(w);
    }
    if (anyNeedsApproval) {
      warnings.push({
        type: 'PRICE_BELOW_ANNOUNCED',
        message: 'มีรายการราคาต่ำกว่าราคาประกาศ ต้องได้รับการอนุมัติก่อนยืนยัน SO'
      });
    }

    // For backwards compatibility, if they sent an array, return array format. Otherwise return single object format.
    if (Array.isArray(req.body)) {
      res.json({ ids: createdIds, wfRefs: createdRefs, needsApproval: anyNeedsApproval, warnings });
    } else {
      res.json({ id: createdIds[0], wfRef: createdRefs[0], needsApproval: anyNeedsApproval, warnings });
    }
  } catch (e) { console.error(e); res.status(e.status || 500).json({ message: e.message, code: e.code, problems: e.problems }); }
});

/**
 * UAT batch 5 (found live on I69-04219): a native bill unlocked for editing is saved by PUT /:id below, and that
 * path wrote the lines exactly as sent — no price check, no coupon check, a giveaway nobody approved, and the
 * client's NET floor, which sets the rebate at ship ((price − NET) × tons). It now gets the server checks a new bill
 * gets. A price approval lives on a draft bill, so an unlocked bill may keep the price it already carried for a good
 * (not lower and, under an announced price, not more tons); a lower price or a new item goes on a new bill, which
 * asks for approval. Returns per line the server NET floor and the giveaway approval to store.
 */
async function checkUnlockedNativeEdit(tx, req, so, order, beforeLines) {
  const lines = order.lines;
  const sameCustomer = String(order.custId) === String(so.CustId);
  const prior = sameCustomer ? (beforeLines || []) : [];
  const actor = { userId: req.user?.sub || req.user?.id, altUserIds: so.SalesUserId ? [Number(so.SalesUserId)] : [], role: req.user?.role };
  const validated = await validateAndLockCouponReservations(tx, lines, order.custId, so.Id, actor, order.soPrefix || so.SoPrefix);
  // coupon draws already on this bill: the line keeps no reservation id, the reservation names the bill as carrier
  const held = sameCustomer ? ((await tx.request().input('so', sql.VarChar(50), String(so.Id)).query(
    `SELECT Id, GoodId, ReservedQty - ISNULL(ConsumedQty, 0) AS LeftQty FROM wf.CouponReservation WITH (UPDLOCK, ROWLOCK)
     WHERE CarrierSoId = @so AND Status = 'RESERVED'`)).recordset || []) : [];
  for (const l of lines) {
    const h = l.couponReservationId && held.find(x => Number(x.Id) === Number(l.couponReservationId));
    if (h) h.LeftQty = Number(h.LeftQty) - Number(l.qtyTon);
  }

  const problems = [];
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const name = l.goodName || l.goodCode || l.goodId;
    if (l.isGiveaway) {
      const kept = prior.find(p => p.IsGiveaway && String(p.GoodId) === String(l.goodId)
        && p.GiveawayApprovalStatus === 'APPROVED' && Number(p.QtyTon) >= Number(l.qtyTon));
      if (kept) out.push({ net: 0, giveaway: { status: 'APPROVED', by: kept.GiveawayApprovedBy, at: kept.GiveawayApprovedAt, note: kept.GiveawayApprovalNote } });
      else if (giveawayApprovalStatusForLine(req, l) === 'APPROVED') out.push({ net: 0, giveaway: { status: 'APPROVED', by: req.user.sub, at: new Date(), note: l.giveawayApprovalNote || null } });
      else problems.push(`ของแถม ${name} ${l.qtyTon} ตัน ยังไม่ได้รับอนุมัติ`);
      continue;
    }
    if (validated instanceof Set && validated.has(i)) { out.push({ net: 0 }); continue; }
    if (!l.couponReservationId && Number(l.pricePerTon) === 0) {
      const h = held.find(x => String(x.GoodId) === String(l.goodId) && Number(x.LeftQty) >= Number(l.qtyTon));
      if (h) { h.LeftQty = Number(h.LeftQty) - Number(l.qtyTon); out.push({ net: 0 }); continue; }
    }
    const ev = await evaluateLinePrice(l, order.custId, order.deliveryDate || null, {});
    if (ev.requiresApproval) {
      const keepsPrice = prior.some(p => !p.IsGiveaway && String(p.GoodId) === String(l.goodId) && Number(p.PricePerTon) > 0
        && Number(l.pricePerTon) >= Number(p.PricePerTon)
        && (!(Number(ev.deviationPerTon) > 0) || Number(l.qtyTon) <= Number(p.QtyTon)));
      if (!keepsPrice) problems.push(ev.reason || `ราคา ${name} ต้องขออนุมัติ`);
    }
    out.push({ net: ev.hasAnnouncedPrice && Number(ev.announcedPrice) > 0 ? Number(ev.announcedPrice) : 0 });
  }
  if (problems.length) {
    throw Object.assign(new Error(`บิลที่ปลดล็อกแก้ได้เฉพาะราคาไม่ต่ำกว่าเดิมของบิล: ${problems.join('; ')} — ถ้าต้องลดราคา เพิ่มสินค้าใหม่ หรือเพิ่มของแถม ให้เปิดบิลใหม่เพื่อขออนุมัติ`),
      { status: 409, code: 'UNLOCKED_EDIT_NEEDS_APPROVAL', problems });
  }
  return out;
}
router.checkUnlockedNativeEdit = checkUnlockedNativeEdit;

// ── PUT /api/so/:id — Update existing DRAFT SO ──
router.put('/:id', requireCapability('so.edit'), requireSoInScope, async (req, res) => {
  try {
    validateBookingNotes(req.body);
    const so = await getSoOrThrow(req.params.id, 'DRAFT');
    const order = req.body;
    
    if (!order.custId) return res.status(400).json({ message: 'ต้องระบุข้อมูลลูกค้า (custId)' });
    if (!order.lines?.length) return res.status(400).json({ message: 'ต้องมีรายการสินค้าอย่างน้อย 1 รายการ' });
    if (!['I', 'K', 'AI'].includes(order.soPrefix)) return res.status(400).json({ message: 'soPrefix ต้องเป็น I / K / AI' });

    for (const l of order.lines) {
      const master = l.masterQty === undefined || l.masterQty === null ? Number(l.qtyTon) : Number(l.masterQty);
      const child = l.childQty === undefined || l.childQty === null ? 0 : Number(l.childQty);
      const qtyTon = Number(l.qtyTon);
      if (Math.abs(master + child - qtyTon) > 0.001) {
        return res.status(400).json({ message: 'ผลรวมยอดแม่ + ยอดลูก ต้องเท่ากับจำนวนตันในแต่ละรายการ' });
      }
    }

    let needsApproval = false;

    // Check if it's an SOHD order by checking if it came from WINSpeed
    const isSohdOrder = !!so.ImportedDocuNo;

      if (isSohdOrder) {
      const beforeLines = await getLines(so.Id);
      await wfTransaction(async tx => {
        const { soPrefix, custId, custName, controlTicketNo, deliveryDate, requestedAt, isOwnTruck, noTruckRequired, pSling, remark, lines, rebateDiscountAmt, creditDays, truckRemark, billRemark, transpId } = order;
        const truckPlate = order.truckPlate || null;
        stripPrivateLineFields(lines);
        const checked = await checkUnlockedNativeEdit(tx, req, so, order, beforeLines);
        // a user who cannot see rebate amounts keeps the rebate already applied to the bill (it was reset to 0)
        const safeRebateDiscountAmt = canViewRebateAmounts(req.user)
          ? normalizeRebateDiscount(req, rebateDiscountAmt)
          : Number(so.RebateDiscountAmt) || 0;
        const totalAmnt = lines.reduce((sum, l) => sum + Math.round(Number(l.qtyTon) * Number(l.pricePerTon) * 100), 0) / 100;
        if (safeRebateDiscountAmt < 0 || safeRebateDiscountAmt > totalAmnt || lines.some(l => Number(l.qtyTon) < 0 || Number(l.pricePerTon) < 0 || (l.isGiveaway && Number(l.pricePerTon) !== 0)))
          throw Object.assign(new Error('ยอดเงินหรือของแถมไม่ถูกต้อง'), { status: 400 });

        const soReq = tx.request();
        soReq.input('id', sql.VarChar(50), String(so.Id));
        soReq.input('soPrefix', sql.NVarChar(5), String(soPrefix));
        soReq.input('custId', sql.NVarChar(20), String(custId));
        soReq.input('custName', sql.NVarChar(200), custName ? String(custName) : '');
        const isControlTicket = Boolean(order.isControlTicket || String(truckPlate || '').trim() === 'ตั๋วคุม' || soPrefix === 'AI');
        const effectiveTruckPlate = isControlTicket
          ? 'ตั๋วคุม'
          : (truckPlate && !['ยังไม่ระบุรถ','ตั๋วคุม','ไม่ระบุทะเบียนรถ'].includes(String(truckPlate).trim()) ? String(truckPlate).trim() || null : null);
        const effectiveNoTruckRequired = isControlTicket ? 1 : toBit(noTruckRequired);

        soReq.input('truckPlate', sql.NVarChar(30), effectiveTruckPlate);
        soReq.input('controlTicketNo', sql.NVarChar(20), controlTicketNo ? String(controlTicketNo) : null);
        soReq.input('deliveryDate', sql.Date, deliveryDate ? new Date(deliveryDate) : null);
        soReq.input('requestedAt', sql.DateTime2, toSqlDateTime(requestedAt));
        soReq.input('isOwnTruck', sql.Bit, toBit(isOwnTruck));
        soReq.input('noTruckRequired', sql.Bit, effectiveNoTruckRequired);
        soReq.input('pSling', sql.Bit, toBit(pSling));
        soReq.input('remark', sql.NVarChar(500), remark || null);
        soReq.input('rebateDiscountAmt', sql.Decimal(12,2), safeRebateDiscountAmt);
        soReq.input('netAmnt', sql.Decimal(18,2), totalAmnt);
        soReq.input('creditDays', sql.Int, creditDays || 30);
        soReq.input('truckRemark', sql.NVarChar(500), truckRemark || null);
        soReq.input('billRemark', sql.NVarChar(500), billRemark || null);
        soReq.input('transpId', sql.Int, transpId || null);

        await soReq.query(`
          UPDATE dbo.SOHD
          SET CustID=@custId,
              CustName=@custName,
              TransRegistration=@truckPlate,
              Remark=@remark,
              NetAmnt=@netAmnt,
              SumGoodAmnt=@netAmnt,
              BillAftrDiscAmnt=@netAmnt,
              CheckAll='Y',
              TranspID=ISNULL(@transpId, ISNULL(TranspID, (SELECT TOP 1 TranspID FROM dbo.EMTransp ORDER BY TranspID)))
          WHERE SOID=@id;
          UPDATE wf.SalesOrderExt
          SET SoPrefix=@soPrefix,
              ControlTicketNo=@controlTicketNo,
              DeliveryDate=@deliveryDate,
              RequestedAt=@requestedAt,
              IsOwnTruck=@isOwnTruck,
              NoTruckRequired=@noTruckRequired,
              PSling=@pSling,
              RebateDiscountAmt=@rebateDiscountAmt,
              CreditDays=@creditDays,
              TruckRemark=@truckRemark,
              BillRemark=@billRemark,
              TranspId=@transpId,
              UpdatedAt=GETUTCDATE()
          WHERE SOID=@id;
        `);

        await tx.request().input('id', sql.VarChar(50), so.Id).query(`DELETE FROM dbo.SODTRemark WHERE SOID=@id; DELETE FROM dbo.SODT WHERE SOID=@id; DELETE FROM wf.SalesOrderLineExt WHERE SOID=@id;`);

        const hasGiveawayApproval = await hasGiveawayApprovalColumns();
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          const lr = tx.request();
          lr.input('soId', sql.VarChar(50), so.Id);
          lr.input('lineNum', sql.Int, i + 1);
          lr.input('goodId', sql.NVarChar(20), String(l.goodId));
          lr.input('goodName', sql.NVarChar(200), l.goodName ? String(l.goodName) : '');
          lr.input('qtyTon', sql.Decimal(12,3), Number(l.qtyTon));
          lr.input('masterQty', sql.Decimal(12,3), l.masterQty === undefined || l.masterQty === null ? Number(l.qtyTon) : Number(l.masterQty));
          lr.input('childQty', sql.Decimal(12,3), l.childQty === undefined || l.childQty === null ? 0 : Number(l.childQty));
          lr.input('pricePerTon', sql.Decimal(12,2), Number(l.pricePerTon));
          lr.input('netPricePerTon', sql.Decimal(12,2), checked[i].net);
          lr.input('isGiveaway', sql.Bit, l.isGiveaway ? 1 : 0);
          lr.input('freeFlag', sql.NVarChar(1), l.isGiveaway ? 'Y' : 'N');
          lr.input('refControlTicketNo', sql.NVarChar(30), l.refControlTicketNo || null);
          lr.input('isControlTicketDrawn', sql.Bit, l.isControlTicketDrawn ? 1 : 0);
          if (hasGiveawayApproval) {
            const g = checked[i].giveaway;
            lr.input('giveawayApprovalStatus', sql.NVarChar(20), g ? g.status : null);
            lr.input('giveawayApprovedBy', sql.Int, g?.by ?? null);
            lr.input('giveawayApprovedAt', sql.DateTime2, g?.at ? new Date(g.at) : null);
            lr.input('giveawayApprovalNote', sql.NVarChar(300), g?.note ?? null);
          }
          lr.input('loadSequence', sql.Int, l.loadSequence || null);

          await lr.query(`
            INSERT INTO dbo.SODT (
              SOID, ListNo, GoodID, GoodName, InveID, LocaID,
              GoodUnitID1, GoodPrice1, GoodQty1, GoodUnitID2, GoodStockRate1, GoodQty2, GoodPrice2,
              GoodDiscAmnt, MiscChargAmnt, SumExcludeAmnt, GoodAmnt,
              GoodCompareQty, ShipDate, RemaBefoQty, ResvAmnt1, ResvAmnt2, MarkUpAmnt, CommisAmnt, AfterMarkupamnt,
              DocuType, LotFlag, SerialFlag, GoodType, VatType, StockFlag, GoodFlag,
              RemaQty, ReserveQty, FreeFlag, GoodStockRate2, GoodStockUnitID, GoodStockQty,
              GoodCost, GoodRemaQty1, GoodRemaQty2, POQty, RemaQtyPkg, Expireflag, Poststock,
              RemaGoodStockQty, remaamnt, CheckFlag, MasterQty, ChildQty
            )
            SELECT
              @soId, @lineNum, @goodId, COALESCE(NULLIF(@goodName, ''), g.GoodName1), 1000, 1000,
              NULL, 0, 0, COALESCE(g.MainGoodUnitID, 1002), 0, @qtyTon, @pricePerTon,
              0, 0, 0, ROUND(@qtyTon * @pricePerTon,2),
              0, h.ShipDate, 0, 0, 0, 0, 0, ROUND(@qtyTon * @pricePerTon,2),
              '103', 'N', 'N', '1', COALESCE(g.VatType, '3'), '-1', 'G',
              @qtyTon, 0, @freeFlag, 1, COALESCE(g.MainGoodUnitID, 1002), @qtyTon,
              0, @qtyTon, 0, @qtyTon, @qtyTon, 'N', 'N',
              0, ROUND(@qtyTon * @pricePerTon,2), 'Y', @masterQty, @childQty
            FROM dbo.EMGood g
            CROSS JOIN dbo.SOHD h
            WHERE g.GoodID = @goodId AND h.SOID = @soId;

            INSERT INTO wf.SalesOrderLineExt (SOID, ListNo, NetPricePerTon, IsGiveaway, RebateBooked, RefControlTicketNo, IsControlTicketDrawn, MasterQty, ChildQty, LoadSequence${giveawayApprovalInsertColumns(hasGiveawayApproval)})
            VALUES (@soId, @lineNum, @netPricePerTon, @isGiveaway, 0, @refControlTicketNo, @isControlTicketDrawn, @masterQty, @childQty, @loadSequence${giveawayApprovalInsertValues(hasGiveawayApproval)});
          `);
        }
        await tx.request().input('SOID',sql.VarChar(50),String(so.Id)).execute('wf.usp_RefreshBookingHeader');
        await tx.request().input('SOID',sql.VarChar(50),String(so.Id)).execute('wf.usp_WriteBookingDescription');
      });
      await audit(null, so.Id, req.user.sub, 'UPDATED', 'DRAFT', 'DRAFT', null, req.ip);
      broadcast('so_updated', { id: so.Id, action: 'updated' });
      return res.json({ id: so.Id, wfRef: so.WfRef, needsApproval: false });
    }

    await wfTransaction(async tx => {
      const { soPrefix, custId, custName, controlTicketNo, deliveryDate, requestedAt, isOwnTruck, noTruckRequired, pSling, remark, lines, rebateDiscountAmt, creditDays, truckRemark, billRemark, transpId } = order;
      const truckPlate = order.truckPlate || null;

      // R6-1: Sanitize client-supplied lines by stripping private internal markers
      stripPrivateLineFields(lines);

      // R5-2: Validate and lock coupon reservations BEFORE evaluating line prices
      const editActor = {
        userId: req.user?.sub || req.user?.id,
        altUserIds: so.SalesUserId ? [Number(so.SalesUserId)] : [],
        role: req.user?.role
      };
      const validatedLineIndexes = await validateAndLockCouponReservations(tx, lines, order.custId, so.Id, editActor, order.soPrefix || so.SoPrefix);

      // Evaluate line prices against authoritative server master (dbo.EMSetPriceDT / HD)
      let orderNeedsApproval = false;
      const lineEvaluations = [];
      for (let lIdx = 0; lIdx < lines.length; lIdx++) {
        const l = lines[lIdx];
        const isCouponValidated = validatedLineIndexes instanceof Set && validatedLineIndexes.has(lIdx);
        const evalResult = await evaluateLinePrice(l, custId, deliveryDate || null, { isCouponValidated });
        lineEvaluations.push(evalResult);
        if (evalResult.requiresApproval) {
          orderNeedsApproval = true;
          needsApproval = true;
        }
      }

      const yy = (new Date().getFullYear() + 543 - 2500).toString().slice(-2);
      // Extract the sequence number from the existing WfRef (e.g. 'WF69I-00001' or 'I69-00001' -> '00001')
      const seqMatch = so.WfRef ? so.WfRef.match(/-(\d+)$/) : null;
      const seq = seqMatch ? seqMatch[1] : '00001';
      const newWfRef = `${soPrefix}${yy}-${seq}`;

      const soReq = tx.request();
      soReq.input('id',                sql.Int,           so.Id);
      soReq.input('soPrefix',          sql.NVarChar(5),   String(soPrefix));
      soReq.input('wfRef',             sql.NVarChar(30),  String(newWfRef));
      soReq.input('custId',            sql.NVarChar(20),  String(custId));
      soReq.input('custName',          sql.NVarChar(200), custName ? String(custName) : '');
      const isControlTicket = Boolean(order.isControlTicket || String(truckPlate || '').trim() === 'ตั๋วคุม' || soPrefix === 'AI');
      const effectiveTruckPlate = isControlTicket
        ? 'ตั๋วคุม'
        : (truckPlate && !['ยังไม่ระบุรถ','ตั๋วคุม','ไม่ระบุทะเบียนรถ'].includes(String(truckPlate).trim()) ? String(truckPlate).trim() || null : null);
      const effectiveNoTruckRequired = isControlTicket ? 1 : toBit(noTruckRequired);

      const has141 = await checkMigration141();
      const existingRow = (await tx.request().input('id', sql.Int, so.Id).query(`
        SELECT DocumentRevision, PricingFingerprint, RequiresPriceApproval, PriceApprovalStatus,
               TripId, RebateDiscountAmt${has141 ? ', AppliedRebateClaimId, ClaimDiscountAmt' : ''}
        FROM wf.SalesOrder WITH (UPDLOCK, HOLDLOCK)
        WHERE Id = @id
      `)).recordset[0];
      if (!existingRow) throw Object.assign(new Error('Draft no longer exists'), { status: 409 });

      // R11 U-7/U-8: แก้จำนวนของแถมต้องตรวจโควต้าใหม่ (ไม่นับบรรทัดเดิมของบิลนี้)
      const editQuota = await checkGiveawayQuota({ queryFn: txQueryFn(tx), salesUserId: so.SalesUserId, lines, excludeSoId: so.Id });
      if (!editQuota.ok) {
        throw Object.assign(new Error(quotaErrorMessage(editQuota.problems)), { status: 400, code: 'GIVEAWAY_OVER_QUOTA', problems: editQuota.problems });
      }

      // R9-3: Read TripId from wf.SalesOrder (row lock) and keep it unless payload explicitly sets tripId
      const effectiveTripId = order.tripId !== undefined
        ? (order.tripId ? Number(order.tripId) : null)
        : (existingRow.TripId !== undefined ? existingRow.TripId : (so.TripId || null));

      if (effectiveTripId !== existingRow.TripId) {
        await audit(tx, so.Id, req.user.sub, 'TRIP_CHANGED', so.Status, so.Status,
          `Trip changed from ${existingRow.TripId ?? 'NULL'} to ${effectiveTripId ?? 'NULL'}`, req.ip);
      }

      // R9-1: Protect rebate discount on SALES edit (who cannot see rebate)
      const canEditRebate = canViewRebateAmounts(req.user);
      const effectiveRebateDiscount = canEditRebate
        ? (rebateDiscountAmt !== undefined ? Math.max(0, Number(rebateDiscountAmt) || 0) : Number(existingRow.RebateDiscountAmt || 0))
        : Number(existingRow.RebateDiscountAmt || 0);

      const claimDiscountAmt = Number(existingRow.ClaimDiscountAmt || 0);
      if (effectiveRebateDiscount < claimDiscountAmt) {
        throw Object.assign(new Error(`ยอดส่วนลดรีเบท (฿${effectiveRebateDiscount.toLocaleString()}) ต้องไม่น้อยกว่าส่วนลดเคลมที่ผูกไว้ (฿${claimDiscountAmt.toLocaleString()})`), { status: 400 });
      }

      soReq.input('truckPlate',        sql.NVarChar(30),  effectiveTruckPlate);
      soReq.input('controlTicketNo',   sql.NVarChar(20),  controlTicketNo ? String(controlTicketNo) : null);
      soReq.input('deliveryDate',      sql.Date,          deliveryDate ? new Date(deliveryDate) : null);
      soReq.input('requestedAt',       sql.DateTime2,     toSqlDateTime(requestedAt));
      soReq.input('isOwnTruck',        sql.Bit,           toBit(isOwnTruck));
      soReq.input('noTruckRequired',   sql.Bit,           effectiveNoTruckRequired);
      soReq.input('pSling',            sql.Bit,           toBit(pSling));
      soReq.input('remark',            sql.NVarChar(500), remark || null);
      soReq.input('rebateDiscountAmt', sql.Decimal(12,2), effectiveRebateDiscount);
      soReq.input('creditDays',        sql.Int,           creditDays || 30);
      soReq.input('truckRemark',       sql.NVarChar(500), truckRemark || null);
      soReq.input('billRemark',        sql.NVarChar(500), billRemark || null);
      soReq.input('transpId',          sql.Int,           transpId || null);
      soReq.input('tripId',            sql.Int,           effectiveTripId);

      const currentRev = Number(existingRow.DocumentRevision) || 1;
      const pricingFingerprint = calculatePricingFingerprint(lines);
      const pricingChanged = pricingFingerprint !== existingRow.PricingFingerprint;
      const newRev = currentRev + (pricingChanged ? 1 : 0);
      needsApproval = pricingChanged ? orderNeedsApproval : !!existingRow.RequiresPriceApproval && existingRow.PriceApprovalStatus !== 'APPROVED';

      soReq.input('requiresPriceApproval', sql.Bit, pricingChanged ? (orderNeedsApproval ? 1 : 0) : existingRow.RequiresPriceApproval);
      soReq.input('priceApprovalStatus', sql.VarChar(20), pricingChanged ? (orderNeedsApproval ? 'PENDING' : 'NONE') : existingRow.PriceApprovalStatus);
      soReq.input('documentRevision',    sql.Int,           newRev);
      soReq.input('pricingFingerprint',  sql.VarChar(64),   pricingFingerprint);

      await soReq.query(`
        UPDATE wf.SalesOrder SET
          SoPrefix = @soPrefix,
          WfRef = @wfRef,
          CustId = @custId,
          CustName = @custName,
          TruckPlate = @truckPlate,
          ControlTicketNo = @controlTicketNo,
          DeliveryDate = @deliveryDate,
          RequestedAt = @requestedAt,
          IsOwnTruck = @isOwnTruck,
          NoTruckRequired = @noTruckRequired,
          PSling = @pSling,
          Remark = @remark,
          RebateDiscountAmt = @rebateDiscountAmt,
          CreditDays = @creditDays,
          TruckRemark = @truckRemark,
          BillRemark = @billRemark,
          TranspId = @transpId,
          TripId = @tripId,
          RequiresPriceApproval = @requiresPriceApproval,
          PriceApprovalStatus = @priceApprovalStatus,
          DocumentRevision = @documentRevision,
          PricingFingerprint = @pricingFingerprint,
          UpdatedAt = GETUTCDATE()
        WHERE Id = @id
      `);

      // Find previous coupon reservations to cancel any lines removed in this edit
      const prevCouponLines = (await tx.request()
        .input('id', sql.Int, so.Id)
        .query(`SELECT DISTINCT CouponReservationId FROM wf.SalesOrderLine WHERE SoId = @id AND CouponReservationId IS NOT NULL`)
      ).recordset?.map(r => r.CouponReservationId) || [];

      const newCouponResIds = new Set(lines.map(l => l.couponReservationId ? Number(l.couponReservationId) : null).filter(Boolean));
      for (const prevResId of prevCouponLines) {
        if (!newCouponResIds.has(prevResId)) {
          await tx.request()
            .input('resId', sql.Int, prevResId)
            .input('uid', sql.Int, req.user.sub)
            .query(`
              UPDATE wf.CouponReservation
              SET Status = 'CANCELLED',
                  CancelledAt = GETUTCDATE(),
                  CancelReason = 'SO_LINE_REMOVED_ON_EDIT',
                  CancelledBy = @uid,
                  UpdatedAt = GETUTCDATE()
              WHERE Id = @resId AND Status = 'RESERVED'
            `);
        }
      }

      // Delete existing lines
      await tx.request().input('id', sql.Int, so.Id).query(`DELETE FROM wf.SalesOrderLine WHERE SoId = @id`);

      // Insert new lines
      const hasGiveawayApproval = await hasGiveawayApprovalColumns();
      let editTripLoadInOrder = Boolean(req.body.loadInOrder);

      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];

        // R9-2: Derive NET floor server-side from active price list; ignore client value
        let derivedNetPrice = null;
        const isCouponOrGiveaway = Boolean(l.isGiveaway || l.isCouponDrawn || l.couponReservationId || l.refCouponDocuNo || l.isControlTicketDrawn || l.refControlTicketNo);
        if (!isCouponOrGiveaway) {
          try {
            const auth = await resolveAuthoritativePrice({
              custId: custId,
              goodId: l.goodId,
              goodCode: l.goodCode,
              asOfDate: deliveryDate ? String(deliveryDate).slice(0, 10) : null
            });
            if (auth && auth.hasAnnouncedPrice && auth.announcedPrice > 0) {
              derivedNetPrice = Number(auth.announcedPrice);
            }
          } catch (err) {
            console.warn('[deriveNetPrice:edit] Failed to resolve authoritative price:', err.message);
          }
        }

        let lineGoodCode = l.goodCode ? String(l.goodCode) : '';
        if (!lineGoodCode && l.couponReservationId && l.goodId) {
          try {
            const gRow = (await tx.request().input('gid', sql.NVarChar(20), String(l.goodId)).query('SELECT TOP 1 GoodCode FROM dbo.EMGood WHERE GoodID = @gid')).recordset?.[0];
            if (gRow?.GoodCode) lineGoodCode = gRow.GoodCode;
          } catch { /* non-fatal */ }
        }

        let lineSeq = l.loadSequence || null;
        if (editTripLoadInOrder && !lineSeq) {
          lineSeq = i + 1; // FR-3: Auto-number lines in display order
        }

        // U-5: Giveaways are stored in pieces (QtyTon=0, MasterQty=0, QtyBag=piece count)
        const isGw = Boolean(l.isGiveaway);
        const pieceQty = isGw ? linePieces(l) : 0;
        const lineQtyTon = isGw ? 0 : Number(l.qtyTon);
        const lineQtyBag = isGw ? pieceQty : (Number(l.qtyBag) || Math.round(Number(l.qtyTon) * 20));
        const lineMasterQty = isGw ? 0 : (l.masterQty === undefined || l.masterQty === null ? Number(l.qtyTon) : Number(l.masterQty));
        const lineChildQty = isGw ? 0 : (l.childQty === undefined || l.childQty === null ? 0 : Number(l.childQty));

        const lr = tx.request();
        lr.input('soId',                 sql.Int,           so.Id);
        lr.input('lineNum',              sql.Int,           i + 1);
        lr.input('goodId',               sql.NVarChar(20),  String(l.goodId));
        lr.input('goodName',             sql.NVarChar(200), l.goodName ? String(l.goodName) : '');
        lr.input('goodCode',             sql.NVarChar(50),  lineGoodCode);
        lr.input('qtyTon',               sql.Decimal(12,3), lineQtyTon);
        lr.input('qtyBag',               sql.Int,           lineQtyBag);
        lr.input('masterQty',            sql.Decimal(12,3), lineMasterQty);
        lr.input('childQty',             sql.Decimal(12,3), lineChildQty);
        const boundNetPrice = derivedNetPrice !== null && derivedNetPrice !== undefined ? derivedNetPrice : 0;
        lr.input('pricePerTon',          sql.Decimal(12,2), isGw ? 0 : Number(l.pricePerTon));
        lr.input('netPricePerTon',       sql.Decimal(12,2), isGw ? 0 : boundNetPrice);
        lr.input('isGiveaway',           sql.Bit,           isGw ? 1 : 0);
        lr.input('refControlTicketNo',   sql.NVarChar(30),  l.refControlTicketNo || null);
        lr.input('isControlTicketDrawn', sql.Bit,           l.isControlTicketDrawn ? 1 : 0);
        lr.input('couponReservationId',   sql.Int,           l.couponReservationId ? Number(l.couponReservationId) : null);
        lr.input('refCouponDocuNo',       sql.VarChar(50),   l.refCouponDocuNo || null);
        lr.input('isCouponDrawn',         sql.Bit,           l.isCouponDrawn ? 1 : 0);
        addGiveawayApprovalInputs(lr, req, l, hasGiveawayApproval);
        lr.input('loadSequence',         sql.Int,           lineSeq);
        
        await lr.query(`
          INSERT INTO wf.SalesOrderLine
            (SoId, LineNum, GoodId, GoodName, GoodCode, QtyTon, QtyBag, MasterQty, ChildQty, PricePerTon, NetPricePerTon, IsGiveaway, RefControlTicketNo, IsControlTicketDrawn, CouponReservationId, RefCouponDocuNo, IsCouponDrawn, LoadSequence${giveawayApprovalInsertColumns(hasGiveawayApproval)})
          VALUES (@soId, @lineNum, @goodId, @goodName, @goodCode, @qtyTon, @qtyBag, @masterQty, @childQty, @pricePerTon, @netPricePerTon, @isGiveaway, @refControlTicketNo, @isControlTicketDrawn, @couponReservationId, @refCouponDocuNo, @isCouponDrawn, @loadSequence${giveawayApprovalInsertValues(hasGiveawayApproval)})
        `);

        if (l.couponReservationId) {
          const updRes = await tx.request()
            .input('resId', sql.Int, Number(l.couponReservationId))
            .input('soIdStr', sql.VarChar(50), String(so.Id))
            .input('wfRefStr', sql.VarChar(50), String(newWfRef))
            .input('lineNum', sql.Int, i + 1)
            .input('tripIdVal', sql.Int, order.tripId ? Number(order.tripId) : null)
            .query(`
              UPDATE wf.CouponReservation
              SET CarrierSoId = @soIdStr,
                  CarrierDocuNo = @wfRefStr,
                  LineNum = @lineNum,
                  TripId = COALESCE(TripId, @tripIdVal),
                  UpdatedAt = GETUTCDATE()
              WHERE Id = @resId AND Status = 'RESERVED'
            `);
          if (updRes.rowsAffected[0] === 0) {
            throw Object.assign(new Error(`ไม่สามารถผูกการจองตั๋วรหัส ${l.couponReservationId} เข้ากับบิลได้ (สถานะเปลี่ยนไปแล้ว)`), { status: 409 });
          }
        }
      }

      // Only a changed pricing fingerprint invalidates price approval.
      if (pricingChanged) await tx.request()
        .input('soId', sql.Int, so.Id)
        .input('newRev', sql.Int, newRev)
        .query(`UPDATE wf.PriceApproval SET Status = 'SUPERSEDED', UpdatedAt = SYSUTCDATETIME() WHERE SoId = @soId AND Status IN ('PENDING', 'APPROVED') AND DocumentRevision < @newRev`);

      if (pricingChanged && orderNeedsApproval) {
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          const ev = lineEvaluations[i];
          if (ev && ev.requiresApproval) {
            await createPriceApprovalRequest(tx, {
              soId: so.Id,
              wfRef: newWfRef,
              custId,
              custName,
              goodId: l.goodId,
              goodCode: l.goodCode,
              goodName: l.goodName,
              qtyTon: l.qtyTon,
              announcedPrice: ev.announcedPrice || 0,
              requestedPrice: ev.requestedPrice || 0,
              priceDeviationPerTon: ev.deviationPerTon || 0,
              totalDeviationAmt: ev.totalDeviation || 0,
              priceSource: ev.priceSource || 'NONE',
              documentRevision: newRev,
              requestedBy: req.user.sub,
              reasonText: ev.reason,
            });
          }
        }
      }
    });

    await audit(null, so.Id, req.user.sub, 'UPDATED', 'DRAFT', 'DRAFT', null, req.ip);
    broadcast('so_updated', { id: so.Id, action: 'updated' });
    res.json({ id: so.Id, wfRef: so.WfRef, needsApproval });
  } catch (e) { console.error(e); res.status(e.status || 500).json({ message: e.message, code: e.code, problems: e.problems }); }
});

// ── PATCH /api/so/:id/confirm ────────────────────────────────
// ── PATCH /api/so/:id/verify — Counter-Sales ตรวจซ้ำ (FR-022) ─────
router.patch('/:id/verify', requireCapability('so.verify'), requireSoInScope, async (req, res) => {
  try {
    const so = await getSoOrThrow(req.params.id, 'DRAFT');
    await wfQuery(`UPDATE wf.SalesOrder SET VerifiedBy=@uid, VerifiedAt=GETUTCDATE() WHERE Id=@id`,
      { uid: { type: sql.Int, value: req.user.sub }, id: { type: sql.Int, value: so.Id } });
    await audit(null, so.Id, req.user.sub, 'VERIFIED', 'DRAFT', 'DRAFT', null, req.ip);
    broadcast('so_updated', { id: so.Id, action: 'verified' });
    res.json({ id: so.Id, verified: true });
  } catch (e) { res.status(e.status || 500).json({ message: e.message }); }
});

router.patch('/:id/confirm', requireCapability('so.confirm'), requireSoInScope, async (req, res) => {
  const {getConfirmationReplay} = require('../services/confirmation-replay');
  try {
    const replay = await getConfirmationReplay(req);
    if (replay) return res.json(replay);
    const pendingQuote = await getPendingQuoteForSo(req.params.id);
    if (pendingQuote) {
      return res.status(400).json({
        message: `SO นี้ผูกกับใบเสนอราคา ${pendingQuote.QuoteNo} (${pendingQuote.Status}) ต้องยืนยันหรือยกเลิกใบเสนอราคาก่อน`,
        requiresQuotationAccepted: true,
        quoteId: pendingQuote.Id,
        quoteNo: pendingQuote.QuoteNo,
        quoteStatus: pendingQuote.Status,
      });
    }

    const isSohdOrder = (await wfQuery(`SELECT SOID, TripId, PickupDueDate, PickupDueType, ConfirmedAt, PickupPolicySnapshotId, IsUnlocked FROM wf.SalesOrderExt WHERE SOID=@id`, { id: { type: sql.VarChar(50), value: String(req.params.id) } })).recordset[0];
    
    // R13 (Q1): A trip is confirmed as a whole. Block per-bill confirm for trip bills.
    if (isSohdOrder && isSohdOrder.TripId) {
      const trip = (await wfQuery(`SELECT TripId, TripCode, Status FROM wf.SalesTrip WHERE TripId = @tripId`, { tripId: { type: sql.Int, value: Number(isSohdOrder.TripId) } })).recordset?.[0];
      if (trip && trip.Status !== 'CANCELLED') {
        if (isSohdOrder.ConfirmedAt && isSohdOrder.IsUnlocked === 0) {
          const { normalizeDateString } = require('../services/so-pickup-policy');
          return res.json({
            id: req.params.id,
            status: 'CONFIRMED',
            pickupDueDate: normalizeDateString(isSohdOrder.PickupDueDate, { isWallClock: true }),
            pickupDueType: isSohdOrder.PickupDueType || 'DEFAULT',
            confirmedAt: isSohdOrder.ConfirmedAt,
            pickupPolicySnapshotId: isSohdOrder.PickupPolicySnapshotId,
            replayed: true,
          });
        }
        return res.status(409).json({
          message: `บิลนี้อยู่ในเที่ยวขนส่ง (${trip.TripCode || ('#' + trip.TripId)}) กรุณายืนยันผ่านการยืนยันเที่ยวขนส่งทั้งเที่ยว (ไม่อนุญาตให้ยืนยันรายบิล)`,
          code: 'BILL_IN_ACTIVE_TRIP',
          tripId: trip.TripId,
          tripCode: trip.TripCode
        });
      }
    }

    if (isSohdOrder) {
      const { calculateConfirmationPickupDue, normalizeDateString } = require('../services/so-pickup-policy');

      // Idempotency: if already confirmed and locked, return existing details without shifting ConfirmedAt (C4)
      if (isSohdOrder.ConfirmedAt && isSohdOrder.IsUnlocked === 0) {
        return res.json({
          id: req.params.id,
          status: 'CONFIRMED',
          pickupDueDate: normalizeDateString(isSohdOrder.PickupDueDate, { isWallClock: true }),
          pickupDueType: isSohdOrder.PickupDueType || 'DEFAULT',
          confirmedAt: isSohdOrder.ConfirmedAt,
          pickupPolicySnapshotId: isSohdOrder.PickupPolicySnapshotId,
          replayed: true,
        });
      }

      const explicitDateInput = req.body?.pickupDueDate || req.body?.deliveryDate;
      const pickupResult = await calculateConfirmationPickupDue({
        explicitDate: explicitDateInput,
        confirmedAt: new Date(),
      });

      const confirmedAtTime = isSohdOrder.ConfirmedAt || pickupResult.confirmedAt;
      const finalDueDate = isSohdOrder.PickupDueDate ? normalizeDateString(isSohdOrder.PickupDueDate, { isWallClock: true }) : pickupResult.pickupDueDate;
      const finalDueType = isSohdOrder.PickupDueType || pickupResult.pickupDueType;
      const finalSnapId = isSohdOrder.PickupPolicySnapshotId || pickupResult.pickupPolicySnapshotId;

      await wfQuery(`
        UPDATE wf.SalesOrderExt
        SET IsUnlocked = 0,
            PickupDueDate = COALESCE(PickupDueDate, @pDueDate),
            PickupDueType = COALESCE(PickupDueType, @pDueType),
            ConfirmedAt = COALESCE(ConfirmedAt, @confirmedAt),
            PickupPolicySnapshotId = COALESCE(PickupPolicySnapshotId, @pSnapId),
            UpdatedAt = GETUTCDATE()
        WHERE SOID = @id
      `, {
        id: { type: sql.VarChar(50), value: req.params.id },
        pDueDate: { type: sql.Date, value: pickupResult.pickupDueDate ? new Date(pickupResult.pickupDueDate) : null },
        pDueType: { type: sql.VarChar(20), value: pickupResult.pickupDueType },
        confirmedAt: { type: sql.DateTime2, value: confirmedAtTime },
        pSnapId: { type: sql.Int, value: finalSnapId },
      });
      await audit(null, req.params.id, req.user.sub, 'CONFIRMED', 'DRAFT', 'CONFIRMED', null, req.ip);
      
      broadcast('so_updated', { id: req.params.id, action: 'confirmed' });
      return res.json({
        id: req.params.id,
        status: 'CONFIRMED',
        pickupDueDate: finalDueDate,
        pickupDueType: finalDueType,
        confirmedAt: confirmedAtTime,
        pickupPolicySnapshotId: finalSnapId,
      });
    }

    const so=await getSoOrThrow(req.params.id,'DRAFT');

    // R13 (Q1): Look up TripId from wf.SalesOrder (v_AllSalesOrders does not project TripId)
    const draftTripRow = (await wfQuery(`SELECT TripId FROM wf.SalesOrder WHERE Id = @id`, { id: { type: sql.Int, value: Number(so.Id) } })).recordset?.[0];
    so.TripId = draftTripRow?.TripId != null ? draftTripRow.TripId : so.TripId;

    // A trip is confirmed as a whole. Block per-bill confirm for trip bills.
    if (so.TripId) {
      const trip = (await wfQuery(`SELECT TripId, TripCode, Status FROM wf.SalesTrip WHERE TripId = @tripId`, { tripId: { type: sql.Int, value: Number(so.TripId) } })).recordset?.[0];
      if (trip && trip.Status !== 'CANCELLED') {
        return res.status(409).json({
          message: `บิลนี้อยู่ในเที่ยวขนส่ง (${trip.TripCode || ('#' + trip.TripId)}) กรุณายืนยันผ่านการยืนยันเที่ยวขนส่งทั้งเที่ยว (ไม่อนุญาตให้ยืนยันรายบิล)`,
          code: 'BILL_IN_ACTIVE_TRIP',
          tripId: trip.TripId,
          tripCode: trip.TripCode
        });
      }
    }
    const result=await wfTransaction(async tx=>{
      if(so.TripId) await lockConfirmationResource(tx,'ConfirmTrip_'+so.TripId);
      await lockConfirmationResource(tx,'ConfirmSO_'+so.Id);
      const replay=await tx.request().input('id',sql.Int,Number(so.Id)).query('SELECT SOID FROM wf.SalesOrderExt WHERE SourceDraftId=@id');
      if(replay.recordset[0])return {id:replay.recordset[0].SOID,status:'CONFIRMED',replayed:true};
      return confirmDraft({tx,draftId:so.Id,user:req.user,ip:req.ip,expectedTripId:so.TripId,
        expectedRevision:so.DocumentRevision,explicitPickup:req.body?.pickupDueDate || req.body?.deliveryDate});
    });
    return res.json(result);

  } catch (e) {
    if (e.status === 404) {
      try {
        const replay = await getConfirmationReplay(req);
        if (replay) return res.json(replay);
      } catch (replayError) { e = replayError; }
    }
    const httpErr = toHttpError(e);
    res.status(httpErr.status).json({ message: httpErr.message });
  }
});

// ── PATCH /api/so/:id/picking ────────────────────────────────
router.patch('/:id/picking', requireRole('WAREHOUSE', 'ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const so = await getSoOrThrow(req.params.id, ['CONFIRMED', 'PENDING_APPROVAL']);

    // Strict Mode: Block picking if past due date
    const { resolvePickupPolicy, diffBangkokCalendarDays, getBangkokDateString } = require('../services/so-pickup-policy');
    const policy = await resolvePickupPolicy();
    if (policy.strictMode && so.PickupDueDate) {
      const todayBkk = getBangkokDateString();
      const dueBkk = typeof so.PickupDueDate === 'string' ? so.PickupDueDate.slice(0, 10) : getBangkokDateString(so.PickupDueDate);
      if (dueBkk && diffBangkokCalendarDays(todayBkk, dueBkk) > 0) {
        return res.status(400).json({ message: 'ไม่สามารถจัดสินค้าได้: เอกสารเลยกำหนดรับสินค้าตามนโยบายแบบเข้มงวด (Strict Mode)' });
      }
    }
    await ensureSalesOrderExt(so.Id);
    await wfQuery(`UPDATE dbo.SOHD SET PkgStatus='Y' WHERE SOID=@id`, { id: { type: sql.VarChar(50), value: so.Id } });
    await wfQuery(`UPDATE wf.SalesOrderExt SET UpdatedAt=GETUTCDATE() WHERE SOID=@id`, { id: { type: sql.VarChar(50), value: so.Id } });
    await audit(null, so.Id, req.user.sub, 'PICKING', 'CONFIRMED', 'PICKING', null, req.ip);
    // ขั้นนี้เขียน dbo.SOHD.PkgStatus จึงต้องมีรอยฝั่ง WINSpeed ด้วย
    await writeAudit({ screen: SCREEN.SO_PICKING, action: 'U', docuNo: so.WfRef,
      docuDate: so.CreatedAt, refId: so.Id, username: auditUser(req.user),
      note: 'PkgStatus=Y (จัดสินค้าจากแอป)' });
    res.json({ id: so.Id, status: 'PICKING' });
  } catch (e) { res.status(e.status || 500).json({ message: e.message }); }
});

// ── PATCH /api/so/:id/unlock — บทบาท APPROVER เท่านั้น ─────
router.patch('/:id/unlock', requireRole('APPROVER', 'ADMIN', 'MANAGER', 'ACCOUNTING', 'C_LEVEL'), requireSoInScope, async (req, res) => {
  try {
    const so = await getSoOrThrow(req.params.id, 'PICKING');
    const { note } = req.body;

    // Reverse rebate accrual entries (ไม่ลบ, ใช้ reversedFlag)
    await wfQuery(
      `UPDATE wf.RebateLedger SET ReversedFlag=1, ReversedAt=GETUTCDATE(), ReversedNote=@note, Status='REVERSED'
       WHERE SoId=@soId AND ReversedFlag=0`,
      { soId: { type: sql.VarChar(50), value: so.Id }, note: { type: sql.NVarChar(300), value: note || 'Unlocked' } }
    );
    await wfQuery(`UPDATE wf.SalesOrderLineExt SET RebateBooked=0 WHERE SOID=@soId`, { soId: { type: sql.VarChar(50), value: so.Id } });
    await wfQuery(`UPDATE dbo.SOHD SET PkgStatus='N' WHERE SOID=@id`, { id: { type: sql.VarChar(50), value: so.Id } });
    await wfQuery(`UPDATE wf.SalesOrderExt SET UpdatedAt=GETUTCDATE() WHERE SOID=@id`, { id: { type: sql.VarChar(50), value: so.Id } });
    // a direct unlock from the warehouse queue answers any unlock request still waiting for this bill; otherwise it
    // stayed PENDING in the approval centre after the work was done (UAT batch 5, SHP-03)
    await wfQuery(`UPDATE wf.UnlockRequest SET Status='APPROVED', ApproverId=@uid, ResponseNote=@note, RespondedAt=GETUTCDATE()
                   WHERE SoId=@soId AND Status='PENDING' AND ReqType='UNLOCK'`, {
      uid: { type: sql.Int, value: req.user.sub },
      note: { type: sql.NVarChar(300), value: note || 'ปลดล็อกจากหน้าคลัง' },
      soId: { type: sql.NVarChar(50), value: String(so.Id) },
    });
    await audit(null, so.Id, req.user.sub, 'UNLOCKED', 'PICKING', 'CONFIRMED', note, req.ip);
    await writeAudit({ screen: SCREEN.SO_UNLOCK, action: 'U', docuNo: so.WfRef,
      docuDate: so.CreatedAt, refId: so.Id, username: auditUser(req.user),
      note: `PkgStatus=N (ปลดล็อกจากแอป) ${note || ''}`.trim() });
    res.json({ id: so.Id, status: 'CONFIRMED' });
  } catch (e) { res.status(e.status || 500).json({ message: e.message }); }
});

// ── POST /api/so/:id/unlock-request — ขอปลดล็อก/ขอแก้ไข/ขอยกเลิก ─────
router.post('/:id/unlock-request', requireRole('SALES', 'COUNTER_SALES', 'WAREHOUSE', 'ADMIN', 'C_LEVEL'), requireSoInScope, async (req, res) => {
  try {
    const so = await getSoOrThrow(req.params.id);
    const { reason, reqType = 'UNLOCK' } = req.body || {};
    if (!reason || String(reason).trim().length < 5)
      return res.status(400).json({ message: 'ต้องระบุเหตุผลอย่างน้อย 5 ตัวอักษร' });
    if (!['UNLOCK', 'EDIT', 'CANCEL'].includes(reqType))
      return res.status(400).json({ message: 'ประเภทคำขอไม่ถูกต้อง' });
    // the approver can unlock only a bill in PICKING; a request taken at any other stage could never be
    // approved and sat in accounting's queue for good (UAT APV-02)
    if (reqType === 'UNLOCK' && so.Status !== 'PICKING')
      return res.status(409).json({ message: `ขอปลดล็อกได้เมื่อบิลอยู่ระหว่างจัดของ (PICKING) เท่านั้น — ตอนนี้ ${so.Status}` });

    const dup = (await wfQuery(`SELECT TOP 1 Id FROM wf.UnlockRequest WHERE SoId=@so AND Status='PENDING'`,
      { so: { type: sql.NVarChar(50), value: so.Id } })).recordset[0];
    if (dup) return res.status(400).json({ message: 'มีคำขอที่รออนุมัติอยู่แล้ว' });
    
    await wfQuery(`INSERT INTO wf.UnlockRequest (SoId, WfRef, Reason, RequesterId, ReqType) VALUES (@so, @ref, @reason, @uid, @reqType)`,
      {
        so: { type: sql.NVarChar(50), value: so.Id },
        ref:{ type: sql.NVarChar(30), value: so.WfRef || null },
        reason:{ type: sql.NVarChar(500), value: String(reason).trim() },
        uid:{ type: sql.Int, value: req.user.sub },
        reqType: { type: sql.NVarChar(20), value: reqType }
      });
      
    // ยกเลิก 03/09/2569 — ไม่แตะ MySQL อีกแล้ว
    // removePreWeighTicket(so.WfRef || so.Id).catch(err => console.error('[truckscale] Push error (remove):', err));
    
    broadcast('so_updated', { id: so.Id, action: 'unlock_requested' });
    res.json({ id: so.Id, ok: true });
  } catch (e) { res.status(e.status || 500).json({ message: e.message }); }
});

// ── PATCH /api/so/:id/load — ยืนยันการโหลดสินค้า (Warehouse) ─────
router.patch('/:id/load', requireRole('WAREHOUSE', 'ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const so = await getSoOrThrow(req.params.id, 'PICKING');
    // ใบที่คีย์จาก WINSpeed ยังไม่มีแถว Ext — ถ้าไม่สร้างก่อน UPDATE ข้างล่างจะโดน 0 แถว
    // แล้วสถานะค้างที่ PICKING โดยที่ผู้ใช้เห็นว่า "กดสำเร็จ"
    await ensureSalesOrderExt(so.Id);
    const { sequences, overloadReason } = req.body; // [{ lineNum: 1, seq: 1 }, ...]

    if (sequences && Array.isArray(sequences)) {
      for (const item of sequences) {
        await wfQuery(
          `UPDATE wf.SalesOrderLineExt SET LoadSequence=@seq WHERE SOID=@id AND ListNo=@lineNum`,
          { seq: { type: sql.Int, value: item.seq }, id: { type: sql.VarChar(50), value: so.Id }, lineNum: { type: sql.Int, value: item.lineNum } }
        );
      }
    }

    await wfQuery(
      `UPDATE wf.SalesOrderExt SET IsLoaded=1, UpdatedAt=GETUTCDATE() WHERE SOID=@id`,
      { id: { type: sql.VarChar(50), value: so.Id } }
    );
    
    const note = overloadReason ? `อนุญาตโหลดเกินขีดจำกัด: ${overloadReason}` : null;
    await audit(null, so.Id, req.user.sub, 'LOADED', 'PICKING', 'LOADED', note, req.ip);
    res.json({ id: so.Id, status: 'LOADED' });
  } catch (e) { console.error(e); res.status(e.status || 500).json({ message: e.message }); }
});

// ฟังก์ชันกู้คืนงานตกค้างหลังชั่งออก (Durable Post-Commit Recovery)
// ป้องกันกรณีที่สถานะชั่งออก commit แล้ว แต่ bookRebateAccrual, audit หรือ outbox ขัดข้อง
async function recoverPendingShipmentTasks(so, user, clientIp, details = {}) {
  const soIdStr = String(so.Id);
  const actingUserId = user?.sub || user?.id || 1;
  const lines = await getLines(so.Id);

  // 1. ตรวจสอบและตั้ง Rebate Accrual หากยังไม่เคยตั้ง (Idempotent) — บันทึกให้เจ้าของบิล (so.SalesUserId)
  const existingLedger = await wfQuery(
    `SELECT TOP 1 Id FROM wf.RebateLedger WHERE SoId = @soId`,
    { soId: { type: sql.VarChar(50), value: soIdStr } }
  );
  let rebateRecovered = false;
  if (!existingLedger.recordset?.length) {
    await bookRebateAccrual(so, lines, so.SalesUserId || actingUserId);
    rebateRecovered = true;
  }

  // 2. ตรวจสอบ Audit log และบันทึกหากยังไม่มี — F-21: บันทึก acting user (manager) ไม่ใช่เจ้าของบิล
  const existingAudit = await wfQuery(
    `SELECT TOP 1 Id FROM wf.SalesOrderAudit WHERE SoId = @soId AND Action = 'SHIPPED'`,
    { soId: { type: sql.VarChar(50), value: soIdStr } }
  );
  if (!existingAudit.recordset?.length) {
    await audit(null, so.Id, actingUserId, 'SHIPPED', 'LOADED', 'SHIPPED', null, clientIp);
    await writeAudit({
      screen: SCREEN.SO_SHIP, action: 'U', docuNo: so.WfRef,
      docuDate: so.CreatedAt, refId: so.Id, username: auditUser(user || { sub: actingUserId }),
      note: `ชั่งออกจากแอป สุทธิ ${details.finalNet || ''} กก.${details.verifiedEvent ? ` [Scale: ${details.verifiedEvent.EventSource} #${details.verifiedEvent.EventId}]` : ''}`
    });
  }

  // 3. ตรวจสอบ Outbox event หากยัง PENDING ให้ส่งต่อและอัปเดตเป็น DONE
  const outboxItem = (await wfQuery(
    `SELECT TOP 1 Id, Status FROM wf.OutboxEvent WHERE EventType = 'SO_SHIPPED' AND AggregateId = @soId ORDER BY Id DESC`,
    { soId: { type: sql.NVarChar(60), value: soIdStr } }
  )).recordset?.[0];

  let outboxRecovered = false;
  if (outboxItem) {
    if (outboxItem.Status === 'PENDING') {
      try {
        broadcast('so_updated', { id: so.Id, action: 'shipped' });
        broadcast('outbox_event', { type: 'SO_SHIPPED', aggregateId: soIdStr });
      } catch { /* socket optional */ }

      await wfQuery(
        `UPDATE wf.OutboxEvent SET Status = 'DONE', ProcessedAt = GETUTCDATE() WHERE Id = @id`,
        { id: { type: sql.Int, value: outboxItem.Id } }
      );
      outboxRecovered = true;
    }
  } else {
    await enqueue('SO_SHIPPED', so.Id, { soId: so.Id, netKg: details.finalNet, by: userId }, `SO_SHIPPED:${so.Id}`);
  }

  try {
    broadcast('so_updated', { id: so.Id, action: 'shipped' });
  } catch { /* socket optional */ }

  return { rebateRecovered, outboxRecovered };
}

// ── PATCH /api/so/:id/ship — โอนข้อมูลสมบูรณ์ (Scale) ──────
// WEIGHBRIDGE ทำได้ถึงขั้นชั่งออก/ส่งของ แต่ไม่ได้สิทธิ์ picking/load ซึ่งเป็นงานคลัง
// (ดู SOP-03 — ผู้ปฏิบัติงานเครื่องชั่งเป็นคนปิดน้ำหนักจริงและออกใบส่งของ)
router.patch('/:id/ship', requireRole('WAREHOUSE', 'WEIGHBRIDGE', 'MANAGER', 'ADMIN', 'C_LEVEL'), requireSoInScope, async (req, res) => {
  try {
    const so = await getSoOrThrow(req.params.id, ['LOADED', 'SHIPPED']);

    // Idempotent retry: หากใบสั่งขายถูกบันทึกเป็น SHIPPED ไปแล้ว คืนข้อมูลเดิมโดยไม่เกิด side-effect ซ้ำ
    const extInfo = await ensureSalesOrderExt(so.Id);
    if (!so.SalesUserId && extInfo.salesUserId) so.SalesUserId = extInfo.salesUserId;

    if (so.Status === 'SHIPPED' || (extInfo?.weighOutWeight && Number(extInfo.weighOutWeight) > 0)) {
      // ตรวจสอบและกู้คืนงานที่อาจตกค้างจาก post-commit failure
      const recovery = await recoverPendingShipmentTasks(so, req.user, req.ip);

      const existingTicket = (await wfQuery(
        `SELECT TOP 1 GrossKg, TareKg, NetKg, ScaleNo, Movebill, WeightStatus, WeighOutAt
         FROM wf.WeighTicket WITH (NOLOCK)
         WHERE SoId = @soId
         ORDER BY Id DESC`,
        { soId: { type: sql.NVarChar(50), value: String(so.Id) } }
      )).recordset?.[0];

      return res.json({
        id: so.Id,
        status: 'SHIPPED',
        netKg: existingTicket ? Number(existingTicket.NetKg) : (so.WeighOutWeight ? Number(so.WeighOutWeight) : null),
        weightEval: { status: existingTicket?.WeightStatus || 'NORMAL' },
        message: 'ใบสั่งขายนี้ถูกบันทึกส่งสินค้าเรียบร้อยแล้ว (Idempotent Retry)',
        idempotent: true,
        recovered: recovery.rebateRecovered || recovery.outboxRecovered
      });
    }

    // ห้ามตัดส่งสินค้าหากใบสั่งขายติด Native Pending Approval (AppvFlag = 'W' และยังไม่มี AppvDocuNo)
    if (so.AppvFlag === 'W' && !so.AppvDocuNo) {
      return res.status(400).json({
        message: 'ไม่สามารถตัดส่งสินค้าได้: ใบสั่งขายนี้อยู่ระหว่างรออนุมัติ (Pending Approval) ต้องได้รับอนุมัติก่อนตัดส่ง'
      });
    }

    const { weighOutWeight, tareKg, scaleNo, movebill, overrideReason, evidencePhotoUrl } = req.body || {};

    // 1. ตรวจสอบสถานะแผนจัดของและการรับทราบของคลัง (SO-07)
    let tripId = extInfo?.tripId || so.TripId || null;
    if (!tripId) {
      const tripLookup = await wfQuery(`
        SELECT TripId FROM wf.SalesOrder WHERE Id = @soId AND TripId IS NOT NULL
        UNION
        SELECT TripId FROM wf.SalesOrderExt WHERE SOID = @soIdStr AND TripId IS NOT NULL
      `, {
        soId: { type: sql.Int, value: Number(so.Id) || 0 },
        soIdStr: { type: sql.VarChar(50), value: String(so.Id) }
      });
      if (tripLookup.recordset?.length > 0) {
        tripId = tripLookup.recordset[0].TripId;
      }
    }

    if (tripId) {
      const tripCheck = (await wfQuery(`
        SELECT TripId, Status, LoadPlanStatus, LoadPlanRevision, WarehouseAckAt
        FROM wf.SalesTrip WHERE TripId = @tid
      `, { tid: { type: sql.Int, value: Number(tripId) } })).recordset?.[0];

      if (tripCheck && tripCheck.LoadPlanStatus && !['WAREHOUSE_ACK', 'LOADING', 'COMPLETED'].includes(tripCheck.LoadPlanStatus)) {
        return res.status(400).json({
          message: `ไม่สามารถตัดส่งสินค้าได้: แผนการโหลดยังไม่ได้รับการยืนยันจากฝ่ายคลัง (สถานะแผนปัจจุบัน: ${tripCheck.LoadPlanStatus || 'DRAFT'})`,
          loadPlanStatus: tripCheck.LoadPlanStatus
        });
      }
    }

    // 2. ค้นหาเหตุการณ์ชั่งจริง (Scale Event) ที่เชื่อมด้วย Typed Identity จริง
    //    - ห้ามใช้ทะเบียนรถเพียงอย่างเดียวหรือการมีประวัติชั่งเวลาใกล้กันเป็นหลักฐาน
    //    - ห้ามใช้ Manual Override เดิมเป็น Verified Event
    const soIdNum = Number(so.Id);
    const soIdInt = Number.isInteger(soIdNum) ? soIdNum : null;
    const soIdStr = String(so.Id);

    let verifiedEvent = null;

    // 2.1 ตรวจสอบตารางชั่งจริง native (dbo.WGHD) ด้วย SPID (typed SOHD.SOID)
    if (soIdInt != null) {
      const wghdRes = await wfQuery(`
        SELECT TOP 1 
          'WGHD' AS EventSource,
          Id AS EventId,
          MoveBill,
          CarNo AS TruckPlate,
          CAST(WeightOut AS DECIMAL(10,2)) AS GrossKg,
          CAST(WeightIn AS DECIMAL(10,2)) AS TareKg,
          CAST(ISNULL(WeightNet, WeightOut - WeightIn) AS DECIMAL(10,2)) AS NetKg,
          CASE 
            WHEN LocationName IS NOT NULL 
             AND LTRIM(RTRIM(LocationName)) NOT LIKE '%[^0-9]%' 
             AND LTRIM(RTRIM(LocationName)) <> '' 
             AND (
               LEN(LTRIM(RTRIM(LocationName))) <= 9
               OR (LEN(LTRIM(RTRIM(LocationName))) = 10 AND CAST(LTRIM(RTRIM(LocationName)) AS BIGINT) <= 2147483647)
             )
            THEN CAST(LTRIM(RTRIM(LocationName)) AS INT) 
            ELSE NULL 
          END AS ScaleNo,
          DateOut AS WeighOutAt
        FROM dbo.WGHD WITH (NOLOCK)
        WHERE WGType = 'SO'
          AND SPID = @soIdInt
          AND (Status = '3' OR Status = 3)
          AND WeightOut > 0
          AND WeightIn > 0
          AND WeightOut > WeightIn
          AND DateOut IS NOT NULL
          AND DateOut <= DATEADD(minute, 5, GETUTCDATE())
        ORDER BY Id DESC
      `, { soIdInt: { type: sql.Int, value: soIdInt } });

      if (wghdRes.recordset?.length > 0) {
        verifiedEvent = wghdRes.recordset[0];
      }
    }

    // 2.2 ตรวจสอบ wf.WeighTicket ที่ผูกด้วย SoId จริง และต้องไม่มี OverrideApprovedBy
    if (!verifiedEvent) {
      const ticketRes = await wfQuery(`
        SELECT TOP 1
          'WEIGH_TICKET' AS EventSource,
          Id AS EventId,
          Movebill,
          TruckPlate,
          CAST(GrossKg AS DECIMAL(10,2)) AS GrossKg,
          CAST(TareKg AS DECIMAL(10,2)) AS TareKg,
          CAST(NetKg AS DECIMAL(10,2)) AS NetKg,
          ScaleNo,
          WeighOutAt
        FROM wf.WeighTicket WITH (NOLOCK)
        WHERE SoId = @soIdStr
          AND Status = 'DONE'
          AND GrossKg > 0
          AND TareKg > 0
          AND GrossKg > TareKg
          AND WeighOutAt IS NOT NULL
          AND WeighOutAt <= DATEADD(minute, 5, GETUTCDATE())
          AND OverrideApprovedBy IS NULL
        ORDER BY Id DESC
      `, { soIdStr: { type: sql.NVarChar(50), value: soIdStr } });

      if (ticketRes.recordset?.length > 0) {
        verifiedEvent = ticketRes.recordset[0];
      }
    }

    let finalGross, finalTare, finalNet, finalScaleNo, finalMovebill;
    let finalOverrideApprovedBy = null;
    let finalOverrideApprovedByName = null;

    if (verifiedEvent) {
      // 3. Weight Authority: ค่าน้ำหนักจาก Verified Event เป็นหลัก
      finalGross = Number(verifiedEvent.GrossKg);
      finalTare = Number(verifiedEvent.TareKg);
      finalNet = Number(verifiedEvent.NetKg);
      finalScaleNo = verifiedEvent.ScaleNo || (scaleNo != null ? Number(scaleNo) : 1);
      finalMovebill = verifiedEvent.MoveBill || movebill || null;

      // ตรวจจับ Mismatch หาก Client ส่งน้ำหนักมาไม่ตรงกับเครื่องชั่งจริง (> 1.0 กก.)
      if (weighOutWeight != null && weighOutWeight !== '') {
        const clientGross = Number(weighOutWeight);
        if (Number.isFinite(clientGross) && Math.abs(clientGross - finalGross) > 1.0) {
          return res.status(400).json({
            message: `น้ำหนักชั่งออกที่ส่งมาไม่ตรงกับข้อมูลจริงจากเครื่องชั่ง (เครื่องชั่ง: ${finalGross} กก., ส่งมา: ${clientGross} กก.)`,
            verifiedEvent: { grossKg: finalGross, tareKg: finalTare, netKg: finalNet }
          });
        }
      }
      if (tareKg != null && tareKg !== '') {
        const clientTare = Number(tareKg);
        if (Number.isFinite(clientTare) && Math.abs(clientTare - finalTare) > 1.0) {
          return res.status(400).json({
            message: `น้ำหนักรถเปล่าที่ส่งมาไม่ตรงกับข้อมูลจริงจากเครื่องชั่ง (เครื่องชั่ง: ${finalTare} กก., ส่งมา: ${clientTare} กก.)`,
            verifiedEvent: { grossKg: finalGross, tareKg: finalTare, netKg: finalNet }
          });
        }
      }
    } else {
      // 4. กรณีไม่มี Verified Event: บังคับ Managerial Exception Gate
      const hasOverrideParams = (overrideReason && overrideReason.trim().length > 0) || Boolean(req.body?.isManualOverride);
      if (!hasOverrideParams) {
        return res.status(400).json({
          message: 'ไม่พบประวัติการชั่งจริงจากเครื่องชั่ง (Scale Event) หรือไม่พบเหตุการณ์ชั่งจริงสำหรับเอกสารนี้ หากต้องการยกเว้นกรุณาดำเนินการผ่าน Exception Workflow โดยผู้จัดการ'
        });
      }

      const isManagerOrAdmin = ['MANAGER', 'ADMIN', 'C_LEVEL'].includes(req.user.role);
      if (!isManagerOrAdmin) {
        return res.status(403).json({
          message: 'การบันทึกน้ำหนักด้วยตนเองโดยไม่มีสัญญาณเครื่องชั่ง ต้องได้รับการอนุมัติจากผู้จัดการ (MANAGER หรือ ADMIN) เท่านั้น'
        });
      }

      if (overrideReason.trim().length < 10) {
        return res.status(400).json({
          message: 'กรุณาระบุเหตุผลการบันทึกน้ำหนักด้วยตนเอง (overrideReason) ให้ชัดเจนอย่างน้อย 10 ตัวอักษร'
        });
      }

      if (!evidencePhotoUrl || String(evidencePhotoUrl).trim() === '') {
        return res.status(400).json({
          message: 'กรุณาแนบรูปถ่ายหลักฐานน้ำหนัก (evidencePhotoUrl) สำหรับกรณีบันทึกน้ำหนักด้วยตนเอง'
        });
      }

      const clientGross = Number(weighOutWeight);
      const clientTare = Number(tareKg);
      if (!Number.isFinite(clientGross) || !Number.isFinite(clientTare) || clientGross <= 0 || clientTare < 0 || clientGross <= clientTare) {
        return res.status(400).json({
          message: 'กรุณาระบุน้ำหนักชั่งออกและน้ำหนักรถเปล่าที่ถูกต้อง (ชั่งออกต้องมากกว่ารถเปล่า)'
        });
      }

      finalGross = clientGross;
      finalTare = clientTare;
      finalNet = clientGross - clientTare;
      finalScaleNo = scaleNo != null ? Number(scaleNo) : 1;
      finalMovebill = movebill || null;
      // ผู้มีอำนาจอนุมัติถูกผูกตาม Authenticated User เท่านั้น ห้ามรับจาก Client Body
      finalOverrideApprovedBy = req.user.sub;
      finalOverrideApprovedByName = req.user.displayName || req.user.name || req.user.username || 'Manager';
    }

    // คำนวณ reconciliation และ tolerance status จาก weight-reconciliation service
    const { evaluateWeight } = require('../services/weight-reconciliation');
    const evalRes = await evaluateWeight(so.Id, finalNet);

    // 5. Transaction Boundary: ล็อกและบันทึกการส่งสินค้าพร้อมกัน ป้องกันการแก้ไขแผนระหว่างชั่ง และป้องกัน Concurrent Duplicate Writes
    const txResult = await wfTransaction(async (tx) => {
      // 5.1 Lock SO record with UPDLOCK, ROWLOCK เพื่อป้องกัน concurrent shipping requests ชนกัน
      const soLock = (await tx.request()
        .input('id', sql.Int, Number(so.Id) || 0)
        .query(`SELECT Id, Status, WfRef, TruckPlate, SalesUserId FROM wf.SalesOrder WITH (UPDLOCK, ROWLOCK) WHERE Id = @id`)
      ).recordset?.[0];

      const extLock = (await tx.request()
        .input('soid', sql.VarChar(50), String(so.Id))
        .query(`SELECT SOID, WeighOutWeight, TripId FROM wf.SalesOrderExt WITH (UPDLOCK, ROWLOCK) WHERE SOID = @soid`)
      ).recordset?.[0];

      // หากมีคำขอคู่ขนานที่ commit ไปก่อนแล้ว (In-Transaction Concurrency Recheck)
      if (soLock?.Status === 'SHIPPED' || (extLock?.WeighOutWeight && Number(extLock.WeighOutWeight) > 0)) {
        const existingTicket = (await tx.request()
          .input('soId', sql.NVarChar(50), String(so.Id))
          .query(`SELECT TOP 1 GrossKg, TareKg, NetKg, ScaleNo, Movebill, WeightStatus, WeighOutAt
                  FROM wf.WeighTicket WITH (NOLOCK)
                  WHERE SoId = @soId
                  ORDER BY Id DESC`)
        ).recordset?.[0];
        return { isAlreadyShipped: true, existingTicketData: existingTicket };
      }

      // ป้องกัน duplicate ticket แม้สถานะ SO ยังไม่อัปเดต
      const ticketExists = (await tx.request()
        .input('soId', sql.NVarChar(50), String(so.Id))
        .query(`SELECT TOP 1 GrossKg, TareKg, NetKg, ScaleNo, Movebill, WeightStatus, WeighOutAt
                FROM wf.WeighTicket WITH (UPDLOCK, ROWLOCK)
                WHERE SoId = @soId AND Status = 'DONE'
                ORDER BY Id DESC`)
      ).recordset?.[0];

      if (ticketExists) {
        return { isAlreadyShipped: true, existingTicketData: ticketExists };
      }

      // 5.2 ล็อก Trip และตรวจสอบสถานะ Load Plan ภายใน Transaction เดียวกัน
      const activeTripId = extLock?.TripId || tripId;
      if (activeTripId) {
        const tripLock = (await tx.request()
          .input('tid', sql.Int, Number(activeTripId))
          .query(`SELECT LoadPlanStatus, LoadPlanRevision, WarehouseAckAt FROM wf.SalesTrip WITH (UPDLOCK, ROWLOCK) WHERE TripId = @tid`)).recordset?.[0];

        if (tripLock && tripLock.LoadPlanStatus && !['WAREHOUSE_ACK', 'LOADING', 'COMPLETED'].includes(tripLock.LoadPlanStatus)) {
          const err = new Error(`ไม่สามารถตัดส่งสินค้าได้: แผนการโหลดยังไม่ได้รับการยืนยันจากฝ่ายคลัง (สถานะแผนปัจจุบัน: ${tripLock.LoadPlanStatus || 'DRAFT'})`);
          err.status = 400;
          throw err;
        }
      }

      // 5.3 อัปเดตข้อมูลน้ำหนักและสถานะอย่างมีเงื่อนไข (Conditional State Transition)
      await tx.request()
        .input('id', sql.VarChar(50), String(so.Id))
        .input('weight', sql.Decimal(10, 2), finalGross)
        .query(`UPDATE wf.SalesOrderExt SET WeighOutWeight = @weight, UpdatedAt = GETUTCDATE() WHERE SOID = @id`);

      const updateSoRes = await tx.request()
        .input('id', sql.Int, Number(so.Id) || 0)
        .query(`UPDATE wf.SalesOrder SET Status = 'SHIPPED', UpdatedAt = GETUTCDATE() WHERE Id = @id AND Status != 'SHIPPED'`);

      if (updateSoRes.rowsAffected?.[0] === 0 && soLock?.Status === 'SHIPPED') {
        const existingTicket = (await tx.request()
          .input('soId', sql.NVarChar(50), String(so.Id))
          .query(`SELECT TOP 1 GrossKg, TareKg, NetKg, ScaleNo, Movebill, WeightStatus, WeighOutAt
                  FROM wf.WeighTicket WITH (NOLOCK)
                  WHERE SoId = @soId
                  ORDER BY Id DESC`)
        ).recordset?.[0];
        return { isAlreadyShipped: true, existingTicketData: existingTicket };
      }

      // 5.4 บันทึกตั๋วชั่งออกจริงเพียงครั้งเดียว
      await tx.request()
        .input('so', sql.NVarChar(50), String(so.Id))
        .input('ref', sql.NVarChar(30), so.WfRef || null)
        .input('plate', sql.NVarChar(30), so.TruckPlate || null)
        .input('gross', sql.Decimal(10, 2), finalGross)
        .input('tare', sql.Decimal(10, 2), finalTare)
        .input('net', sql.Decimal(10, 2), finalNet)
        .input('scale', sql.Int, finalScaleNo)
        .input('mb', sql.NVarChar(50), finalMovebill)
        .input('uid', sql.Int, req.user.sub)
        .input('expNet', sql.Decimal(12, 2), evalRes.expectedNetKg)
        .input('varKg', sql.Decimal(12, 2), evalRes.varianceKg)
        .input('varPct', sql.Decimal(6, 2), evalRes.variancePct)
        .input('wStatus', sql.NVarChar(20), evalRes.status)
        .input('ovReason', sql.NVarChar(500), overrideReason || null)
        .input('ovApprovedBy', sql.Int, finalOverrideApprovedBy)
        .input('ovApprovedByName', sql.NVarChar(100), finalOverrideApprovedByName)
        .input('evidencePhoto', sql.NVarChar(sql.MAX), evidencePhotoUrl || null)
        .query(`
          INSERT INTO wf.WeighTicket (
            SoId, WfRef, TruckPlate, GrossKg, TareKg, NetKg, ScaleNo, WeighOutAt, Status, Movebill, CreatedBy,
            ExpectedNetKg, VarianceKg, VariancePct, WeightStatus,
            OverrideReason, OverrideApprovedBy, OverrideApprovedByName, EvidencePhotoUrl
          )
          VALUES (
            @so, @ref, @plate, @gross, @tare, @net, @scale, GETUTCDATE(), 'DONE', @mb, @uid,
            @expNet, @varKg, @varPct, @wStatus,
            @ovReason, @ovApprovedBy, @ovApprovedByName, @evidencePhoto
          )
        `);

      // 5.5 บันทึก Durable Outbox Event (สถานะ PENDING) ภายใน Transaction เดียวกัน
      // หาก Transaction นี้ Commit ได้ งานส่งต่อและรีเบทจะมีหลักฐานคงทนให้กู้คืนเสมอ
      const outboxPayload = JSON.stringify({ soId: so.Id, netKg: finalNet, by: req.user.sub });
      await tx.request()
        .input('t', sql.NVarChar(60), 'SO_SHIPPED')
        .input('a', sql.NVarChar(60), String(so.Id))
        .input('p', sql.NVarChar(sql.MAX), outboxPayload)
        .input('k', sql.NVarChar(120), `SO_SHIPPED:${so.Id}`)
        .query(`
          IF NOT EXISTS (SELECT 1 FROM wf.OutboxEvent WHERE IdempotencyKey = @k)
          BEGIN
            INSERT INTO wf.OutboxEvent (EventType, AggregateId, Payload, IdempotencyKey, Status, CreatedAt)
            VALUES (@t, @a, @p, @k, 'PENDING', GETUTCDATE())
          END
        `);

      // 5.6 Fault Injection: ทดสอบ Rollback ระหว่างเขียนจริง (Non-production only)
      if (process.env.NODE_ENV !== 'production' && req.headers['x-test-fault-injection'] === 'mid_write_rollback') {
        const err = new Error('FAULT_INJECTION_MID_WRITE_ROLLBACK');
        err.status = 500;
        throw err;
      }

      return { isAlreadyShipped: false };
    });

    // 5.7 Fault Injection: ทดสอบ Post-Commit Delivery Failure ก่อนทำ side-effects (Non-production only)
    if (process.env.NODE_ENV !== 'production' && req.headers['x-test-fault-injection'] === 'post_commit_delivery_failure') {
      const err = new Error('FAULT_INJECTION_POST_COMMIT_DELIVERY_FAILURE');
      err.status = 500;
      throw err;
    }

    // หากเป็นคำขอคู่ขนานที่แพ้ race ให้คืนผล idempotent เดิม พร้อมตรวจ recovery หากคำขอก่อนหน้าค้าง
    if (txResult?.isAlreadyShipped) {
      const recovery = await recoverPendingShipmentTasks(so, req.user, req.ip, { finalNet, evalRes, verifiedEvent });
      const existingTicket = txResult.existingTicketData;
      return res.json({
        id: so.Id,
        status: 'SHIPPED',
        netKg: existingTicket ? Number(existingTicket.NetKg) : finalNet,
        weightEval: { status: existingTicket?.WeightStatus || evalRes?.status || 'NORMAL' },
        message: 'ใบสั่งขายนี้ถูกบันทึกส่งสินค้าเรียบร้อยแล้ว (Idempotent Concurrent Resolution)',
        idempotent: true,
        recovered: recovery.rebateRecovered || recovery.outboxRecovered
      });
    }

    // ประมวลผลงานต่อเนื่องหลัง Commit แบบ Idempotent พร้อมอัปเดตสถานะ Outbox
    const recovery = await recoverPendingShipmentTasks(so, req.user, req.ip, { finalNet, evalRes, verifiedEvent });
    res.json({
      id: so.Id,
      status: 'SHIPPED',
      netKg: finalNet,
      weightEval: evalRes,
      recovered: recovery.rebateRecovered || recovery.outboxRecovered
    });
  } catch (e) { console.error(e); res.status(e.status || 500).json({ message: e.message }); }
});

// ── POST /api/so/:id/weigh-item — บันทึกผลการชั่งวนรายรายการสินค้า ──
router.post('/:id/weigh-item', requireRole('WAREHOUSE', 'WEIGHBRIDGE', 'ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const soId = String(req.params.id);
    const { grossScaleKg, lineNum, goodCode, goodName, note, tareKg } = req.body || {};
    const gross = Number(grossScaleKg);
    if (isNaN(gross) || gross <= 0) return res.status(400).json({ message: 'กรุณาระบุน้ำหนักเครื่องชั่งที่ถูกต้อง' });

    // ดึงประวัติการชั่งย่อยย้อนหลังเพื่อคำนวณ Incremental Net
    const lastLogs = (await wfQuery(`
      SELECT TOP 1 GrossScaleKg FROM wf.WeighTicketItemLog
      WHERE SoId = @so ORDER BY PassNo DESC, Id DESC
    `, { so: { type: sql.NVarChar(50), value: soId } })).recordset || [];

    const passCnt = (await wfQuery(`
      SELECT COUNT(*) AS cnt FROM wf.WeighTicketItemLog WHERE SoId = @so
    `, { so: { type: sql.NVarChar(50), value: soId } })).recordset[0]?.cnt || 0;

    const baseWeight = lastLogs.length > 0 ? Number(lastLogs[0].GrossScaleKg) : (Number(tareKg) || 0);
    const incNet = baseWeight > 0 ? gross - baseWeight : null;

    await wfQuery(`
      INSERT INTO wf.WeighTicketItemLog (SoId, LineNum, GoodCode, GoodName, PassNo, GrossScaleKg, IncrementalNetKg, Note, WeighedBy)
      VALUES (@so, @line, @code, @name, @pass, @gross, @inc, @note, @uid)
    `, {
      so:    { type: sql.NVarChar(50), value: soId },
      line:  { type: sql.Int, value: lineNum != null ? Number(lineNum) : null },
      code:  { type: sql.NVarChar(50), value: goodCode || null },
      name:  { type: sql.NVarChar(200), value: goodName || null },
      pass:  { type: sql.Int, value: passCnt + 1 },
      gross: { type: sql.Decimal(10,2), value: gross },
      inc:   { type: sql.Decimal(10,2), value: incNet },
      note:  { type: sql.NVarChar(300), value: note || null },
      uid:   { type: sql.Int, value: req.user.sub },
    });

    res.json({ ok: true, passNo: passCnt + 1, grossScaleKg: gross, incrementalNetKg: incNet });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// ── GET /api/so/:id/weigh-history — ประวัติใบชั่งและการชั่งวนรายรายการ ──
router.get('/:id/weigh-history', requireSoInScope, async (req, res) => {
  try {
    const soId = String(req.params.id);
    const ticket = (await wfQuery(`
      SELECT TOP 1 * FROM wf.WeighTicket WHERE SoId = @so ORDER BY Id DESC
    `, { so: { type: sql.NVarChar(50), value: soId } })).recordset[0] || null;

    const itemLogs = (await wfQuery(`
      SELECT l.*, u.DisplayName AS WeighedByName
      FROM wf.WeighTicketItemLog l
      LEFT JOIN wf.AppUser u ON u.Id = l.WeighedBy
      WHERE l.SoId = @so
      ORDER BY l.PassNo ASC, l.Id ASC
    `, { so: { type: sql.NVarChar(50), value: soId } })).recordset || [];

    const { evaluateWeight } = require('../services/weight-reconciliation');
    const netKg = ticket ? ticket.NetKg : null;
    const weightEval = await evaluateWeight(soId, netKg);

    res.json({ ticket, itemLogs, weightEval });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// ── PATCH /api/so/:id/sync-imported — เลิกใช้ เพราะเข้า Winspeed อัตโนมัติตั้งแต่ CONFIRM แล้ว ─
router.patch('/:id/sync-imported', requireRole('ADMIN', 'ACCOUNTING', 'C_LEVEL'), async (req, res) => {
  res.status(400).json({ message: 'ฟังก์ชันนี้ถูกยกเลิก (ข้อมูลซิงค์ตรงเข้า Winspeed แล้ว)' });
});

// ── POST /api/so/bulk-cancel-delete — Atomic bulk cancel or delete for Sales Orders / Trips ──
router.post('/bulk-cancel-delete', requireRole('SALES', 'ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const { soIds, action = 'AUTO', reasonCode: rawReasonCode, reasonText: rawReasonText } = req.body || {};

    if (!Array.isArray(soIds) || soIds.length === 0) {
      return res.status(400).json({ message: 'กรุณาระบุรายการ soIds อย่างน้อย 1 รายการ' });
    }

    const { validateReasonCode, logChangeEvent } = require('../services/policy-contract');

    // 1. Validate master reason code
    let reasonCategory = action === 'DELETE' ? 'SO_DELETE' : 'SO_CANCEL';
    let reasonCheck = await validateReasonCode(null, rawReasonCode, rawReasonText, reasonCategory);
    if (!reasonCheck.valid && action === 'AUTO') {
      const altCheck = await validateReasonCode(null, rawReasonCode, rawReasonText, 'SO_DELETE');
      if (altCheck.valid) {
        reasonCheck = altCheck;
      }
    }
    if (!reasonCheck.valid) {
      return res.status(400).json({ message: reasonCheck.error });
    }
    const validatedReasonCode = reasonCheck.reasonCode;
    const validatedReasonText = reasonCheck.reasonText;

    // 2. Pre-fetch and pre-validate ALL orders before starting transaction
    const loadedSos = [];
    for (const id of soIds) {
      const so = await getSoOrThrow(id);
      if (['SHIPPED', 'IMPORTED'].includes(so.Status)) {
        return res.status(400).json({
          message: `ไม่สามารถดำเนินการได้ เนื่องจากบิล ${so.WfRef || so.Id} อยู่ในสถานะ ${so.Status}`,
          failedSoId: so.Id,
        });
      }

      const pendingQuote = await getPendingQuoteForSo(so.Id);
      if (pendingQuote) {
        return res.status(400).json({
          message: `บิล ${so.WfRef || so.Id} ผูกกับใบเสนอราคา ${pendingQuote.QuoteNo} (${pendingQuote.Status}) ต้องยกเลิกใบเสนอราคาก่อน`,
          requiresQuotationAction: true,
          quoteId: pendingQuote.Id,
          quoteNo: pendingQuote.QuoteNo,
          failedSoId: so.Id,
        });
      }

      let op = action;
      if (op === 'AUTO') {
        op = ['DRAFT', 'CANCELLED'].includes(so.Status) ? 'DELETE' : 'CANCEL';
      }

      if (op === 'DELETE' && !['DRAFT', 'CANCELLED'].includes(so.Status)) {
        return res.status(400).json({
          message: `ลบได้เฉพาะบิลร่างหรือยกเลิกแล้ว แต่บิล ${so.WfRef || so.Id} อยู่ในสถานะ ${so.Status}`,
          failedSoId: so.Id,
        });
      }

      if (op === 'CANCEL' && so.Status === 'CANCELLED') {
        return res.status(400).json({
          message: `บิล ${so.WfRef || so.Id} ถูกยกเลิกไปแล้ว`,
          failedSoId: so.Id,
        });
      }

      loadedSos.push({ so, op });
    }

    // 3. Execute inside single atomic transaction
    await wfTransaction(async (tx) => {
      for (const { so, op } of loadedSos) {
        if (op === 'DELETE') {
          const isWebDraft = !so.ImportedDocuNo;
          if (isWebDraft) {
            // a deleted draft closes its open price approvals; otherwise managers keep approving a bill
            // that no longer exists (UAT batch 4, SO-14)
            await tx.request().input('id', sql.Int, so.Id)
              .query(`UPDATE wf.PriceApproval SET Status = 'SUPERSEDED', UpdatedAt = SYSUTCDATETIME() WHERE SoId = @id AND Status = 'PENDING'`);
            const reqLine = tx.request();
            reqLine.input('id', sql.Int, so.Id);
            await reqLine.query(`DELETE FROM wf.SalesOrderLine WHERE SoId=@id`);

            const reqSo = tx.request();
            reqSo.input('id', sql.Int, so.Id);
            await reqSo.query(`DELETE FROM wf.SalesOrder WHERE Id=@id`);
          } else {
            const reqSohd = tx.request();
            reqSohd.input('id', sql.VarChar(50), String(so.Id));
            await reqSohd.query(`UPDATE dbo.SOHD SET DocuStatus='C' WHERE SOID=@id`);
          }

          const reqGw = tx.request();
          reqGw.input('nt', sql.NVarChar(300), `ตัดโควต้าอัตโนมัติจากบิล ${so.WfRef || so.Id}`);
          await reqGw.query(`DELETE FROM wf.GiveawayWithdrawal WHERE Note = @nt`);

          // Auto-cancel attached coupon reservations
          await tx.request()
            .input('soIdStr', sql.VarChar(50), String(so.Id))
            .input('wfRefStr', sql.VarChar(50), String(so.WfRef || ''))
            .input('rsn', sql.NVarChar(255), String(validatedReasonText || 'BULK_DELETE'))
            .input('uid', sql.Int, req.user.sub)
            .query(`
              UPDATE wf.CouponReservation
              SET Status = 'CANCELLED',
                  CancelledAt = GETUTCDATE(),
                  CancelReason = @rsn,
                  CancelledBy = @uid,
                  UpdatedAt = GETUTCDATE()
              WHERE (CarrierSoId = @soIdStr OR CarrierDocuNo = @wfRefStr)
                AND Status = 'RESERVED'
            `);

          await audit(tx, so.Id, req.user.sub, 'DELETED', so.Status, 'DELETED', validatedReasonText, req.ip);

          await logChangeEvent(tx, {
            entityType: 'SALES_ORDER',
            entityId: String(so.Id),
            action: 'DELETE',
            beforeJson: { id: so.Id, wfRef: so.WfRef, status: so.Status },
            afterJson: { deleted: true },
            reasonCode: validatedReasonCode,
            reasonText: validatedReasonText,
            userId: String(req.user?.sub || req.user?.username || 'SYSTEM'),
            ipAddress: req.ip,
          });
        } else {
          // CANCEL — an unlocked native bill reads DRAFT too, but has a WinSpeed document to cancel
          if (so.Status === 'DRAFT' && !so.ImportedDocuNo) {
            const reqDraft = tx.request();
            reqDraft.input('id', sql.Int, so.Id);
            await reqDraft.query(`UPDATE wf.SalesOrder SET Status='CANCELLED', UpdatedAt=GETUTCDATE() WHERE Id=@id`);
          } else {
            const reqReb = tx.request();
            reqReb.input('soId', sql.VarChar(50), String(so.Id));
            reqReb.input('note', sql.NVarChar(300), validatedReasonText);
            await reqReb.query(`UPDATE wf.RebateLedger SET ReversedFlag=1, ReversedAt=GETUTCDATE(), ReversedNote=@note, Status='REVERSED' WHERE SoId=@soId AND ReversedFlag=0`);

            const reqSohd = tx.request();
            reqSohd.input('id', sql.VarChar(50), String(so.Id));
            await reqSohd.query(`UPDATE dbo.SOHD SET DocuStatus='C' WHERE SOID=@id`);

            const reqExt = tx.request();
            reqExt.input('id', sql.VarChar(50), String(so.Id));
            await reqExt.query(`UPDATE wf.SalesOrderExt SET UpdatedAt=GETUTCDATE() WHERE SOID=@id`);
          }

          const reqGw = tx.request();
          reqGw.input('nt', sql.NVarChar(300), `ตัดโควต้าอัตโนมัติจากบิล ${so.WfRef || so.Id}`);
          await reqGw.query(`DELETE FROM wf.GiveawayWithdrawal WHERE Note = @nt`);

            await tx.request()
              .input('soIdStr', sql.VarChar(50), String(so.Id))
              .input('wfRefStr', sql.VarChar(50), String(so.WfRef || ''))
              .input('rsn', sql.NVarChar(255), String(validatedReasonText || 'BULK_CANCEL'))
              .input('uid', sql.Int, req.user.sub)
              .query(`
                UPDATE wf.CouponReservation
                SET Status = 'CANCELLED',
                    CancelledAt = GETUTCDATE(),
                    CancelReason = @rsn,
                    CancelledBy = @uid,
                    UpdatedAt = GETUTCDATE()
                WHERE (CarrierSoId = @soIdStr OR CarrierDocuNo = @wfRefStr)
                  AND Status = 'RESERVED'
              `);

            // R9-1 / F-02: give back applied claims and consumed accrual (drafts and confirmed bills alike)
            await releaseRebateOnCancel(tx, so, so.Status === 'DRAFT' && !so.ImportedDocuNo);

            await audit(tx, so.Id, req.user.sub, 'CANCELLED', so.Status, 'CANCELLED', validatedReasonText, req.ip);

          await logChangeEvent(tx, {
            entityType: 'SALES_ORDER',
            entityId: String(so.Id),
            action: 'CANCEL',
            beforeJson: { id: so.Id, wfRef: so.WfRef, status: so.Status },
            afterJson: { status: 'CANCELLED' },
            reasonCode: validatedReasonCode,
            reasonText: validatedReasonText,
            userId: String(req.user?.sub || req.user?.username || 'SYSTEM'),
            ipAddress: req.ip,
          });
        }
      }
    });

    res.json({
      success: true,
      processedCount: loadedSos.length,
      soIds: loadedSos.map(x => x.so.Id),
      operations: loadedSos.map(x => ({ id: x.so.Id, op: x.op })),
    });
  } catch (e) {
    console.error('[so/bulk-cancel-delete]', e);
    res.status(e.status || 500).json({ message: e.message });
  }
});

// ── PATCH /api/so/:id/cancel ─────────────────────────────────
/**
 * F-02 (UAT batch 6): a cancelled bill gives back the rebate it used — only delete and bulk cancel did it, for
 * drafts only. A claim applied to the draft is free again; a claim advanced at confirm (CN_ISSUED on this bill)
 * returns to APPROVED with its amount; accrual the bill's discount consumed goes back to the ledger through a
 * reversing usage row, so the history stays.
 */
async function releaseRebateOnCancel(tx, so, isDraft) {
  const docuNo = String(so.ImportedDocuNo || so.WfRef || '');
  const claimNote = isDraft ? '[บิลร่างถูกยกเลิก คืนสถานะเคลม]' : `[บิล ${docuNo} ถูกยกเลิก คืนสถานะเคลม]`;
  await tx.request()
    .input('soId', sql.Int, Number(so.Id))
    .input('docuNo', sql.VarChar(50), docuNo)
    .input('custId', sql.NVarChar(20), String(so.CustId || ''))
    .input('note', sql.NVarChar(200), claimNote)
    .input('draft', sql.Bit, isDraft ? 1 : 0)
    .query(`
      UPDATE wf.RebateClaim
      SET AppliedDraftSoId = NULL, Note = RTRIM(ISNULL(Note + ' ', '') + @note)
      WHERE @draft = 1 AND AppliedDraftSoId = @soId AND Status = 'APPROVED';
      UPDATE wf.RebateClaim
      SET Status = 'APPROVED', RemainingAmt = ClaimAmt, AppliedDraftSoId = NULL, AppliedSoDocuNo = NULL,
          Note = RTRIM(ISNULL(Note + ' ', '') + @note)
      WHERE @draft = 0 AND @docuNo <> '' AND Status = 'CN_ISSUED' AND AppliedSoDocuNo = @docuNo AND CustId = @custId;`);
  if (!isDraft) {
    await tx.request().input('soid', sql.VarChar(50), String(so.Id)).query(`
      UPDATE l SET RemainingAmt = l.RemainingAmt + u.Amt, Status = CASE WHEN l.Status = 'CLAIMED' THEN 'PENDING' ELSE l.Status END
      FROM wf.RebateLedger l
      JOIN (SELECT LedgerId, SUM(DeductedAmt) Amt FROM wf.RebateUsage WHERE AppliedSOID = @soid GROUP BY LedgerId HAVING SUM(DeductedAmt) > 0) u
        ON u.LedgerId = l.Id
      WHERE l.ReversedFlag = 0;
      INSERT INTO wf.RebateUsage (LedgerId, AppliedSOID, DeductedAmt)
      SELECT LedgerId, AppliedSOID, -SUM(DeductedAmt) FROM wf.RebateUsage WHERE AppliedSOID = @soid
      GROUP BY LedgerId, AppliedSOID HAVING SUM(DeductedAmt) > 0;`);
  }
}

router.patch('/:id/cancel', requireCapability('so.cancel'), requireSoInScope, async (req, res) => {
  try {
    const so = await getSoOrThrow(req.params.id);
    if (['SHIPPED', 'IMPORTED', 'CANCELLED'].includes(so.Status))
      return res.status(400).json({ message: 'ยกเลิกไม่ได้ในสถานะนี้' });

    const pendingQuote = await getPendingQuoteForSo(so.Id);
    if (pendingQuote) {
      return res.status(400).json({
        message: `SO นี้ผูกกับใบเสนอราคา ${pendingQuote.QuoteNo} (${pendingQuote.Status}) ต้องยกเลิกใบเสนอราคาก่อน`,
        requiresQuotationAction: true,
        quoteId: pendingQuote.Id,
        quoteNo: pendingQuote.QuoteNo,
        quoteStatus: pendingQuote.Status,
      });
    }

    const rawReasonCode = req.body?.reasonCode;
    const rawReasonText = req.body?.reason || req.body?.note;
    const { validateReasonCode, logChangeEvent } = require('../services/policy-contract');

    const reasonCheck = await validateReasonCode(null, rawReasonCode, rawReasonText, 'SO_CANCEL');
    if (!reasonCheck.valid) {
      return res.status(400).json({ message: reasonCheck.error });
    }
    const cancelReasonCode = reasonCheck.reasonCode;
    const cancelReason = reasonCheck.reasonText;

    // an unlocked native bill also reads DRAFT; it has a WinSpeed document to cancel, so it is not a draft here —
    // it took the draft branch, which updated no row, and the bill stayed live (UAT batch 6)
    const isDraft = so.Status === 'DRAFT' && !so.ImportedDocuNo;
    await wfTransaction(async (tx) => {
      if (isDraft) {
        const reqDraft = tx.request();
        reqDraft.input('id', sql.Int, so.Id);
        await reqDraft.query(`UPDATE wf.SalesOrder SET Status='CANCELLED', UpdatedAt=GETUTCDATE() WHERE Id=@id`);
      } else {
        const reqReb = tx.request();
        reqReb.input('soId', sql.VarChar(50), String(so.Id));
        reqReb.input('note', sql.NVarChar(300), cancelReason);
        await reqReb.query(`UPDATE wf.RebateLedger SET ReversedFlag=1, ReversedAt=GETUTCDATE(), ReversedNote=@note, Status='REVERSED' WHERE SoId=@soId AND ReversedFlag=0`);

        const reqSohd = tx.request();
        reqSohd.input('id', sql.VarChar(50), String(so.Id));
        await reqSohd.query(`UPDATE dbo.SOHD SET DocuStatus='C' WHERE SOID=@id`);

        const reqExt = tx.request();
        reqExt.input('id', sql.VarChar(50), String(so.Id));
        await reqExt.query(`UPDATE wf.SalesOrderExt SET UpdatedAt=GETUTCDATE() WHERE SOID=@id`);
      }

      await releaseRebateOnCancel(tx, so, isDraft);

      // Auto-restore Giveaway Quota
      const reqGw = tx.request();
      reqGw.input('nt', sql.NVarChar(300), `ตัดโควต้าอัตโนมัติจากบิล ${so.WfRef || so.Id}`);
      await reqGw.query(`DELETE FROM wf.GiveawayWithdrawal WHERE Note = @nt`);

      // Auto-cancel attached coupon reservations
      await tx.request()
        .input('soIdStr', sql.VarChar(50), String(so.Id))
        .input('wfRefStr', sql.VarChar(50), String(so.WfRef || ''))
        .input('rsn', sql.NVarChar(255), String(cancelReason || 'SO_CANCELLED'))
        .input('uid', sql.Int, req.user.sub)
        .query(`
          UPDATE wf.CouponReservation
          SET Status = 'CANCELLED',
              CancelledAt = GETUTCDATE(),
              CancelReason = @rsn,
              CancelledBy = @uid,
              UpdatedAt = GETUTCDATE()
          WHERE (CarrierSoId = @soIdStr OR CarrierDocuNo = @wfRefStr)
            AND Status = 'RESERVED'
        `);

      // Atomic Audit Logs inside the same transaction (R2)
      await audit(tx, so.Id, req.user.sub, 'CANCELLED', so.Status, 'CANCELLED', cancelReason, req.ip);

      await logChangeEvent(tx, {
        entityType: 'SALES_ORDER',
        entityId: String(so.Id),
        action: 'CANCEL',
        beforeJson: { id: so.Id, wfRef: so.WfRef, status: so.Status },
        afterJson: { status: 'CANCELLED' },
        reasonCode: cancelReasonCode,
        reasonText: cancelReason,
        userId: String(req.user?.sub || req.user?.username || 'SYSTEM'),
        ipAddress: req.ip,
      });
    });

    res.json({ id: so.Id, status: 'CANCELLED' });
  } catch (e) { res.status(e.status || 500).json({ message: e.message }); }
});

// ── DELETE /api/so/:id — Permanently remove DRAFT/CANCELLED SO ──
router.delete('/:id', requireRole('SALES', 'ADMIN', 'C_LEVEL'), requireSoInScope, async (req, res) => {
  try {
    const so = await getSoOrThrow(req.params.id);
    if (!['DRAFT', 'CANCELLED'].includes(so.Status))
      return res.status(400).json({ message: `ลบได้เฉพาะบิลร่างหรือยกเลิกแล้ว (ปัจจุบัน: ${so.Status})` });

    const rawDelReasonCode = req.body?.reasonCode;
    const rawDelReasonText = req.body?.reason || req.body?.note;
    const { validateReasonCode, logChangeEvent } = require('../services/policy-contract');

    const reasonDelCheck = await validateReasonCode(null, rawDelReasonCode, rawDelReasonText, 'SO_DELETE');
    if (!reasonDelCheck.valid) {
      return res.status(400).json({ message: reasonDelCheck.error });
    }
    const delReasonCode = reasonDelCheck.reasonCode;
    const delReason = reasonDelCheck.reasonText;

    await wfTransaction(async (tx) => {
      const isWebDraft = !so.ImportedDocuNo;
      if (isWebDraft) {
        // a deleted draft closes its open price approvals (UAT batch 4, SO-14)
        await tx.request().input('id', sql.Int, so.Id)
          .query(`UPDATE wf.PriceApproval SET Status = 'SUPERSEDED', UpdatedAt = SYSUTCDATETIME() WHERE SoId = @id AND Status = 'PENDING'`);
        const reqLine = tx.request();
        reqLine.input('id', sql.Int, so.Id);
        await reqLine.query(`DELETE FROM wf.SalesOrderLine WHERE SoId=@id`);

        const reqSo = tx.request();
        reqSo.input('id', sql.Int, so.Id);
        await reqSo.query(`DELETE FROM wf.SalesOrder WHERE Id=@id`);
      } else {
        const reqSohd = tx.request();
        reqSohd.input('id', sql.VarChar(50), String(so.Id));
        await reqSohd.query(`UPDATE dbo.SOHD SET DocuStatus='C' WHERE SOID=@id`);
      }

      const reqGw = tx.request();
      reqGw.input('nt', sql.NVarChar(300), `ตัดโควต้าอัตโนมัติจากบิล ${so.WfRef || so.Id}`);
      await reqGw.query(`DELETE FROM wf.GiveawayWithdrawal WHERE Note = @nt`);

      // Auto-cancel attached coupon reservations
      await tx.request()
        .input('soIdStr', sql.VarChar(50), String(so.Id))
        .input('wfRefStr', sql.VarChar(50), String(so.WfRef || ''))
        .input('rsn', sql.NVarChar(255), String(delReason || 'SO_DELETED'))
        .input('uid', sql.Int, req.user.sub)
        .query(`
          UPDATE wf.CouponReservation
          SET Status = 'CANCELLED',
              CancelledAt = GETUTCDATE(),
              CancelReason = @rsn,
              CancelledBy = @uid,
              UpdatedAt = GETUTCDATE()
          WHERE (CarrierSoId = @soIdStr OR CarrierDocuNo = @wfRefStr)
            AND Status = 'RESERVED'
        `);

      // R9-1: Restore any applied rebate claim back to clean APPROVED status
      try {
        await tx.request()
          .input('soId', sql.Int, Number(so.Id))
          .query(`
            UPDATE wf.RebateClaim
            SET AppliedDraftSoId = NULL,
                Note = RTRIM(ISNULL(Note + ' ', '') + N'[บิลร่างถูกลบ คืนสถานะเคลม]')
            WHERE AppliedDraftSoId = @soId AND Status = 'APPROVED'
          `);
      } catch { /* column may not exist yet */ }

      // ⚠ กฎเหล็ก: ห้ามลบ Audit Trail — บันทึกประวัติการลบและ ChangeEvent เพื่อตรวจสอบย้อนหลังได้เสมอ
      await audit(tx, so.Id, req.user.sub, 'DELETED', so.Status, 'DELETED', delReason, req.ip);

      await logChangeEvent(tx, {
        entityType: 'SALES_ORDER',
        entityId: String(so.Id),
        action: 'DELETE',
        beforeJson: { id: so.Id, wfRef: so.WfRef, status: so.Status },
        afterJson: { deleted: true },
        reasonCode: delReasonCode,
        reasonText: delReason,
        userId: String(req.user?.sub || req.user?.username || 'SYSTEM'),
        ipAddress: req.ip,
      });
    });

    broadcast('so_updated', { id: so.Id, action: 'deleted' });
    res.json({ id: so.Id, deleted: true });
  } catch (e) { res.status(e.status || 500).json({ message: e.message }); }
});

// ── Internal: Book Rebate Accrual ────────────────────────────
// ── Internal: Book Rebate Accrual ────────────────────────────
async function bookRebateAccrual(so, lines, userId) {
  await wfTransaction(async (tx) => {
    // ล็อกแถวด้วย UPDLOCK, HOLDLOCK เพื่อป้องกันการตั้ง Rebate ซ้ำจากคำขอคู่ขนาน (Concurrency Guard)
    const existingLedger = (await tx.request()
      .input('soId', sql.VarChar(50), String(so.Id))
      .query(`SELECT TOP 1 Id FROM wf.RebateLedger WITH (UPDLOCK, HOLDLOCK) WHERE SoId = @soId`)
    ).recordset?.[0];

    if (existingLedger) {
      return;
    }

    // the pool month is the Bangkok business month: on a UTC server a bill shipped before 07:00 on the 1st
    // landed in last month's pool
    const { getBangkokDateString } = require('../services/so-pickup-policy');
    const today = getBangkokDateString();
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));

    // หา/สร้าง RebatePool แบบ Lazy
    let pool = (await tx.request()
      .input('u', sql.Int, userId)
      .input('y', sql.Int, year)
      .input('m', sql.Int, month)
      .query(`SELECT * FROM wf.RebatePool WITH (UPDLOCK, HOLDLOCK) WHERE SalesUserId=@u AND PeriodYear=@y AND PeriodMonth=@m`)
    ).recordset?.[0];

    if (!pool) {
      const pr = await tx.request()
        .input('u', sql.Int, userId)
        .input('y', sql.Int, year)
        .input('m', sql.Int, month)
        .query(`INSERT INTO wf.RebatePool (SalesUserId, PeriodYear, PeriodMonth, AllocatedAmt) OUTPUT inserted.* VALUES (@u,@y,@m,0)`);
      pool = pr.recordset[0];
    }

    for (const l of lines) {
      // R9-2: Coupon and giveaway lines NEVER accrue
      if (l.IsGiveaway || l.IsCouponDrawn || l.CouponReservationId || l.RefCouponDocuNo || l.RefControlTicketNo || l.IsControlTicketDrawn) {
        continue;
      }
      // When no NET is in effect (NULL or 0), accrue 0 and log for Accounting
      if (l.NetPricePerTon === null || l.NetPricePerTon === undefined || Number(l.NetPricePerTon) === 0) {
        console.warn(`[ShipAccrual] No NET floor for SO ${so.Id} line ${l.LineNum || l.Id}, goodId ${l.GoodId}; skipping rebate accrual (0 accrued)`);
        continue;
      }
      const rebatePer = Number(l.PricePerTon) - Number(l.NetPricePerTon);
      if (rebatePer <= 0) continue;
      const rebateAmt = rebatePer * Number(l.QtyTon);

      // FR-008: best-effort match Plan ที่ ACTIVE
      let planId = null, planRegion = null;
      try {
        const plan = (await tx.request()
          .input('gc', sql.NVarChar(50), l.GoodCode || '')
          .query(`SELECT TOP 1 PlanId, Region FROM wf.RebatePlan
                  WHERE Status IN ('APPROVED', 'ACTIVE')
                    AND (GoodCodePattern IS NULL OR @gc LIKE GoodCodePattern + '%')
                    AND (ValidFrom IS NULL OR ValidFrom <= CAST(DATEADD(hour, 7, GETUTCDATE()) AS DATE))
                    AND (ValidTo   IS NULL OR ValidTo   >= CAST(DATEADD(hour, 7, GETUTCDATE()) AS DATE))
                  ORDER BY Priority ASC, PlanId DESC`)
        ).recordset?.[0];
        if (plan) { planId = plan.PlanId; planRegion = plan.Region; }
      } catch { /* keep direct accrual */ }

      await tx.request()
        .input('poolId',   sql.Int,          pool.Id)
        .input('soId',     sql.VarChar(50),  String(so.Id))
        .input('lineId',   sql.Int,          l.Id || l.LineNum || 1)
        .input('custId',   sql.NVarChar(20), String(so.CustId || ''))
        .input('goodId',   sql.NVarChar(20), String(l.GoodId || ''))
        .input('goodCode', sql.NVarChar(50), String(l.GoodCode || ''))
        .input('qty',      sql.Decimal(12,3),Number(l.QtyTon))
        .input('price',    sql.Decimal(12,2),Number(l.PricePerTon))
        .input('net',      sql.Decimal(12,2),Number(l.NetPricePerTon))
        .input('rebPer',   sql.Decimal(10,2),rebatePer)
        .input('rebAmt',   sql.Decimal(12,2),rebateAmt)
        .input('planId',   sql.Int,          planId)
        .input('region',   sql.NVarChar(20), planRegion)
        .query(`
          INSERT INTO wf.RebateLedger
            (PoolId, SoId, SoLineId, CustId, GoodId, GoodCode, QtyTon, PricePerTon, NetPricePerTon, RebatePerTon, RebateAmount, RemainingAmt, Status, PlanId, Region)
          VALUES (@poolId, @soId, @lineId, @custId, @goodId, @goodCode, @qty, @price, @net, @rebPer, @rebAmt, @rebAmt, 'PENDING', @planId, @region)
        `);

      await tx.request()
        .input('soId', sql.VarChar(50), String(so.Id))
        .input('listNo', sql.Int, l.LineNum || l.ListNo || 1)
        .query(`UPDATE wf.SalesOrderLineExt SET RebateBooked=1 WHERE SOID=@soId AND ListNo=@listNo`);

      await tx.request()
        .input('amt', sql.Decimal(12,2), rebateAmt)
        .input('id', sql.Int, pool.Id)
        .query(`UPDATE wf.RebatePool SET AccruedAmt = AccruedAmt + @amt, UpdatedAt=GETUTCDATE() WHERE Id=@id`);
    }
  });
}

// ── Internal: Consume Rebate (FIFO) ──────────────────────────
module.exports = router;
