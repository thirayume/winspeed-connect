/**
 * RebateCalculatorService
 *
 * Implements Business Specification Section 2:
 *   - Case A: Below Base Price with Cash Discount (isCashDiscount = true)
 *       Invoice = Selling Price, Rebate = 0
 *   - Case B: Below Base Price without Cash Discount (isCashDiscount = false)
 *       Invoice = Base Price
 *       Price Diff = Base Price - Selling Price
 *       Tier 1 (0 < Diff <= 200): Rebate = Diff, requiresManagerApproval = false
 *       Tier 2 (200 < Diff <= 300): Rebate = Diff, excessApprovalAmount = Diff - 200,
 *                                   requiresManagerApproval = true (PENDING_MANAGER_APPROVAL)
 *       Tier 3 (Diff > 300): Reject with REBATE_EXCEEDS_MAX_LIMIT
 *   - Case C: At or Above Base Price (Selling Price >= Base Price)
 *       Invoice = Selling Price
 *       Markup = Selling Price - Base Price
 *       Rebate = MIN(Markup, 200)
 *       Company Extra Profit = MAX(0, Markup - 200)
 */

const { wfTransaction, sql } = require('../db');
const { defaultRebateQuery: wfQuery, transactionQuery } = require('./rebate-sql');
const { getBangkokDateString } = require('./so-pickup-policy');
const { assertPricesAboveCost } = require('./cost-authority');
const { hasPermission, hasRole } = require('./role-capabilities');
const { approvalIdentity, isSubmitter } = require('./approval-identity');
const { getSettingValue, logChangeEvent } = require('./policy-contract');
const {
  REBATE_CONSTANTS,
  LEDGER_STATUS,
  APPROVAL_STATUS,
  PRICING_MODE,
  round2,
  round4,
  formatYmd,
  computeCycleExpiryDate,
  generateDocCode,
  mapLedgerRow,
  RebatePoolModels,
} = require('./rebate-pool-models');

function createRebateError(message, { status = 400, code = 'REBATE_ERROR', details = null } = {}) {
  const err = new Error(message);
  err.status = status;
  err.statusCode = status;
  err.code = code;
  if (details !== null) err.details = details;
  return err;
}

/**
 * Pure pricing and rebate pool calculation engine.
 *
 * @param {number} basePrice Standard list/base price per ton (THB)
 * @param {number} sellingPrice Negotiated selling price per ton (THB)
 * @param {number} qtyTons Quantity in metric tons
 * @param {boolean} [isCashDiscount=false] Cash discount flag
 * @param {object} [options] Optional configurable thresholds
 * @returns {{
 *   basePrice: number,
 *   sellingPrice: number,
 *   qtyTons: number,
 *   isCashDiscount: boolean,
 *   invoiceUnitPrice: number,
 *   rebatePerTon: number,
 *   totalRebateEarned: number,
 *   companyExtraProfitPerTon: number,
 *   totalCompanyExtraProfit: number,
 *   requiresManagerApproval: boolean,
 *   excessApprovalAmount: number,
 *   totalExcessApprovalAmount: number,
 *   approvalStatus: string,
 *   pricingMode: string
 * }}
 */
function calculateOrderPricingAndRebate(
  basePrice,
  sellingPrice,
  qtyTons,
  isCashDiscount = false,
  options = {}
) {
  const base = Number(basePrice);
  const selling = Number(sellingPrice);
  const qty = Number(qtyTons);
  const cashDiscount = Boolean(isCashDiscount);

  if (!Number.isFinite(base) || base <= 0) {
    throw createRebateError('Base Price (ราคากลาง) ต้องมากกว่า 0 บาท/ตัน', {
      status: 400,
      code: 'INVALID_BASE_PRICE',
    });
  }
  if (!Number.isFinite(selling) || selling < 0) {
    throw createRebateError('Selling Price (ราคาขาย) ไม่ถูกต้อง', {
      status: 400,
      code: 'INVALID_SELLING_PRICE',
    });
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    throw createRebateError('ปริมาณ (QtyTons) ต้องมากกว่า 0 ตัน', {
      status: 400,
      code: 'INVALID_QTY_TONS',
    });
  }

  const standardDiscountLimit = Number.isFinite(Number(options.standardDiscountLimit))
    ? Number(options.standardDiscountLimit)
    : REBATE_CONSTANTS.STANDARD_DISCOUNT_LIMIT;
  const maxDiscountLimit = Number.isFinite(Number(options.maxDiscountLimit))
    ? Number(options.maxDiscountLimit)
    : REBATE_CONSTANTS.MAX_DISCOUNT_LIMIT;
  const standardMarkupCap = Number.isFinite(Number(options.standardMarkupCap))
    ? Number(options.standardMarkupCap)
    : REBATE_CONSTANTS.STANDARD_MARKUP_CAP;

  const baseR = round2(base);
  const sellingR = round2(selling);
  const qtyR = round4(qty);

  // Case A & Case B: Selling Price < Base Price
  if (sellingR < baseR) {
    // Case A: Cash Discount Mode
    if (cashDiscount) {
      return {
        basePrice: baseR,
        sellingPrice: sellingR,
        qtyTons: qtyR,
        isCashDiscount: true,
        invoiceUnitPrice: sellingR,
        rebatePerTon: 0,
        totalRebateEarned: 0,
        companyExtraProfitPerTon: 0,
        totalCompanyExtraProfit: 0,
        requiresManagerApproval: false,
        excessApprovalAmount: 0,
        totalExcessApprovalAmount: 0,
        approvalStatus: APPROVAL_STATUS.NOT_REQUIRED,
        pricingMode: PRICING_MODE.CASH_DISCOUNT,
      };
    }

    // Case B: Rebate Accumulation Mode
    const priceDiff = round2(baseR - sellingR);

    // Tier 3: Exceeds max limit (300 THB/ton) -> Reject
    if (priceDiff > maxDiscountLimit) {
      throw createRebateError(
        `ส่วนลดจากราคากลาง ${priceDiff} บาท/ตัน เกินเพดานสูงสุดที่อนุญาต (${maxDiscountLimit} บาท/ตัน) กรุณาแก้ไขราคาหรือเลือกใช้โหมดส่วนลดเงินสด`,
        {
          status: 400,
          code: 'REBATE_EXCEEDS_MAX_LIMIT',
          details: {
            basePrice: baseR,
            sellingPrice: sellingR,
            priceDiff,
            standardDiscountLimit,
            maxDiscountLimit,
          },
        }
      );
    }

    // Tier 2: Over standard limit (200 < Diff <= 300) -> Requires Manager Approval
    if (priceDiff > standardDiscountLimit) {
      const excessPerTon = round2(priceDiff - standardDiscountLimit);
      const totalRebate = round2(priceDiff * qtyR);
      const totalExcess = round2(excessPerTon * qtyR);
      return {
        basePrice: baseR,
        sellingPrice: sellingR,
        qtyTons: qtyR,
        isCashDiscount: false,
        invoiceUnitPrice: baseR,
        rebatePerTon: priceDiff,
        totalRebateEarned: totalRebate,
        companyExtraProfitPerTon: 0,
        totalCompanyExtraProfit: 0,
        requiresManagerApproval: true,
        excessApprovalAmount: excessPerTon,
        totalExcessApprovalAmount: totalExcess,
        approvalStatus: APPROVAL_STATUS.PENDING_MANAGER_APPROVAL,
        pricingMode: PRICING_MODE.REBATE_OVER_LIMIT,
      };
    }

    // Tier 1: Standard (0 < Diff <= 200) -> Auto-credited at Base Price invoice
    const totalRebate = round2(priceDiff * qtyR);
    return {
      basePrice: baseR,
      sellingPrice: sellingR,
      qtyTons: qtyR,
      isCashDiscount: false,
      invoiceUnitPrice: baseR,
      rebatePerTon: priceDiff,
      totalRebateEarned: totalRebate,
      companyExtraProfitPerTon: 0,
      totalCompanyExtraProfit: 0,
      requiresManagerApproval: false,
      excessApprovalAmount: 0,
      totalExcessApprovalAmount: 0,
      approvalStatus: APPROVAL_STATUS.NOT_REQUIRED,
      pricingMode: PRICING_MODE.REBATE_WITHIN_LIMIT,
    };
  }

  // Case C: Selling Price >= Base Price
  const markup = round2(sellingR - baseR);
  const rebatePerTon = round2(Math.min(markup, standardMarkupCap));
  const extraProfitPerTon = round2(Math.max(0, markup - standardMarkupCap));
  const totalRebate = round2(rebatePerTon * qtyR);
  const totalExtraProfit = round2(extraProfitPerTon * qtyR);

  let pricingMode = PRICING_MODE.STANDARD_LIST;
  if (extraProfitPerTon > 0) {
    pricingMode = PRICING_MODE.MARKUP_EXTRA_PROFIT;
  } else if (rebatePerTon > 0) {
    pricingMode = PRICING_MODE.MARKUP_STANDARD;
  }

  return {
    basePrice: baseR,
    sellingPrice: sellingR,
    qtyTons: qtyR,
    isCashDiscount: cashDiscount,
    invoiceUnitPrice: sellingR,
    rebatePerTon,
    totalRebateEarned: totalRebate,
    companyExtraProfitPerTon: extraProfitPerTon,
    totalCompanyExtraProfit: totalExtraProfit,
    requiresManagerApproval: false,
    excessApprovalAmount: 0,
    totalExcessApprovalAmount: 0,
    approvalStatus: APPROVAL_STATUS.NOT_REQUIRED,
    pricingMode,
  };
}

async function resolveConfiguredRebatePolicy() {
  try {
    const [std, max, months] = await Promise.all([
      getSettingValue('REBATE_STANDARD_LIMIT_PER_TON'),
      getSettingValue('REBATE_MAX_LIMIT_PER_TON'),
      getSettingValue('REBATE_CYCLE_MONTHS'),
    ]);
    return {
      standardDiscountLimit: Number(std || REBATE_CONSTANTS.STANDARD_DISCOUNT_LIMIT),
      maxDiscountLimit: Number(max || REBATE_CONSTANTS.MAX_DISCOUNT_LIMIT),
      standardMarkupCap: Number(std || REBATE_CONSTANTS.STANDARD_MARKUP_CAP),
      cycleMonths: Number(months || REBATE_CONSTANTS.CYCLE_MONTHS),
    };
  } catch {
    return {
      standardDiscountLimit: REBATE_CONSTANTS.STANDARD_DISCOUNT_LIMIT,
      maxDiscountLimit: REBATE_CONSTANTS.MAX_DISCOUNT_LIMIT,
      standardMarkupCap: REBATE_CONSTANTS.STANDARD_MARKUP_CAP,
      cycleMonths: REBATE_CONSTANTS.CYCLE_MONTHS,
    };
  }
}

/**
 * Computes pricing & rebate, enforces confidential Costlist floor, and inserts
 * a RebateTransactionLedger record into wf.RebateTransactionLedger.
 */
async function recordRebateTransaction(queryFn = wfQuery, params = {}, options = {}) {
  const custId = Number(params.custId);
  if (!Number.isInteger(custId) || custId <= 0) {
    throw createRebateError('กรุณาระบุรหัสลูกค้า (custId) ให้ถูกต้อง', {
      status: 400,
      code: 'INVALID_CUSTOMER',
    });
  }

  const policy = options.policy ||
    (queryFn === wfQuery
      ? await resolveConfiguredRebatePolicy()
      : {
          standardDiscountLimit: REBATE_CONSTANTS.STANDARD_DISCOUNT_LIMIT,
          maxDiscountLimit: REBATE_CONSTANTS.MAX_DISCOUNT_LIMIT,
          standardMarkupCap: REBATE_CONSTANTS.STANDARD_MARKUP_CAP,
          cycleMonths: REBATE_CONSTANTS.CYCLE_MONTHS,
        });
  const calc = calculateOrderPricingAndRebate(
    params.basePrice,
    params.sellingPrice,
    params.qtyTons,
    Boolean(params.isCashDiscount),
    policy
  );

  // Always enforce confidential cost floor unless caller runs synthetic unit test with skipCostCheck
  if (!options.skipCostCheck && params.goodId) {
    await assertPricesAboveCost({
      lines: [
        {
          goodId: params.goodId,
          goodCode: params.goodCode || null,
          goodName: params.goodName || null,
          qtyTon: calc.qtyTons,
          unitPrice: calc.invoiceUnitPrice,
        },
      ],
      asOfDate: params.earnedDate || getBangkokDateString(),
      rebateDiscountAmt: calc.sellingPrice < calc.basePrice && !calc.isCashDiscount ? calc.totalRebateEarned : 0,
      queryFn: options.costQueryFn || queryFn,
    });
  }

  const earnedDate = formatYmd(params.earnedDate) || getBangkokDateString();
  const cycleMonths = Number(options.cycleMonths || policy.cycleMonths || REBATE_CONSTANTS.CYCLE_MONTHS);
  const cycleExpiryDate = formatYmd(params.cycleExpiryDate) || computeCycleExpiryDate(earnedDate, cycleMonths);
  const ledgerCode = params.ledgerCode || generateDocCode('RBL', earnedDate);

  const initialStatus = calc.requiresManagerApproval
    ? LEDGER_STATUS.PENDING_APPROVAL
    : LEDGER_STATUS.ACTIVE;

  const inserted = await RebatePoolModels.insertLedger(queryFn, {
    ledgerCode,
    soId: params.soId ?? null,
    soLineId: params.soLineId ?? null,
    docNo: params.docNo ?? null,
    custId,
    custCode: params.custCode ?? null,
    custName: params.custName ?? null,
    goodId: params.goodId ?? null,
    goodCode: params.goodCode ?? null,
    goodName: params.goodName ?? null,
    qtyTons: calc.qtyTons,
    basePrice: calc.basePrice,
    sellingPrice: calc.sellingPrice,
    invoiceUnitPrice: calc.invoiceUnitPrice,
    isCashDiscount: calc.isCashDiscount,
    pricingMode: calc.pricingMode,
    rebatePerTon: calc.rebatePerTon,
    totalRebateEarned: calc.totalRebateEarned,
    remainingAmount: calc.totalRebateEarned,
    companyExtraProfitPerTon: calc.companyExtraProfitPerTon,
    totalCompanyExtraProfit: calc.totalCompanyExtraProfit,
    requiresManagerApproval: calc.requiresManagerApproval,
    excessApprovalAmount: calc.excessApprovalAmount,
    totalExcessApprovalAmount: calc.totalExcessApprovalAmount,
    approvalStatus: calc.approvalStatus,
    earnedDate,
    cycleExpiryDate,
    status: initialStatus,
    createdByUserId: params.createdByUserId ?? options.actorUser?.id ?? null,
  });

  return {
    calculation: calc,
    ledger: inserted,
  };
}

function assertManagerApprovalAuthority(actorUser) {
  if (!actorUser) {
    throw createRebateError('กรุณาเข้าสู่ระบบก่อนดำเนินการอนุมัติ', {
      status: 401,
      code: 'UNAUTHENTICATED',
    });
  }
  const identity = approvalIdentity(actorUser);
  const qualifies = user => hasPermission(user, 'rebate.approve-over-limit');
  const realActor = identity.impersonating ? { role: actorUser.actorRole, roles: actorUser.actorRoles, permissions: actorUser.actorPermissions } : actorUser;
  if ((identity.impersonating && !identity.actorRoles.length) || !qualifies(actorUser) || !qualifies(realActor)) {
    throw createRebateError('เฉพาะผู้จัดการ (MANAGER / C_LEVEL / ADMIN) เท่านั้นที่สามารถอนุมัติส่วนลดเกิน 200 บาท/ตันได้', {
      status: 403,
      code: 'FORBIDDEN_APPROVAL_ROLE',
    });
  }
}

/**
 * Manager approves an over-limit rebate ledger entry (200 < diff <= 300 THB/ton).
 */
async function approveOverLimitRebate(queryFnOrUndefined, { ledgerId, actorUser, note = null, asOfDate = null, dataStartDate = null } = {}) {
  assertManagerApprovalAuthority(actorUser);
  const runInTx = async (txQuery) => {
    const existing = await RebatePoolModels.findLedgerById(txQuery, ledgerId, { lock: true });
    if (!existing) {
      throw createRebateError('ไม่พบรายการ Rebate ที่ต้องการอนุมัติ', {
        status: 404,
        code: 'LEDGER_NOT_FOUND',
      });
    }
    if (dataStartDate && (!existing.earnedDate || existing.earnedDate < dataStartDate)) {
      throw createRebateError('ไม่พบรายการ Rebate ที่ต้องการอนุมัติ', { status: 404, code: 'LEDGER_NOT_FOUND' });
    }
    if (existing.approvalStatus !== APPROVAL_STATUS.PENDING_MANAGER_APPROVAL) {
      throw createRebateError(`ไม่สามารถอนุมัติได้ เนื่องจากสถานะปัจจุบันคือ ${existing.approvalStatus}`, {
        status: 409,
        code: 'INVALID_APPROVAL_STATE',
      });
    }
    if (existing.createdByUserId && isSubmitter(approvalIdentity(actorUser), existing.createdByUserId)) {
      throw createRebateError('ห้ามอนุมัติคำขอที่ตนเองเป็นผู้บันทึก (Anti-Self-Approval)', {
        status: 403,
        code: 'SELF_APPROVAL_FORBIDDEN',
      });
    }

    const today = formatYmd(asOfDate) || getBangkokDateString();
    const nextStatus = existing.cycleExpiryDate && existing.cycleExpiryDate <= today
      ? LEDGER_STATUS.READY_FOR_CONVERSION
      : LEDGER_STATUS.ACTIVE;

    const updated = await txQuery(
      `UPDATE wf.RebateTransactionLedger
       SET ApprovalStatus = @approvalStatus,
           Status = @nextStatus,
           ApprovedByUserId = @approvedByUserId,
           ApprovedAt = DATEADD(HOUR, 7, GETUTCDATE()),
           ApprovalNote = @note,
           MaturedAt = CASE WHEN @nextStatus = 'READY_FOR_CONVERSION' AND MaturedAt IS NULL THEN DATEADD(HOUR, 7, GETUTCDATE()) ELSE MaturedAt END,
           UpdatedAt = DATEADD(HOUR, 7, GETUTCDATE())
       OUTPUT INSERTED.*
       WHERE Id = @id`,
      {
        id: ledgerId,
        approvalStatus: APPROVAL_STATUS.APPROVED,
        nextStatus,
        approvedByUserId: actorUser.id,
        note: note || null,
      }
    );

    const mapped = mapLedgerRow(updated.recordset?.[0]);
    if (typeof queryFnOrUndefined !== 'function') {
      try {
        await logChangeEvent({
          entityType: 'REBATE_LEDGER',
          entityId: String(ledgerId),
          action: 'APPROVE_OVER_LIMIT',
          changedBy: actorUser.id,
          summary: `Approved over-limit rebate ${mapped?.ledgerCode} (${mapped?.excessApprovalAmount} THB/ton excess)`,
        });
      } catch { /* non-fatal */ }
    }
    return mapped;
  };

  if (typeof queryFnOrUndefined === 'function') {
    return runInTx(queryFnOrUndefined);
  }
  return wfTransaction(async (tx) => runInTx(transactionQuery(tx, sql)));
}

/**
 * Manager rejects an over-limit rebate ledger entry.
 */
async function rejectOverLimitRebate(queryFnOrUndefined, { ledgerId, actorUser, note = null, dataStartDate = null } = {}) {
  assertManagerApprovalAuthority(actorUser);
  const rejectNote = String(note || '').trim();
  if (!rejectNote) {
    throw createRebateError('กรุณาระบุเหตุผลในการไม่อนุมัติส่วนลดเกินเพดาน', {
      status: 400,
      code: 'REJECTION_NOTE_REQUIRED',
    });
  }

  const runInTx = async (txQuery) => {
    const existing = await RebatePoolModels.findLedgerById(txQuery, ledgerId, { lock: true });
    if (!existing) {
      throw createRebateError('ไม่พบรายการ Rebate ที่ต้องการดำเนินการ', {
        status: 404,
        code: 'LEDGER_NOT_FOUND',
      });
    }
    if (dataStartDate && (!existing.earnedDate || existing.earnedDate < dataStartDate)) {
      throw createRebateError('ไม่พบรายการ Rebate ที่ต้องการดำเนินการ', { status: 404, code: 'LEDGER_NOT_FOUND' });
    }
    if (existing.approvalStatus !== APPROVAL_STATUS.PENDING_MANAGER_APPROVAL) {
      throw createRebateError(`ไม่สามารถปฏิเสธได้ เนื่องจากสถานะปัจจุบันคือ ${existing.approvalStatus}`, {
        status: 409,
        code: 'INVALID_APPROVAL_STATE',
      });
    }

    const updated = await txQuery(
      `UPDATE wf.RebateTransactionLedger
       SET ApprovalStatus = @approvalStatus,
           Status = @nextStatus,
           RemainingAmount = 0,
           ApprovedByUserId = @approvedByUserId,
           ApprovedAt = DATEADD(HOUR, 7, GETUTCDATE()),
           ApprovalNote = @note,
           UpdatedAt = DATEADD(HOUR, 7, GETUTCDATE())
       OUTPUT INSERTED.*
       WHERE Id = @id`,
      {
        id: ledgerId,
        approvalStatus: APPROVAL_STATUS.REJECTED,
        nextStatus: LEDGER_STATUS.REJECTED,
        approvedByUserId: actorUser.id,
        note: rejectNote,
      }
    );

    const mapped = mapLedgerRow(updated.recordset?.[0]);
    if (typeof queryFnOrUndefined !== 'function') {
      try {
        await logChangeEvent({
          entityType: 'REBATE_LEDGER',
          entityId: String(ledgerId),
          action: 'REJECT_OVER_LIMIT',
          changedBy: actorUser.id,
          summary: `Rejected over-limit rebate ${mapped?.ledgerCode}: ${rejectNote}`,
        });
      } catch { /* non-fatal */ }
    }
    return mapped;
  };

  if (typeof queryFnOrUndefined === 'function') {
    return runInTx(queryFnOrUndefined);
  }
  return wfTransaction(async (tx) => runInTx(transactionQuery(tx, sql)));
}

module.exports = {
  calculateOrderPricingAndRebate,
  recordRebateTransaction,
  approveOverLimitRebate,
  rejectOverLimitRebate,
  resolveConfiguredRebatePolicy,
  createRebateError,
};

