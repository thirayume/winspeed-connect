'use strict';

// Internal preparation only: caller must hold draft/header/line locks and
// provide the transaction-bound query. It neither approves nor issues 103.
const { evaluateRebatePriceDecision } = require('./rebate-price-authority');
const { isValidStartDate } = require('./data-window');

function fail(code) { throw Object.assign(new Error(code), { code, status: 409 }); }
const positive = n => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;

async function prepareRebateBookingDecisions(query, { draft, lines, saleDate } = {}) {
  if (typeof query !== 'function' || !positive(Number(draft?.Id)) ||
      !positive(Number(draft?.DocumentRevision)) || !isValidStartDate(saleDate) ||
      !Array.isArray(lines) || !lines.length) fail('REBATE_DRAFT_INVALID');
  const seen = new Set();
  const decisions = [];
  for (const line of lines) {
    const lineNo = Number(line.LineNum);
    const goodId = Number(line.GoodId);
    if (Number(line.SoId) !== Number(draft.Id) || !positive(lineNo) ||
        !positive(goodId) || seen.has(lineNo)) fail('REBATE_DRAFT_INVALID');
    seen.add(lineNo);
    // Migration 165 keeps approved giveaways in the extension table and
    // excludes them from native SODT. They never earn a price snapshot.
    if (line.IsGiveaway) {
      if (line.IsCouponDrawn || line.IsControlTicketDrawn || line.RebatePricingMode || Number(line.PricePerTon)!==0)
        fail('REBATE_NONCOMMERCIAL_PROOF_UNAVAILABLE');
      continue;
    }
    // Drawn tickets remain held until their native 103 contract is verified.
    if (line.IsCouponDrawn || line.IsControlTicketDrawn)
      fail('REBATE_NONCOMMERCIAL_PROOF_UNAVAILABLE');
    if (!['POOL', 'CASH'].includes(line.RebatePricingMode)) fail('REBATE_PRICING_MODE_REQUIRED');
    decisions.push(await evaluateRebatePriceDecision(query, {
      draftId: Number(draft.Id), lineNo, revision: Number(draft.DocumentRevision), goodId,
      saleDate, qtyTon: line.QtyTon, sellingPrice: line.PricePerTon,
      isCashDiscount: line.RebatePricingMode === 'CASH',
    }));
  }
  if (!decisions.length) fail('REBATE_DRAFT_INVALID');
  return decisions;
}

module.exports = { prepareRebateBookingDecisions };
