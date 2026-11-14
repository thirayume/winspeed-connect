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

// Disabled by default until the cross-database fence audit and UAT pass.
// Database targets are derived exclusively from server configuration.
router.get('/admin/reset', requireRole('ADMIN'), async (req,res)=>{
  try { return res.json(await require('../services/rebate-reset-admin').getResetStatus(req.user)); }
  catch(e) { return res.status(e.status||503).json({code:e.code||'REBATE_RESET_UNAVAILABLE',message:'ไม่สามารถตรวจความพร้อม Reset Rebate ได้'}); }
});
router.post('/admin/reset', requireRole('ADMIN'), async (req,res)=>{
  try { return res.json(await require('../services/rebate-reset-admin').executeReset(req.user,req.body||{})); }
  catch(e) { return res.status(e.status||503).json({code:e.code||'REBATE_RESET_UNAVAILABLE',
    message:'Reset Rebate ยังไม่สำเร็จ กรุณาตรวจสถานะและลองคำขอเดิมอีกครั้ง',
    ...(e.resetRequestId?{requestId:e.resetRequestId}:{})}); }
});

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
router.get('/customers', requireRebateAmountAccess, async (req, res) => {
  if (process.env.REBATE_POOL_103_ENABLED !== 'true')
    return res.status(503).json({ code: 'REBATE_POOL_103_UNAVAILABLE', error: 'กอง Rebate ใหม่ยังไม่เปิดใช้งาน' });
  try {
    const after = req.query.after == null ? 0 : Number(req.query.after);
    const limit = req.query.limit == null ? 10 : Number(req.query.limit);
    const search = req.query.search == null ? '' : String(req.query.search).trim();
    const asOfDate = getBangkokDateString();
    const cutoff = (await require('../services/global-data-window-store').readGlobalDataWindow()).businessDate;
    const scope = await require('../services/rebate-shared-scope').sharedRebateScopeFilter(req.user);
    const { withRebateRouteFence, routeParticipantFence, isShipmentEpoch } = require('../services/rebate-route-fence');
    const result = await withRebateRouteFence(epoch => wfTransaction(async tx => {
      const q = transactionQuery(tx, sql);
      await routeParticipantFence(q, epoch);
      if (!isShipmentEpoch(epoch)) throw Object.assign(new Error('reset required'), { code: 'REBATE_RESET_NOT_COMPLETED', status: 409 });
      const cycleMonths = await require('../services/rebate-cycle-policy').readRebateCycleMonths(q, { lock: true });
      return require('../services/rebate-shipment-customer-overview').getShipmentCustomerOverview(q,
        { epoch, scope, asOfDate, cutoff, cycleMonths, after, limit, search });
    }));
    return res.json(result);
  } catch (err) { return sendRebateError(res, err); }
});

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
  // Owner requires a sales request and an explicit role-authorized decision.
  // Do not let the earlier one-step API bypass that approval, even if old
  // environment flags are enabled. Existing receipts remain unchanged.
  return res.status(503).json({ code: 'REBATE_CONVERSION_APPROVAL_REQUIRED',
    error: 'การแปลง Rebate ต้องผ่านการยื่นและอนุมัติ ระบบกำลังเชื่อมขั้นตอนนี้' });
});

// The new request workflow is isolated behind its own default-off switch. It
// must not be enabled until the reset coordinator, UAT and accounting checks
// are complete. Decision writers use the same epoch and business transaction.
function conversionApprovalsEnabled(req, res, next) {
  if (process.env.REBATE_POOL_103_ENABLED !== 'true' || process.env.REBATE_CONVERSION_APPROVAL_ENABLED !== 'true')
    return res.status(503).json({ code: 'REBATE_APPROVAL_WORKFLOW_UNAVAILABLE', error: 'ระบบคำขอแปลง Rebate ยังไม่เปิดใช้งาน' });
  next();
}
async function verifyConversionTarget(query, expectedDatabase) {
  if (typeof expectedDatabase !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(expectedDatabase))
    throw Object.assign(new Error('กรุณาตรวจสอบฐานข้อมูลปัจจุบัน'), { code:'REBATE_TARGET_REQUIRED', status:400 });
  const actual = (await query('SELECT DB_NAME() AS DatabaseName', {})).recordset?.[0]?.DatabaseName;
  if (String(actual || '').trim().toLowerCase() !== expectedDatabase.toLowerCase())
    throw Object.assign(new Error('ฐานข้อมูลเปลี่ยนหรือไม่ตรงกับที่เลือก กรุณาตรวจสอบอีกครั้ง'), { code:'REBATE_TARGET_MISMATCH', status:409 });
}
router.get('/conversion-requests', conversionApprovalsEnabled, async (req, res) => {
  try {
    const { authorizeConversionAction } = require('../services/rebate-conversion-approval-policy');
    let requester = null, reviewer = null;
    try { requester = authorizeConversionAction(req.user, 'REQUEST'); } catch (err) {
      if (err.code !== 'REBATE_CONVERSION_PERMISSION_REQUIRED') throw err;
    }
    try { reviewer = authorizeConversionAction(req.user, 'APPROVE'); } catch (err) {
      if (err.code !== 'REBATE_CONVERSION_PERMISSION_REQUIRED') throw err;
    }
    if (!requester && !reviewer) return res.status(403).json({ code: 'REBATE_CONVERSION_PERMISSION_REQUIRED' });
    const identity = reviewer || requester;
    const windowStartUtc = (await require('../services/global-data-window-store').readGlobalDataWindow()).utcInstant;
    const { withRebateRouteFence, routeParticipantFence, isShipmentEpoch } = require('../services/rebate-route-fence');
    const authorizeScope = require('../services/rebate-conversion-approval-scope').authorizeConversionRequestScope;
    const actor = require('../services/business-identity').actorPerspective(req.user);
    const showMoney = require('../middleware/auth').canViewAllRebateAmounts(req.user) &&
      require('../middleware/auth').canViewAllRebateAmounts(actor);
    const result = await withRebateRouteFence(epoch => wfTransaction(async tx => {
      const q = transactionQuery(tx, sql); await routeParticipantFence(q, epoch);
      if (!isShipmentEpoch(epoch)) throw Object.assign(new Error('reset required'), { code: 'REBATE_RESET_NOT_COMPLETED', status: 409 });
      const database = (await q('SELECT DB_NAME() AS DatabaseName', {})).recordset?.[0]?.DatabaseName;
      if (typeof database !== 'string' || !database.trim()) throw Object.assign(new Error('database unavailable'), {code:'REBATE_TARGET_UNAVAILABLE',status:503});
      const rows = (await q(`SELECT TOP (50) r.Id,r.CustId,r.ConversionId,r.Status,r.CreatedAtUtc,
          r.ActorPrimaryId,r.EffectivePrimaryId,c.CustCode,c.CustName,c.GoodName,c.ConvertedValueBaht,c.ConvertedTons
        FROM wf.RebateConversionApprovalRequest r
        JOIN wf.FertilizerTicketConversion c ON c.Id=r.ConversionId AND c.CustId=r.CustId
        WHERE r.EnvironmentKind=@environment AND r.ResetId=@resetId AND r.Generation=@generation
          AND r.CreatedAtUtc>=@windowStartUtc
          AND (@reviewer=1 OR (r.ActorPrimaryId=@actor AND r.EffectivePrimaryId=@effective)) ORDER BY r.Id DESC`, {
        environment:epoch.environment,resetId:epoch.resetId,generation:epoch.generation,windowStartUtc,
        reviewer:!!reviewer,actor:identity.actorPrimaryId,effective:identity.effectivePrimaryId })).recordset || [];
      const items=[];
      for (const row of rows) {
        try { await authorizeScope(q, req.user, row); }
        catch (err) { if (err.code === 'REBATE_CONVERSION_REQUEST_NOT_FOUND') continue; throw err; }
        items.push({ id:Number(row.Id),custId:Number(row.CustId),custCode:row.CustCode||null,custName:row.CustName||null,
          goodName:row.GoodName||null,status:row.Status,createdAtUtc:row.CreatedAtUtc,
          canCancel:!!requester && row.Status==='PENDING' && Number(row.EffectivePrimaryId)===requester.effectivePrimaryId,
          canDecide:!!reviewer && row.Status==='PENDING',
          ...(showMoney ? { amount:Number(row.ConvertedValueBaht),tons:Number(row.ConvertedTons) } : {}) });
      }
      return { items, limit:50, database };
    }));
    return res.json(result);
  } catch (err) { return sendRebateError(res, err); }
});
router.post('/conversion-requests', conversionApprovalsEnabled, requireCapability('rebate.conversion.request'), async (req, res) => {
  try {
    const { withRebateRouteFence, isShipmentEpoch } = require('../services/rebate-route-fence');
    const windowStartUtc = (await require('../services/global-data-window-store').readGlobalDataWindow()).utcInstant;
    const result = await withRebateRouteFence(epoch => {
      if (!isShipmentEpoch(epoch)) throw Object.assign(new Error('reset required'), { code: 'REBATE_RESET_NOT_COMPLETED', status: 409 });
      return wfTransaction(async tx => {
        const q = transactionQuery(tx, sql); await verifyConversionTarget(q, req.body?.expectedDatabase);
        return require('../services/rebate-conversion-approval-request').createConversionApprovalRequest(q, req.user, req.body, epoch, { windowStartUtc });
      });
    });
    return res.json(result);
  } catch (err) { return sendRebateError(res, err); }
});
router.post('/conversion-requests/:id/:action', conversionApprovalsEnabled, async (req, res) => {
  try {
    const action = String(req.params.action || '').toUpperCase();
    if (!['APPROVE','REJECT','CANCEL'].includes(action))
      return res.status(400).json({ code: 'REBATE_CONVERSION_ACTION_INVALID', error: 'คำสั่งไม่ถูกต้อง' });
    const { withRebateRouteFence, isShipmentEpoch } = require('../services/rebate-route-fence');
    const authorizeScope = require('../services/rebate-conversion-approval-scope').authorizeConversionRequestScope;
    const windowStartUtc = (await require('../services/global-data-window-store').readGlobalDataWindow()).utcInstant;
    const result = await withRebateRouteFence(epoch => {
      if (!isShipmentEpoch(epoch)) throw Object.assign(new Error('reset required'), { code: 'REBATE_RESET_NOT_COMPLETED', status: 409 });
      return wfTransaction(async tx => {
        const q = transactionQuery(tx, sql), input = { id: Number(req.params.id), action, reason: req.body?.reason };
        await verifyConversionTarget(q, req.body?.expectedDatabase);
        return action === 'APPROVE'
          ? require('../services/rebate-conversion-approval-issue').approveConversionRequest(q, req.user, input, epoch, { authorizeScope, windowStartUtc })
          : require('../services/rebate-conversion-approval-release').releaseConversionApprovalRequest(q, req.user, input, epoch, { authorizeScope, windowStartUtc });
      });
    });
    return res.json(result);
  } catch (err) { return sendRebateError(res, err); }
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

// Read-only UAT preview: verifies the locked 103, current scope, aging and
// available ticket tons. It neither consumes a ticket nor certifies the
// accounting treatment. The real writer remains separately closed.
router.post('/tickets/redemption-preview', requireCapability('rebate.ticket-redeem'), async (req,res)=>{
  if(process.env.REBATE_POOL_103_ENABLED!=='true'||process.env.REBATE_TICKET_PREVIEW_ENABLED!=='true')
    return res.status(503).json({code:'TICKET_PREVIEW_UNAVAILABLE',message:'การตรวจตั๋ว Rebate ยังไม่เปิดใช้งาน'});
  try {
    const {withRebateRouteFence,routeParticipantFence,isShipmentEpoch}=require('../services/rebate-route-fence');
    const window=await require('../services/global-data-window-store').readGlobalDataWindow();
    const result=await withRebateRouteFence(epoch=>wfTransaction(async tx=>{
      const q=transactionQuery(tx,sql);await routeParticipantFence(q,epoch);
      if(!isShipmentEpoch(epoch))throw Object.assign(Error('reset required'),{code:'REBATE_RESET_NOT_COMPLETED',status:409});
      await verifyConversionTarget(q,req.body?.expectedDatabase);
      const proof=await require('../services/rebate-ticket-booking-proof').prepareTicketBookingProof(q,{
        user:req.user,bookingId:Number(req.body?.bookingId),lineNo:Number(req.body?.lineNo),
        requestedTonnage:req.body?.requestedTonnage,startDate:window.businessDate});
      // Do not expose financial fields or customer data beyond the already
      // authorized booking. A preview does not reserve or consume anything.
      return {bookingId:proof.bookingId,lineNo:proof.lineNo,quantityTon:proof.plan.quantityTon,
        ticketCount:proof.plan.allocations.length,asOfDate:proof.plan.asOfDate,
        readyForRedemption:false};
    }));
    return res.json(result);
  } catch(e) {
    const status=Number.isInteger(e.status)&&e.status>=400&&e.status<=599?e.status:503;
    return res.status(status).json({code:e.code||'TICKET_PREVIEW_UNAVAILABLE',message:'ไม่สามารถตรวจตั๋วกับใบจองได้ กรุณาตรวจสิทธิ์ ยอดตั๋ว และข้อมูลต้นทาง'});
  }
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

module.exports = router;

