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
const { writeAudit, auditUser, SCREEN } = require('../services/winspeed-audit');
const { advanceDocuNoCounter } = require('../services/winspeed-counter');
const { evaluateLinePrice, createPriceApprovalRequest, calculatePricingFingerprint } = require('../services/price-authority');

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

// Keep workflow references compatible with WINSpeed DocuNo while avoiding
// collisions with both existing native documents and concurrent app drafts.
async function allocateWorkflowRef(tx, soPrefix) {
  const yy = (new Date().getFullYear() + 543 - 2500).toString().slice(-2);
  const prefixYear = `${soPrefix}${yy}`;
  // UPDLOCK + HOLDLOCK บน wf.SalesOrder ทำให้คำขอที่เข้ามาพร้อมกันเข้าคิวกัน
  // ตัวที่สองจะรอจนตัวแรก commit แล้วจึงเห็นแถวใหม่และคำนวณ MAX ได้ถูก
  // dbo.SOHD อ่านด้วย NOLOCK เท่านั้น — ห้ามล็อกตารางของ WINSpeed
  const maxResult = await tx.request()
    .input('prefixYear', sql.NVarChar(10), prefixYear)
    .query(`
      SELECT ISNULL(MAX(RefSuffix), 0) AS MaxSuffix
      FROM (
        SELECT CASE
          WHEN ISNUMERIC(SUBSTRING(WfRef, LEN(@prefixYear) + 2, 20)) = 1
          THEN CONVERT(BIGINT, SUBSTRING(WfRef, LEN(@prefixYear) + 2, 20))
        END AS RefSuffix
        FROM wf.SalesOrder WITH (UPDLOCK, HOLDLOCK)
        WHERE WfRef LIKE @prefixYear + '-%'
        UNION ALL
        SELECT CASE
          WHEN ISNUMERIC(SUBSTRING(DocuNo, LEN(@prefixYear) + 2, 20)) = 1
          THEN CONVERT(BIGINT, SUBSTRING(DocuNo, LEN(@prefixYear) + 2, 20))
        END AS RefSuffix
        FROM dbo.SOHD WITH (NOLOCK)
        WHERE DocuType = 103 AND DocuNo LIKE @prefixYear + '-%'
      ) refs
      WHERE RefSuffix IS NOT NULL;
    `);
  // เดินทีละหนึ่ง
  //
  // เดิมเป็น MAX + NEXT VALUE FOR wf.WfRefSeq ซึ่ง WfRefSeq เป็นตัวนับที่โตขึ้นเรื่อย ๆ
  // ไม่เคยรีเซ็ต ผลคือช่องว่างของเลขที่เอกสาร **ขยายแบบทวีคูณ** เพราะเลขที่เพิ่งจอง
  // กลายเป็น MAX ของรอบถัดไป แล้วถูกบวกด้วยค่าลำดับที่โตขึ้นอีก
  //
  //   วัดจริงบน UAT — เริ่มที่ I69-02422 สร้างสามใบติดกันได้
  //     I69-02425 · I69-02428 · I69-02432
  //   สามใบกินเลขไป 10 หมายเลข ข้ามทิ้ง 7 หมายเลข
  //
  // เลขที่เอกสารขายเป็นหลักฐานทางภาษี ช่องว่างต้องอธิบายได้เสมอว่าหายไปไหน
  // ความปลอดภัยจากการชนกันมาจาก unique index บน WfRef คู่กับการล็อกด้านบน
  // ไม่ใช่จากการเว้นช่วงเลขทิ้งไว้
  const nextSuffix = Number(maxResult.recordset?.[0]?.MaxSuffix || 0) + 1;
  return `${prefixYear}-${String(nextSuffix).padStart(5, '0')}`;
}

async function reassignCollidingDraftRef(so, userId, ip) {
  const collision = await wfQuery(`
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM dbo.SOHD WITH (NOLOCK)
      WHERE DocuType = 103 AND DocuNo = @wfRef
    ) THEN 1 ELSE 0 END AS HasCollision
  `, { wfRef: { type: sql.NVarChar(30), value: so.WfRef } });
  if (!Number(collision.recordset?.[0]?.HasCollision || 0)) return so;

  const oldRef = so.WfRef;
  const newRef = await wfTransaction(async tx => {
    const allocated = await allocateWorkflowRef(tx, so.SoPrefix);
    const result = await tx.request()
      .input('id', sql.Int, Number(so.Id))
      .input('oldRef', sql.NVarChar(30), oldRef)
      .input('newRef', sql.NVarChar(30), allocated)
      .query(`
        UPDATE wf.SalesOrder SET WfRef=@newRef, UpdatedAt=GETUTCDATE()
        WHERE Id=@id AND WfRef=@oldRef;
        SELECT @@ROWCOUNT AS Affected;
      `);
    if (Number(result.recordset?.[0]?.Affected || 0) !== 1) {
      throw new Error('ไม่สามารถแก้เลข WfRef ที่ซ้ำได้');
    }
    return allocated;
  });
  await audit(null, so.Id, userId, 'WFREF_REASSIGNED', 'DRAFT', 'DRAFT', `${oldRef} -> ${newRef}`, ip);
  broadcast('so_updated', { id: so.Id, action: 'wfref_reassigned', oldRef, newRef });
  return { ...so, WfRef: newRef };
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
async function validateAndLockCouponReservations(tx, lines, orderCustId, targetSoId = null, actor = null) {
  const seenResIds = new Set();
  const custStr = String(orderCustId).trim();
  // 1. Check duplicate reservation IDs in the order lines first
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (!line.couponReservationId) continue;
    const resId = Number(line.couponReservationId);
    if (isNaN(resId) || resId <= 0) {
      throw Object.assign(new Error(`บรรทัดที่ ${idx + 1}: รหัสการจองตั๋วไม่ถูกต้อง (${line.couponReservationId})`), { status: 400 });
    }
    if (seenResIds.has(resId)) {
      throw Object.assign(new Error(`พบการใช้รหัสการจองตั๋วซ้ำ (${resId}) ในมากกว่าหนึ่งบรรทัด`), { status: 400 });
    }
    seenResIds.add(resId);
  }

  // 2. Lock and validate each reservation against the line
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (!line.couponReservationId) continue;

    const resId = Number(line.couponReservationId);
    const r = await tx.request()
      .input('resId', sql.Int, resId)
      .query(`
        SELECT Id, CouponId, CouponNo, GoodId, GoodUnit, ReservedQty, Status,
               BeneficiaryCustId, OwnerCustId, CarrierSoId, ExpiresAt, CreatedBy
        FROM wf.CouponReservation WITH (UPDLOCK, ROWLOCK)
        WHERE Id = @resId
      `);

    const resRow = r.recordset?.[0];
    if (!resRow) {
      throw Object.assign(new Error(`ไม่พบรายการจองตั๋วรหัส ${resId}`), { status: 400 });
    }

    if (resRow.Status !== 'RESERVED') {
      throw Object.assign(new Error(`รายการจองตั๋วรหัส ${resId} ไม่อยู่ในสถานะ RESERVED (ปัจจุบัน: ${resRow.Status})`), { status: 400 });
    }

    // Actor Authorization check: non-elevated users can only bind their own reservations
    if (actor && actor.userId) {
      const isElevated = ['ADMIN', 'MANAGER', 'C_LEVEL'].includes(String(actor.role || '').toUpperCase());
      if (!isElevated && resRow.CreatedBy && Number(resRow.CreatedBy) !== Number(actor.userId)) {
        throw Object.assign(new Error(`รายการจองตั๋วรหัส ${resId} ถูกสร้างโดยผู้ใช้อื่น (#${resRow.CreatedBy})`), { status: 403 });
      }
    }

    if (resRow.ExpiresAt && new Date(resRow.ExpiresAt) <= new Date()) {
      throw Object.assign(new Error(`รายการจองตั๋วรหัส ${resId} หมดอายุแล้ว`), { status: 400 });
    }

    const resCust = String(resRow.BeneficiaryCustId).trim();
    if (resCust !== custStr) {
      throw Object.assign(new Error(`รายการจองตั๋วรหัส ${resId} ถูกจองให้ลูกค้า ${resCust} ไม่ตรงกับลูกค้าของบิล (${custStr})`), { status: 400 });
    }

    if (Number(resRow.GoodId) !== Number(line.goodId)) {
      throw Object.assign(new Error(`สินค้าของการจองตั๋ว (${resRow.GoodId}) ไม่ตรงกับสินค้าในบิล (${line.goodId})`), { status: 400 });
    }

    // Exact metric ton quantity check using integer-scaled kilograms (1 metric ton = 1,000 kg, 0.001 ton = 1 kg)
    const numQtyTon = Number(line.qtyTon);
    if (!Number.isFinite(numQtyTon) || numQtyTon <= 0) {
      throw Object.assign(new Error(`จำนวนตันในบิล (${line.qtyTon}) ไม่ถูกต้อง`), { status: 400 });
    }
    if (Math.abs(numQtyTon * 1000 - Math.round(numQtyTon * 1000)) > 1e-4) {
      throw Object.assign(new Error(`จำนวนตันต้องมีความละเอียดไม่เกิน 3 ตำแหน่งทศนิยม (1 กิโลกรัม)`), { status: 400 });
    }
    const lineTonScaled = Math.round(numQtyTon * 1000);
    const resTonScaled = Math.round(Number(resRow.ReservedQty) * 1000);
    if (lineTonScaled !== resTonScaled) {
      throw Object.assign(new Error(`จำนวนตันในบิล (${line.qtyTon}) ไม่ตรงกับจำนวนที่จองตั๋วไว้ (${resRow.ReservedQty})`), { status: 400 });
    }

    // Unit comparison when provided
    if (line.goodUnit && resRow.GoodUnit) {
      const lu = String(line.goodUnit).trim().toLowerCase();
      const ru = String(resRow.GoodUnit).trim().toLowerCase();
      const isTon = (u) => u === 'ตัน' || u === 'tonne' || u === 'ton' || u === 't';
      if (lu !== ru && !(isTon(lu) && isTon(ru))) {
        throw Object.assign(new Error(`หน่วยสินค้าในบิล (${line.goodUnit}) ไม่ตรงกับหน่วยที่จองตั๋วไว้ (${resRow.GoodUnit})`), { status: 400 });
      }
    }

    if (resRow.CarrierSoId) {
      const boundSo = String(resRow.CarrierSoId).trim();
      const isCurrentSo = targetSoId != null && boundSo === String(targetSoId);
      // Canonical server-owned draft carrier patterns:
      // TRIP-{tripId}-DRAFT or DRAFT / DRAFT:{id} / DRAFT-{id} or SO-TEST- in test environments
      const isDraftCarrier = /^TRIP-\d+-DRAFT$/i.test(boundSo) || /^DRAFT([:-].*)?$/i.test(boundSo) || boundSo.startsWith('SO-TEST-');
      if (!isDraftCarrier && !isCurrentSo) {
        throw Object.assign(new Error(`รายการจองตั๋วรหัส ${resId} ถูกผูกกับบิลอื่นไปแล้ว (${boundSo})`), { status: 400 });
      }
    }
  }
}

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

  // Enrich with Coupon fields from wf.SalesOrderLine
  if (r.recordset && r.recordset.length > 0) {
    const numId = Number(idValue);
    if (!isNaN(numId)) {
      const couponLines = (await wfQuery(`
        SELECT LineNum, CouponReservationId, RefCouponDocuNo, IsCouponDrawn
        FROM wf.SalesOrderLine WITH (NOLOCK)
        WHERE SoId = @soId
      `, { soId: { type: sql.Int, value: numId } })).recordset || [];
      
      if (couponLines.length > 0) {
        const cMap = new Map(couponLines.map(cl => [cl.LineNum, cl]));
        for (const line of r.recordset) {
          const match = cMap.get(line.LineNum);
          if (match) {
            line.CouponReservationId = match.CouponReservationId;
            line.RefCouponDocuNo = match.RefCouponDocuNo;
            line.IsCouponDrawn = match.IsCouponDrawn;
          }
        }
      }
    }
  }

  return r.recordset || [];
}

// audit — เขียน log การเปลี่ยนสถานะ (immutable). รองรับ transaction เมื่อส่ง tx เข้ามา
async function audit(tx, soId, userId, action, fromStatus, toStatus, note, ipAddress) {
  const sqlStr = `
    INSERT INTO wf.SalesOrderAudit (SoId, UserId, Action, FromStatus, ToStatus, Note, IpAddress)
    VALUES (@soId, @userId, @action, @fromStatus, @toStatus, @note, @ip)
  `;
  const params = {
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
          so.TripId,
          ISNULL(so.RequiresPriceApproval, 0) AS RequiresPriceApproval,
          ISNULL(so.PriceApprovalStatus, 'NONE') AS PriceApprovalStatus,
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
router.get('/unlock-requests', requireRole('APPROVER', 'ADMIN', 'MANAGER', 'ACCOUNTING', 'C_LEVEL'), async (req, res) => {
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
router.patch('/unlock-requests/:reqId/resolve', requireRole('APPROVER', 'ADMIN', 'MANAGER', 'ACCOUNTING', 'C_LEVEL'), async (req, res) => {
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

    const { evaluatePickupTiming } = require('../services/so-pickup-policy');
    const pickupEvaluation = {
      in: evaluatePickupTiming(so.ActualWeighInAt, so.PickupDueDate),
      out: evaluatePickupTiming(so.ActualWeighOutAt, so.PickupDueDate),
    };

    res.json(redactSoForRole(req, {
      ...camelizeRow(so),
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
    const r = await wfQuery(`
      SELECT l.SoId, l.LineNum, l.GoodName, l.QtyTon, l.QtyBag, 
             s.WfRef, s.CustName, s.CreatedAt, u.DisplayName AS CreatedByName
      FROM wf.SalesOrderLine l
      INNER JOIN wf.SalesOrder s ON s.Id = l.SoId
      LEFT JOIN wf.AppUser u ON u.Id = s.SalesUserId
      WHERE l.IsGiveaway = 1 AND ISNULL(l.GiveawayApprovalStatus, 'PENDING') = 'PENDING' AND s.Status = 'DRAFT'
      ORDER BY s.CreatedAt ASC
    `);
    res.json(r.recordset || []);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// PATCH /api/so/:id/giveaway-lines/:lineNum/approve — manager approval for giveaway line
router.patch('/:id/giveaway-lines/:lineNum/approve', requireRole('MANAGER', 'ADMIN', 'C_LEVEL'), async (req, res) => {
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

router.post('/', requireRole('SALES', 'COUNTER_SALES', 'ADMIN', 'C_LEVEL'), async (req, res) => {
  try {
    const orders = Array.isArray(req.body) ? req.body : [req.body];
    if (orders.length === 0) return res.status(400).json({ message: 'ไม่มีข้อมูลคำสั่งซื้อ' });

    for (const order of orders) {
      if (!order.custId || !order.lines?.length) return res.status(400).json({ message: 'custId และ lines จำเป็น' });
      if (!['I', 'K', 'AI'].includes(order.soPrefix)) return res.status(400).json({ message: 'soPrefix ต้องเป็น I / K / AI' });
    }

    const createdIds = [];
    const createdRefs = [];
    const salesOwnerIds = new Set();
    const creditChecks = [];
    let anyNeedsApproval = false;

    await wfTransaction(async tx => {
      for (const order of orders) {
        const { soPrefix, custId, custName, controlTicketNo, deliveryDate, requestedAt, isOwnTruck, noTruckRequired, pSling, remark, lines, salesUserId: impersonatedId, rebateDiscountAmt, convertFromQuoteId, creditDays, truckRemark, billRemark, transpId } = order;
        const truckPlate = order.truckPlate || null;

        // Validate and lock all coupon reservations for this order before pricing and line generation
        const actor = {
          userId: impersonatedId || req.user?.sub || req.user?.id,
          role: req.user?.role
        };
        await validateAndLockCouponReservations(tx, lines, custId, null, actor);

        // Evaluate line prices against authoritative server master (dbo.EMSetPriceDT / HD)
        let orderNeedsApproval = false;
        const lineEvaluations = [];
        for (const l of lines) {
          const evalResult = await evaluateLinePrice(l, custId, deliveryDate || null);
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
        soReq.input('truckPlate',       sql.NVarChar(30),  truckPlate ? String(truckPlate) : null);
        soReq.input('controlTicketNo',  sql.NVarChar(20),  controlTicketNo ? String(controlTicketNo) : null);
        soReq.input('deliveryDate',     sql.Date,          deliveryDate ? new Date(deliveryDate) : null);
        soReq.input('requestedAt',      sql.DateTime2,     toSqlDateTime(requestedAt));
        soReq.input('isOwnTruck',       sql.Bit,           toBit(isOwnTruck));
        soReq.input('noTruckRequired',  sql.Bit,           toBit(noTruckRequired));
        soReq.input('pSling',           sql.Bit,           toBit(pSling));
        soReq.input('remark',           sql.NVarChar(500), remark || null);
        soReq.input('rebateDiscountAmt', sql.Decimal(12,2), normalizeRebateDiscount(req, rebateDiscountAmt));
        const { salesUserId: actualSalesUserId, enteredByUserId } = resolveSalesOwner(req, impersonatedId);
        soReq.input('salesUserId',      sql.Int,           actualSalesUserId);
        soReq.input('enteredByUserId',  sql.Int,           enteredByUserId);
        salesOwnerIds.add(actualSalesUserId);
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
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          const lr = tx.request();
          lr.input('soId',                 sql.Int,           soId);
          lr.input('lineNum',              sql.Int,           i + 1);
          lr.input('goodId',               sql.NVarChar(20),  String(l.goodId));
          lr.input('goodName',             sql.NVarChar(200), l.goodName ? String(l.goodName) : '');
          lr.input('goodCode',             sql.NVarChar(50),  l.goodCode ? String(l.goodCode) : '');
          lr.input('qtyTon',               sql.Decimal(12,3), Number(l.qtyTon));
          lr.input('qtyBag',               sql.Int,           Number(l.qtyBag) || Math.round(l.qtyTon * 20));
          lr.input('masterQty',            sql.Decimal(12,3), l.masterQty === undefined || l.masterQty === null ? Number(l.qtyTon) : Number(l.masterQty));
          lr.input('childQty',             sql.Decimal(12,3), l.childQty === undefined || l.childQty === null ? 0 : Number(l.childQty));
          lr.input('pricePerTon',          sql.Decimal(12,2), Number(l.pricePerTon));
          lr.input('netPricePerTon',       sql.Decimal(12,2), Number(l.netPricePerTon) || 0);
          lr.input('isGiveaway',           sql.Bit,           l.isGiveaway ? 1 : 0);
          lr.input('refControlTicketNo',   sql.NVarChar(30),  l.refControlTicketNo || null);
          lr.input('isControlTicketDrawn', sql.Bit,           l.isControlTicketDrawn ? 1 : 0);
          lr.input('couponReservationId',   sql.Int,           l.couponReservationId ? Number(l.couponReservationId) : null);
          lr.input('refCouponDocuNo',       sql.VarChar(50),   l.refCouponDocuNo || null);
          lr.input('isCouponDrawn',         sql.Bit,           l.isCouponDrawn ? 1 : 0);
          addGiveawayApprovalInputs(lr, req, l, hasGiveawayApproval);
          lr.input('loadSequence',         sql.Int,           l.loadSequence || null);
          
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
  } catch (e) { console.error(e); res.status(e.status || 500).json({ message: e.message }); }
});

// ── PUT /api/so/:id — Update existing DRAFT SO ──
router.put('/:id', requireRole('SALES', 'COUNTER_SALES', 'ADMIN', 'C_LEVEL'), async (req, res) => {
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
        const truckPlate = order.truckPlate || null;
        const safeRebateDiscountAmt = normalizeRebateDiscount(req, rebateDiscountAmt);
        const totalAmnt = lines.reduce((sum, l) => sum + (Number(l.qtyTon) * Number(l.pricePerTon)), 0) - safeRebateDiscountAmt;

        const soReq = tx.request();
        soReq.input('id', sql.VarChar(50), String(so.Id));
        soReq.input('soPrefix', sql.NVarChar(5), String(soPrefix));
        soReq.input('custId', sql.NVarChar(20), String(custId));
        soReq.input('custName', sql.NVarChar(200), custName ? String(custName) : '');
        soReq.input('truckPlate', sql.NVarChar(30), truckPlate ? String(truckPlate) : null);
        soReq.input('controlTicketNo', sql.NVarChar(20), controlTicketNo ? String(controlTicketNo) : null);
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
          lr.input('goodId', sql.NVarChar(20), String(l.goodId));
          lr.input('goodName', sql.NVarChar(200), l.goodName ? String(l.goodName) : '');
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

            INSERT INTO wf.SalesOrderLineExt (SOID, ListNo, NetPricePerTon, IsGiveaway, RebateBooked, RefControlTicketNo, IsControlTicketDrawn, MasterQty, ChildQty, LoadSequence${giveawayApprovalInsertColumns(hasGiveawayApproval)})
            VALUES (@soId, @lineNum, @netPricePerTon, @isGiveaway, 0, @refControlTicketNo, @isControlTicketDrawn, @masterQty, @childQty, @loadSequence${giveawayApprovalInsertValues(hasGiveawayApproval)});
          `);
        }
      });
      await audit(null, so.Id, req.user.sub, 'UPDATED', 'DRAFT', 'DRAFT', null, req.ip);
      broadcast('so_updated', { id: so.Id, action: 'updated' });
      return res.json({ id: so.Id, wfRef: so.WfRef, needsApproval: false });
    }

    await wfTransaction(async tx => {
      const { soPrefix, custId, custName, controlTicketNo, deliveryDate, requestedAt, isOwnTruck, noTruckRequired, pSling, remark, lines, rebateDiscountAmt, creditDays, truckRemark, billRemark, transpId } = order;
      const truckPlate = order.truckPlate || null;

      // Evaluate line prices against authoritative server master (dbo.EMSetPriceDT / HD)
      let orderNeedsApproval = false;
      const lineEvaluations = [];
      for (const l of lines) {
        const evalResult = await evaluateLinePrice(l, custId, deliveryDate || null);
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
      soReq.input('truckPlate',        sql.NVarChar(30),  truckPlate ? String(truckPlate) : null);
      soReq.input('controlTicketNo',   sql.NVarChar(20),  controlTicketNo ? String(controlTicketNo) : null);
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
      soReq.input('tripId',            sql.Int,           order.tripId !== undefined ? (order.tripId ? Number(order.tripId) : null) : (so.TripId || null));
      const currentRev = Number(so.DocumentRevision) || 1;
      const newRev = currentRev + 1;
      const pricingFingerprint = calculatePricingFingerprint(lines);

      soReq.input('requiresPriceApproval', sql.Bit,       orderNeedsApproval ? 1 : 0);
      soReq.input('priceApprovalStatus', sql.VarChar(20), orderNeedsApproval ? 'PENDING' : 'NONE');
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

      // Validate and lock all new/retained coupon reservations for this order before inserting lines
      const editActor = {
        userId: req.user?.sub || req.user?.id,
        role: req.user?.role
      };
      await validateAndLockCouponReservations(tx, lines, order.custId, so.Id, editActor);

      // Insert new lines
      const hasGiveawayApproval = await hasGiveawayApprovalColumns();
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const lr = tx.request();
        lr.input('soId',                 sql.Int,           so.Id);
        lr.input('lineNum',              sql.Int,           i + 1);
        lr.input('goodId',               sql.NVarChar(20),  String(l.goodId));
        lr.input('goodName',             sql.NVarChar(200), l.goodName ? String(l.goodName) : '');
        lr.input('goodCode',             sql.NVarChar(50),  l.goodCode ? String(l.goodCode) : '');
        lr.input('qtyTon',               sql.Decimal(12,3), Number(l.qtyTon));
        lr.input('qtyBag',               sql.Int,           Number(l.qtyBag) || Math.round(l.qtyTon * 20));
        lr.input('masterQty',            sql.Decimal(12,3), l.masterQty === undefined || l.masterQty === null ? Number(l.qtyTon) : Number(l.masterQty));
        lr.input('childQty',             sql.Decimal(12,3), l.childQty === undefined || l.childQty === null ? 0 : Number(l.childQty));
        lr.input('pricePerTon',          sql.Decimal(12,2), Number(l.pricePerTon));
        lr.input('netPricePerTon',       sql.Decimal(12,2), Number(l.netPricePerTon) || 0);
        lr.input('isGiveaway',           sql.Bit,           l.isGiveaway ? 1 : 0);
        lr.input('refControlTicketNo',   sql.NVarChar(30),  l.refControlTicketNo || null);
        lr.input('isControlTicketDrawn', sql.Bit,           l.isControlTicketDrawn ? 1 : 0);
        lr.input('couponReservationId',   sql.Int,           l.couponReservationId ? Number(l.couponReservationId) : null);
        lr.input('refCouponDocuNo',       sql.VarChar(50),   l.refCouponDocuNo || null);
        lr.input('isCouponDrawn',         sql.Bit,           l.isCouponDrawn ? 1 : 0);
        addGiveawayApprovalInputs(lr, req, l, hasGiveawayApproval);
        lr.input('loadSequence',         sql.Int,           l.loadSequence || null);
        
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

      // Supersede old price approvals (both PENDING and APPROVED from previous revisions)
      await tx.request()
        .input('soId', sql.Int, so.Id)
        .input('newRev', sql.Int, newRev)
        .query(`UPDATE wf.PriceApproval SET Status = 'SUPERSEDED', UpdatedAt = SYSUTCDATETIME() WHERE SoId = @soId AND Status IN ('PENDING', 'APPROVED') AND DocumentRevision < @newRev`);

      if (orderNeedsApproval) {
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
  } catch (e) { console.error(e); res.status(e.status || 500).json({ message: e.message }); }
});

// ── PATCH /api/so/:id/confirm ────────────────────────────────
// ── PATCH /api/so/:id/verify — Counter-Sales ตรวจซ้ำ (FR-022) ─────
router.patch('/:id/verify', requireRole('COUNTER_SALES', 'ADMIN', 'MANAGER', 'C_LEVEL'), async (req, res) => {
  try {
    const so = await getSoOrThrow(req.params.id, 'DRAFT');
    await wfQuery(`UPDATE wf.SalesOrder SET VerifiedBy=@uid, VerifiedAt=GETUTCDATE() WHERE Id=@id`,
      { uid: { type: sql.Int, value: req.user.sub }, id: { type: sql.Int, value: so.Id } });
    await audit(null, so.Id, req.user.sub, 'VERIFIED', 'DRAFT', 'DRAFT', null, req.ip);
    broadcast('so_updated', { id: so.Id, action: 'verified' });
    res.json({ id: so.Id, verified: true });
  } catch (e) { res.status(e.status || 500).json({ message: e.message }); }
});

router.patch('/:id/confirm', requireRole('SALES', 'COUNTER_SALES', 'ADMIN', 'C_LEVEL'), async (req, res) => {
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

    const isSohdOrder = (await wfQuery(`SELECT SOID, PickupDueDate, PickupDueType, ConfirmedAt, PickupPolicySnapshotId, IsUnlocked FROM wf.SalesOrderExt WHERE SOID=@id`, { id: { type: sql.VarChar(50), value: String(req.params.id) } })).recordset[0];
    
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

    let so = await getSoOrThrow(req.params.id, 'DRAFT');

    // ตรวจสอบสถานะการอนุมัติราคาขายต่ำกว่าประกาศ ผูกกับ DocumentRevision ปัจจุบัน (P0: Finding 6)
    const priceApprovalCheck = await wfQuery(`
      SELECT RequiresPriceApproval, PriceApprovalStatus, DocumentRevision, PricingFingerprint,
             (SELECT COUNT(*) FROM wf.PriceApproval WHERE SoId = @id AND Status = 'PENDING') AS PendingApprovals,
             (SELECT COUNT(*) FROM wf.PriceApproval WHERE SoId = @id AND DocumentRevision = wf.SalesOrder.DocumentRevision AND Status = 'APPROVED') AS ApprovedCurrentApprovals
      FROM wf.SalesOrder WHERE Id = @id
    `, { id: { type: sql.Int, value: so.Id } });
    const pCheck = priceApprovalCheck.recordset[0];
    if (pCheck?.RequiresPriceApproval) {
      if (pCheck.PriceApprovalStatus !== 'APPROVED' || (pCheck.PendingApprovals && Number(pCheck.PendingApprovals) > 0)) {
        return res.status(400).json({
          message: `ไม่สามารถยืนยันคำสั่งซื้อได้: มีรายการราคาขายต่ำกว่าราคาประกาศที่ยังไม่ได้รับอนุมัติ (สถานะ: ${pCheck?.PriceApprovalStatus || 'PENDING'})`,
          requiresApproval: true,
          priceApprovalStatus: pCheck?.PriceApprovalStatus || 'PENDING'
        });
      }
      if (!pCheck.ApprovedCurrentApprovals || Number(pCheck.ApprovedCurrentApprovals) === 0) {
        return res.status(400).json({
          message: `ไม่สามารถยืนยันคำสั่งซื้อได้: คำขออนุมัติราคาไม่ตรงกับฉบับปัจจุบัน (Revision ${pCheck.DocumentRevision}) กรุณาส่งขออนุมัติใหม่`,
          requiresApproval: true,
          priceApprovalStatus: 'SUPERSEDED'
        });
      }
    }

    if (!so.TruckPlate && !so.NoTruckRequired) {
      return res.status(400).json({ message: 'ต้องระบุทะเบียนรถ หรือทำเครื่องหมาย "ไม่ใช้รถ" ก่อนทำการยืนยัน SO' });
    }

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

    // Existing drafts may predate collision-safe allocation; repair just-in-time.
    so = await reassignCollidingDraftRef(so, req.user.sub, req.ip);

    // Calculate pickup due date policy snapshot and enforce strict mode (SO-03, C2, C4)
    const { calculateConfirmationPickupDue, diffBangkokCalendarDays, getBangkokDateString, normalizeDateString } = require('../services/so-pickup-policy');

    // Only treat as explicit if user provided date in request OR draft was explicitly marked EXPLICIT (C4)
    // Legacy default DeliveryDate is NOT used as an explicit date overriding the 7-day policy!
    const explicitPickup = req.body?.pickupDueDate ||
      req.body?.deliveryDate ||
      (so.PickupDueType === 'EXPLICIT' && so.PickupDueDate ? normalizeDateString(so.PickupDueDate, { isWallClock: true }) : null);

    const pickupResult = await calculateConfirmationPickupDue({
      explicitDate: explicitPickup,
      confirmedAt: new Date(),
    });

    if (pickupResult.policy.strictMode && pickupResult.pickupDueDate) {
      const todayBkk = getBangkokDateString();
      if (diffBangkokCalendarDays(pickupResult.pickupDueDate, todayBkk) < 0) {
        return res.status(400).json({ message: 'ไม่อนุญาตให้กำหนดวันรับสินค้าในอดีต (Strict Mode)' });
      }
    }

    // Serialize confirmation with session application lock to prevent concurrent double-conversion (C4)
    const activePool = require('../db').pools().ownerPool;
    const lockResource = `ConfirmSO_${so.Id}`;
    const lockReq = activePool.request();
    lockReq.input('rname', sql.NVarChar(255), lockResource);
    await lockReq.query(`
      DECLARE @res INT;
      EXEC @res = sp_getapplock @Resource = @rname, @LockMode = 'Exclusive', @LockOwner = 'Session', @LockTimeout = 10000;
      IF @res < 0 THROW 50002, 'Unable to acquire lock for SO confirmation', 1;
    `);

    let newSoid = null;
    try {
      // Re-check draft status under lock
      const freshDraft = (await wfQuery(`SELECT Id, Status, WfRef, PickupDueDate, PickupDueType, ConfirmedAt, PickupPolicySnapshotId FROM wf.SalesOrder WHERE Id = @soId`, {
        soId: { type: sql.Int, value: so.Id }
      })).recordset?.[0];

      if (!freshDraft || freshDraft.Status !== 'DRAFT') {
        // Check if already converted to SalesOrderExt
        const existingExt = (await wfQuery(`SELECT SOID, PickupDueDate, PickupDueType, ConfirmedAt, PickupPolicySnapshotId FROM wf.SalesOrderExt WHERE WfRef = @ref`, {
          ref: { type: sql.NVarChar(30), value: so.WfRef }
        })).recordset?.[0];

        if (existingExt) {
          return res.json({
            id: existingExt.SOID,
            status: 'CONFIRMED',
            pickupDueDate: normalizeDateString(existingExt.PickupDueDate, { isWallClock: true }),
            pickupDueType: existingExt.PickupDueType || 'DEFAULT',
            confirmedAt: existingExt.ConfirmedAt,
            pickupPolicySnapshotId: existingExt.PickupPolicySnapshotId,
            replayed: true,
          });
        }
        throw new Error('ไม่พบแบบร่างใบสั่งขาย หรือใบสั่งขายถูกเปลี่ยนสถานะแล้ว');
      }

      // 1. Persist pickup due date to draft before conversion
      await wfQuery(`
        UPDATE wf.SalesOrder
        SET PickupDueDate = @pDueDate,
            PickupDueType = @pDueType,
            ConfirmedAt = @confirmedAt,
            PickupPolicySnapshotId = @pSnapId
        WHERE Id = @soId
      `, {
        soId: { type: sql.Int, value: so.Id },
        pDueDate: { type: sql.Date, value: pickupResult.pickupDueDate ? new Date(pickupResult.pickupDueDate) : null },
        pDueType: { type: sql.VarChar(20), value: pickupResult.pickupDueType },
        confirmedAt: { type: sql.DateTime2, value: pickupResult.confirmedAt },
        pSnapId: { type: sql.Int, value: pickupResult.pickupPolicySnapshotId },
      });

      // 2. เรียก Stored Procedure เพื่อย้ายข้อมูลจาก wf.SalesOrder ไป SOHD (Winspeed)
      const spReq = activePool.request();
      spReq.input('SoId', sql.Int, so.Id);
      spReq.output('NewSoid', sql.VarChar(50));
      const spRes = await spReq.execute('wf.sp_ConfirmSalesOrder');
      
      newSoid = spRes.output.NewSoid;
      if (!newSoid) throw new Error('ย้ายข้อมูลไปยัง Winspeed ไม่สำเร็จ (ไม่ได้ SOID กลับมา)');

      // 3. Ensure native SO preserves PickupDueDate, PickupDueType, ConfirmedAt, PickupPolicySnapshotId (SO-03, C1)
      await wfQuery(`
        UPDATE wf.SalesOrderExt
        SET PickupDueDate = @pDueDate,
            PickupDueType = @pDueType,
            ConfirmedAt = @confirmedAt,
            PickupPolicySnapshotId = @pSnapId,
            UpdatedAt = GETUTCDATE()
        WHERE SOID = @newSoid
      `, {
        newSoid: { type: sql.VarChar(50), value: String(newSoid) },
        pDueDate: { type: sql.Date, value: pickupResult.pickupDueDate ? new Date(pickupResult.pickupDueDate) : null },
        pDueType: { type: sql.VarChar(20), value: pickupResult.pickupDueType },
        confirmedAt: { type: sql.DateTime2, value: pickupResult.confirmedAt },
        pSnapId: { type: sql.Int, value: pickupResult.pickupPolicySnapshotId },
      });

      // 4. Carry over coupon reservations from draft SO to confirmed native SOID
      await wfQuery(`
        UPDATE wf.CouponReservation
        SET CarrierSoId = @newSoid,
            UpdatedAt = GETUTCDATE()
        WHERE CarrierSoId = @oldSoId
      `, {
        newSoid: { type: sql.VarChar(50), value: String(newSoid) },
        oldSoId: { type: sql.VarChar(50), value: String(so.Id) }
      });
    } finally {
      // Release application lock
      const unlockReq = activePool.request();
      unlockReq.input('rname', sql.NVarChar(255), lockResource);
      await unlockReq.query(`EXEC sp_releaseapplock @Resource = @rname, @LockOwner = 'Session';`).catch(() => {});
    }

    // ตั๋วปุ๋ยไม่ได้ออกที่ขั้นนี้ — sp_ConfirmSalesOrder สร้างใบสั่งจอง (103)
    // และตั๋วผูกกับใบส่งขาย (104) เท่านั้น (111,210 แถวในระบบเป็น 104 ล้วน
    // ส่วนใบสั่งจองจริง 61,439 ใบเป็น CouponFlag='N' ทุกใบ ซึ่งถูกต้องแล้ว)
    // ใบส่งขายกับตั๋วเกิดตอนเจ้าหน้าที่เปิดเอกสารต่อใน WINSpeed · ดู 098/099

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

    // 2.7 Auto-deduct Giveaway Quota (FR-AutoDeduct)
    const giveawayLines = lines.filter(l => l.IsGiveaway);
    const targetSalesUserId = so.SalesUserId || req.user.sub;
    for (const gl of giveawayLines) {
      const mapRow = (await wfQuery(`SELECT Brand, ItemName FROM wf.GiveawayItemMapping WHERE GoodID=@g`, { g: { type: sql.VarChar(50), value: gl.GoodId } })).recordset[0];
      if (mapRow) {
        let y = new Date().getFullYear();
        if (y < 2500) y += 543;
        let regRow = (await wfQuery(`SELECT TOP 1 Region, EmpId, EmpCode FROM wf.GiveawayBudget WHERE SalesUserId=@su AND PeriodYear=@y`, { su: { type: sql.Int, value: targetSalesUserId }, y: { type: sql.Int, value: y } })).recordset[0];
        if (!regRow && req.user.sub) {
          regRow = (await wfQuery(`SELECT TOP 1 Region, EmpId, EmpCode FROM wf.GiveawayBudget WHERE SalesUserId=@su AND PeriodYear=@y`, { su: { type: sql.Int, value: req.user.sub }, y: { type: sql.Int, value: y } })).recordset[0];
        }
        if (regRow) {
          await wfQuery(`
            INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, IssueMonth, Brand, ItemName, Qty, CustId, SoId, Note, Source)
            VALUES (@su, @ei, @ec, @rg, @y, @mo, @br, @it, @qy, @cu, @so, @nt, 'APP')
          `, {
            su: { type: sql.Int, value: targetSalesUserId },
            ei: { type: sql.NVarChar(20), value: regRow.EmpId || null },
            ec: { type: sql.NVarChar(20), value: regRow.EmpCode || null },
            rg: { type: sql.NVarChar(60), value: regRow.Region },
            y: { type: sql.Int, value: y },
            mo: { type: sql.Int, value: new Date().getMonth() + 1 },
            br: { type: sql.NVarChar(50), value: mapRow.Brand },
            it: { type: sql.NVarChar(100), value: mapRow.ItemName },
            qy: { type: sql.Decimal(12,2), value: gl.QtyBag || gl.QtyTon || 0 },
            cu: { type: sql.NVarChar(20), value: so.CustId ? String(so.CustId) : null },
            so: { type: sql.Int, value: so.Id },
            nt: { type: sql.NVarChar(300), value: `ตัดโควต้าอัตโนมัติจากบิล ${so.WfRef || so.Id}` }
          });
        }
      }
    }

    // 3. Audit log (บันทึกโดยใช้ newSoid)
    await audit(null, newSoid, req.user.sub, 'CONFIRMED', 'DRAFT', 'CONFIRMED', null, req.ip);
    
    // ยกเลิก 03/09/2569 — ไม่ผลักใบชั่งล่วงหน้าเข้า MySQL อีกแล้ว
    // insertPreWeighTicket(so).catch(err => console.error('[truckscale] Push error:', err));
    
    // เดินตัวนับของ WINSpeed ให้ทันเลขที่แอปเพิ่งออกไป ไม่งั้นหน้าจอ WINSpeed
    // จะเสนอเลขที่ถูกใช้ไปแล้วให้พนักงานคนถัดไป
    await advanceDocuNoCounter(so.WfRef);

    // ขั้นนี้สร้างแถวใหม่ใน dbo.SOHD ผ่าน sp_ConfirmSalesOrder — เอกสารที่โผล่ใน
    // WINSpeed โดยไม่มีรอยว่าใครสร้าง คือสิ่งที่ผู้ตรวจถามหาเป็นอันดับแรก
    await writeAudit({ screen: SCREEN.SO_CONFIRM, action: 'I', docuNo: so.WfRef,
      docuDate: so.DeliveryDate || new Date(), refId: newSoid, username: auditUser(req.user),
      note: `ยืนยันใบสั่งขายจากแอป (ลูกค้า ${so.CustId})` });

    // FR-029 outbox: reliable integration event (idempotent ต่อ SO)
    await enqueue('SO_CONFIRMED', newSoid, { soId: newSoid, custId: so.CustId, by: req.user.sub }, `SO_CONFIRMED:${newSoid}`);
    res.json({
      id: newSoid,
      status: 'CONFIRMED',
      pickupDueDate: pickupResult.pickupDueDate,
      pickupDueType: pickupResult.pickupDueType,
      confirmedAt: pickupResult.confirmedAt,
      pickupPolicySnapshotId: pickupResult.pickupPolicySnapshotId,
    });
  } catch (e) { res.status(e.status || 500).json({ message: e.message }); }
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
router.patch('/:id/unlock', requireRole('APPROVER', 'ADMIN', 'MANAGER', 'ACCOUNTING', 'C_LEVEL'), async (req, res) => {
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
    await writeAudit({ screen: SCREEN.SO_UNLOCK, action: 'U', docuNo: so.WfRef,
      docuDate: so.CreatedAt, refId: so.Id, username: auditUser(req.user),
      note: `PkgStatus=N (ปลดล็อกจากแอป) ${note || ''}`.trim() });
    res.json({ id: so.Id, status: 'CONFIRMED' });
  } catch (e) { res.status(e.status || 500).json({ message: e.message }); }
});

// ── POST /api/so/:id/unlock-request — ขอปลดล็อก/ขอแก้ไข/ขอยกเลิก ─────
router.post('/:id/unlock-request', requireRole('SALES', 'COUNTER_SALES', 'WAREHOUSE', 'ADMIN', 'C_LEVEL'), async (req, res) => {
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
  const userId = so.SalesUserId || user?.sub || 1;
  const lines = await getLines(so.Id);

  // 1. ตรวจสอบและตั้ง Rebate Accrual หากยังไม่เคยตั้ง (Idempotent)
  const existingLedger = await wfQuery(
    `SELECT TOP 1 Id FROM wf.RebateLedger WHERE SoId = @soId`,
    { soId: { type: sql.VarChar(50), value: soIdStr } }
  );
  let rebateRecovered = false;
  if (!existingLedger.recordset?.length) {
    await bookRebateAccrual(so, lines, userId);
    rebateRecovered = true;
  }

  // 2. ตรวจสอบ Audit log และบันทึกหากยังไม่มี
  const existingAudit = await wfQuery(
    `SELECT TOP 1 Id FROM wf.SalesOrderAudit WHERE SoId = @soId AND Action = 'SHIPPED'`,
    { soId: { type: sql.VarChar(50), value: soIdStr } }
  );
  if (!existingAudit.recordset?.length) {
    await audit(null, so.Id, userId, 'SHIPPED', 'LOADED', 'SHIPPED', null, clientIp);
    await writeAudit({
      screen: SCREEN.SO_SHIP, action: 'U', docuNo: so.WfRef,
      docuDate: so.CreatedAt, refId: so.Id, username: auditUser(user || { sub: userId }),
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
router.patch('/:id/ship', requireRole('WAREHOUSE', 'WEIGHBRIDGE', 'MANAGER', 'ADMIN', 'C_LEVEL'), async (req, res) => {
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
          TRY_CAST(LocationName AS INT) AS ScaleNo,
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
router.get('/:id/weigh-history', async (req, res) => {
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
          // CANCEL
          if (so.Status === 'DRAFT') {
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

          // Auto-cancel attached coupon reservations
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
router.patch('/:id/cancel', requireRole('SALES', 'ADMIN', 'C_LEVEL'), async (req, res) => {
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

    await wfTransaction(async (tx) => {
      if (so.Status === 'DRAFT') {
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
router.delete('/:id', requireRole('SALES', 'ADMIN', 'C_LEVEL'), async (req, res) => {
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

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

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
      if (l.IsGiveaway) continue;
      const rebatePer = Number(l.PricePerTon) - Number(l.NetPricePerTon);
      if (rebatePer <= 0) continue;
      const rebateAmt = rebatePer * Number(l.QtyTon);

      // FR-008: best-effort match Plan ที่ ACTIVE
      let planId = null, planRegion = null;
      try {
        const plan = (await tx.request()
          .input('gc', sql.NVarChar(50), l.GoodCode || '')
          .query(`SELECT TOP 1 PlanId, Region FROM wf.RebatePlan
                  WHERE Status='ACTIVE'
                    AND (GoodCodePattern IS NULL OR @gc LIKE GoodCodePattern + '%')
                    AND (ValidFrom IS NULL OR ValidFrom <= CAST(GETDATE() AS DATE))
                    AND (ValidTo   IS NULL OR ValidTo   >= CAST(GETDATE() AS DATE))
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
async function consumeRebateAccrual(custId, newSoid, rebateDiscountAmt) {
  if (!rebateDiscountAmt || rebateDiscountAmt <= 0) return;
  let remainingToDeduct = Number(rebateDiscountAmt);

  const ledgersR = await wfQuery(
    `SELECT Id, RemainingAmt FROM wf.RebateLedger 
     WHERE CustId = @custId AND Status = 'PENDING' AND RemainingAmt > 0 AND ReversedFlag = 0 
     ORDER BY CreatedAt ASC`,
    { custId: { type: sql.VarChar(20), value: String(custId || '') } }
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
