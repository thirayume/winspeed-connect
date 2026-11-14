/**
 * /api/rebate-pool — New Rebate Pool Ledger, Over-Limit Approval,
 *                    Oct 31 Standing Price Snapshot & Manual FIFO Conversion
 */

const express = require('express');
const router = express.Router();
const { sql, wfTransaction } = require('../db');
const { defaultRebateQuery: wfQuery, transactionQuery } = require('../services/rebate-sql');
const { requireAuth, requireRole, requireCapability, requireRebateAmountAccess } = require('../middleware/auth');
const { getBangkokDateString } = require('../services/so-pickup-policy');
const {
  calculateOrderPricingAndRebate,
  resolveConfiguredRebatePolicy,
} = require('../services/rebate-calculator-service');
const {
  snapshotOct31StandingPrices,
} = require('../services/rebate-conversion-service');
const {
  mapLedgerRow,
  mapConversionRow,
  formatYmd,
  RebatePoolModels,
} = require('../services/rebate-pool-models');
const {
  validateCustomerAging,
  getExpiringTickets,
  getCustomerTickets,
  getTicketRedemptionHistory,
  getAuditLog,
} = require('../services/rebate-ticket-service');

router.use(requireAuth);
router.use('/shipment-evidence', require('./rebate-evidence'));

function sendRebateError(res, err) {
  const status = err?.status || err?.statusCode || 500;
  return res.status(status).json({
    error: err?.message || 'Internal Server Error',
    code: err?.code || 'REBATE_POOL_ERROR',
    details: err?.details || undefined,
  });
}

async function canAccessRebateCustomer(user, custId) {
  const scope = await require('../services/rebate-shared-scope').sharedRebateScopeFilter(user);
  const visible = await wfQuery(`SELECT TOP 1 1 AS ok FROM wf.v_RebateAccrualRemaining
    WHERE CustId=@cid AND ${scope.sql}`, { ...scope.inputs, cid: custId });
  return !!visible.recordset?.length;
}

// ── 1) Pure calculation preview ─────────────────────────────────────────────
router.post('/calculate', requireRebateAmountAccess, async (req, res) => {
  try {
    const { basePrice, sellingPrice, qtyTons, isCashDiscount } = req.body || {};
    const policy = await resolveConfiguredRebatePolicy();
    const result = calculateOrderPricingAndRebate(
      basePrice,
      sellingPrice,
      qtyTons,
      Boolean(isCashDiscount),
      policy
    );
    return res.json(result);
  } catch (err) {
    return sendRebateError(res, err);
  }
});

// ── 2) Ledger list & creation ───────────────────────────────────────────────
router.get('/ledger', requireRebateAmountAccess, async (req, res) => {
  // Do not present the separate legacy ledger as the new Pool balance.
  if (process.env.REBATE_POOL_103_ENABLED === 'true')
    return res.status(503).json({code:'REBATE_SHIPMENT_VIEW_UNAVAILABLE',error:'มุมมองยอดจากการขนส่งอยู่ระหว่างตรวจสอบ'});
  try {
    const custId = req.query.custId ? Number(req.query.custId) : null;
    const approvalStatus = req.query.approvalStatus ? String(req.query.approvalStatus) : null;
    const status = req.query.status ? String(req.query.status) : null;
    const limit = Math.min(Math.max(1, parseInt(String(req.query.limit || '100'), 10) || 100), 500);

    const dataWindow = await require('../services/global-data-window-store').readGlobalDataWindow();
    // This filters the displayed transaction history only. Conversion queues
    // and balances continue to include qualifying prior-period amounts.
    const where = ['EarnedDate >= @globalStartDate'];
    const params = { limit: { type: sql.Int, value: limit }, globalStartDate: { type: sql.Date, value: dataWindow.businessDate } };
    if (custId) {
      where.push('CustId = @custId');
      params.custId = { type: sql.Int, value: custId };
    }
    if (approvalStatus) {
      where.push('ApprovalStatus = @approvalStatus');
      params.approvalStatus = { type: sql.NVarChar(30), value: approvalStatus };
    }
    if (status) {
      where.push('Status = @status');
      params.status = { type: sql.NVarChar(30), value: status };
    }

    const r = await wfQuery(
      `SELECT TOP (@limit) *
       FROM wf.RebateTransactionLedger WITH (NOLOCK)
       WHERE ${where.join(' AND ')}
       ORDER BY EarnedDate DESC, CreatedAt DESC, Id DESC`,
      params
    );
    return res.json((r.recordset || []).map(mapLedgerRow));
  } catch (err) {
    return sendRebateError(res, err);
  }
});

router.post('/ledger', async (req, res) => {
  // The current body contains caller-supplied price/quantity and has no
  // authoritative, idempotent booking link. Never mint financial balances
  // from that input while the posting contract is being implemented.
  return res.status(503).json({ code: 'REBATE_POSTING_UNAVAILABLE', error: 'การบันทึก Rebate ผ่านช่องทางนี้ยังไม่พร้อมใช้งาน' });
});

// ── 3) Manager approval for -200 < diff <= -300 THB/ton ─────────────────────
router.post('/ledger/:id/approve', async (req, res) => {
  // This ledger is separate from the owner's confirmed shared claim balance.
  return res.status(503).json({ code: 'REBATE_SINGLE_SOURCE_REQUIRED', error: 'การอนุมัติอยู่ระหว่างเชื่อมยอดเดียวกับระบบเคลียร์รีเบท' });
});

router.post('/ledger/:id/reject', async (req, res) => {
  return res.status(503).json({ code: 'REBATE_SINGLE_SOURCE_REQUIRED', error: 'การอนุมัติอยู่ระหว่างเชื่อมยอดเดียวกับระบบเคลียร์รีเบท' });
});

// ── 4) Customer conversion queue & annual Nov 1 alerts ──────────────────────
router.get('/queue/:custId', requireRebateAmountAccess, async (req, res) => {
  try {
    const custId = Number(req.params.custId);
    const asOfDate = req.query.asOfDate ? String(req.query.asOfDate) : getBangkokDateString();
    const cutoff = (await require('../services/global-data-window-store').readGlobalDataWindow()).businessDate;
    const scope = await require('../services/rebate-shared-scope').sharedRebateScopeFilter(req.user);
    if(process.env.REBATE_POOL_103_ENABLED==='true') {
      const {withRebateRouteFence,routeParticipantFence,isShipmentEpoch}=require('../services/rebate-route-fence');
      const queue=await withRebateRouteFence(epoch=>wfTransaction(async tx=>{
        const q=transactionQuery(tx,sql);await routeParticipantFence(q,epoch);
        if(!isShipmentEpoch(epoch))throw Object.assign(Error('reset required'),{code:'REBATE_RESET_NOT_COMPLETED',status:409});
        const months=await require('../services/rebate-cycle-policy').readRebateCycleMonths(q,{lock:true});
        return require('../services/rebate-shipment-queue').getShipmentCustomerQueue(q,{epoch,custId,asOfDate,cutoff,scope,cycleMonths:months});
      }));
      return res.json(queue);
    }
    const cycleMonths = await require('../services/rebate-cycle-policy').readRebateCycleMonths(wfQuery);
    const queue = await require('../services/rebate-shared-queue').getSharedCustomerQueue(wfQuery, {
      custId, asOfDate, cutoff, scope, cycleMonths,
    });
    return res.json(queue);
  } catch (err) {
    return sendRebateError(res, err);
  }
});

router.get('/alerts', requireRebateAmountAccess, async (req, res) => {
  if (process.env.REBATE_POOL_103_ENABLED === 'true')
    return res.status(503).json({code:'REBATE_SHIPMENT_VIEW_UNAVAILABLE',error:'การแจ้งเตือนยอดจากการขนส่งอยู่ระหว่างตรวจสอบ'});
  try {
    const year = req.query.year ? Number(req.query.year) : Number(getBangkokDateString().slice(0, 4));
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return res.status(400).json({ code: 'INVALID_YEAR' });
    const scope = await require('../services/rebate-shared-scope').sharedRebateScopeFilter(req.user);
    const cycleMonths = await require('../services/rebate-cycle-policy').readRebateCycleMonths(wfQuery);
    const r = await wfQuery(
      `SELECT CustId AS Id, @year AS AlertYear, CustId, MAX(CustCode) AS CustCode, MAX(CustName) AS CustName,
         SUM(ROUND(RemainingTonRebate*RebatePerTon,2)) AS MaturedBalance, COUNT(*) AS LedgerCount
       FROM wf.v_RebateAccrualRemaining
       WHERE RemainingTonRebate > 0 AND PlanId IS NOT NULL AND RebatePerTon > 0
         AND SourceDocuDate <= @asOf AND DATEADD(MONTH,@months,SourceDocuDate) <= @asOf AND ${scope.sql}
       GROUP BY CustId ORDER BY MaturedBalance DESC,CustId`,
      { ...scope.inputs, year, asOf: `${year}-11-01`, months: cycleMonths }
    );
    return res.json(r.recordset || []);
  } catch (err) {
    return sendRebateError(res, err);
  }
});

router.post('/alerts/check', requireRole('ADMIN', 'ACCOUNTING', 'MANAGER', 'C_LEVEL'), async (req, res) => {
  // The legacy job writes alerts for a separate ledger, not the shared balance.
  // Keep it closed until a shared-source notification job is implemented.
  return res.status(503).json({ code: 'REBATE_SHARED_ALERT_UNAVAILABLE', error: 'การส่งแจ้งเตือนอยู่ระหว่างเชื่อมยอดเดียวกับระบบเคลียร์' });
});

// ── 5) Official Oct 31 standing prices ──────────────────────────────────────
router.get('/oct31-prices', async (req, res) => {
  try {
    const year = Number(req.query.year || getBangkokDateString().slice(0, 4));
    const items = await RebatePoolModels.listOct31StandingPrices(wfQuery, year);
    return res.json({ standingYear: year, items });
  } catch (err) {
    return sendRebateError(res, err);
  }
});

router.post('/oct31-prices/snapshot', requireRole('ADMIN', 'ACCOUNTING', 'MANAGER', 'C_LEVEL'), async (req, res) => {
  try {
    const { standingYear = null, entries = null } = req.body || {};
    const result = await wfTransaction(async tx => snapshotOct31StandingPrices(transactionQuery(tx, sql), {
      standingYear,
      entries,
      actorUser: req.user,
    }));
    return res.status(201).json(result);
  } catch (err) {
    return sendRebateError(res, err);
  }
});

// ── 6) Manual-only FIFO Fertilizer Ticket Conversion ────────────────────────
router.get('/conversions', requireRebateAmountAccess, async (req, res) => {
  try {
    const custId = req.query.custId ? Number(req.query.custId) : null;
    const limit = Math.min(Math.max(1, parseInt(String(req.query.limit || '100'), 10) || 100), 500);
    const dataWindow = await require('../services/global-data-window-store').readGlobalDataWindow();
    // ConvertedAt is stored in Bangkok local time by migration 187. This is a
    // history filter only; it must not change ticket or pool balances.
    const where = custId ? 'WHERE ConvertedAt >= @globalStartDate AND CustId = @custId' : 'WHERE ConvertedAt >= @globalStartDate';
    const r = await wfQuery(
      `SELECT TOP (@limit) *
       FROM wf.FertilizerTicketConversion WITH (NOLOCK)
       ${where}
       ORDER BY ConvertedAt DESC, Id DESC`,
      custId
        ? { limit, custId, globalStartDate: { type: sql.Date, value: dataWindow.businessDate } }
        : { limit, globalStartDate: { type: sql.Date, value: dataWindow.businessDate } }
    );
    const conversions = (r.recordset || []).map(mapConversionRow);
    if (conversions.length) {
      const ids = conversions.map((_, i) => `@conversion${i}`);
      const params = { globalStartDate: { type: sql.Date, value: dataWindow.businessDate } };
      conversions.forEach((row, i) => { params[`conversion${i}`] = { type: sql.BigInt, value: row.id }; });
      // Old allocations remain part of the conversion total but their source
      // documents are hidden from history under the data-window policy.
      const allocations = await wfQuery(
        `SELECT a.ConversionId, a.LedgerId, a.DeductionOrder, a.DeductedAmount, a.RemainingAfter,
                l.DocNo, l.EarnedDate
         FROM wf.FertilizerTicketConversionAllocation a
         JOIN wf.RebateTransactionLedger l ON l.Id = a.LedgerId
         WHERE a.ConversionId IN (${ids.join(', ')}) AND l.EarnedDate >= @globalStartDate
         ORDER BY a.ConversionId, a.DeductionOrder`, params);
      const byId = new Map(conversions.map(row => [row.id, []]));
      for (const row of allocations.recordset || []) {
        byId.get(Number(row.ConversionId))?.push({ ledgerId: Number(row.LedgerId),
          docNo: row.DocNo || null, earnedDate: formatYmd(row.EarnedDate),
          deductedAmount: Number(row.DeductedAmount), remainingAfter: Number(row.RemainingAfter) });
      }
      const shared = await wfQuery(`SELECT a.ConversionId,a.SourceSOID,a.SourceListNo,a.QtyTon,a.AmountBaht,
          h.DocuNo,h.DocuDate
        FROM wf.RebateConversionSourceAllocation a
        JOIN dbo.SOHD h ON h.SOID=a.SourceSOID
        WHERE a.ConversionId IN (${ids.join(', ')}) AND h.DocuDate >= @globalStartDate
        ORDER BY a.ConversionId,h.DocuDate,h.DocuNo,a.SourceListNo`, params);
      for (const row of shared.recordset || []) {
        byId.get(Number(row.ConversionId))?.push({ ledgerId: null, sourceSOID: Number(row.SourceSOID),
          sourceListNo: Number(row.SourceListNo), docNo: row.DocuNo || null, earnedDate: formatYmd(row.DocuDate),
          qtyTon: Number(row.QtyTon), deductedAmount: Number(row.AmountBaht), remainingAfter: null });
      }
      conversions.forEach(row => { row.allocations = byId.get(row.id) || []; });
    }
    return res.json(conversions);
  } catch (err) {
    return sendRebateError(res, err);
  }
});

router.post('/conversions/execute', requireCapability('rebate.convert'), async (req, res) => {
  // Both switches default off. Only the post-reset shared shipment epoch may
  // be used through HTTP; the old standalone Pool ledger is never accepted.
  if (process.env.REBATE_POOL_103_ENABLED !== 'true' || process.env.REBATE_CONVERSION_ENABLED !== 'true')
    return res.status(503).json({ code: 'REBATE_SINGLE_SOURCE_REQUIRED', error: 'การแปลง Rebate ยังไม่เปิดใช้งาน' });
  try {
    const result=await require('../services/rebate-conversion-execution').executeReviewedConversion(req.user,req.body,{requireShipmentEpoch:true});
    return res.json(result);
  } catch(err) { return sendRebateError(res,err); }
});

// ── 7) Fertilizer Tickets (ตั๋วปุ๋ย) ──────────────────────────────────────
router.get('/tickets', requireRebateAmountAccess, async (req, res) => {
  try {
    const custId = req.query.custId ? Number(req.query.custId) : null;
    if (!Number.isSafeInteger(custId) || custId <= 0) {
      return res.status(400).json({ error: 'กรุณาระบุ custId', code: 'MISSING_CUST_ID' });
    }
    if (!await canAccessRebateCustomer(req.user, custId)) return res.status(404).json({ code: 'REBATE_CUSTOMER_OUT_OF_SCOPE' });
    const includeExpired = req.query.includeExpired === 'true';
    const tickets = await getCustomerTickets(wfQuery, { custId, includeExpired });
    return res.json(tickets);
  } catch (err) {
    return sendRebateError(res, err);
  }
});

router.post('/tickets/issue', requireRole('ADMIN', 'ACCOUNTING', 'REBATE_CONVERTER'), async (req, res) => {
  // Issuance must lock and consume exactly one verified conversion; the old
  // interface trusted amounts supplied by the caller and permitted duplicates.
  return res.status(503).json({ code: 'TICKET_ISSUANCE_UNAVAILABLE', error: 'การออกตั๋วปุ๋ยยังไม่พร้อมใช้งาน' });
});

router.post('/tickets/redeem', requireCapability('rebate.ticket-redeem'), async (req, res) => {
  // The order/customer/product link and caller scope must be verified before
  // allowing a FIFO deduction. A submitted amount alone is not evidence.
  return res.status(503).json({ code: 'TICKET_REDEMPTION_UNAVAILABLE', error: 'การใช้ตั๋วปุ๋ยยังไม่พร้อมใช้งาน' });
});

router.get('/tickets/:ticketId/history', requireRebateAmountAccess, async (req, res) => {
  try {
    const ticketId = Number(req.params.ticketId);
    if (!Number.isInteger(ticketId) || ticketId <= 0) {
      return res.status(400).json({ error: 'Invalid ticket id', code: 'INVALID_ID' });
    }
    const ticket = await wfQuery('SELECT CustId FROM wf.FertilizerTicket WHERE Id=@id', { id: ticketId });
    const custId = Number(ticket.recordset?.[0]?.CustId);
    if (!Number.isSafeInteger(custId) || !await canAccessRebateCustomer(req.user, custId)) {
      return res.status(404).json({ code: 'TICKET_NOT_FOUND' });
    }
    const dataWindow = await require('../services/global-data-window-store').readGlobalDataWindow();
    const history = await getTicketRedemptionHistory(wfQuery, ticketId, { startDate: dataWindow.businessDate });
    return res.json(history);
  } catch (err) {
    return sendRebateError(res, err);
  }
});

// ── 8) Expired Ticket Extension (Executive Override) ────────────────────────
router.post('/tickets/:ticketId/extend', requireCapability('rebate.ticket-extend'), async (req, res) => {
  return res.status(503).json({ code: 'TICKET_EXTENSION_UNAVAILABLE', error: 'การต่ออายุตั๋วอยู่ระหว่างตรวจสอบและยังไม่พร้อมใช้งาน' });
});

// ── 9) AR Aging Check & Override ────────────────────────────────────────────
router.get('/aging/:custId', requireRebateAmountAccess, async (req, res) => {
  try {
    const custId = Number(req.params.custId);
    if (!Number.isSafeInteger(custId) || custId <= 0) return res.status(400).json({ code: 'INVALID_ID' });
    if (!await canAccessRebateCustomer(req.user, custId)) return res.status(404).json({ code: 'REBATE_CUSTOMER_OUT_OF_SCOPE' });
    const result = await validateCustomerAging(wfQuery, custId);
    return res.json(result);
  } catch (err) {
    return sendRebateError(res, err);
  }
});

router.post('/aging/:custId/override', requireCapability('rebate.aging-override'), async (req, res) => {
  // A log entry alone is not a consumable, bound approval. Avoid telling users
  // an override is granted until it is linked to a specific transaction.
  return res.status(503).json({ code: 'AGING_OVERRIDE_UNAVAILABLE', error: 'การอนุมัติยกเว้นอายุหนี้ยังไม่พร้อมใช้งาน' });
});

// ── 10) Daily Ticket Expiry Cron & Expiry Warnings ──────────────────────────
router.post('/tickets/expire', requireRole('ADMIN', 'ACCOUNTING'), async (req, res) => {
  return res.status(503).json({ code: 'TICKET_EXPIRY_UNAVAILABLE', error: 'การเปลี่ยนสถานะตั๋วหมดอายุอยู่ระหว่างตรวจสอบและยังไม่พร้อมใช้งาน' });
});

router.get('/tickets/expiring', requireRebateAmountAccess, async (req, res) => {
  try {
    const warningDays = parseInt(req.query.warningDays || '15', 10) || 15;
    const result = await getExpiringTickets(wfQuery, {
      warningDays,
      asOfDate: req.query.asOfDate || null,
    });
    return res.json(result);
  } catch (err) {
    return sendRebateError(res, err);
  }
});

// ── 11) Audit Log ───────────────────────────────────────────────────────────
router.get('/audit', requireRole('ADMIN', 'C_LEVEL', 'MANAGER', 'ACCOUNTING'), async (req, res) => {
  try {
    const window = await require('../services/global-data-window-store').readGlobalDataWindow();
    const logs = await getAuditLog(wfQuery, {
      entityType: req.query.entityType || null,
      entityId: req.query.entityId ? Number(req.query.entityId) : null,
      custId: req.query.custId ? Number(req.query.custId) : null,
      limit: parseInt(req.query.limit || '100', 10),
      startDate: window.businessDate,
    });
    return res.json(logs);
  } catch (err) {
    return sendRebateError(res, err);
  }
});

// ── 12) Reset fences: status and first-time initialization ──────────────────
// The fences must exist before the Rebate Pool switch can be used in an
// environment. Initialization writes generation 0 only: it changes no balance,
// cancels nothing and is not a reset. On-prem only, from the primary database.
const RESET_ADMIN_MESSAGES = Object.freeze({
  REBATE_POOL_103_UNAVAILABLE: 'ระบบ Rebate Pool ยังไม่เปิดใช้งานในสภาพแวดล้อมนี้',
  REBATE_RESET_ENVIRONMENT_INVALID: 'ใช้งานได้เฉพาะระบบที่ติดตั้งบนเซิร์ฟเวอร์ของบริษัท',
  REBATE_RESET_PRIMARY_SESSION_REQUIRED: 'กรุณาสลับกลับมาที่ฐานข้อมูลหลักก่อนทำรายการนี้',
  REBATE_RESET_CONFIRMATION_REQUIRED: 'กรุณายืนยันสภาพแวดล้อมและพิมพ์คำยืนยันให้ถูกต้อง',
  REBATE_RESET_REASON_REQUIRED: 'กรุณาระบุเหตุผล (ไม่เกิน 500 ตัวอักษร)',
  REBATE_RESET_HISTORY_EXISTS: 'ฐานข้อมูลนี้มีประวัติการเริ่มยอดรีเบทใหม่อยู่แล้ว ตั้งค่าเริ่มต้นซ้ำไม่ได้ ต้องให้ผู้ดูแลระบบตรวจสอบ',
  REBATE_RESET_COORDINATOR_MISMATCH: 'สถานะตัวควบคุมรีเบทไม่ตรงกับการตั้งค่าของระบบ ต้องให้ผู้ดูแลระบบตรวจสอบ',
  REBATE_RESET_PARTICIPANT_MISMATCH: 'สถานะรีเบทของบางฐานข้อมูลไม่ตรงกับการตั้งค่าของระบบ ต้องให้ผู้ดูแลระบบตรวจสอบ',
  REBATE_RESET_PREFLIGHT_FAILED: 'บางฐานข้อมูลยังไม่มีตารางที่จำเป็น กรุณาอัปเดตฐานข้อมูลให้ครบก่อน',
});

function sendResetAdminError(res, err) {
  const code = typeof err?.code === 'string' && /^REBATE_/.test(err.code) ? err.code : null;
  if (!code) { console.error('[rebate-pool/reset]', err); return res.status(500).json({ code: 'REBATE_POOL_ERROR', error: 'ไม่สามารถทำรายการได้' }); }
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 503;
  return res.status(status).json({ code, error: RESET_ADMIN_MESSAGES[code] || 'ระบบรีเบทยังไม่พร้อมใช้งาน กรุณาแจ้งผู้ดูแลระบบ' });
}

function assertOnPremPrimarySession() {
  const db = require('../db');
  const fail = code => { throw Object.assign(new Error(code), { code, status: 409 }); };
  if (db.getTarget() !== 'onprem') fail('REBATE_RESET_ENVIRONMENT_INVALID');
  const primary = String(require('../services/active-database').primaryDatabase() || '').trim().toLowerCase();
  const session = String(db.getDbName() || primary).trim().toLowerCase();
  if (!primary || session !== primary) fail('REBATE_RESET_PRIMARY_SESSION_REQUIRED');
}

router.get('/reset/status', requireRole('ADMIN'), async (req, res) => {
  try {
    assertOnPremPrimarySession();
    return res.json(await require('../services/rebate-reset-initialize').readRebateEnvironmentStatus());
  } catch (err) {
    return sendResetAdminError(res, err);
  }
});

router.post('/reset/initialize', requireRole('ADMIN'), async (req, res) => {
  try {
    if (process.env.REBATE_POOL_103_ENABLED !== 'true') {
      return res.status(503).json({ code: 'REBATE_POOL_103_UNAVAILABLE', error: RESET_ADMIN_MESSAGES.REBATE_POOL_103_UNAVAILABLE });
    }
    assertOnPremPrimarySession();
    // The administrator names the environment and types the confirmation, so a
    // request aimed at UAT cannot initialize Production or the other way round.
    const expected = String(process.env.ONPREM_TARGET_KIND || '').trim().toLowerCase();
    if (req.body?.confirm !== 'INITIALIZE' || String(req.body?.environment || '').trim().toLowerCase() !== expected || !expected) {
      return res.status(400).json({ code: 'REBATE_RESET_CONFIRMATION_REQUIRED', error: RESET_ADMIN_MESSAGES.REBATE_RESET_CONFIRMATION_REQUIRED });
    }
    const identity = require('../services/approval-identity').approvalIdentity(req.user);
    const result = await require('../services/rebate-reset-initialize').initializeRebateEnvironment({
      actorId: identity.actorId, effectiveId: identity.effectiveId, reason: req.body?.reason,
    });
    return res.status(result.coordinatorCreated ? 201 : 200).json(result);
  } catch (err) {
    return sendResetAdminError(res, err);
  }
});

module.exports = router;

