/**
 * RebateConversionService
 *
 * Implements Business Specification Section 3 (Rebate Pool Lifecycle & Ticket Conversion):
 *   - 12-month accumulation window & Ticket Conversion Queue promotion
 *   - Annual November 1st (01-Nov) conversion alert trigger
 *   - Official October 31st (31-Oct) standing price snapshot & mandatory lookup
 *   - Strict MANUAL-only execution restricted to authorized roles
 *     (ROLE_AUTHORIZED_REBATE_CONVERTER / REBATE_CONVERTER / ACCOUNTING / ADMIN)
 *   - Atomic FIFO deduction from oldest RebateTransactionLedger entries first,
 *     supporting full & partial deductions (PARTIALLY_CONVERTED / CONVERTED)
 */

const { wfTransaction, sql } = require('../db');
const { defaultRebateQuery: wfQuery, transactionQuery } = require('./rebate-sql');
const { getBangkokDateString } = require('./so-pickup-policy');
const { hasPermission, hasRole, userRoles } = require('./role-capabilities');
const { getSettingValue, logChangeEvent } = require('./policy-contract');
const { broadcast } = require('./socket');
const {
  REBATE_CONSTANTS,
  LEDGER_STATUS,
  CONVERSION_STATUS,
  AUTHORIZED_CONVERTER_ROLES,
  round2,
  round4,
  formatYmd,
  generateDocCode,
  mapLedgerRow,
  mapConversionRow,
  RebatePoolModels,
} = require('./rebate-pool-models');
const { createRebateError } = require('./rebate-calculator-service');

function isAuthorizedConverter(actorUser) {
  if (!actorUser) return false;
  if (hasPermission(actorUser, 'rebate.convert')) return true;
  const roles = userRoles(actorUser);
  for (const r of AUTHORIZED_CONVERTER_ROLES) {
    if (roles.includes(r) || hasRole(actorUser, r)) {
      return true;
    }
  }
  return false;
}

function resolveActorPrimaryConverterRole(actorUser) {
  const roles = userRoles(actorUser);
  for (const preferred of AUTHORIZED_CONVERTER_ROLES) {
    if (roles.includes(preferred)) return preferred;
  }
  return actorUser?.role || roles[0] || 'UNKNOWN';
}

function parseYmdParts(ymd) {
  const normalized = formatYmd(ymd);
  if (!normalized) return null;
  const [y, m, d] = normalized.split('-').map(Number);
  return { ymd: normalized, year: y, month: m, day: d };
}

function isNovemberFirstDate(asOfDate) {
  const parts = parseYmdParts(asOfDate);
  if (!parts) return false;
  return parts.month === REBATE_CONSTANTS.CONVERSION_ALERT_MONTH &&
    parts.day === REBATE_CONSTANTS.CONVERSION_ALERT_DAY;
}

/**
 * Promotes approved ACTIVE ledger entries whose 12-month CycleExpiryDate has been reached
 * into Status = 'READY_FOR_CONVERSION' ("Ticket Conversion Queue").
 */
async function promoteMaturedLedgerEntries(queryFn = wfQuery, asOfDate = null) {
  const today = formatYmd(asOfDate) || getBangkokDateString();
  const res = await queryFn(
    `UPDATE wf.RebateTransactionLedger
     SET Status = @readyStatus,
         MaturedAt = ISNULL(MaturedAt, DATEADD(HOUR, 7, GETUTCDATE())),
         UpdatedAt = DATEADD(HOUR, 7, GETUTCDATE())
     OUTPUT INSERTED.*
     WHERE RemainingAmount > 0
       AND ApprovalStatus IN ('NOT_REQUIRED', 'APPROVED')
       AND Status = 'ACTIVE'
       AND CycleExpiryDate <= @asOfDate`,
    {
      readyStatus: LEDGER_STATUS.READY_FOR_CONVERSION,
      asOfDate: today,
    }
  );
  const promoted = (res.recordset || []).map(mapLedgerRow);
  return {
    asOfDate: today,
    promotedCount: promoted.length,
    promotedLedgers: promoted,
  };
}

/**
 * Summarizes a customer's Rebate Pool balances and FIFO conversion queue.
 */
async function getCustomerConversionQueue(queryFn = wfQuery, { custId, asOfDate = null } = {}) {
  const today = formatYmd(asOfDate) || getBangkokDateString();
  const numericCustId = Number(custId);
  if (!Number.isInteger(numericCustId) || numericCustId <= 0) {
    throw createRebateError('กรุณาระบุรหัสลูกค้าที่ถูกต้อง', {
      status: 400,
      code: 'INVALID_CUSTOMER',
    });
  }

  const res = await queryFn(
    `SELECT *
     FROM wf.RebateTransactionLedger WITH (NOLOCK)
     WHERE CustId = @custId
     ORDER BY EarnedDate ASC, CreatedAt ASC, Id ASC`,
    { custId: numericCustId }
  );

  const rows = (res.recordset || []).map(mapLedgerRow);
  let maturedBalance = 0;
  let activeUnmaturedBalance = 0;
  let pendingApprovalBalance = 0;
  const eligibleLedgers = [];

  for (const row of rows) {
    if (row.approvalStatus === 'PENDING_MANAGER_APPROVAL') {
      pendingApprovalBalance = round2(pendingApprovalBalance + row.remainingAmount);
      continue;
    }
    if (
      row.remainingAmount > 0 &&
      ['NOT_REQUIRED', 'APPROVED'].includes(row.approvalStatus) &&
      ['ACTIVE', 'READY_FOR_CONVERSION', 'PARTIALLY_CONVERTED'].includes(row.status)
    ) {
      eligibleLedgers.push(row);
      // A status reflects a previous job run, not the queried as-of date.
      // In particular, an earlier-date preview must not show a future lot as
      // matured just because a later job already marked it READY.
      const isMatured = row.cycleExpiryDate && row.cycleExpiryDate <= today;
      if (isMatured) {
        maturedBalance = round2(maturedBalance + row.remainingAmount);
      } else {
        activeUnmaturedBalance = round2(activeUnmaturedBalance + row.remainingAmount);
      }
    }
  }

  return {
    custId: numericCustId,
    asOfDate: today,
    maturedBalance,
    activeUnmaturedBalance,
    totalFifoEligibleBalance: round2(maturedBalance + activeUnmaturedBalance),
    pendingApprovalBalance,
    eligibleLedgers,
  };
}

/**
 * Annual November 1st (01-Nov) trigger check:
 * 1) Promotes all 12-month matured ledger entries into READY_FOR_CONVERSION.
 * 2) If asOfDate is Nov 1st (or force === true), creates idempotent per-customer
 *    wf.RebateConversionAlert records for that year and broadcasts notifications.
 */
async function runNovember1ConversionAlertCheck(
  queryFn = wfQuery,
  { asOfDate = null, force = false } = {}
) {
  const today = formatYmd(asOfDate) || getBangkokDateString();
  const parts = parseYmdParts(today);
  const promotion = await promoteMaturedLedgerEntries(queryFn, today);

  if (!force && !isNovemberFirstDate(today)) {
    return {
      triggered: false,
      reason: 'NOT_NOVEMBER_1',
      asOfDate: today,
      promotedCount: promotion.promotedCount,
      alertsCreated: 0,
      alerts: [],
    };
  }

  const alertYear = parts.year;
  const queueRes = await queryFn(
    `SELECT
       CustId,
       MAX(CustCode) AS CustCode,
       MAX(CustName) AS CustName,
       SUM(RemainingAmount) AS MaturedBalance,
       COUNT(*) AS EligibleLedgerCount
     FROM wf.RebateTransactionLedger WITH (NOLOCK)
     WHERE RemainingAmount > 0
       AND ApprovalStatus IN ('NOT_REQUIRED', 'APPROVED')
       AND (Status = 'READY_FOR_CONVERSION' OR (Status IN ('ACTIVE', 'PARTIALLY_CONVERTED') AND CycleExpiryDate <= @asOfDate))
     GROUP BY CustId
     HAVING SUM(RemainingAmount) > 0
     ORDER BY SUM(RemainingAmount) DESC, CustId ASC`,
    { asOfDate: today }
  );

  const candidates = queueRes.recordset || [];
  const createdAlerts = [];

  for (const row of candidates) {
    const custId = Number(row.CustId);
    const maturedBalance = round2(row.MaturedBalance);
    const eligibleCount = Number(row.EligibleLedgerCount || 0);

    const insertRes = await queryFn(
      `IF NOT EXISTS (SELECT 1 FROM wf.RebateConversionAlert WHERE AlertYear = @alertYear AND CustId = @custId)
       BEGIN
         INSERT INTO wf.RebateConversionAlert (
           AlertYear, AlertDate, CustId, CustCode, CustName, MaturedBalance, EligibleLedgerCount, Status
         )
         OUTPUT INSERTED.*
         VALUES (
           @alertYear, @alertDate, @custId, @custCode, @custName, @maturedBalance, @eligibleCount, 'PENDING'
         );
       END`,
      {
        alertYear,
        alertDate: today,
        custId,
        custCode: row.CustCode || null,
        custName: row.CustName || null,
        maturedBalance,
        eligibleCount,
      }
    );

    if (insertRes.recordset?.[0]) {
      createdAlerts.push(insertRes.recordset[0]);
    }
  }

  if (createdAlerts.length > 0) {
    try {
      broadcast('rebate_conversion_alert', {
        alertYear,
        alertDate: today,
        alertsCreated: createdAlerts.length,
        customers: createdAlerts.map(a => ({
          custId: Number(a.CustId ?? a.custId),
          custCode: a.CustCode ?? a.custCode ?? null,
          custName: a.CustName ?? a.custName ?? null,
          maturedBalance: round2(a.MaturedBalance ?? a.maturedBalance),
          eligibleLedgerCount: Number(a.EligibleLedgerCount ?? a.eligibleLedgerCount ?? 0),
        })),
      });
    } catch { /* socket not initialized in unit tests */ }
  }

  return {
    triggered: true,
    alertYear,
    asOfDate: today,
    promotedCount: promotion.promotedCount,
    alertsCreated: createdAlerts.length,
    totalCustomersReady: candidates.length,
    alerts: createdAlerts,
  };
}

/**
 * Captures or updates official Oct 31st standing product prices in wf.Oct31StandingPrice.
 * When `entries` are omitted, snapshots active wf.PriceBookLine rows covering `${standingYear}-10-31`.
 */
async function snapshotOct31StandingPrices(
  queryFn = wfQuery,
  { standingYear = null, entries = null, actorUser = null } = {}
) {
  const year = Number(standingYear || String(getBangkokDateString()).slice(0, 4));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw createRebateError('กรุณาระบุปี ค.ศ. สำหรับราคายืนวันที่ 31 ตุลาคม ให้ถูกต้อง', {
      status: 400,
      code: 'INVALID_STANDING_YEAR',
    });
  }

  const standingDate = `${year}-10-31`;
  let sourceEntries = Array.isArray(entries) ? entries : null;

  if (!sourceEntries) {
    const bookRes = await queryFn(
      `SELECT pbl.GoodId, pbl.GoodCode, pbl.GoodName, pbl.Price AS ListPricePerTon, pb.Id AS PriceBookId, pb.Name AS PriceListCode
       FROM wf.PriceBookLine pbl WITH (NOLOCK)
       JOIN wf.PriceBook pb WITH (NOLOCK) ON pb.Id = pbl.PriceBookId
       WHERE pb.Status = 'ACTIVE'
         AND pbl.Price > 0
         AND ISNULL(pbl.LineStatus, 'NORMAL') <> 'SUSPENDED'
         AND (pb.EffectiveFrom IS NULL OR pb.EffectiveFrom <= @standingDate)
         AND (pb.EffectiveTo IS NULL OR pb.EffectiveTo >= @standingDate)
       ORDER BY pb.EffectiveFrom DESC, pb.Id DESC, pbl.GoodId ASC`,
      { standingDate }
    );
    const seenGoods = new Set();
    sourceEntries = [];
    for (const r of (bookRes.recordset || [])) {
      const gid = Number(r.GoodId);
      if (!gid) continue;
      if (seenGoods.has(gid)) {
        throw createRebateError('พบราคาสินค้าซ้ำใน Pricelist ณ วันที่ 31 ตุลาคม กรุณาตรวจสอบก่อน Snapshot', {
          status: 409, code: 'OCT31_PRICE_AMBIGUOUS', details: { goodId: gid },
        });
      }
      seenGoods.add(gid);
      sourceEntries.push({
        goodId: gid,
        goodCode: r.GoodCode,
        goodName: r.GoodName,
        basePrice: Number(r.ListPricePerTon),
        sourceType: 'WINSPEED_PRICELIST',
        sourcePriceBookId: Number(r.PriceBookId),
        priceListCode: r.PriceListCode,
      });
    }
  }

  if (!sourceEntries || sourceEntries.length === 0) {
    throw createRebateError(`ไม่พบรายการราคาสินค้าสำหรับ Snapshot ณ วันที่ ${standingDate}`, {
      status: 404,
      code: 'NO_PRICES_FOR_OCT31_SNAPSHOT',
    });
  }

  // Validate the complete batch before making any changes. The HTTP endpoint
  // also wraps the entire snapshot in a transaction.
  const uniqueGoods = new Set();
  for (const item of sourceEntries) {
    const goodId = Number(item.goodId);
    const basePrice = round2(item.basePrice);
    if (!Number.isInteger(goodId) || goodId <= 0 || !(basePrice > 0)) {
      throw createRebateError('ข้อมูลสินค้าหรือ BasePrice สำหรับ Oct31StandingPrice ไม่ถูกต้อง', {
        status: 400,
        code: 'INVALID_STANDING_PRICE_ENTRY',
      });
    }
    if (uniqueGoods.has(goodId)) {
      throw createRebateError('พบสินค้าซ้ำในรายการราคายืน', { status: 400, code: 'DUPLICATE_STANDING_PRICE_ENTRY' });
    }
    uniqueGoods.add(goodId);
  }

  const saved = [];
  for (const item of sourceEntries) {
    const goodId = Number(item.goodId);
    const basePrice = round2(item.basePrice);
    const row = await RebatePoolModels.upsertOct31StandingPrice(queryFn, {
      standingYear: year,
      standingDate,
      goodId,
      goodCode: item.goodCode || String(goodId),
      goodName: item.goodName || item.goodCode || String(goodId),
      basePrice,
      sourceType: item.sourceType || 'OCT31_SNAPSHOT',
      sourcePriceBookId: item.sourcePriceBookId ?? null,
      priceListCode: item.priceListCode ?? null,
      note: item.note ?? null,
      capturedByUserId: actorUser?.id ?? null,
    });
    if (!row) throw createRebateError('ไม่สามารถบันทึกราคายืนได้', { status: 503, code: 'STANDING_PRICE_SAVE_FAILED' });
    saved.push(row);
  }

  return {
    standingYear: year,
    standingDate,
    count: saved.length,
    items: saved,
  };
}

/**
 * Fetches official Oct 31st standing price, throwing OCT31_STANDING_PRICE_NOT_FOUND if absent.
 */
async function requireOct31StandingPrice(queryFn = wfQuery, { standingYear, goodId, lock = false }) {
  const row = await RebatePoolModels.findOct31StandingPrice(queryFn, standingYear, goodId, { lock });
  if (!row || !(row.basePrice > 0)) {
    throw createRebateError(
      `ไม่พบราคายืน ณ วันที่ 31 ตุลาคม ปี ${standingYear} สำหรับสินค้า #${goodId} กรุณาบันทึกราคายืน 31 ต.ค. ก่อนทำการแปลงตั๋วปุ๋ย`,
      {
        status: 422,
        code: 'OCT31_STANDING_PRICE_NOT_FOUND',
        details: { standingYear, goodId },
      }
    );
  }
  return row;
}

/**
 * Executes a STRICTLY MANUAL, Role-Restricted FIFO Fertilizer Ticket Conversion.
 *
 * Enforces:
 *   1) executionMode must strictly be 'MANUAL' (rejects automated/scheduled runs)
 *   2) actorUser must hold ROLE_AUTHORIZED_REBATE_CONVERTER / REBATE_CONVERTER / ACCOUNTING / ADMIN / rebate.convert
 *   3) Official Oct 31st standing product price must exist in wf.Oct31StandingPrice
 *   4) Atomic FIFO deduction from oldest RebateTransactionLedger entries first (EarnedDate ASC, CreatedAt ASC, Id ASC),
 *      updating RemainingAmount and Status ('PARTIALLY_CONVERTED' or 'CONVERTED')
 */
async function executeManualTicketConversion(queryFnOrUndefined, params = {}) {
  const {
    custId,
    custCode = null,
    custName = null,
    goodId,
    standingYear = null,
    requestedAmountBaht = null,
    requestedTons = null,
    convertAllEligible = false,
    maturedOnly = false,
    executionMode = 'MANUAL',
    isAutomated = false,
    actorUser = null,
    asOfDate = null,
    note = null,
  } = params;

  // 1) Strict Manual-Only Execution Guard
  if (isAutomated === true || String(executionMode).toUpperCase() !== 'MANUAL') {
    throw createRebateError(
      'ไม่อนุญาตให้แปลง Rebate Pool เป็นตั๋วปุ๋ยแบบอัตโนมัติ ต้องเป็นการสั่งดำเนินการแบบ Manual โดยผู้มีสิทธิ์เท่านั้น',
      {
        status: 403,
        code: 'AUTO_CONVERSION_FORBIDDEN',
      }
    );
  }

  // 2) Authentication & Strict Role Guard
  if (!actorUser || !actorUser.id) {
    throw createRebateError('กรุณาเข้าสู่ระบบก่อนดำเนินการแปลงตั๋วปุ๋ย', {
      status: 401,
      code: 'UNAUTHENTICATED',
    });
  }
  if (!isAuthorizedConverter(actorUser)) {
    throw createRebateError(
      'บัญชีผู้ใช้นี้ไม่มีสิทธิ์แปลง Rebate Pool เป็นตั๋วปุ๋ย (ต้องเป็น ROLE_AUTHORIZED_REBATE_CONVERTER, ACCOUNTING หรือ ADMIN เท่านั้น)',
      {
        status: 403,
        code: 'FORBIDDEN_CONVERTER_ROLE',
      }
    );
  }

  const numericCustId = Number(custId);
  const numericGoodId = Number(goodId);
  if (!Number.isInteger(numericCustId) || numericCustId <= 0) {
    throw createRebateError('กรุณาระบุรหัสลูกค้า (custId) ให้ถูกต้อง', {
      status: 400,
      code: 'INVALID_CUSTOMER',
    });
  }
  if (!Number.isInteger(numericGoodId) || numericGoodId <= 0) {
    throw createRebateError('กรุณาระบุสินค้าปุ๋ยที่ต้องการแปลงตั๋ว (goodId)', {
      status: 400,
      code: 'INVALID_GOOD',
    });
  }

  const today = formatYmd(asOfDate) || getBangkokDateString();
  const effectiveYear = Number(standingYear || String(today).slice(0, 4));
  const actorRole = resolveActorPrimaryConverterRole(actorUser);

  const runInTx = async (txQuery) => {
    // 3) Mandatory Oct 31st Standing Price
    const standingPrice = await requireOct31StandingPrice(txQuery, {
      standingYear: effectiveYear,
      goodId: numericGoodId,
      lock: true,
    });

    // 4) Fetch & lock FIFO-eligible ledger lots oldest-first
    const allEligible = await RebatePoolModels.listFifoEligibleLedgersForCustomer(
      txQuery,
      numericCustId,
      { lock: true }
    );

    const fifoLots = maturedOnly
      ? allEligible.filter(lot => lot.cycleExpiryDate && lot.cycleExpiryDate <= today)
      : allEligible;

    const totalAvailable = round2(fifoLots.reduce((sum, lot) => sum + lot.remainingAmount, 0));
    if (totalAvailable <= 0) {
      throw createRebateError('ไม่มียอด Rebate คงเหลือที่พร้อมแปลงเป็นตั๋วปุ๋ยสำหรับลูกค้ารายนี้', {
        status: 400,
        code: 'NO_ELIGIBLE_REBATE_BALANCE',
      });
    }

    // Resolve target conversion Baht
    let targetBaht = null;
    if (requestedAmountBaht != null) {
      targetBaht = round2(requestedAmountBaht);
    } else if (requestedTons != null) {
      const tons = Number(requestedTons);
      if (!Number.isFinite(tons) || tons <= 0) {
        throw createRebateError('จำนวนตันที่ต้องการแปลงต้องมากกว่า 0', {
          status: 400,
          code: 'INVALID_REQUESTED_TONS',
        });
      }
      targetBaht = round2(tons * standingPrice.basePrice);
    } else if (convertAllEligible) {
      targetBaht = totalAvailable;
    } else {
      throw createRebateError('กรุณาระบุจำนวนเงินบาท หรือจำนวนตัน ที่ต้องการแปลงเป็นตั๋วปุ๋ย', {
        status: 400,
        code: 'MISSING_CONVERSION_AMOUNT',
      });
    }

    if (!(targetBaht > 0)) {
      throw createRebateError('จำนวนเงินที่ต้องการแปลงต้องมากกว่า 0 บาท', {
        status: 400,
        code: 'INVALID_CONVERSION_AMOUNT',
      });
    }
    if (targetBaht > totalAvailable) {
      throw createRebateError(
        `ยอด Rebate คงเหลือไม่เพียงพอ (มี ${totalAvailable.toLocaleString()} บาท แต่ขอแปลง ${targetBaht.toLocaleString()} บาท)`,
        {
          status: 400,
          code: 'INSUFFICIENT_REBATE_BALANCE',
          details: { totalAvailable, requestedAmountBaht: targetBaht },
        }
      );
    }

    // 5) FIFO Deduction Loop (supports Partial Deduction across entries)
    let remainingToDeduct = targetBaht;
    let deductionOrder = 0;
    const allocations = [];
    const updatedLedgers = [];

    for (const lot of fifoLots) {
      if (remainingToDeduct <= 0) break;
      if (lot.remainingAmount <= 0) continue;

      const deduct = round2(Math.min(lot.remainingAmount, remainingToDeduct));
      if (deduct <= 0) continue;

      const remainingAfter = round2(lot.remainingAmount - deduct);
      const nextStatus = remainingAfter <= 0
        ? LEDGER_STATUS.CONVERTED
        : LEDGER_STATUS.PARTIALLY_CONVERTED;

      const updRes = await txQuery(
        `UPDATE wf.RebateTransactionLedger
         SET RemainingAmount = @remainingAfter,
             Status = @nextStatus,
             UpdatedAt = DATEADD(HOUR, 7, GETUTCDATE())
         OUTPUT INSERTED.*
         WHERE Id = @id`,
        {
          id: lot.id,
          remainingAfter,
          nextStatus,
        }
      );

      deductionOrder += 1;
      allocations.push({
        ledgerId: lot.id,
        ledgerCode: lot.ledgerCode,
        earnedDate: lot.earnedDate,
        deductionOrder,
        deductedAmount: deduct,
        remainingBefore: lot.remainingAmount,
        remainingAfter,
        resultingStatus: nextStatus,
      });
      updatedLedgers.push(mapLedgerRow(updRes.recordset?.[0]) || { ...lot, remainingAmount: remainingAfter, status: nextStatus });

      remainingToDeduct = round2(remainingToDeduct - deduct);
    }

    if (remainingToDeduct > 0.01) {
      throw createRebateError('ไม่สามารถตัดยอด FIFO ได้ครบตามจำนวนที่ขอ', {
        status: 409,
        code: 'FIFO_DEDUCTION_INCOMPLETE',
      });
    }

    const totalDeducted = round2(allocations.reduce((s, a) => s + a.deductedAmount, 0));
    const convertedTons = round4(totalDeducted / standingPrice.basePrice);
    const convertedBags = Math.floor((totalDeducted / standingPrice.basePrice) * REBATE_CONSTANTS.BAGS_PER_TON + 1e-6);
    const pricePerBag = round2(standingPrice.basePrice / REBATE_CONSTANTS.BAGS_PER_TON);
    const residualBaht = Math.max(0, round2(totalDeducted - convertedBags * pricePerBag));
    const conversionNo = params.conversionNo || generateDocCode('FTC', today);

    const convRes = await txQuery(
      `INSERT INTO wf.FertilizerTicketConversion (
         ConversionNo, CustId, CustCode, CustName, StandingYear,
         GoodId, GoodCode, GoodName, StandingPricePerTon,
         ConvertedTons, ConvertedBags, ConvertedValueBaht, ResidualBaht,
         ExecutionMode, ConvertedByUserId, ConvertedByRole, Note, Status
       )
       OUTPUT INSERTED.*
       VALUES (
         @conversionNo, @custId, @custCode, @custName, @standingYear,
         @goodId, @goodCode, @goodName, @standingPricePerTon,
         @convertedTons, @convertedBags, @convertedValueBaht, @residualBaht,
         'MANUAL', @convertedByUserId, @convertedByRole, @note, @status
       )`,
      {
        conversionNo,
        custId: numericCustId,
        custCode: custCode ?? fifoLots[0]?.custCode ?? null,
        custName: custName ?? fifoLots[0]?.custName ?? null,
        standingYear: effectiveYear,
        goodId: standingPrice.goodId,
        goodCode: standingPrice.goodCode,
        goodName: standingPrice.goodName,
        standingPricePerTon: standingPrice.basePrice,
        convertedTons,
        convertedBags,
        convertedValueBaht: totalDeducted,
        residualBaht,
        convertedByUserId: actorUser.id,
        convertedByRole: actorRole,
        note: note || null,
        status: CONVERSION_STATUS.ISSUED,
      }
    );

    const conversion = mapConversionRow(convRes.recordset?.[0]);

    for (const alloc of allocations) {
      await txQuery(
        `INSERT INTO wf.FertilizerTicketConversionAllocation (
           ConversionId, LedgerId, DeductionOrder, DeductedAmount, RemainingAfter
         )
         VALUES (
           @conversionId, @ledgerId, @deductionOrder, @deductedAmount, @remainingAfter
         )`,
        {
          conversionId: conversion.id,
          ledgerId: alloc.ledgerId,
          deductionOrder: alloc.deductionOrder,
          deductedAmount: alloc.deductedAmount,
          remainingAfter: alloc.remainingAfter,
        }
      );
    }

    // Early conversion is allowed, but must not dismiss an alert while any
    // approved matured balance remains. An absent alert simply updates 0 rows.
    await txQuery(
      `UPDATE wf.RebateConversionAlert
       SET Status = 'CONVERTED',
           AcknowledgedByUserId = ISNULL(AcknowledgedByUserId, @userId),
           AcknowledgedAt = ISNULL(AcknowledgedAt, DATEADD(HOUR, 7, GETUTCDATE()))
       WHERE AlertYear = @year AND CustId = @custId AND Status = 'PENDING'
         AND NOT EXISTS (SELECT 1 FROM wf.RebateTransactionLedger l
           WHERE l.CustId = @custId AND l.RemainingAmount > 0
             AND l.ApprovalStatus IN ('NOT_REQUIRED','APPROVED')
             AND l.Status IN ('ACTIVE','READY_FOR_CONVERSION','PARTIALLY_CONVERTED')
             AND l.CycleExpiryDate <= @today)`,
      { year: effectiveYear, custId: numericCustId, userId: actorUser.id, today }
    );

    return {
      conversion,
      standingPrice,
      allocations,
      updatedLedgers,
      remainingPoolBalance: round2(totalAvailable - totalDeducted),
    };
  };

  if (typeof queryFnOrUndefined === 'function') {
    return runInTx(queryFnOrUndefined);
  }
  const result = await wfTransaction(async (tx) => runInTx(transactionQuery(tx, sql)));
  // Notifications and optional legacy event are emitted only after commit.
  try { await logChangeEvent({ entityType: 'FERTILIZER_TICKET_CONVERSION', entityId: String(result.conversion.id),
    action: 'MANUAL_FIFO_CONVERSION', changedBy: actorUser.id, summary: `Converted ${result.conversion.convertedValueBaht} THB` }); } catch { /* legacy event is best-effort */ }
  try { broadcast('rebate_ticket_converted', { conversionNo: result.conversion.conversionNo, custId: numericCustId,
    goodId: numericGoodId, convertedTons: result.conversion.convertedTons, convertedValueBaht: result.conversion.convertedValueBaht }); } catch { /* notification is best-effort */ }
  return result;
}

module.exports = {
  isAuthorizedConverter,
  isNovemberFirstDate,
  promoteMaturedLedgerEntries,
  getCustomerConversionQueue,
  runNovember1ConversionAlertCheck,
  snapshotOct31StandingPrices,
  requireOct31StandingPrice,
  executeManualTicketConversion,
};

