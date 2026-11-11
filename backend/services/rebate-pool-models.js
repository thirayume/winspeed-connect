/**
 * Rebate Pool Schema & Models
 * Canonical definitions, row mappers, and SQL Server 2008 R2+ persistence helpers
 * for:
 *   - wf.RebateTransactionLedger
 *   - wf.Oct31StandingPrice
 *   - wf.FertilizerTicketConversion
 *   - wf.FertilizerTicketConversionAllocation
 *   - wf.RebateConversionAlert
 */

const crypto = require('crypto');
const { wfQuery, sql } = require('../db');

const REBATE_CONSTANTS = Object.freeze({
  STANDARD_DISCOUNT_LIMIT: 200,
  MAX_DISCOUNT_LIMIT: 300,
  STANDARD_MARKUP_CAP: 200,
  CYCLE_MONTHS: 12,
  CONVERSION_ALERT_MONTH: 11,
  CONVERSION_ALERT_DAY: 1,
  BAGS_PER_TON: 20,
});

const LEDGER_STATUS = Object.freeze({
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  REJECTED: 'REJECTED',
  ACTIVE: 'ACTIVE',
  READY_FOR_CONVERSION: 'READY_FOR_CONVERSION',
  PARTIALLY_CONVERTED: 'PARTIALLY_CONVERTED',
  CONVERTED: 'CONVERTED',
  VOID: 'VOID',
});

const APPROVAL_STATUS = Object.freeze({
  NOT_REQUIRED: 'NOT_REQUIRED',
  PENDING_MANAGER_APPROVAL: 'PENDING_MANAGER_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
});

const PRICING_MODE = Object.freeze({
  CASH_DISCOUNT: 'CASH_DISCOUNT',
  STANDARD_LIST: 'STANDARD_LIST',
  REBATE_WITHIN_LIMIT: 'REBATE_WITHIN_LIMIT',
  REBATE_OVER_LIMIT: 'REBATE_OVER_LIMIT',
  MARKUP_STANDARD: 'MARKUP_STANDARD',
  MARKUP_EXTRA_PROFIT: 'MARKUP_EXTRA_PROFIT',
});

const CONVERSION_STATUS = Object.freeze({
  ISSUED: 'ISSUED',
  VOID: 'VOID',
});

const AUTHORIZED_CONVERTER_ROLES = Object.freeze([
  'ROLE_AUTHORIZED_REBATE_CONVERTER',
  'REBATE_CONVERTER',
  'ACCOUNTING',
  'ADMIN',
]);

function round2(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

function round4(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 10000) / 10000;
}

function formatYmd(input) {
  if (!input) return null;
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.trim())) {
    return input.trim();
  }
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Computes cycle_expiry_date (+cycleMonths calendar months from earnedDate).
 * Preserves end-of-month clamping (e.g., 2024-02-29 + 12m => 2025-02-28).
 */
function computeCycleExpiryDate(earnedDateInput, cycleMonths = REBATE_CONSTANTS.CYCLE_MONTHS) {
  const ymd = formatYmd(earnedDateInput);
  if (!ymd) throw new Error('Invalid earnedDate for cycle expiry computation');
  const [y, m, d] = ymd.split('-').map(Number);
  const months = Math.max(1, parseInt(cycleMonths, 10) || REBATE_CONSTANTS.CYCLE_MONTHS);
  const targetZeroMonth = (m - 1) + months;
  const targetYear = y + Math.floor(targetZeroMonth / 12);
  const targetMonth = (targetZeroMonth % 12) + 1;
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const clampedDay = Math.min(d, lastDayOfTargetMonth);
  const mm = String(targetMonth).padStart(2, '0');
  const dd = String(clampedDay).padStart(2, '0');
  return `${targetYear}-${mm}-${dd}`;
}

function generateDocCode(prefix, dateStr) {
  const compactDate = (formatYmd(dateStr) || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${compactDate}-${rand}`;
}

function mapLedgerRow(row) {
  if (!row) return null;
  const remaining = round2(row.RemainingAmount ?? row.remaining_amount ?? 0);
  const earnedDate = formatYmd(row.EarnedDate ?? row.earned_date);
  const cycleExpiryDate = formatYmd(row.CycleExpiryDate ?? row.cycle_expiry_date);
  const status = row.Status ?? row.status ?? LEDGER_STATUS.ACTIVE;
  const approvalStatus = row.ApprovalStatus ?? row.approval_status ?? APPROVAL_STATUS.NOT_REQUIRED;
  return {
    id: row.Id != null ? Number(row.Id) : (row.id ?? null),
    ledgerCode: row.LedgerCode ?? row.ledger_code ?? null,
    soId: row.SoId != null ? Number(row.SoId) : (row.so_id ?? null),
    soLineId: row.SoLineId != null ? Number(row.SoLineId) : (row.so_line_id ?? null),
    docNo: row.DocNo ?? row.doc_no ?? null,
    custId: Number(row.CustId ?? row.cust_id),
    custCode: row.CustCode ?? row.cust_code ?? null,
    custName: row.CustName ?? row.cust_name ?? null,
    goodId: row.GoodId != null ? Number(row.GoodId) : (row.good_id ?? null),
    goodCode: row.GoodCode ?? row.good_code ?? null,
    goodName: row.GoodName ?? row.good_name ?? null,
    qtyTons: round4(row.QtyTons ?? row.qty_tons ?? 0),
    basePrice: round2(row.BasePrice ?? row.base_price ?? 0),
    sellingPrice: round2(row.SellingPrice ?? row.selling_price ?? 0),
    invoiceUnitPrice: round2(row.InvoiceUnitPrice ?? row.invoice_unit_price ?? 0),
    isCashDiscount: Boolean(row.IsCashDiscount ?? row.is_cash_discount),
    pricingMode: row.PricingMode ?? row.pricing_mode ?? null,
    rebatePerTon: round2(row.RebatePerTon ?? row.rebate_per_ton ?? 0),
    totalRebateEarned: round2(row.TotalRebateEarned ?? row.total_rebate_earned ?? 0),
    remainingAmount: remaining,
    remaining_amount: remaining,
    companyExtraProfitPerTon: round2(row.CompanyExtraProfitPerTon ?? row.company_extra_profit_per_ton ?? 0),
    totalCompanyExtraProfit: round2(row.TotalCompanyExtraProfit ?? row.total_company_extra_profit ?? 0),
    requiresManagerApproval: Boolean(row.RequiresManagerApproval ?? row.requires_manager_approval),
    excessApprovalAmount: round2(row.ExcessApprovalAmount ?? row.excess_approval_amount ?? 0),
    totalExcessApprovalAmount: round2(row.TotalExcessApprovalAmount ?? row.total_excess_approval_amount ?? 0),
    approvalStatus,
    approval_status: approvalStatus,
    approvedByUserId: row.ApprovedByUserId != null ? Number(row.ApprovedByUserId) : null,
    approvedAt: row.ApprovedAt ?? null,
    approvalNote: row.ApprovalNote ?? null,
    earnedDate,
    earned_date: earnedDate,
    cycleExpiryDate,
    cycle_expiry_date: cycleExpiryDate,
    maturedAt: row.MaturedAt ?? null,
    status,
    createdByUserId: row.CreatedByUserId != null ? Number(row.CreatedByUserId) : null,
    createdAt: row.CreatedAt ?? row.created_at ?? null,
    updatedAt: row.UpdatedAt ?? row.updated_at ?? null,
  };
}

function mapOct31StandingPriceRow(row) {
  if (!row) return null;
  return {
    id: row.Id != null ? Number(row.Id) : (row.id ?? null),
    standingYear: Number(row.StandingYear ?? row.standing_year),
    standingDate: formatYmd(row.StandingDate ?? row.standing_date),
    goodId: Number(row.GoodId ?? row.good_id),
    goodCode: row.GoodCode ?? row.good_code ?? null,
    goodName: row.GoodName ?? row.good_name ?? null,
    basePrice: round2(row.BasePrice ?? row.base_price ?? 0),
    sourceType: row.SourceType ?? row.source_type ?? 'OCT31_SNAPSHOT',
    sourcePriceBookId: row.SourcePriceBookId != null ? Number(row.SourcePriceBookId) : null,
    priceListCode: row.PriceListCode ?? null,
    note: row.Note ?? null,
    capturedByUserId: row.CapturedByUserId != null ? Number(row.CapturedByUserId) : null,
    capturedAt: row.CapturedAt ?? null,
  };
}

function mapConversionRow(row) {
  if (!row) return null;
  return {
    id: row.Id != null ? Number(row.Id) : (row.id ?? null),
    conversionNo: row.ConversionNo ?? row.conversion_no ?? null,
    custId: Number(row.CustId ?? row.cust_id),
    custCode: row.CustCode ?? row.cust_code ?? null,
    custName: row.CustName ?? row.cust_name ?? null,
    standingYear: Number(row.StandingYear ?? row.standing_year),
    goodId: Number(row.GoodId ?? row.good_id),
    goodCode: row.GoodCode ?? row.good_code ?? null,
    goodName: row.GoodName ?? row.good_name ?? null,
    standingPricePerTon: round2(row.StandingPricePerTon ?? row.standing_price_per_ton ?? 0),
    convertedTons: round4(row.ConvertedTons ?? row.converted_tons ?? 0),
    convertedBags: Number(row.ConvertedBags ?? row.converted_bags ?? 0),
    convertedValueBaht: round2(row.ConvertedValueBaht ?? row.converted_value_baht ?? 0),
    residualBaht: round2(row.ResidualBaht ?? row.residual_baht ?? 0),
    executionMode: row.ExecutionMode ?? row.execution_mode ?? 'MANUAL',
    convertedByUserId: Number(row.ConvertedByUserId ?? row.converted_by_user_id),
    convertedByRole: row.ConvertedByRole ?? row.converted_by_role ?? null,
    convertedAt: row.ConvertedAt ?? row.converted_at ?? null,
    note: row.Note ?? row.note ?? null,
    status: row.Status ?? row.status ?? CONVERSION_STATUS.ISSUED,
  };
}

const RebatePoolModels = {
  async insertLedger(queryFn = wfQuery, data) {
    const res = await queryFn(
      `INSERT INTO wf.RebateTransactionLedger (
         LedgerCode, SoId, SoLineId, DocNo,
         CustId, CustCode, CustName, GoodId, GoodCode, GoodName,
         QtyTons, BasePrice, SellingPrice, InvoiceUnitPrice, IsCashDiscount, PricingMode,
         RebatePerTon, TotalRebateEarned, RemainingAmount,
         CompanyExtraProfitPerTon, TotalCompanyExtraProfit,
         RequiresManagerApproval, ExcessApprovalAmount, TotalExcessApprovalAmount,
         ApprovalStatus, EarnedDate, CycleExpiryDate, Status, CreatedByUserId
       )
       OUTPUT INSERTED.*
       VALUES (
         @ledgerCode, @soId, @soLineId, @docNo,
         @custId, @custCode, @custName, @goodId, @goodCode, @goodName,
         @qtyTons, @basePrice, @sellingPrice, @invoiceUnitPrice, @isCashDiscount, @pricingMode,
         @rebatePerTon, @totalRebateEarned, @remainingAmount,
         @companyExtraProfitPerTon, @totalCompanyExtraProfit,
         @requiresManagerApproval, @excessApprovalAmount, @totalExcessApprovalAmount,
         @approvalStatus, @earnedDate, @cycleExpiryDate, @status, @createdByUserId
       )`,
      {
        ledgerCode: data.ledgerCode,
        soId: data.soId ?? null,
        soLineId: data.soLineId ?? null,
        docNo: data.docNo ?? null,
        custId: data.custId,
        custCode: data.custCode ?? null,
        custName: data.custName ?? null,
        goodId: data.goodId ?? null,
        goodCode: data.goodCode ?? null,
        goodName: data.goodName ?? null,
        qtyTons: round4(data.qtyTons),
        basePrice: round2(data.basePrice),
        sellingPrice: round2(data.sellingPrice),
        invoiceUnitPrice: round2(data.invoiceUnitPrice),
        isCashDiscount: { type: sql.Bit, value: data.isCashDiscount ? 1 : 0 },
        pricingMode: data.pricingMode,
        rebatePerTon: round2(data.rebatePerTon),
        totalRebateEarned: round2(data.totalRebateEarned),
        remainingAmount: round2(data.remainingAmount),
        companyExtraProfitPerTon: round2(data.companyExtraProfitPerTon),
        totalCompanyExtraProfit: round2(data.totalCompanyExtraProfit),
        requiresManagerApproval: { type: sql.Bit, value: data.requiresManagerApproval ? 1 : 0 },
        excessApprovalAmount: round2(data.excessApprovalAmount),
        totalExcessApprovalAmount: round2(data.totalExcessApprovalAmount),
        approvalStatus: data.approvalStatus,
        earnedDate: formatYmd(data.earnedDate),
        cycleExpiryDate: formatYmd(data.cycleExpiryDate),
        status: data.status,
        createdByUserId: data.createdByUserId ?? null,
      }
    );
    return mapLedgerRow(res.recordset?.[0]);
  },

  async findLedgerById(queryFn = wfQuery, id, { lock = false } = {}) {
    const hint = lock ? 'WITH (UPDLOCK, ROWLOCK)' : '';
    const res = await queryFn(
      `SELECT * FROM wf.RebateTransactionLedger ${hint} WHERE Id = @id`,
      { id }
    );
    return mapLedgerRow(res.recordset?.[0]);
  },

  async listFifoEligibleLedgersForCustomer(queryFn = wfQuery, custId, { lock = false } = {}) {
    const hint = lock ? 'WITH (UPDLOCK, ROWLOCK)' : '';
    const res = await queryFn(
      `SELECT *
       FROM wf.RebateTransactionLedger ${hint}
       WHERE CustId = @custId
         AND RemainingAmount > 0
         AND ApprovalStatus IN ('NOT_REQUIRED', 'APPROVED')
         AND Status IN ('ACTIVE', 'READY_FOR_CONVERSION', 'PARTIALLY_CONVERTED')
       ORDER BY EarnedDate ASC, CreatedAt ASC, Id ASC`,
      { custId }
    );
    return (res.recordset || []).map(mapLedgerRow);
  },

  async findOct31StandingPrice(queryFn = wfQuery, standingYear, goodId) {
    const res = await queryFn(
      `SELECT * FROM wf.Oct31StandingPrice WHERE StandingYear = @standingYear AND GoodId = @goodId`,
      { standingYear, goodId }
    );
    return mapOct31StandingPriceRow(res.recordset?.[0]);
  },

  async listOct31StandingPrices(queryFn = wfQuery, standingYear) {
    const res = await queryFn(
      `SELECT * FROM wf.Oct31StandingPrice WHERE StandingYear = @standingYear ORDER BY GoodName ASC, GoodId ASC`,
      { standingYear }
    );
    return (res.recordset || []).map(mapOct31StandingPriceRow);
  },

  async upsertOct31StandingPrice(queryFn = wfQuery, item) {
    const standingDate = formatYmd(item.standingDate) || `${item.standingYear}-10-31`;
    const res = await queryFn(
      `IF EXISTS (SELECT 1 FROM wf.Oct31StandingPrice WHERE StandingYear = @standingYear AND GoodId = @goodId)
       BEGIN
         UPDATE wf.Oct31StandingPrice
         SET StandingDate = @standingDate,
             GoodCode = @goodCode,
             GoodName = @goodName,
             BasePrice = @basePrice,
             SourceType = @sourceType,
             SourcePriceBookId = @sourcePriceBookId,
             PriceListCode = @priceListCode,
             Note = @note,
             CapturedByUserId = @capturedByUserId,
             UpdatedAt = DATEADD(HOUR, 7, GETUTCDATE())
         OUTPUT INSERTED.*
         WHERE StandingYear = @standingYear AND GoodId = @goodId;
       END
       ELSE
       BEGIN
         INSERT INTO wf.Oct31StandingPrice (
           StandingYear, StandingDate, GoodId, GoodCode, GoodName, BasePrice,
           SourceType, SourcePriceBookId, PriceListCode, Note, CapturedByUserId
         )
         OUTPUT INSERTED.*
         VALUES (
           @standingYear, @standingDate, @goodId, @goodCode, @goodName, @basePrice,
           @sourceType, @sourcePriceBookId, @priceListCode, @note, @capturedByUserId
         );
       END`,
      {
        standingYear: item.standingYear,
        standingDate,
        goodId: item.goodId,
        goodCode: item.goodCode || String(item.goodId),
        goodName: item.goodName || item.goodCode || String(item.goodId),
        basePrice: round2(item.basePrice),
        sourceType: item.sourceType || 'OCT31_SNAPSHOT',
        sourcePriceBookId: item.sourcePriceBookId ?? null,
        priceListCode: item.priceListCode ?? null,
        note: item.note ?? null,
        capturedByUserId: item.capturedByUserId ?? null,
      }
    );
    return mapOct31StandingPriceRow(res.recordset?.[0]);
  },
};

module.exports = {
  REBATE_CONSTANTS,
  LEDGER_STATUS,
  APPROVAL_STATUS,
  PRICING_MODE,
  CONVERSION_STATUS,
  AUTHORIZED_CONVERTER_ROLES,
  round2,
  round4,
  formatYmd,
  computeCycleExpiryDate,
  generateDocCode,
  mapLedgerRow,
  mapOct31StandingPriceRow,
  mapConversionRow,
  RebatePoolModels,
};

