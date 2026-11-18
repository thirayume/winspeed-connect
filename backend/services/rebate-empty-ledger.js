'use strict';
// After a Rebate reset the verified shipment ledger starts empty. The shipment
// queue reports "no lots in scope" (REBATE_CUSTOMER_OUT_OF_SCOPE, 404) both for
// a customer outside the caller's scope and for every customer with nothing in
// the new generation yet. On UAT (17 Nov 2026) that made the bill form tell
// sales "Rebate cannot be checked" on every bill right after the reset.
//
// This keeps the two cases apart:
//   - the customer has no accrual at all in this epoch -> an empty queue, which
//     the route returns only after checking that the caller (both identities of
//     an Access As session) may see the customer;
//   - the customer has accruals, none in the caller's lot scope -> the original
//     404 stands, so a lot belonging to someone else is never reported as zero.
const { getShipmentCustomerQueue } = require('./rebate-shipment-queue');

const EMPTY_CODE = 'REBATE_CUSTOMER_OUT_OF_SCOPE';

function emptyQueue(custId, asOfDate) {
  return { custId, asOfDate, maturedBalance: 0, activeUnmaturedBalance: 0, totalFifoEligibleBalance: 0,
    pendingApprovalBalance: null, withoutPlanCount: 0, openingEligibleBalance: 0, openingEligibleCount: 0,
    detailLimit: 500, eligibleLedgers: [], emptyLedger: true };
}

// The caller holds both reset fences and the business transaction, as for the queue itself.
async function getShipmentCustomerQueueOrEmpty(query, params, overrides = {}) {
  const readQueue = overrides.getQueue || getShipmentCustomerQueue;
  try {
    return await readQueue(query, params);
  } catch (err) {
    if (err?.code !== EMPTY_CODE) throw err;
    const { epoch, custId, asOfDate } = params || {};
    // The queue has already taken the customer's application lock in this
    // transaction; HOLDLOCK keeps a concurrent first accrual from slipping in
    // between this check and the answer.
    const any = (await query(`SELECT TOP 1 a.Id FROM wf.RebateShipmentAccrual a WITH(HOLDLOCK)
      WHERE a.EnvironmentKind=@environment AND a.ResetId=@resetId AND a.Generation=@generation AND a.CustId=@custId`,
    { environment: epoch.environment, resetId: epoch.resetId, generation: epoch.generation, custId })).recordset || [];
    if (any.length) throw err;
    return emptyQueue(custId, asOfDate);
  }
}

// Route side: an empty queue is shown only to a caller who may see the customer.
async function assertEmptyQueueVisible(user, queue, { customerVisible = require('./secondary-customer-scope').customerVisible } = {}) {
  if (!queue?.emptyLedger) return queue;
  if (await customerVisible(user, queue.custId)) return queue;
  throw Object.assign(new Error(EMPTY_CODE), { code: EMPTY_CODE, status: 404 });
}

module.exports = { getShipmentCustomerQueueOrEmpty, assertEmptyQueueVisible, emptyQueue };
