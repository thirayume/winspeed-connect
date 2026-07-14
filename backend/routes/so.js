/**
 * so.js — wf.SalesOrder state machine
 * DRAFT → CONFIRMED → PICKING → SHIPPED → IMPORTED | CANCELLED
 *
 * ⚠ ไม่มีการเขียน dbo ใดๆ — writes ไปที่ wf schema เท่านั้น
 */
const router = require('express').Router();
const { sql, wfQuery, wfTransaction, getTarget } = require('../db');
const { requireAuth, requireRole, requireRebateAmountAccess, canViewRebateAmounts } = require('../middleware/auth');
const { generateImportFiles } = require('../services/winspeed-import.service');
const { broadcast } = require('../services/socket');
const { enqueue } = require('../services/outbox');
const { resolveApprovalPolicy } = require('../services/approval');

router.use(requireAuth);

// PascalCase → camelCase (DB คอลัมน์เป็น PascalCase, frontend type เป็น camelCase)
const camel = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const camelizeRow = (row) => {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[camel(k)] = v;
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
  if (expectedStatus && so.Status !== expectedStatus)
    throw Object.assign(new Error(`SO ต้องอยู่ใน ${expectedStatus} (ปัจจุบัน: ${so.Status})`), { status: 400 });
  return so;
}

async function getLines(soId) {
  const isString = typeof soId === 'string' && isNaN(Number(soId));
  const idValue = isString ? soId : Number(soId);
  const idCol = isString ? 'SoId' : 'CAST(SoId AS INT)';
  const idType = isString ? sql.VarChar(50) : sql.Int;

  const r = await wfQuery(
    `SELECT * FROM wf.v_AllSalesOrderLines WHERE ${idCol} = @soId ORDER BY LineNum`,
    { soId: { type: idType, value: idValue } }
  );
  return r.recordset || [];
}

// audit — เขียน log การเปลี่ยนสถานะ (immutable). ไม่ผูก transaction เพื่อความเรียบง่าย
async function audit(_tx, soId, userId, action, fromStatus, toStatus, note, ipAddress) {
  await wfQuery(
    `INSERT INTO wf.SalesOrderAudit (SoId, UserId, Action, FromStatus, ToStatus, Note, IpAddress)
     VALUES (@soId, @userId, @action, @fromStatus, @toStatus, @note, @ip)`,
    {
      soId:       { type: sql.VarChar(50),  value: String(soId) },
      userId:     { type: sql.Int,          value: userId },
      action:     { type: sql.NVarChar(50), value: action },
      fromStatus: { type: sql.NVarChar(20), value: fromStatus || null },
      toStatus:   { type: sql.NVarChar(20), value: toStatus || null },
      note:       { type: sql.NVarChar(500),value: note || null },
      ip:         { type: sql.NVarChar(45), value: ipAddress || null },
    }
  );
}

// ── GET /api/so/stats — สรุปจำนวนตามสถานะ (Dashboard) ────────
// Cache 5 นาที เพื่อลด load จาก 107k rows scan บน dbo.SOHD
let _statsCache = null;
let _statsCacheAt = 0;
const STATS_TTL = 5 * 60 * 1000;

router.delete('/stats/cache', requireRole('ADMIN'), (req, res) => {
  _statsCache = null; _statsCacheAt = 0;
  res.json({ ok: true, message: 'Stats cache cleared' });
});

router.get('/stats', async (req, res) => {
  try {
    const now = Date.now();
    const bust = req.query.bust === '1';
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
              WHEN ext.WeighOutWeight IS NOT NULL THEN 'SHIPPED'
              WHEN hd.DocuType = 104 THEN 'IMPORTED'
              WHEN ext.IsLoaded = 1 THEN 'LOADED'
              WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
              WHEN hd.DocuType = 103 AND ISNULL(hd.DocuStatus, 'N') = 'N' THEN 'DRAFT'
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
              WHEN ext.WeighOutWeight IS NOT NULL THEN 'SHIPPED'
              WHEN hd.DocuType = 104 THEN 'IMPORTED'
              WHEN ext.IsLoaded = 1 THEN 'LOADED'
              WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
              WHEN hd.DocuType = 103 AND ISNULL(hd.DocuStatus, 'N') = 'N' THEN 'DRAFT'
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
          so.ImportedAt
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
            WHEN ext.WeighOutWeight IS NOT NULL THEN 'SHIPPED'
            WHEN hd.DocuType = 104 THEN 'IMPORTED'
            WHEN ext.IsLoaded = 1 THEN 'LOADED'
            WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
            WHEN hd.DocuType = 103 AND ISNULL(hd.DocuStatus, 'N') = 'N' THEN 'DRAFT'
            ELSE 'CONFIRMED'
          END AS Status,
          hd.DocuNo AS ImportedDocuNo,
          CAST(hd.DocuDate AS DATETIME2) AS CreatedAt,
          ext.DeliveryDate,
          ext.RequestedAt,
          ext.ImportedAt
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
          pq.Id AS LinkedQuoteId,
          pq.QuoteNo AS LinkedQuoteNo,
          pq.Status AS LinkedQuoteStatus,
          pq.Remark AS LinkedQuoteRemark,
          pq.ValidUntil AS LinkedQuoteValidUntil,
          CASE WHEN pq.Id IS NOT NULL THEN CONCAT('Waiting for quotation ', pq.QuoteNo, ' confirmation') ELSE NULL END AS QuotationLockReason
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
            WHEN ext.WeighOutWeight IS NOT NULL THEN 'SHIPPED'
            WHEN hd.DocuType = 104 THEN 'IMPORTED'
            WHEN ext.IsLoaded = 1 THEN 'LOADED'
            WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
            WHEN hd.DocuType = 103 AND ISNULL(hd.DocuStatus, 'N') = 'N' THEN 'DRAFT'
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
          pq.Id AS LinkedQuoteId,
          pq.QuoteNo AS LinkedQuoteNo,
          pq.Status AS LinkedQuoteStatus,
          pq.Remark AS LinkedQuoteRemark,
          pq.ValidUntil AS LinkedQuoteValidUntil,
          CASE WHEN pq.Id IS NOT NULL THEN CONCAT('Waiting for quotation ', pq.QuoteNo, ' confirmation') ELSE NULL END AS QuotationLockReason
        FROM dbo.SOHD hd WITH (NOLOCK)
        LEFT JOIN wf.SalesOrderExt ext WITH (NOLOCK)
          ON CONVERT(VARCHAR(50), ext.SOID) = CONVERT(VARCHAR(50), hd.SOID)
        OUTER APPLY (
          SELECT TOP 1 q.Id, q.QuoteNo, q.Status, q.Remark, q.ValidUntil
          FROM wf.QuotationSourceSO src WITH (NOLOCK)
          INNER JOIN wf.Quotation q WITH (NOLOCK) ON q.Id = src.QuoteId
          WHERE src.SoId = CASE
              WHEN ISNUMERIC(CONVERT(VARCHAR(50), hd.SOID)) = 1 THEN CAST(hd.SOID AS INT)
              ELSE NULL
            END
            AND q.Status IN ('DRAFT', 'SENT', 'EXPIRED')
          ORDER BY q.Id DESC
        ) pq
        WHERE hd.DocuType IN (103, 104)
      )
      SELECT q.*, u.DisplayName AS SalesName
      FROM Orders q
      LEFT JOIN wf.AppUser u WITH (NOLOCK) ON u.Id = q.SalesUserId
      ${where}
      ORDER BY q.CreatedAt DESC, q.Id DESC
      OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY
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
router.get('/unlock-requests', requireRole('APPROVER', 'ADMIN', 'MANAGER', 'ACCOUNTING'), async (req, res) => {
  try {
    const { status } = req.query;
    const where = status ? 'WHERE r.Status=@st' : '';
    const inputs = status ? { st: { type: sql.NVarChar(20), value: status } } : {};
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
router.patch('/unlock-requests/:reqId/resolve', requireRole('APPROVER', 'ADMIN', 'MANAGER', 'ACCOUNTING'), async (req, res) => {
  try {
    const { approve, note } = req.body || {};
    const reqRow = (await wfQuery(`SELECT * FROM wf.UnlockRequest WHERE Id=@id`,
      { id: { type: sql.Int, value: Number(req.params.reqId) } })).recordset[0];
    if (!reqRow) return res.status(404).json({ message: 'ไม่พบคำขอ' });
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
router.get('/:id/weigh', async (req, res) => {
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
    res.json(redactSoForRole(req, {
      ...camelizeRow(so),
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
// PATCH /api/so/:id/giveaway-lines/:lineNum/approve — manager approval for giveaway line
router.patch('/:id/giveaway-lines/:lineNum/approve', requireRole('MANAGER', 'ADMIN'), async (req, res) => {
  try {
    if (!(await hasGiveawayApprovalColumns())) {
      return res.status(400).json({ message: 'ยังไม่ได้ apply migration สำหรับอนุมัติของแถมรายบรรทัด' });
    }
    const so = await getSoOrThrow(req.params.id);
    const lineNum = Number(req.params.lineNum);
    const note = req.body?.note || null;
    const isDraft = so.Status === 'DRAFT';
    const targetTable = isDraft ? 'wf.SalesOrderLine' : 'wf.SalesOrderLineExt';
    const idColumn = isDraft ? 'SoId' : 'SOID';
    const lineColumn = isDraft ? 'LineNum' : 'ListNo';
    const idType = isDraft ? sql.Int : sql.VarChar(50);
    const idValue = isDraft ? Number(so.Id) : String(so.Id);

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

router.post('/', requireRole('SALES', 'COUNTER_SALES', 'ADMIN'), async (req, res) => {
  try {
    const orders = Array.isArray(req.body) ? req.body : [req.body];
    if (orders.length === 0) return res.status(400).json({ message: 'ไม่มีข้อมูลคำสั่งซื้อ' });

    for (const order of orders) {
      if (!order.custId || !order.lines?.length) return res.status(400).json({ message: 'custId และ lines จำเป็น' });
      if (!['I', 'K', 'AI'].includes(order.soPrefix)) return res.status(400).json({ message: 'soPrefix ต้องเป็น I / K / AI' });
    }

    const createdIds = [];
    const createdRefs = [];
    let anyNeedsApproval = false;

    await wfTransaction(async tx => {
      for (const order of orders) {
        const { soPrefix, custId, custName, controlTicketNo, deliveryDate, requestedAt, isOwnTruck, noTruckRequired, pSling, remark, lines, salesUserId: impersonatedId, rebateDiscountAmt, convertFromQuoteId, creditDays, truckRemark, billRemark, transpId } = order;
        const truckPlate = ['I', 'K'].includes(soPrefix) ? 'ตั๋วคุม' : (order.truckPlate || null);

        // price deviation check
        const devLine = lines.find(l => !l.isGiveaway && (Number(l.pricePerTon) < Number(l.netPricePerTon) - 500));
        const needsApproval = !!devLine;
        if (needsApproval) anyNeedsApproval = true;

        // generate WfRef
        const seqR = await tx.request().query(`SELECT NEXT VALUE FOR wf.WfRefSeq AS Seq`);
        const seq = String(seqR.recordset[0].Seq).padStart(5, '0');
        const yy = (new Date().getFullYear() + 543 - 2500).toString().slice(-2);
        const wfRef = `${soPrefix}${yy}-${seq}`;

        const soReq = tx.request();
        soReq.input('wfRef',            sql.NVarChar(30),  wfRef);
        soReq.input('soPrefix',         sql.NVarChar(5),   soPrefix);
        soReq.input('custId',           sql.NVarChar(20),  custId);
        soReq.input('custName',         sql.NVarChar(200), custName || '');
        soReq.input('truckPlate',       sql.NVarChar(30),  truckPlate || null);
        soReq.input('controlTicketNo',  sql.NVarChar(20),  controlTicketNo || null);
        soReq.input('deliveryDate',     sql.Date,          deliveryDate ? new Date(deliveryDate) : null);
        soReq.input('requestedAt',      sql.DateTime2,     toSqlDateTime(requestedAt));
        soReq.input('isOwnTruck',       sql.Bit,           toBit(isOwnTruck));
        soReq.input('noTruckRequired',  sql.Bit,           toBit(noTruckRequired));
        soReq.input('pSling',           sql.Bit,           toBit(pSling));
        soReq.input('remark',           sql.NVarChar(500), remark || null);
        soReq.input('rebateDiscountAmt', sql.Decimal(12,2), normalizeRebateDiscount(req, rebateDiscountAmt));
        const actualSalesUserId = (req.user.role === 'ADMIN' && impersonatedId) ? Number(impersonatedId) : req.user.sub;
        soReq.input('salesUserId',      sql.Int,           actualSalesUserId);
        soReq.input('creditDays',       sql.Int,           creditDays || 30);
        soReq.input('truckRemark',      sql.NVarChar(500), truckRemark || null);
        soReq.input('billRemark',       sql.NVarChar(500), billRemark || null);
        soReq.input('transpId',         sql.Int,           transpId || null);

        const soR = await soReq.query(`
          INSERT INTO wf.SalesOrder
            (WfRef, SoPrefix, CustId, CustName, TruckPlate, ControlTicketNo, DeliveryDate, RequestedAt, IsOwnTruck, NoTruckRequired, PSling, Remark, SalesUserId, RebateDiscountAmt, Status, CreditDays, TruckRemark, BillRemark, TranspId)
            OUTPUT inserted.Id
          VALUES (@wfRef, @soPrefix, @custId, @custName, @truckPlate, @controlTicketNo, @deliveryDate, @requestedAt, @isOwnTruck, @noTruckRequired, @pSling, @remark, @salesUserId, @rebateDiscountAmt, 'DRAFT', @creditDays, @truckRemark, @billRemark, @transpId)
        `);
        const soId = soR.recordset[0].Id;
        createdIds.push(soId);
        createdRefs.push(wfRef);

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
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          const lr = tx.request();
          lr.input('soId',                 sql.Int,           soId);
          lr.input('lineNum',              sql.Int,           i + 1);
          lr.input('goodId',               sql.NVarChar(20),  l.goodId);
          lr.input('goodName',             sql.NVarChar(200), l.goodName || '');
          lr.input('goodCode',             sql.NVarChar(50),  l.goodCode || '');
          lr.input('qtyTon',               sql.Decimal(12,3), Number(l.qtyTon));
          lr.input('qtyBag',               sql.Int,           Number(l.qtyBag) || Math.round(l.qtyTon * 20));
          lr.input('masterQty',            sql.Decimal(12,3), l.masterQty === undefined || l.masterQty === null ? Number(l.qtyTon) : Number(l.masterQty));
          lr.input('childQty',             sql.Decimal(12,3), l.childQty === undefined || l.childQty === null ? 0 : Number(l.childQty));
          lr.input('pricePerTon',          sql.Decimal(12,2), Number(l.pricePerTon));
          lr.input('netPricePerTon',       sql.Decimal(12,2), Number(l.netPricePerTon) || 0);
          lr.input('isGiveaway',           sql.Bit,           l.isGiveaway ? 1 : 0);
          lr.input('refControlTicketNo',   sql.NVarChar(30),  l.refControlTicketNo || null);
          lr.input('isControlTicketDrawn', sql.Bit,           l.isControlTicketDrawn ? 1 : 0);
          addGiveawayApprovalInputs(lr, req, l, hasGiveawayApproval);
          
          await lr.query(`
            INSERT INTO wf.SalesOrderLine
              (SoId, LineNum, GoodId, GoodName, GoodCode, QtyTon, QtyBag, MasterQty, ChildQty, PricePerTon, NetPricePerTon, IsGiveaway, RefControlTicketNo, IsControlTicketDrawn${giveawayApprovalInsertColumns(hasGiveawayApproval)})
            VALUES (@soId, @lineNum, @goodId, @goodName, @goodCode, @qtyTon, @qtyBag, @masterQty, @childQty, @pricePerTon, @netPricePerTon, @isGiveaway, @refControlTicketNo, @isControlTicketDrawn${giveawayApprovalInsertValues(hasGiveawayApproval)})
          `);
        }
      }
    });

    for (const soId of createdIds) {
      await audit(null, soId, req.user.sub, 'CREATED', null, 'DRAFT', null, req.ip);
    }

    // For backwards compatibility, if they sent an array, return array format. Otherwise return single object format.
    if (Array.isArray(req.body)) {
      res.json({ ids: createdIds, wfRefs: createdRefs, needsApproval: anyNeedsApproval });
    } else {
      res.json({ id: createdIds[0], wfRef: createdRefs[0], needsApproval: anyNeedsApproval });
    }
  } catch (e) { console.error(e); res.status(e.status || 500).json({ message: e.message }); }
});

// ── PUT /api/so/:id — Update existing DRAFT SO ──
router.put('/:id', requireRole('SALES', 'COUNTER_SALES', 'ADMIN'), async (req, res) => {
  try {
    const so = await getSoOrThrow(req.params.id, 'DRAFT');
    const order = req.body;
    
    if (!order.custId) return res.status(400).json({ message: 'ต้องระบุข้อมูลลูกค้า (custId)' });
    if (!order.lines?.length) return res.status(400).json({ message: 'ต้องมีรายการสินค้าอย่างน้อย 1 รายการ' });
    if (!['I', 'K', 'AI'].includes(order.soPrefix)) return res.status(400).json({ message: 'soPrefix ต้องเป็น I / K / AI' });

    let needsApproval = false;

    // Check if it's an SOHD order by checking if it came from WINSpeed
    const isSohdOrder = !!so.ImportedDocuNo;

      if (isSohdOrder) {
      await wfTransaction(async tx => {
        const { soPrefix, custId, custName, controlTicketNo, deliveryDate, requestedAt, isOwnTruck, noTruckRequired, pSling, remark, lines, rebateDiscountAmt, creditDays, truckRemark, billRemark, transpId } = order;
        const truckPlate = ['I', 'K'].includes(soPrefix) ? 'ตั๋วคุม' : (order.truckPlate || null);
        const safeRebateDiscountAmt = normalizeRebateDiscount(req, rebateDiscountAmt);
        const totalAmnt = lines.reduce((sum, l) => sum + (Number(l.qtyTon) * Number(l.pricePerTon)), 0) - safeRebateDiscountAmt;

        const soReq = tx.request();
        soReq.input('id', sql.VarChar(50), so.Id);
        soReq.input('soPrefix', sql.NVarChar(5), soPrefix);
        soReq.input('custId', sql.NVarChar(20), custId);
        soReq.input('custName', sql.NVarChar(200), custName || '');
        soReq.input('truckPlate', sql.NVarChar(30), truckPlate || null);
        soReq.input('controlTicketNo', sql.NVarChar(20), controlTicketNo || null);
        soReq.input('deliveryDate', sql.Date, deliveryDate ? new Date(deliveryDate) : null);
        soReq.input('requestedAt', sql.DateTime2, toSqlDateTime(requestedAt));
        soReq.input('isOwnTruck', sql.Bit, toBit(isOwnTruck));
        soReq.input('noTruckRequired', sql.Bit, toBit(noTruckRequired));
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
          lr.input('goodId', sql.NVarChar(20), l.goodId);
          lr.input('goodName', sql.NVarChar(200), l.goodName || '');
          lr.input('qtyTon', sql.Decimal(12,3), Number(l.qtyTon));
          lr.input('masterQty', sql.Decimal(12,3), l.masterQty === undefined || l.masterQty === null ? Number(l.qtyTon) : Number(l.masterQty));
          lr.input('childQty', sql.Decimal(12,3), l.childQty === undefined || l.childQty === null ? 0 : Number(l.childQty));
          lr.input('pricePerTon', sql.Decimal(12,2), Number(l.pricePerTon));
          lr.input('netPricePerTon', sql.Decimal(12,2), Number(l.netPricePerTon) || 0);
          lr.input('isGiveaway', sql.Bit, l.isGiveaway ? 1 : 0);
          lr.input('freeFlag', sql.NVarChar(1), l.isGiveaway ? 'Y' : 'N');
          lr.input('refControlTicketNo', sql.NVarChar(30), l.refControlTicketNo || null);
          lr.input('isControlTicketDrawn', sql.Bit, l.isControlTicketDrawn ? 1 : 0);
          addGiveawayApprovalInputs(lr, req, l, hasGiveawayApproval);

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
              0, 0, 0, @qtyTon * @pricePerTon,
              0, h.ShipDate, 0, 0, 0, 0, 0, @qtyTon * @pricePerTon,
              '103', 'N', 'N', '1', COALESCE(g.VatType, '3'), '-1', 'G',
              @qtyTon, 0, @freeFlag, 1, COALESCE(g.MainGoodUnitID, 1002), @qtyTon,
              0, @qtyTon, 0, @qtyTon, @qtyTon, 'N', 'N',
              0, @qtyTon * @pricePerTon, 'Y', @masterQty, @childQty
            FROM dbo.EMGood g
            CROSS JOIN dbo.SOHD h
            WHERE g.GoodID = @goodId AND h.SOID = @soId;

            INSERT INTO dbo.SODTRemark (SOID, ListNo, RefListNo, Remark)
            SELECT @soId, @lineNum, @lineNum, COALESCE(NULLIF(@goodName, ''), g.GoodName1)
            FROM dbo.EMGood g
            WHERE g.GoodID = @goodId;

            INSERT INTO wf.SalesOrderLineExt (SOID, ListNo, NetPricePerTon, IsGiveaway, RebateBooked, RefControlTicketNo, IsControlTicketDrawn, MasterQty, ChildQty${giveawayApprovalInsertColumns(hasGiveawayApproval)})
            VALUES (@soId, @lineNum, @netPricePerTon, @isGiveaway, 0, @refControlTicketNo, @isControlTicketDrawn, @masterQty, @childQty${giveawayApprovalInsertValues(hasGiveawayApproval)});
          `);
        }
      });
      await audit(null, so.Id, req.user.sub, 'UPDATED', 'DRAFT', 'DRAFT', null, req.ip);
      broadcast('so_updated', { id: so.Id, action: 'updated' });
      return res.json({ id: so.Id, wfRef: so.WfRef, needsApproval: false });
    }

    await wfTransaction(async tx => {
      const { soPrefix, custId, custName, controlTicketNo, deliveryDate, requestedAt, isOwnTruck, noTruckRequired, pSling, remark, lines, rebateDiscountAmt, creditDays, truckRemark, billRemark, transpId } = order;
      const truckPlate = ['I', 'K'].includes(soPrefix) ? 'ตั๋วคุม' : (order.truckPlate || null);

      // price deviation check
      const devLine = lines.find(l => !l.isGiveaway && (Number(l.pricePerTon) < Number(l.netPricePerTon) - 500));
      needsApproval = !!devLine;

      const yy = (new Date().getFullYear() + 543 - 2500).toString().slice(-2);
      // Extract the sequence number from the existing WfRef (e.g. 'WF69I-00001' or 'I69-00001' -> '00001')
      const seqMatch = so.WfRef ? so.WfRef.match(/-(\d+)$/) : null;
      const seq = seqMatch ? seqMatch[1] : '00001';
      const newWfRef = `${soPrefix}${yy}-${seq}`;

      const soReq = tx.request();
      soReq.input('id',                sql.Int,           so.Id);
      soReq.input('soPrefix',          sql.NVarChar(5),   soPrefix);
      soReq.input('wfRef',             sql.NVarChar(30),  newWfRef);
      soReq.input('custId',            sql.NVarChar(20),  custId);
      soReq.input('custName',          sql.NVarChar(200), custName || '');
      soReq.input('truckPlate',        sql.NVarChar(30),  truckPlate || null);
      soReq.input('controlTicketNo',   sql.NVarChar(20),  controlTicketNo || null);
      soReq.input('deliveryDate',      sql.Date,          deliveryDate ? new Date(deliveryDate) : null);
      soReq.input('requestedAt',       sql.DateTime2,     toSqlDateTime(requestedAt));
      soReq.input('isOwnTruck',        sql.Bit,           toBit(isOwnTruck));
      soReq.input('noTruckRequired',   sql.Bit,           toBit(noTruckRequired));
      soReq.input('pSling',            sql.Bit,           toBit(pSling));
      soReq.input('remark',            sql.NVarChar(500), remark || null);
      soReq.input('rebateDiscountAmt', sql.Decimal(12,2), normalizeRebateDiscount(req, rebateDiscountAmt));
      soReq.input('creditDays',        sql.Int,           creditDays || 30);
      soReq.input('truckRemark',       sql.NVarChar(500), truckRemark || null);
      soReq.input('billRemark',        sql.NVarChar(500), billRemark || null);
      soReq.input('transpId',          sql.Int,           transpId || null);

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
          UpdatedAt = GETUTCDATE()
        WHERE Id = @id
      `);

      // Delete existing lines
      await tx.request().input('id', sql.Int, so.Id).query(`DELETE FROM wf.SalesOrderLine WHERE SoId = @id`);

      // Insert new lines
      const hasGiveawayApproval = await hasGiveawayApprovalColumns();
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const lr = tx.request();
        lr.input('soId',                 sql.Int,           so.Id);
        lr.input('lineNum',              sql.Int,           i + 1);
        lr.input('goodId',               sql.NVarChar(20),  l.goodId);
        lr.input('goodName',             sql.NVarChar(200), l.goodName || '');
        lr.input('goodCode',             sql.NVarChar(50),  l.goodCode || '');
        lr.input('qtyTon',               sql.Decimal(12,3), Number(l.qtyTon));
        lr.input('qtyBag',               sql.Int,           Number(l.qtyBag) || Math.round(l.qtyTon * 20));
        lr.input('masterQty',            sql.Decimal(12,3), l.masterQty === undefined || l.masterQty === null ? Number(l.qtyTon) : Number(l.masterQty));
        lr.input('childQty',             sql.Decimal(12,3), l.childQty === undefined || l.childQty === null ? 0 : Number(l.childQty));
        lr.input('pricePerTon',          sql.Decimal(12,2), Number(l.pricePerTon));
        lr.input('netPricePerTon',       sql.Decimal(12,2), Number(l.netPricePerTon) || 0);
        lr.input('isGiveaway',           sql.Bit,           l.isGiveaway ? 1 : 0);
        lr.input('refControlTicketNo',   sql.NVarChar(30),  l.refControlTicketNo || null);
        lr.input('isControlTicketDrawn', sql.Bit,           l.isControlTicketDrawn ? 1 : 0);
        addGiveawayApprovalInputs(lr, req, l, hasGiveawayApproval);
        
        await lr.query(`
          INSERT INTO wf.SalesOrderLine
            (SoId, LineNum, GoodId, GoodName, GoodCode, QtyTon, QtyBag, MasterQty, ChildQty, PricePerTon, NetPricePerTon, IsGiveaway, RefControlTicketNo, IsControlTicketDrawn${giveawayApprovalInsertColumns(hasGiveawayApproval)})
          VALUES (@soId, @lineNum, @goodId, @goodName, @goodCode, @qtyTon, @qtyBag, @masterQty, @childQty, @pricePerTon, @netPricePerTon, @isGiveaway, @refControlTicketNo, @isControlTicketDrawn${giveawayApprovalInsertValues(hasGiveawayApproval)})
        `);
      }
    });

    await audit(null, so.Id, req.user.sub, 'UPDATED', 'DRAFT', 'DRAFT', null, req.ip);
    broadcast('so_updated', { id: so.Id, action: 'updated' });
    res.json({ id: so.Id, wfRef: newWfRef, needsApproval });
  } catch (e) { console.error(e); res.status(e.status || 500).json({ message: e.message }); }
});

// ── PATCH /api/so/:id/confirm ────────────────────────────────
// ── PATCH /api/so/:id/verify — Counter-Sales ตรวจซ้ำ (FR-022) ─────
router.patch('/:id/verify', requireRole('COUNTER_SALES', 'ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const so = await getSoOrThrow(req.params.id, 'DRAFT');
    await wfQuery(`UPDATE wf.SalesOrder SET VerifiedBy=@uid, VerifiedAt=GETUTCDATE() WHERE Id=@id`,
      { uid: { type: sql.Int, value: req.user.sub }, id: { type: sql.Int, value: so.Id } });
    await audit(null, so.Id, req.user.sub, 'VERIFIED', 'DRAFT', 'DRAFT', null, req.ip);
    broadcast('so_updated', { id: so.Id, action: 'verified' });
    res.json({ id: so.Id, verified: true });
  } catch (e) { res.status(e.status || 500).json({ message: e.message }); }
});

router.patch('/:id/confirm', requireRole('SALES', 'COUNTER_SALES', 'ADMIN'), async (req, res) => {
  try {
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

    const isSohdOrder = (await wfQuery(`SELECT SOID FROM wf.SalesOrderExt WHERE SOID=@id`, { id: { type: sql.VarChar(50), value: String(req.params.id) } })).recordset.length > 0;
    
    if (isSohdOrder) {
      await wfQuery(`UPDATE wf.SalesOrderExt SET IsUnlocked=0 WHERE SOID=@id`, { id: { type: sql.VarChar(50), value: req.params.id } });
      await audit(null, req.params.id, req.user.sub, 'CONFIRMED', 'DRAFT', 'CONFIRMED', null, req.ip);
      broadcast('so_updated', { id: req.params.id, action: 'confirmed' });
      return res.json({ id: req.params.id, status: 'CONFIRMED' });
    }

    const so = await getSoOrThrow(req.params.id, 'DRAFT');

    if (await hasQuoteSourceTable()) {
      const pendingQuote = (await wfQuery(`
        SELECT TOP 1 q.Id, q.QuoteNo, q.Status
        FROM wf.QuotationSourceSO src
        INNER JOIN wf.Quotation q ON q.Id = src.QuoteId
        WHERE src.SoId = @soId
          AND q.Status IN ('DRAFT', 'SENT', 'EXPIRED')
          AND NOT EXISTS (
            SELECT 1
            FROM wf.QuotationSourceSO acceptedSrc
            INNER JOIN wf.Quotation acceptedQ ON acceptedQ.Id = acceptedSrc.QuoteId
            WHERE acceptedSrc.SoId = @soId
              AND acceptedQ.Status = 'ACCEPTED'
          )
        ORDER BY q.Id DESC
      `, { soId: { type: sql.Int, value: so.Id } })).recordset?.[0];

      if (pendingQuote) {
        return res.status(400).json({
          message: `SO ${so.WfRef || so.Id} อยู่ในใบเสนอราคา ${pendingQuote.QuoteNo} (${pendingQuote.Status}) ต้องยืนยันใบเสนอราคาก่อนจึงจะ Confirm SO ได้`,
          requiresQuotationAccepted: true,
          quoteId: pendingQuote.Id,
          quoteNo: pendingQuote.QuoteNo,
          quoteStatus: pendingQuote.Status,
        });
      }
    }

    // FR-022 Verification Gate: ต้องตรวจซ้ำ (Counter-Sales) ก่อนยืนยัน (ADMIN bypass ได้)
    if (req.user.role !== 'ADMIN') {
      const vr = await wfQuery(`SELECT VerifiedAt FROM wf.SalesOrder WHERE Id=@id`, { id: { type: sql.Int, value: so.Id } });
      if (!vr.recordset?.[0]?.VerifiedAt)
        return res.status(400).json({ message: 'ต้องตรวจซ้ำ (Counter-Sales) ก่อนยืนยัน — กดปุ่ม “ตรวจแล้ว” ก่อน (FR-022)' });
    }

    const lines = await getLines(so.Id);

    if (await hasGiveawayApprovalColumns()) {
      const pendingGiveaway = lines.find(l => l.IsGiveaway && l.GiveawayApprovalStatus !== 'APPROVED');
      if (pendingGiveaway) {
        return res.status(400).json({
          message: `รายการของแถมบรรทัด ${pendingGiveaway.LineNum} ยังไม่ได้รับอนุมัติจากผู้จัดการ`,
          requiresApproval: true,
          approvalType: 'GIVEAWAY',
        });
      }
    }

    // FR-003 Credit Hold: ถ้าลูกค้าถูก hold → ต้อง override โดย role ตามนโยบาย CREDIT_OVERRIDE
    const credit = (await wfQuery(`SELECT CreditHold FROM wf.CreditMaster WHERE CustId=@c`,
      { c: { type: sql.NVarChar(20), value: String(so.CustId) } })).recordset[0];
    if (credit?.CreditHold) {
      const pol = await resolveApprovalPolicy('CREDIT_OVERRIDE');
      const allowed = req.user.role === 'ADMIN' || (pol && req.user.role === pol.RequiredRole);
      if (!allowed)
        return res.status(400).json({ message: `ลูกค้าถูกระงับเครดิต (Credit Hold) — ต้องอนุมัติโดย ${pol?.RequiredRole || 'ผจก.'} ก่อน (FR-003)`, requiresApproval: true });
    }

    // Get the RebateDiscountAmt from draft table
    const rAmt = await wfQuery(`SELECT ISNULL(RebateDiscountAmt, 0) AS RebateDiscountAmt FROM wf.SalesOrder WHERE Id = @id`, { id: { type: sql.Int, value: so.Id } });
    const rebateDiscountAmt = rAmt.recordset[0]?.RebateDiscountAmt || 0;

    // ตรวจ price deviation: ราคาขาย < NET - 500 → block
    const devLine = lines.find(l => !l.IsGiveaway && (Number(l.PricePerTon) < Number(l.NetPricePerTon) - 500));
    if (devLine) {
      return res.status(400).json({
        message: `ราคาต่ำกว่า NET เกิน 500 บาท/ตัน (${devLine.GoodCode}: ฿${devLine.PricePerTon} vs NET ฿${devLine.NetPricePerTon}) — ต้องอนุมัติจาก ผจก. 3 ท่านก่อน`,
        requiresApproval: true
      });
    }

    // 1. เรียก Stored Procedure เพื่อย้ายข้อมูลจาก wf.SalesOrder ไป SOHD (Winspeed)
    const activePool = require('../db').pools().ownerPool;
    const spReq = activePool.request();
    spReq.input('SoId', sql.Int, so.Id);
    spReq.output('NewSoid', sql.VarChar(50));
    const spRes = await spReq.execute('wf.sp_ConfirmSalesOrder');
    
    const newSoid = spRes.output.NewSoid;
    if (!newSoid) throw new Error('ย้ายข้อมูลไปยัง Winspeed ไม่สำเร็จ (ไม่ได้ SOID กลับมา)');

    if (await hasQuoteSourceTable()) {
      await wfQuery(`
        UPDATE q
        SET q.Status = 'CONVERTED',
            q.ConvertedSoId = COALESCE(q.ConvertedSoId, @sourceSoId),
            q.UpdatedAt = GETUTCDATE()
        FROM wf.Quotation q
        WHERE q.Status = 'ACCEPTED'
          AND EXISTS (
            SELECT 1
            FROM wf.QuotationSourceSO src
            WHERE src.QuoteId = q.Id
              AND src.SoId = @sourceSoId
          )
          AND NOT EXISTS (
            SELECT 1
            FROM wf.QuotationSourceSO src
            LEFT JOIN wf.SalesOrder draftSo ON draftSo.Id = src.SoId
            WHERE src.QuoteId = q.Id
              AND draftSo.Status = 'DRAFT'
          )
      `, { sourceSoId: { type: sql.Int, value: so.Id } });
    }

    // 2. (Moved to SHIPPED) ตั้ง Rebate accrual
    // await bookRebateAccrual({ ...so, Id: newSoid }, lines, req.user.sub);

    // 2.5 Consume Rebate (FIFO)
    if (rebateDiscountAmt > 0) {
      await consumeRebateAccrual(so.CustId, newSoid, rebateDiscountAmt);
    }

    // 3. Audit log (บันทึกโดยใช้ newSoid)
    await audit(null, newSoid, req.user.sub, 'CONFIRMED', 'DRAFT', 'CONFIRMED', null, req.ip);
    // FR-029 outbox: reliable integration event (idempotent ต่อ SO)
    await enqueue('SO_CONFIRMED', newSoid, { soId: newSoid, custId: so.CustId, by: req.user.sub }, `SO_CONFIRMED:${newSoid}`);
    res.json({ id: newSoid, status: 'CONFIRMED' });
  } catch (e) { res.status(e.status || 500).json({ message: e.message }); }
});

// ── PATCH /api/so/:id/picking ────────────────────────────────
router.patch('/:id/picking', requireRole('WAREHOUSE', 'ADMIN'), async (req, res) => {
  try {
    const so = await getSoOrThrow(req.params.id, 'CONFIRMED');
    await wfQuery(`UPDATE dbo.SOHD SET PkgStatus='Y' WHERE SOID=@id`, { id: { type: sql.VarChar(50), value: so.Id } });
    await wfQuery(`UPDATE wf.SalesOrderExt SET UpdatedAt=GETUTCDATE() WHERE SOID=@id`, { id: { type: sql.VarChar(50), value: so.Id } });
    await audit(null, so.Id, req.user.sub, 'PICKING', 'CONFIRMED', 'PICKING', null, req.ip);
    res.json({ id: so.Id, status: 'PICKING' });
  } catch (e) { res.status(e.status || 500).json({ message: e.message }); }
});

// ── PATCH /api/so/:id/unlock — APPROVER เท่านั้น (สุรชัย) ─────
router.patch('/:id/unlock', requireRole('APPROVER', 'ADMIN', 'MANAGER', 'ACCOUNTING'), async (req, res) => {
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
    await audit(null, so.Id, req.user.sub, 'UNLOCKED', 'PICKING', 'CONFIRMED', note, req.ip);
    res.json({ id: so.Id, status: 'CONFIRMED' });
  } catch (e) { res.status(e.status || 500).json({ message: e.message }); }
});

// ── POST /api/so/:id/unlock-request — ขอปลดล็อก/ขอแก้ไข/ขอยกเลิก ─────
router.post('/:id/unlock-request', requireRole('SALES', 'COUNTER_SALES', 'WAREHOUSE', 'ADMIN'), async (req, res) => {
  try {
    const so = await getSoOrThrow(req.params.id);
    const { reason, reqType = 'UNLOCK' } = req.body || {};
    if (!reason || String(reason).trim().length < 5)
      return res.status(400).json({ message: 'ต้องระบุเหตุผลอย่างน้อย 5 ตัวอักษร' });
    if (!['UNLOCK', 'EDIT', 'CANCEL'].includes(reqType))
      return res.status(400).json({ message: 'ประเภทคำขอไม่ถูกต้อง' });
      
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
    broadcast('so_updated', { id: so.Id, action: 'unlock_requested' });
    res.json({ id: so.Id, ok: true });
  } catch (e) { res.status(e.status || 500).json({ message: e.message }); }
});

// ── PATCH /api/so/:id/load — ยืนยันการโหลดสินค้า (Warehouse) ─────
router.patch('/:id/load', requireRole('WAREHOUSE', 'ADMIN'), async (req, res) => {
  try {
    const so = await getSoOrThrow(req.params.id, 'PICKING');
    const { sequences } = req.body; // [{ lineNum: 1, seq: 1 }, ...]
    
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
    await audit(null, so.Id, req.user.sub, 'LOADED', 'PICKING', 'LOADED', null, req.ip);
    res.json({ id: so.Id, status: 'LOADED' });
  } catch (e) { console.error(e); res.status(e.status || 500).json({ message: e.message }); }
});

// ── PATCH /api/so/:id/ship — โอนข้อมูลสมบูรณ์ (Scale) ──────
router.patch('/:id/ship', requireRole('WAREHOUSE', 'ADMIN'), async (req, res) => {
  try {
    const so = await getSoOrThrow(req.params.id, 'LOADED');
    const { weighOutWeight, tareKg, scaleNo, movebill } = req.body;
    const gross = weighOutWeight != null ? Number(weighOutWeight) : null;
    const tare  = tareKg != null ? Number(tareKg) : null;
    const net   = (gross != null && tare != null) ? gross - tare : null;

    // ตั้งสถานะว่า SHIPPED ใน Winspeed
    await wfQuery(
      `UPDATE dbo.SOHD SET clearflag='Y', ClearDate=GETDATE() WHERE SOID=@id`,
      { id: { type: sql.VarChar(50), value: so.Id } }
    );
    await wfQuery(
      `UPDATE wf.SalesOrderExt SET WeighOutWeight=@weight, UpdatedAt=GETUTCDATE() WHERE SOID=@id`,
      { id: { type: sql.VarChar(50), value: so.Id }, weight: { type: sql.Decimal(10,2), value: gross } }
    );
    // บันทึก WeighTicket (gross/tare/net) — รากฐาน TruckScale
    await wfQuery(`
      INSERT INTO wf.WeighTicket (SoId, WfRef, TruckPlate, GrossKg, TareKg, NetKg, ScaleNo, WeighOutAt, Status, Movebill, CreatedBy)
      VALUES (@so, @ref, @plate, @gross, @tare, @net, @scale, GETUTCDATE(), 'DONE', @mb, @uid)`,
      {
        so:   { type: sql.NVarChar(50), value: so.Id },
        ref:  { type: sql.NVarChar(30), value: so.WfRef || null },
        plate:{ type: sql.NVarChar(30), value: so.TruckPlate || null },
        gross:{ type: sql.Decimal(10,2), value: gross },
        tare: { type: sql.Decimal(10,2), value: tare },
        net:  { type: sql.Decimal(10,2), value: net },
        scale:{ type: sql.Int, value: scaleNo != null ? Number(scaleNo) : null },
        mb:   { type: sql.NVarChar(50), value: movebill || null },
        uid:  { type: sql.Int, value: req.user.sub },
      });

    // ตั้ง Rebate accrual เมื่อ SHIPPED (เรียกชำระเงินแล้ว)
    const lines = await getLines(so.Id);
    await bookRebateAccrual(so, lines, req.user.sub);
    await audit(null, so.Id, req.user.sub, 'SHIPPED', 'LOADED', 'SHIPPED', null, req.ip);
    broadcast('so_updated', { id: so.Id, action: 'shipped' });
    await enqueue('SO_SHIPPED', so.Id, { soId: so.Id, netKg: net, by: req.user.sub }, `SO_SHIPPED:${so.Id}`);
    res.json({ id: so.Id, status: 'SHIPPED', netKg: net });
  } catch (e) { console.error(e); res.status(e.status || 500).json({ message: e.message }); }
});

// ── PATCH /api/so/:id/sync-imported — เลิกใช้ เพราะเข้า Winspeed อัตโนมัติตั้งแต่ CONFIRM แล้ว ─
router.patch('/:id/sync-imported', requireRole('ADMIN', 'ACCOUNTING'), async (req, res) => {
  res.status(400).json({ message: 'ฟังก์ชันนี้ถูกยกเลิก (ข้อมูลซิงค์ตรงเข้า Winspeed แล้ว)' });
});

// ── PATCH /api/so/:id/cancel ─────────────────────────────────
router.patch('/:id/cancel', requireRole('SALES', 'ADMIN'), async (req, res) => {
  try {
    const so = await getSoOrThrow(req.params.id);
    if (['SHIPPED', 'IMPORTED', 'CANCELLED'].includes(so.Status))
      return res.status(400).json({ message: 'ยกเลิกไม่ได้ในสถานะนี้' });
    const { note } = req.body;
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

    if (so.Status === 'DRAFT') {
      await wfQuery(`UPDATE wf.SalesOrder SET Status='CANCELLED', UpdatedAt=GETUTCDATE() WHERE Id=@id`, { id: { type: sql.Int, value: so.Id } });
    } else {
      await wfQuery(`UPDATE wf.RebateLedger SET ReversedFlag=1, ReversedAt=GETUTCDATE(), ReversedNote=@note, Status='REVERSED' WHERE SoId=@soId AND ReversedFlag=0`,
        { soId: { type: sql.VarChar(50), value: so.Id }, note: { type: sql.NVarChar(300), value: note || 'Cancelled' } });
      await wfQuery(`UPDATE dbo.SOHD SET DocuStatus='C' WHERE SOID=@id`, { id: { type: sql.VarChar(50), value: so.Id } });
      await wfQuery(`UPDATE wf.SalesOrderExt SET UpdatedAt=GETUTCDATE() WHERE SOID=@id`, { id: { type: sql.VarChar(50), value: so.Id } });
    }
    await audit(null, so.Id, req.user.sub, 'CANCELLED', so.Status, 'CANCELLED', note, req.ip);
    res.json({ id: so.Id, status: 'CANCELLED' });
  } catch (e) { res.status(e.status || 500).json({ message: e.message }); }
});

// ── Internal: Book Rebate Accrual ────────────────────────────
async function bookRebateAccrual(so, lines, userId) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  // หา/สร้าง RebatePool แบบ Lazy (สร้างเฉพาะเมื่อมีรายการรีเบทจริงๆ เพื่อป้องกันแฟ้มขยะ)
  let pool = null;
  const getOrCreatePool = async () => {
    if (pool) return pool;
    pool = (await wfQuery(
      `SELECT * FROM wf.RebatePool WHERE SalesUserId=@u AND PeriodYear=@y AND PeriodMonth=@m`,
      { u: { type: sql.Int, value: userId }, y: { type: sql.Int, value: year }, m: { type: sql.Int, value: month } }
    )).recordset?.[0];

    if (!pool) {
      const pr = await wfQuery(
        `INSERT INTO wf.RebatePool (SalesUserId, PeriodYear, PeriodMonth, AllocatedAmt) OUTPUT inserted.* VALUES (@u,@y,@m,0)`,
        { u: { type: sql.Int, value: userId }, y: { type: sql.Int, value: year }, m: { type: sql.Int, value: month } }
      );
      pool = pr.recordset[0];
    }
    return pool;
  };

  for (const l of lines) {
    if (l.IsGiveaway) continue;
    const rebatePer = Number(l.PricePerTon) - Number(l.NetPricePerTon);
    if (rebatePer <= 0) continue;
    const rebateAmt = rebatePer * Number(l.QtyTon);

    // FR-008: best-effort match Plan ที่ ACTIVE (ตาม GoodCode pattern + ช่วงเวลา) → tag PlanId/Region
    let planId = null, planRegion = null;
    try {
      const plan = (await wfQuery(
        `SELECT TOP 1 PlanId, Region FROM wf.RebatePlan
         WHERE Status='ACTIVE'
           AND (GoodCodePattern IS NULL OR @gc LIKE GoodCodePattern + '%')
           AND (ValidFrom IS NULL OR ValidFrom <= CAST(GETDATE() AS DATE))
           AND (ValidTo   IS NULL OR ValidTo   >= CAST(GETDATE() AS DATE))
         ORDER BY Priority ASC, PlanId DESC`,
        { gc: { type: sql.NVarChar(50), value: l.GoodCode || '' } }
      )).recordset?.[0];
      if (plan) { planId = plan.PlanId; planRegion = plan.Region; }
    } catch { /* no plan layer — keep direct accrual */ }

    const activePool = await getOrCreatePool();

    await wfQuery(
      `INSERT INTO wf.RebateLedger
         (PoolId, SoId, SoLineId, CustId, GoodId, GoodCode, QtyTon, PricePerTon, NetPricePerTon, RebatePerTon, RebateAmount, RemainingAmt, Status, PlanId, Region)
       VALUES (@poolId, @soId, @lineId, @custId, @goodId, @goodCode, @qty, @price, @net, @rebPer, @rebAmt, @rebAmt, 'PENDING', @planId, @region)`,
      {
        poolId:   { type: sql.Int,          value: activePool.Id },
        soId:     { type: sql.VarChar(50),  value: String(so.Id) },
        lineId:   { type: sql.Int,          value: l.Id },
        custId:   { type: sql.NVarChar(20), value: so.CustId },
        goodId:   { type: sql.NVarChar(20), value: l.GoodId },
        goodCode: { type: sql.NVarChar(50), value: l.GoodCode },
        qty:      { type: sql.Decimal(12,3),value: Number(l.QtyTon) },
        price:    { type: sql.Decimal(12,2),value: Number(l.PricePerTon) },
        net:      { type: sql.Decimal(12,2),value: Number(l.NetPricePerTon) },
        rebPer:   { type: sql.Decimal(10,2),value: rebatePer },
        rebAmt:   { type: sql.Decimal(12,2),value: rebateAmt },
        planId:   { type: sql.Int,          value: planId },
        region:   { type: sql.NVarChar(20), value: planRegion },
      }
    );
    // ⚠ Update RebateBooked in Ext table because the line is now in Winspeed + Ext
    await wfQuery(`UPDATE wf.SalesOrderLineExt SET RebateBooked=1 WHERE SOID=@soId AND ListNo=@listNo`, 
      { soId: { type: sql.VarChar(50), value: so.Id }, listNo: { type: sql.Int, value: l.LineNum || l.ListNo } });
    await wfQuery(
      `UPDATE wf.RebatePool SET AccruedAmt = AccruedAmt + @amt, UpdatedAt=GETUTCDATE() WHERE Id=@id`,
      { amt: { type: sql.Decimal(12,2), value: rebateAmt }, id: { type: sql.Int, value: activePool.Id } }
    );
  }
}

// ── Internal: Consume Rebate (FIFO) ──────────────────────────
async function consumeRebateAccrual(custId, newSoid, rebateDiscountAmt) {
  if (!rebateDiscountAmt || rebateDiscountAmt <= 0) return;
  let remainingToDeduct = Number(rebateDiscountAmt);

  const ledgersR = await wfQuery(
    `SELECT Id, RemainingAmt FROM wf.RebateLedger 
     WHERE CustId = @custId AND Status = 'PENDING' AND RemainingAmt > 0 AND ReversedFlag = 0 
     ORDER BY CreatedAt ASC`,
    { custId: { type: sql.VarChar(20), value: custId } }
  );

  for (const ledger of ledgersR.recordset) {
    if (remainingToDeduct <= 0) break;
    
    const deduct = Math.min(remainingToDeduct, Number(ledger.RemainingAmt));
    remainingToDeduct -= deduct;
    
    await wfQuery(
      `UPDATE wf.RebateLedger SET RemainingAmt = RemainingAmt - @deduct WHERE Id = @id`,
      { deduct: { type: sql.Decimal(12,2), value: deduct }, id: { type: sql.Int, value: ledger.Id } }
    );
    
    await wfQuery(
      `INSERT INTO wf.RebateUsage (LedgerId, AppliedSOID, DeductedAmt) VALUES (@ledgerId, @soid, @deduct)`,
      { ledgerId: { type: sql.Int, value: ledger.Id }, soid: { type: sql.VarChar(50), value: newSoid }, deduct: { type: sql.Decimal(12,2), value: deduct } }
    );
  }
}

module.exports = router;
