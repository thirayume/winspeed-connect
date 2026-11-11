const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LEDGER_STATUS,
  APPROVAL_STATUS,
  PRICING_MODE,
  computeCycleExpiryDate,
} = require('../services/rebate-pool-models');
const {
  calculateOrderPricingAndRebate,
  recordRebateTransaction,
  approveOverLimitRebate,
  rejectOverLimitRebate,
} = require('../services/rebate-calculator-service');
const {
  runNovember1ConversionAlertCheck,
  snapshotOct31StandingPrices,
  executeManualTicketConversion,
  getCustomerConversionQueue,
} = require('../services/rebate-conversion-service');

/**
 * Lightweight deterministic in-memory SQL mock tailored for
 * wf.RebateTransactionLedger, wf.Oct31StandingPrice,
 * wf.FertilizerTicketConversion, wf.FertilizerTicketConversionAllocation,
 * and wf.RebateConversionAlert.
 */
function createInMemoryRebateDb() {
  const state = {
    ledgers: [],
    oct31Prices: [],
    conversions: [],
    allocations: [],
    alerts: [],
    nextLedgerId: 1,
    nextOct31Id: 1,
    nextConversionId: 1,
    nextAllocationId: 1,
    nextAlertId: 1,
  };

  function pVal(v) {
    return v && typeof v === 'object' && 'value' in v ? v.value : v;
  }

  async function query(sqlText, params = {}) {
    const sql = String(sqlText || '');

    // INSERT INTO wf.RebateTransactionLedger
    if (/INSERT\s+INTO\s+wf\.RebateTransactionLedger/i.test(sql)) {
      const id = state.nextLedgerId++;
      const row = {
        Id: id,
        LedgerCode: pVal(params.ledgerCode),
        SoId: pVal(params.soId) ?? null,
        SoLineId: pVal(params.soLineId) ?? null,
        DocNo: pVal(params.docNo) ?? null,
        CustId: Number(pVal(params.custId)),
        CustCode: pVal(params.custCode) ?? null,
        CustName: pVal(params.custName) ?? null,
        GoodId: pVal(params.goodId) ?? null,
        GoodCode: pVal(params.goodCode) ?? null,
        GoodName: pVal(params.goodName) ?? null,
        QtyTons: Number(pVal(params.qtyTons)),
        BasePrice: Number(pVal(params.basePrice)),
        SellingPrice: Number(pVal(params.sellingPrice)),
        InvoiceUnitPrice: Number(pVal(params.invoiceUnitPrice)),
        IsCashDiscount: Boolean(pVal(params.isCashDiscount)),
        PricingMode: pVal(params.pricingMode),
        RebatePerTon: Number(pVal(params.rebatePerTon)),
        TotalRebateEarned: Number(pVal(params.totalRebateEarned)),
        RemainingAmount: Number(pVal(params.remainingAmount)),
        CompanyExtraProfitPerTon: Number(pVal(params.companyExtraProfitPerTon)),
        TotalCompanyExtraProfit: Number(pVal(params.totalCompanyExtraProfit)),
        RequiresManagerApproval: Boolean(pVal(params.requiresManagerApproval)),
        ExcessApprovalAmount: Number(pVal(params.excessApprovalAmount)),
        TotalExcessApprovalAmount: Number(pVal(params.totalExcessApprovalAmount)),
        ApprovalStatus: pVal(params.approvalStatus),
        ApprovedByUserId: null,
        ApprovedAt: null,
        ApprovalNote: null,
        EarnedDate: pVal(params.earnedDate),
        CycleExpiryDate: pVal(params.cycleExpiryDate),
        MaturedAt: null,
        Status: pVal(params.status),
        CreatedByUserId: pVal(params.createdByUserId) ?? null,
        CreatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, id)),
        UpdatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, id)),
      };
      state.ledgers.push(row);
      return { recordset: [{ ...row }], rowsAffected: [1] };
    }

    // SELECT single ledger by Id
    if (/SELECT\s+\*\s+FROM\s+wf\.RebateTransactionLedger[\s\S]*WHERE\s+Id\s*=\s*@id/i.test(sql)) {
      const id = Number(pVal(params.id));
      const found = state.ledgers.find(r => r.Id === id);
      return { recordset: found ? [{ ...found }] : [] };
    }

    // SELECT FIFO eligible ledgers for customer
    if (/FROM\s+wf\.RebateTransactionLedger[\s\S]*WHERE\s+CustId\s*=\s*@custId[\s\S]*RemainingAmount\s*>\s*0/i.test(sql)) {
      const custId = Number(pVal(params.custId));
      const matched = state.ledgers
        .filter(
          r =>
            r.CustId === custId &&
            r.RemainingAmount > 0 &&
            ['NOT_REQUIRED', 'APPROVED'].includes(r.ApprovalStatus) &&
            ['ACTIVE', 'READY_FOR_CONVERSION', 'PARTIALLY_CONVERTED'].includes(r.Status)
        )
        .sort((a, b) =>
          a.EarnedDate.localeCompare(b.EarnedDate) ||
          (a.CreatedAt - b.CreatedAt) ||
          (a.Id - b.Id)
        );
      return { recordset: matched.map(r => ({ ...r })) };
    }

    // SELECT all ledgers for customer queue summary
    if (/FROM\s+wf\.RebateTransactionLedger[\s\S]*WHERE\s+CustId\s*=\s*@custId/i.test(sql)) {
      const custId = Number(pVal(params.custId));
      const matched = state.ledgers
        .filter(r => r.CustId === custId)
        .sort((a, b) => a.EarnedDate.localeCompare(b.EarnedDate) || (a.Id - b.Id));
      return { recordset: matched.map(r => ({ ...r })) };
    }

    // UPDATE approval decision on ledger
    if (/UPDATE\s+wf\.RebateTransactionLedger[\s\S]*SET\s+ApprovalStatus\s*=\s*@approvalStatus/i.test(sql)) {
      const id = Number(pVal(params.id));
      const row = state.ledgers.find(r => r.Id === id);
      if (!row) return { recordset: [], rowsAffected: [0] };
      row.ApprovalStatus = pVal(params.approvalStatus);
      row.Status = pVal(params.nextStatus);
      row.ApprovedByUserId = Number(pVal(params.approvedByUserId));
      row.ApprovedAt = new Date();
      row.ApprovalNote = pVal(params.note) ?? null;
      if (row.ApprovalStatus === 'REJECTED') row.RemainingAmount = 0;
      if (row.Status === 'READY_FOR_CONVERSION' && !row.MaturedAt) row.MaturedAt = new Date();
      row.UpdatedAt = new Date();
      return { recordset: [{ ...row }], rowsAffected: [1] };
    }

    // UPDATE promote matured ledgers to READY_FOR_CONVERSION
    if (/UPDATE\s+wf\.RebateTransactionLedger[\s\S]*SET\s+Status\s*=\s*@readyStatus[\s\S]*CycleExpiryDate\s*<=\s*@asOfDate/i.test(sql)) {
      const asOfDate = String(pVal(params.asOfDate));
      const readyStatus = pVal(params.readyStatus);
      const updated = [];
      for (const row of state.ledgers) {
        if (
          row.RemainingAmount > 0 &&
          ['NOT_REQUIRED', 'APPROVED'].includes(row.ApprovalStatus) &&
          row.Status === 'ACTIVE' &&
          row.CycleExpiryDate <= asOfDate
        ) {
          row.Status = readyStatus;
          row.MaturedAt = row.MaturedAt || new Date();
          row.UpdatedAt = new Date();
          updated.push({ ...row });
        }
      }
      return { recordset: updated, rowsAffected: [updated.length] };
    }

    // GROUP BY CustId for Nov 1 alerts
    if (/FROM\s+wf\.RebateTransactionLedger[\s\S]*GROUP\s+BY\s+CustId/i.test(sql)) {
      const asOfDate = String(pVal(params.asOfDate));
      const grouped = new Map();
      for (const row of state.ledgers) {
        if (
          row.RemainingAmount > 0 &&
          ['NOT_REQUIRED', 'APPROVED'].includes(row.ApprovalStatus) &&
          (row.Status === 'READY_FOR_CONVERSION' ||
            (['ACTIVE', 'PARTIALLY_CONVERTED'].includes(row.Status) && row.CycleExpiryDate <= asOfDate))
        ) {
          if (!grouped.has(row.CustId)) {
            grouped.set(row.CustId, {
              CustId: row.CustId,
              CustCode: row.CustCode,
              CustName: row.CustName,
              MaturedBalance: 0,
              EligibleLedgerCount: 0,
            });
          }
          const g = grouped.get(row.CustId);
          g.MaturedBalance += row.RemainingAmount;
          g.EligibleLedgerCount += 1;
        }
      }
      return { recordset: Array.from(grouped.values()) };
    }

    // UPDATE FIFO RemainingAmount deduction
    if (/UPDATE\s+wf\.RebateTransactionLedger[\s\S]*SET\s+RemainingAmount\s*=\s*@remainingAfter/i.test(sql)) {
      const id = Number(pVal(params.id));
      const row = state.ledgers.find(r => r.Id === id);
      if (!row) return { recordset: [], rowsAffected: [0] };
      row.RemainingAmount = Number(pVal(params.remainingAfter));
      row.Status = pVal(params.nextStatus);
      row.UpdatedAt = new Date();
      return { recordset: [{ ...row }], rowsAffected: [1] };
    }

    // UPSERT wf.Oct31StandingPrice
    if (/Oct31StandingPrice/i.test(sql) && /INSERT\s+INTO\s+wf\.Oct31StandingPrice/i.test(sql)) {
      const year = Number(pVal(params.standingYear));
      const goodId = Number(pVal(params.goodId));
      let row = state.oct31Prices.find(p => p.StandingYear === year && p.GoodId === goodId);
      if (row) {
        row.StandingDate = pVal(params.standingDate);
        row.GoodCode = pVal(params.goodCode);
        row.GoodName = pVal(params.goodName);
        row.BasePrice = Number(pVal(params.basePrice));
        row.SourceType = pVal(params.sourceType);
        row.UpdatedAt = new Date();
      } else {
        row = {
          Id: state.nextOct31Id++,
          StandingYear: year,
          StandingDate: pVal(params.standingDate),
          GoodId: goodId,
          GoodCode: pVal(params.goodCode),
          GoodName: pVal(params.goodName),
          BasePrice: Number(pVal(params.basePrice)),
          SourceType: pVal(params.sourceType),
          SourcePriceBookId: pVal(params.sourcePriceBookId) ?? null,
          PriceListCode: pVal(params.priceListCode) ?? null,
          Note: pVal(params.note) ?? null,
          CapturedByUserId: pVal(params.capturedByUserId) ?? null,
          CapturedAt: new Date(),
        };
        state.oct31Prices.push(row);
      }
      return { recordset: [{ ...row }], rowsAffected: [1] };
    }

    // SELECT single wf.Oct31StandingPrice
    if (/SELECT\s+\*\s+FROM\s+wf\.Oct31StandingPrice[\s\S]*GoodId\s*=\s*@goodId/i.test(sql)) {
      const year = Number(pVal(params.standingYear));
      const goodId = Number(pVal(params.goodId));
      const row = state.oct31Prices.find(p => p.StandingYear === year && p.GoodId === goodId);
      return { recordset: row ? [{ ...row }] : [] };
    }

    // INSERT wf.RebateConversionAlert (idempotent)
    if (/INSERT\s+INTO\s+wf\.RebateConversionAlert/i.test(sql)) {
      const alertYear = Number(pVal(params.alertYear));
      const custId = Number(pVal(params.custId));
      const exists = state.alerts.find(a => a.AlertYear === alertYear && a.CustId === custId);
      if (exists) return { recordset: [], rowsAffected: [0] };
      const row = {
        Id: state.nextAlertId++,
        AlertYear: alertYear,
        AlertDate: pVal(params.alertDate),
        CustId: custId,
        CustCode: pVal(params.custCode),
        CustName: pVal(params.custName),
        MaturedBalance: Number(pVal(params.maturedBalance)),
        EligibleLedgerCount: Number(pVal(params.eligibleCount)),
        Status: 'PENDING',
        NotifiedAt: new Date(),
      };
      state.alerts.push(row);
      return { recordset: [{ ...row }], rowsAffected: [1] };
    }

    // INSERT wf.FertilizerTicketConversion
    if (/INSERT\s+INTO\s+wf\.FertilizerTicketConversion\b/i.test(sql)) {
      const row = {
        Id: state.nextConversionId++,
        ConversionNo: pVal(params.conversionNo),
        CustId: Number(pVal(params.custId)),
        CustCode: pVal(params.custCode),
        CustName: pVal(params.custName),
        StandingYear: Number(pVal(params.standingYear)),
        GoodId: Number(pVal(params.goodId)),
        GoodCode: pVal(params.goodCode),
        GoodName: pVal(params.goodName),
        StandingPricePerTon: Number(pVal(params.standingPricePerTon)),
        ConvertedTons: Number(pVal(params.convertedTons)),
        ConvertedBags: Number(pVal(params.convertedBags)),
        ConvertedValueBaht: Number(pVal(params.convertedValueBaht)),
        ResidualBaht: Number(pVal(params.residualBaht)),
        ExecutionMode: 'MANUAL',
        ConvertedByUserId: Number(pVal(params.convertedByUserId)),
        ConvertedByRole: pVal(params.convertedByRole),
        ConvertedAt: new Date(),
        Note: pVal(params.note),
        Status: pVal(params.status),
      };
      state.conversions.push(row);
      return { recordset: [{ ...row }], rowsAffected: [1] };
    }

    // INSERT wf.FertilizerTicketConversionAllocation
    if (/INSERT\s+INTO\s+wf\.FertilizerTicketConversionAllocation/i.test(sql)) {
      const row = {
        Id: state.nextAllocationId++,
        ConversionId: Number(pVal(params.conversionId)),
        LedgerId: Number(pVal(params.ledgerId)),
        DeductionOrder: Number(pVal(params.deductionOrder)),
        DeductedAmount: Number(pVal(params.deductedAmount)),
        RemainingAfter: Number(pVal(params.remainingAfter)),
      };
      state.allocations.push(row);
      return { recordset: [{ ...row }], rowsAffected: [1] };
    }

    // UPDATE wf.RebateConversionAlert on conversion
    if (/UPDATE\s+wf\.RebateConversionAlert/i.test(sql)) {
      const year = Number(pVal(params.year));
      const custId = Number(pVal(params.custId));
      for (const a of state.alerts) {
        if (a.AlertYear === year && a.CustId === custId && a.Status === 'PENDING') {
          a.Status = 'CONVERTED';
        }
      }
      return { recordset: [], rowsAffected: [1] };
    }

    throw new Error(`Unhandled mock SQL query: ${sql}`);
  }

  return { state, query };
}

test('Case A: Below base price with Cash Discount uses SellingPrice on invoice and 0 rebate', () => {
  const res = calculateOrderPricingAndRebate(18000, 17750, 10, true);
  assert.equal(res.invoiceUnitPrice, 17750);
  assert.equal(res.rebatePerTon, 0);
  assert.equal(res.totalRebateEarned, 0);
  assert.equal(res.companyExtraProfitPerTon, 0);
  assert.equal(res.requiresManagerApproval, false);
  assert.equal(res.excessApprovalAmount, 0);
  assert.equal(res.approvalStatus, APPROVAL_STATUS.NOT_REQUIRED);
  assert.equal(res.pricingMode, PRICING_MODE.CASH_DISCOUNT);
});

test('Case B Tier 1: Below base price <= 200 THB/ton bills at BasePrice and earns Rebate = Diff', () => {
  const res100 = calculateOrderPricingAndRebate(18000, 17900, 10, false);
  assert.equal(res100.invoiceUnitPrice, 18000);
  assert.equal(res100.rebatePerTon, 100);
  assert.equal(res100.totalRebateEarned, 1000);
  assert.equal(res100.companyExtraProfitPerTon, 0);
  assert.equal(res100.requiresManagerApproval, false);
  assert.equal(res100.excessApprovalAmount, 0);
  assert.equal(res100.approvalStatus, APPROVAL_STATUS.NOT_REQUIRED);
  assert.equal(res100.pricingMode, PRICING_MODE.REBATE_WITHIN_LIMIT);

  const res200 = calculateOrderPricingAndRebate(18000, 17800, 10, false);
  assert.equal(res200.invoiceUnitPrice, 18000);
  assert.equal(res200.rebatePerTon, 200);
  assert.equal(res200.totalRebateEarned, 2000);
  assert.equal(res200.requiresManagerApproval, false);
  assert.equal(res200.excessApprovalAmount, 0);
});

test('Case B Tier 2: Discount 201..300 THB/ton requires Manager approval for excess amount', () => {
  const res = calculateOrderPricingAndRebate(18000, 17700, 10, false);
  assert.equal(res.invoiceUnitPrice, 18000);
  assert.equal(res.rebatePerTon, 300);
  assert.equal(res.totalRebateEarned, 3000);
  assert.equal(res.companyExtraProfitPerTon, 0);
  assert.equal(res.requiresManagerApproval, true);
  assert.equal(res.excessApprovalAmount, 100);
  assert.equal(res.totalExcessApprovalAmount, 1000);
  assert.equal(res.approvalStatus, APPROVAL_STATUS.PENDING_MANAGER_APPROVAL);
  assert.equal(res.pricingMode, PRICING_MODE.REBATE_OVER_LIMIT);
});

test('Case B Tier 3: Discount > 300 THB/ton without Cash Discount throws REBATE_EXCEEDS_MAX_LIMIT', () => {
  assert.throws(
    () => calculateOrderPricingAndRebate(18000, 17699, 10, false),
    (err) => err.code === 'REBATE_EXCEEDS_MAX_LIMIT' && err.status === 400
  );

  // Same >300 discount IS permitted when isCashDiscount === true
  const cashAllowed = calculateOrderPricingAndRebate(18000, 17500, 10, true);
  assert.equal(cashAllowed.invoiceUnitPrice, 17500);
  assert.equal(cashAllowed.rebatePerTon, 0);
});

test('Case C: At or above BasePrice bills at SellingPrice; caps Rebate at 200 and sends excess to company extra profit', () => {
  const exactList = calculateOrderPricingAndRebate(18000, 18000, 10, false);
  assert.equal(exactList.invoiceUnitPrice, 18000);
  assert.equal(exactList.rebatePerTon, 0);
  assert.equal(exactList.totalRebateEarned, 0);
  assert.equal(exactList.companyExtraProfitPerTon, 0);
  assert.equal(exactList.pricingMode, PRICING_MODE.STANDARD_LIST);

  const markup150 = calculateOrderPricingAndRebate(18000, 18150, 10, false);
  assert.equal(markup150.invoiceUnitPrice, 18150);
  assert.equal(markup150.rebatePerTon, 150);
  assert.equal(markup150.totalRebateEarned, 1500);
  assert.equal(markup150.companyExtraProfitPerTon, 0);
  assert.equal(markup150.pricingMode, PRICING_MODE.MARKUP_STANDARD);

  const markup300 = calculateOrderPricingAndRebate(18000, 18300, 10, false);
  assert.equal(markup300.invoiceUnitPrice, 18300);
  assert.equal(markup300.rebatePerTon, 200);
  assert.equal(markup300.totalRebateEarned, 2000);
  assert.equal(markup300.companyExtraProfitPerTon, 100);
  assert.equal(markup300.totalCompanyExtraProfit, 1000);
  assert.equal(markup300.requiresManagerApproval, false);
  assert.equal(markup300.pricingMode, PRICING_MODE.MARKUP_EXTRA_PROFIT);
});

test('Manager Approval & Rejection workflow + anti-self-approval + FIFO exclusion', async () => {
  const db = createInMemoryRebateDb();
  const salesUser = { id: 101, role: 'SALES' };
  const managerUser = { id: 202, role: 'MANAGER' };

  const created = await recordRebateTransaction(
    db.query,
    {
      custId: 1092,
      custName: 'บริษัท ทดสอบ จำกัด',
      goodId: 1094,
      qtyTons: 10,
      basePrice: 18000,
      sellingPrice: 17750,
      isCashDiscount: false,
      earnedDate: '2026-01-15',
      createdByUserId: salesUser.id,
    },
    { skipCostCheck: true }
  );

  assert.equal(created.ledger.approvalStatus, APPROVAL_STATUS.PENDING_MANAGER_APPROVAL);
  assert.equal(created.ledger.status, LEDGER_STATUS.PENDING_APPROVAL);
  assert.equal(created.ledger.excessApprovalAmount, 50);

  // Blocked from FIFO queue before Manager approves
  const qBefore = await getCustomerConversionQueue(db.query, { custId: 1092, asOfDate: '2026-11-01' });
  assert.equal(qBefore.pendingApprovalBalance, 2500);
  assert.equal(qBefore.totalFifoEligibleBalance, 0);

  // SALES user cannot approve
  await assert.rejects(
    () => approveOverLimitRebate(db.query, { ledgerId: created.ledger.id, actorUser: salesUser }),
    (err) => err.code === 'FORBIDDEN_APPROVAL_ROLE'
  );

  // Self-approval blocked even if creator were MANAGER
  await assert.rejects(
    () => approveOverLimitRebate(db.query, { ledgerId: created.ledger.id, actorUser: { id: salesUser.id, role: 'MANAGER' } }),
    (err) => err.code === 'SELF_APPROVAL_FORBIDDEN'
  );

  // MANAGER approves
  const approved = await approveOverLimitRebate(db.query, {
    ledgerId: created.ledger.id,
    actorUser: managerUser,
    note: 'Approved strategic customer',
    asOfDate: '2026-06-01',
  });
  assert.equal(approved.approvalStatus, APPROVAL_STATUS.APPROVED);
  assert.equal(approved.status, LEDGER_STATUS.ACTIVE);

  const qAfter = await getCustomerConversionQueue(db.query, { custId: 1092, asOfDate: '2026-06-01' });
  assert.equal(qAfter.totalFifoEligibleBalance, 2500);
  assert.equal(qAfter.pendingApprovalBalance, 0);

  // Separate entry rejected
  const created2 = await recordRebateTransaction(
    db.query,
    {
      custId: 1092,
      qtyTons: 5,
      basePrice: 18000,
      sellingPrice: 17700,
      isCashDiscount: false,
      earnedDate: '2026-02-01',
      createdByUserId: salesUser.id,
    },
    { skipCostCheck: true }
  );
  const rejected = await rejectOverLimitRebate(db.query, {
    ledgerId: created2.ledger.id,
    actorUser: managerUser,
    note: 'Margin too low',
  });
  assert.equal(rejected.approvalStatus, APPROVAL_STATUS.REJECTED);
  assert.equal(rejected.status, LEDGER_STATUS.REJECTED);
  assert.equal(rejected.remainingAmount, 0);
});

test('12-Month cycle maturity promotion & November 1st idempotent alert trigger', async () => {
  assert.equal(computeCycleExpiryDate('2025-10-15', 12), '2026-10-15');
  assert.equal(computeCycleExpiryDate('2024-02-29', 12), '2025-02-28');

  const db = createInMemoryRebateDb();
  await recordRebateTransaction(
    db.query,
    {
      custId: 5001,
      custName: 'ร้านเกษตรรุ่งเรือง',
      qtyTons: 10,
      basePrice: 18000,
      sellingPrice: 17900,
      isCashDiscount: false,
      earnedDate: '2025-10-15',
    },
    { skipCostCheck: true }
  );

  // Oct 31 promotes matured lot to queue, but does NOT fire annual Nov 1 alert
  const oct31Check = await runNovember1ConversionAlertCheck(db.query, { asOfDate: '2026-10-31' });
  assert.equal(oct31Check.promotedCount, 1);
  assert.equal(oct31Check.triggered, false);
  assert.equal(oct31Check.reason, 'NOT_NOVEMBER_1');
  assert.equal(db.state.ledgers[0].Status, LEDGER_STATUS.READY_FOR_CONVERSION);
  assert.equal(db.state.alerts.length, 0);

  // Nov 1 triggers annual conversion alert once per customer
  const nov1First = await runNovember1ConversionAlertCheck(db.query, { asOfDate: '2026-11-01' });
  assert.equal(nov1First.triggered, true);
  assert.equal(nov1First.alertsCreated, 1);
  assert.equal(nov1First.alerts[0].MaturedBalance, 1000);

  // Re-running same Nov 1 is idempotent
  const nov1Second = await runNovember1ConversionAlertCheck(db.query, { asOfDate: '2026-11-01' });
  assert.equal(nov1Second.triggered, true);
  assert.equal(nov1Second.alertsCreated, 0);
  assert.equal(db.state.alerts.length, 1);
});

test('Manual-only guard, Role guard, Mandatory Oct 31 price & FIFO Partial Deduction across entries', async () => {
  const db = createInMemoryRebateDb();
  const authorizedConverter = { id: 901, role: 'ROLE_AUTHORIZED_REBATE_CONVERTER' };
  const salesUser = { id: 101, role: 'SALES' };

  // Seed 3 lots for customer 777:
  // Lot 1: 2025-05-01, 2000 THB
  // Lot 2: 2025-08-01, 3000 THB
  // Lot 3: 2026-01-10, 1500 THB (unapproved - must NEVER be touched by FIFO!)
  const lot1 = await recordRebateTransaction(
    db.query,
    {
      custId: 777,
      custName: 'สหกรณ์การเกษตร 777',
      goodId: 1094,
      qtyTons: 10,
      basePrice: 18000,
      sellingPrice: 17800,
      earnedDate: '2025-05-01',
    },
    { skipCostCheck: true }
  );
  const lot2 = await recordRebateTransaction(
    db.query,
    {
      custId: 777,
      custName: 'สหกรณ์การเกษตร 777',
      goodId: 1094,
      qtyTons: 15,
      basePrice: 18000,
      sellingPrice: 18200,
      earnedDate: '2025-08-01',
    },
    { skipCostCheck: true }
  );
  const lot3Pending = await recordRebateTransaction(
    db.query,
    {
      custId: 777,
      goodId: 1094,
      qtyTons: 6,
      basePrice: 18000,
      sellingPrice: 17750,
      earnedDate: '2025-01-01', // older date, but still PENDING_MANAGER_APPROVAL
    },
    { skipCostCheck: true }
  );

  // 1) Block automated execution
  await assert.rejects(
    () => executeManualTicketConversion(db.query, {
      custId: 777,
      goodId: 1094,
      requestedAmountBaht: 1800,
      executionMode: 'AUTO',
      actorUser: authorizedConverter,
    }),
    (err) => err.code === 'AUTO_CONVERSION_FORBIDDEN'
  );

  // 2) Block unauthorized role (SALES)
  await assert.rejects(
    () => executeManualTicketConversion(db.query, {
      custId: 777,
      goodId: 1094,
      requestedAmountBaht: 1800,
      executionMode: 'MANUAL',
      actorUser: salesUser,
    }),
    (err) => err.code === 'FORBIDDEN_CONVERTER_ROLE'
  );

  // 3) Require Oct 31 standing price
  await assert.rejects(
    () => executeManualTicketConversion(db.query, {
      custId: 777,
      goodId: 1094,
      standingYear: 2026,
      requestedAmountBaht: 3600,
      executionMode: 'MANUAL',
      actorUser: authorizedConverter,
    }),
    (err) => err.code === 'OCT31_STANDING_PRICE_NOT_FOUND' && err.status === 422
  );

  // 4) Snapshot Oct 31 standing price @ 18,000 THB/ton and convert 3,600 THB (= 0.2 ton / 4 bags)
  await snapshotOct31StandingPrices(db.query, {
    standingYear: 2026,
    actorUser: authorizedConverter,
    entries: [{ goodId: 1094, goodCode: '15-7-18', goodName: 'ปุ๋ย 15-7-18', basePrice: 18000 }],
  });

  const conv1 = await executeManualTicketConversion(db.query, {
    custId: 777,
    goodId: 1094,
    standingYear: 2026,
    requestedAmountBaht: 3600,
    executionMode: 'MANUAL',
    actorUser: authorizedConverter,
    asOfDate: '2026-11-01',
  });

  assert.equal(conv1.conversion.standingPricePerTon, 18000);
  assert.equal(conv1.conversion.convertedTons, 0.2);
  assert.equal(conv1.conversion.convertedBags, 4);
  assert.equal(conv1.conversion.convertedValueBaht, 3600);
  assert.equal(conv1.conversion.executionMode, 'MANUAL');

  // Verify strict FIFO order + Partial Deduction:
  // Lot 1 (2000 THB) -> fully consumed (CONVERTED, 0 left)
  // Lot 2 (3000 THB) -> partially consumed (1600 deducted, 1400 left, PARTIALLY_CONVERTED)
  // Lot 3 (PENDING_APPROVAL) -> completely untouched
  assert.equal(conv1.allocations.length, 2);
  assert.equal(conv1.allocations[0].ledgerId, lot1.ledger.id);
  assert.equal(conv1.allocations[0].deductedAmount, 2000);
  assert.equal(conv1.allocations[0].remainingAfter, 0);
  assert.equal(conv1.allocations[0].resultingStatus, LEDGER_STATUS.CONVERTED);

  assert.equal(conv1.allocations[1].ledgerId, lot2.ledger.id);
  assert.equal(conv1.allocations[1].deductedAmount, 1600);
  assert.equal(conv1.allocations[1].remainingAfter, 1400);
  assert.equal(conv1.allocations[1].resultingStatus, LEDGER_STATUS.PARTIALLY_CONVERTED);

  assert.equal(db.state.ledgers.find(l => l.Id === lot3Pending.ledger.id).RemainingAmount, 1500);
  assert.equal(conv1.remainingPoolBalance, 1400);

  // 5) Follow-up conversion of 0.05 tons (1 bag = 900 THB) drains further from partially-converted Lot 2 -> 500 left
  const conv2 = await executeManualTicketConversion(db.query, {
    custId: 777,
    goodId: 1094,
    standingYear: 2026,
    requestedTons: 0.05,
    executionMode: 'MANUAL',
    actorUser: { id: 902, role: 'ACCOUNTING' },
    asOfDate: '2026-11-02',
  });
  assert.equal(conv2.conversion.convertedValueBaht, 900);
  assert.equal(conv2.allocations.length, 1);
  assert.equal(conv2.allocations[0].ledgerId, lot2.ledger.id);
  assert.equal(conv2.allocations[0].remainingAfter, 500);
  assert.equal(conv2.remainingPoolBalance, 500);
});

