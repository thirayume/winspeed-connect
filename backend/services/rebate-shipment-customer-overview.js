'use strict';
const { isValidStartDate } = require('./data-window');
const { getShipmentCustomerQueue } = require('./rebate-shipment-queue');
function fail(code, status = 400) { throw Object.assign(new Error(code), { code, status }); }

// Bounded pages, ordered by customer id, so customer locks are always acquired
// in the same order. Every amount comes from the same verified queue as the
// conversion API; an unverified customer never receives an estimated balance.
async function getShipmentCustomerOverview(query, options, overrides = {}) {
  const { epoch, scope, asOfDate, cutoff, cycleMonths, after = 0, limit = 10, search = '' } = options || {};
  if (typeof query !== 'function' || !epoch || !scope || typeof scope.sql !== 'string' ||
      !isValidStartDate(asOfDate) || !isValidStartDate(cutoff) ||
      !Number.isSafeInteger(after) || after < 0 || after > 2147483647 ||
      !Number.isInteger(limit) || limit < 1 || limit > 10 || typeof search !== 'string' || search.length > 100)
    fail('INVALID_REBATE_OVERVIEW');
  const rows = (await query(`SELECT DISTINCT TOP (@take) x.CustId,x.CustCode,x.CustName
    FROM (SELECT a.CustId,c.CustCode,c.CustName,h.EmpID AS SalesEmpId
      FROM wf.RebateShipmentAccrual a
      LEFT JOIN dbo.SOHD h ON h.SOID=a.SourceSOID AND h.DocuType=104
      LEFT JOIN dbo.EMCust c ON c.CustID=a.CustId
      WHERE a.EnvironmentKind=@environment AND a.ResetId=@resetId AND a.Generation=@generation
        AND a.CustId>@after) x
    WHERE ${scope.sql} AND (@search='' OR CHARINDEX(LOWER(@search),LOWER(COALESCE(x.CustCode,'')))>0
      OR CHARINDEX(LOWER(@search),LOWER(COALESCE(x.CustName,'')))>0
      OR CHARINDEX(@search,CONVERT(nvarchar(20),x.CustId))>0)
    ORDER BY x.CustId`, { ...scope.inputs, environment: epoch.environment, resetId: epoch.resetId,
    generation: epoch.generation, after, take: limit + 1, search })).recordset || [];
  const items = [];
  for (const row of rows.slice(0, limit)) {
    const custId = Number(row.CustId);
    if (!Number.isSafeInteger(custId) || custId <= after || custId > 2147483647 ||
        (items.length && custId <= items[items.length - 1].custId)) fail('REBATE_OVERVIEW_SOURCE_INVALID', 503);
    try {
      const queue = await (overrides.getQueue || getShipmentCustomerQueue)(query,
        { epoch, scope, asOfDate, cutoff, cycleMonths, custId });
      if (!Number.isFinite(queue.totalFifoEligibleBalance) || queue.totalFifoEligibleBalance < 0 ||
          !Number.isFinite(queue.openingEligibleBalance) || queue.openingEligibleBalance < 0 ||
          queue.openingEligibleBalance > queue.totalFifoEligibleBalance)
        fail('REBATE_OVERVIEW_SOURCE_INVALID', 503);
      items.push({ custId, custCode: row.CustCode || null, custName: row.CustName || null,
        status: 'ready', balance: queue.totalFifoEligibleBalance, openingBalance: queue.openingEligibleBalance });
    } catch (err) {
      // Abort transaction-level failures. Source/verification problems are
      // shown without a monetary value, never converted to a zero balance.
      if (!['REBATE_RESERVATION_SOURCE_CHANGED', 'REBATE_CUSTOMER_OUT_OF_SCOPE'].includes(err?.code)) throw err;
      items.push({ custId, custCode: row.CustCode || null, custName: row.CustName || null,
        status: 'needs_review', balance: null, openingBalance: null });
    }
  }
  return { items, nextAfter: rows.length > limit ? items[items.length - 1].custId : null, asOfDate };
}
module.exports = { getShipmentCustomerOverview };
