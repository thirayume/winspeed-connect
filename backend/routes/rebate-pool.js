/**
 * /api/rebate-pool — New Rebate Pool Ledger, Over-Limit Approval,
 *                    Oct 31 Standing Price Snapshot & Manual FIFO Conversion
 */

const express = require('express');
const router = express.Router();
const { wfQuery } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getBangkokDateString } = require('../services/so-pickup-policy');
const {
  calculateOrderPricingAndRebate,
  recordRebateTransaction,
  approveOverLimitRebate,
  rejectOverLimitRebate,
  resolveConfiguredRebatePolicy,
} = require('../services/rebate-calculator-service');
const {
  getCustomerConversionQueue,
  runNovember1ConversionAlertCheck,
  snapshotOct31StandingPrices,
  executeManualTicketConversion,
  isAuthorizedConverter,
} = require('../services/rebate-conversion-service');
const {
  mapLedgerRow,
  mapConversionRow,
  RebatePoolModels,
} = require('../services/rebate-pool-models');

router.use(requireAuth);

function sendRebateError(res, err) {
  const status = err?.status || err?.statusCode || 500;
  return res.status(status).json({
    error: err?.message || 'Internal Server Error',
    code: err?.code || 'REBATE_POOL_ERROR',
    details: err?.details || undefined,
  });
}

// ── 1) Pure calculation preview ─────────────────────────────────────────────
router.post('/calculate', async (req, res) => {
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
router.get('/ledger', async (req, res) => {
  try {
    const custId = req.query.custId ? Number(req.query.custId) : null;
    const approvalStatus = req.query.approvalStatus ? String(req.query.approvalStatus) : null;
    const status = req.query.status ? String(req.query.status) : null;
    const limit = Math.min(Math.max(1, parseInt(String(req.query.limit || '100'), 10) || 100), 500);

    const where = ['1 = 1'];
    const params = { limit };
    if (custId) {
      where.push('CustId = @custId');
      params.custId = custId;
    }
    if (approvalStatus) {
      where.push('ApprovalStatus = @approvalStatus');
      params.approvalStatus = approvalStatus;
    }
    if (status) {
      where.push('Status = @status');
      params.status = status;
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
  try {
    const payload = { ...(req.body || {}), createdByUserId: req.user?.id };
    const result = await recordRebateTransaction(wfQuery, payload, { actorUser: req.user });
    return res.status(201).json(result);
  } catch (err) {
    return sendRebateError(res, err);
  }
});

// ── 3) Manager approval for -200 < diff <= -300 THB/ton ─────────────────────
router.post('/ledger/:id/approve', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid ledger id', code: 'INVALID_ID' });
    }
    const updated = await approveOverLimitRebate(undefined, {
      ledgerId: id,
      actorUser: req.user,
      note: req.body?.note || null,
    });
    return res.json(updated);
  } catch (err) {
    return sendRebateError(res, err);
  }
});

router.post('/ledger/:id/reject', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid ledger id', code: 'INVALID_ID' });
    }
    const updated = await rejectOverLimitRebate(undefined, {
      ledgerId: id,
      actorUser: req.user,
      note: req.body?.note || null,
    });
    return res.json(updated);
  } catch (err) {
    return sendRebateError(res, err);
  }
});

// ── 4) Customer conversion queue & annual Nov 1 alerts ──────────────────────
router.get('/queue/:custId', async (req, res) => {
  try {
    const custId = Number(req.params.custId);
    const asOfDate = req.query.asOfDate ? String(req.query.asOfDate) : null;
    const queue = await getCustomerConversionQueue(wfQuery, { custId, asOfDate });
    return res.json(queue);
  } catch (err) {
    return sendRebateError(res, err);
  }
});

router.get('/alerts', async (req, res) => {
  try {
    const year = req.query.year ? Number(req.query.year) : Number(getBangkokDateString().slice(0, 4));
    const r = await wfQuery(
      `SELECT *
       FROM wf.RebateConversionAlert WITH (NOLOCK)
       WHERE AlertYear = @year
       ORDER BY MaturedBalance DESC, CustId ASC`,
      { year }
    );
    return res.json(r.recordset || []);
  } catch (err) {
    return sendRebateError(res, err);
  }
});

router.post('/alerts/check', requireRole('ADMIN', 'ACCOUNTING', 'MANAGER', 'C_LEVEL'), async (req, res) => {
  try {
    const { asOfDate = null, force = false } = req.body || {};
    const result = await runNovember1ConversionAlertCheck(wfQuery, { asOfDate, force: Boolean(force) });
    return res.json(result);
  } catch (err) {
    return sendRebateError(res, err);
  }
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
    const result = await snapshotOct31StandingPrices(wfQuery, {
      standingYear,
      entries,
      actorUser: req.user,
    });
    return res.status(201).json(result);
  } catch (err) {
    return sendRebateError(res, err);
  }
});

// ── 6) Manual-only FIFO Fertilizer Ticket Conversion ────────────────────────
router.get('/conversions', async (req, res) => {
  try {
    const custId = req.query.custId ? Number(req.query.custId) : null;
    const limit = Math.min(Math.max(1, parseInt(String(req.query.limit || '100'), 10) || 100), 500);
    const where = custId ? 'WHERE CustId = @custId' : '';
    const r = await wfQuery(
      `SELECT TOP (@limit) *
       FROM wf.FertilizerTicketConversion WITH (NOLOCK)
       ${where}
       ORDER BY ConvertedAt DESC, Id DESC`,
      custId ? { limit, custId } : { limit }
    );
    return res.json((r.recordset || []).map(mapConversionRow));
  } catch (err) {
    return sendRebateError(res, err);
  }
});

router.post('/conversions/execute', async (req, res) => {
  try {
    if (!isAuthorizedConverter(req.user)) {
      return res.status(403).json({
        error: 'บัญชีผู้ใช้นี้ไม่มีสิทธิ์แปลง Rebate Pool เป็นตั๋วปุ๋ย',
        code: 'FORBIDDEN_CONVERTER_ROLE',
      });
    }
    const result = await executeManualTicketConversion(undefined, {
      ...(req.body || {}),
      actorUser: req.user,
    });
    return res.status(201).json(result);
  } catch (err) {
    return sendRebateError(res, err);
  }
});

module.exports = router;

