'use strict';
const { formatYmd, round2 } = require('./rebate-pool-models');
const { isValidStartDate } = require('./data-window');

// The aggregate includes opening balances. Individual pre-window source
// documents never leave the server, and detail is bounded for responsiveness.
async function getSharedCustomerQueue(query, { custId, asOfDate, cutoff, scope, cycleMonths = 12 }) {
  if (!Number.isSafeInteger(custId) || custId <= 0 || !isValidStartDate(asOfDate) || !isValidStartDate(cutoff) ||
      !Number.isInteger(cycleMonths) || cycleMonths < 1 || cycleMonths > 120) {
    throw Object.assign(new Error('Invalid rebate queue input'), { code: 'INVALID_REBATE_QUEUE', status: 400 });
  }
  const args = { cid: String(custId), today: asOfDate, cutoff, months: cycleMonths, ...scope.inputs };
  const visible = await query(`SELECT TOP 1 1 AS ok FROM wf.v_RebateAccrualRemaining
    WHERE CustId=@cid AND ${scope.sql}`, args);
  if (!visible.recordset?.length) throw Object.assign(new Error('Customer outside scope'), { code: 'REBATE_CUSTOMER_OUT_OF_SCOPE', status: 404 });
  const summary = (await query(`SELECT
    ISNULL(SUM(CASE WHEN PlanId IS NOT NULL AND RebatePerTon > 0 AND DATEADD(MONTH,@months,SourceDocuDate) <= @today
      THEN ROUND(RemainingTonRebate*RebatePerTon,2) ELSE 0 END),0) AS MaturedBalance,
    ISNULL(SUM(CASE WHEN PlanId IS NOT NULL AND RebatePerTon > 0 AND DATEADD(MONTH,@months,SourceDocuDate) > @today
      THEN ROUND(RemainingTonRebate*RebatePerTon,2) ELSE 0 END),0) AS UnmaturedBalance,
    ISNULL(SUM(CASE WHEN PlanId IS NOT NULL AND RebatePerTon > 0 AND SourceDocuDate < @cutoff
      THEN ROUND(RemainingTonRebate*RebatePerTon,2) ELSE 0 END),0) AS OpeningBalance,
    ISNULL(SUM(CASE WHEN PlanId IS NOT NULL AND RebatePerTon > 0 AND SourceDocuDate < @cutoff THEN 1 ELSE 0 END),0) AS OpeningCount,
    ISNULL(SUM(CASE WHEN PlanId IS NULL THEN 1 ELSE 0 END),0) AS WithoutPlanCount
    FROM wf.v_RebateAccrualRemaining
    WHERE CustId=@cid AND SourceDocuDate <= @today AND RemainingTonRebate > 0`, args)).recordset?.[0];
  if (!summary) throw Object.assign(new Error('Rebate queue unavailable'), { code: 'REBATE_QUEUE_UNAVAILABLE', status: 503 });
  const detail = await query(`SELECT TOP 500 SourceSOID,SourceListNo,SourceDocuNo,SourceDocuDate,
      DATEADD(MONTH,@months,SourceDocuDate) AS CycleExpiryDate,
      ROUND(RemainingTonRebate*RebatePerTon,2) AS RemainingAmount
    FROM wf.v_RebateAccrualRemaining
    WHERE CustId=@cid AND SourceDocuDate >= @cutoff AND SourceDocuDate <= @today
      AND RemainingTonRebate > 0 AND PlanId IS NOT NULL AND RebatePerTon > 0
    ORDER BY SourceDocuDate,SourceDocuNo,SourceListNo,SourceSOID`, args);
  const maturedBalance = round2(summary.MaturedBalance), activeUnmaturedBalance = round2(summary.UnmaturedBalance);
  return { custId, asOfDate, maturedBalance, activeUnmaturedBalance,
    totalFifoEligibleBalance: round2(maturedBalance + activeUnmaturedBalance), pendingApprovalBalance: null,
    withoutPlanCount: Number(summary.WithoutPlanCount || 0), openingEligibleBalance: round2(summary.OpeningBalance),
    openingEligibleCount: Number(summary.OpeningCount || 0), detailLimit: 500,
    eligibleLedgers: (detail.recordset || []).map(row => ({ id: `${row.SourceSOID}:${row.SourceListNo}`,
      docNo: row.SourceDocuNo || null, earnedDate: formatYmd(row.SourceDocuDate),
      cycleExpiryDate: formatYmd(row.CycleExpiryDate), remainingAmount: round2(row.RemainingAmount) })) };
}
module.exports = { getSharedCustomerQueue };
