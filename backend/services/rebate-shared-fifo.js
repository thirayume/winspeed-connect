'use strict';

// Pure allocation for the existing WinSpeed 104-backed claim balance. This
// does not reserve funds: callers must hold the same RebateCust application
// lock as claim creation, re-read the live view, and persist reservations in
// the transaction before it can be used for financial writes.
const { computeCycleExpiryDate, formatYmd } = require('./rebate-pool-models');

function fail(code) { throw Object.assign(new Error(code), { code, status: 400 }); }
function exactUnits(value, scale, code) {
  const n = Number(value), scaled = n * scale;
  if (!Number.isFinite(n) || n < 0 || !Number.isSafeInteger(Math.round(scaled)) || Math.abs(scaled - Math.round(scaled)) > 0.00001) fail(code);
  return Math.round(scaled);
}
function costCents(milliTons, rateCents) {
  if (!Number.isSafeInteger(milliTons * rateCents)) fail('REBATE_AMOUNT_OUT_OF_RANGE');
  return Math.round(milliTons * rateCents / 1000);
}

function allocateSharedRebate(lots, { requestedAmountBaht = null, convertAll = false, maturedOnly = false, asOfDate, cycleMonths = 12 } = {}) {
  const date = formatYmd(asOfDate);
  if (!date || !Array.isArray(lots) || !Number.isInteger(cycleMonths) || cycleMonths < 1 || cycleMonths > 120) fail('INVALID_REBATE_ALLOCATION');
  if ((requestedAmountBaht != null) === (convertAll === true)) fail('INVALID_CONVERSION_AMOUNT');
  const seen = new Set();
  const eligible = lots.map(row => {
    const soid = Number(row.SourceSOID), listNo = Number(row.SourceListNo), sourceDate = formatYmd(row.SourceDocuDate);
    if (!Number.isSafeInteger(soid) || soid < 1 || !Number.isSafeInteger(listNo) || listNo < 1 || !sourceDate) fail('REBATE_SOURCE_INVALID');
    const key = `${soid}:${listNo}`;
    if (seen.has(key)) fail('REBATE_SOURCE_DUPLICATE');
    seen.add(key);
    const units = exactUnits(row.RemainingTonRebate, 1000, 'REBATE_SOURCE_INVALID');
    const rate = exactUnits(row.RebatePerTon, 100, 'REBATE_SOURCE_INVALID');
    return { soid, listNo, sourceDate, docNo: String(row.SourceDocuNo || ''), units, rate, planId: Number(row.PlanId) };
  }).filter(row => row.units > 0 && row.rate > 0 && row.sourceDate <= date && Number.isSafeInteger(row.planId) && row.planId > 0 &&
    (!maturedOnly || computeCycleExpiryDate(row.sourceDate, cycleMonths) <= date))
    .sort((a, b) => a.sourceDate.localeCompare(b.sourceDate) || a.docNo.localeCompare(b.docNo) || a.listNo - b.listNo || a.soid - b.soid);
  const available = eligible.reduce((sum, lot) => sum + costCents(lot.units, lot.rate), 0);
  if (!Number.isSafeInteger(available)) fail('REBATE_AMOUNT_OUT_OF_RANGE');
  const target = convertAll ? available : exactUnits(requestedAmountBaht, 100, 'INVALID_CONVERSION_AMOUNT');
  if (target <= 0) fail('INVALID_CONVERSION_AMOUNT');
  if (target > available) fail('INSUFFICIENT_REBATE_BALANCE');
  let remaining = target;
  const allocations = [];
  for (const lot of eligible) {
    if (!remaining) break;
    let low = 0, high = lot.units;
    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      if (costCents(mid, lot.rate) <= remaining) low = mid; else high = mid - 1;
    }
    const amount = costCents(low, lot.rate);
    if (!low || !amount) fail('CONVERSION_AMOUNT_NOT_REPRESENTABLE');
    allocations.push({ sourceSOID: lot.soid, sourceListNo: lot.listNo, qtyTon: low / 1000,
      rebatePerTon: lot.rate / 100, amountBaht: amount / 100 });
    remaining -= amount;
    // Do not skip an older partially consumed lot to make an amount fit.
    if (low < lot.units && remaining > 0) fail('CONVERSION_AMOUNT_NOT_REPRESENTABLE');
  }
  if (remaining) fail('CONVERSION_AMOUNT_NOT_REPRESENTABLE');
  return { allocations, convertedBaht: target / 100, remainingBaht: (available - target) / 100 };
}

module.exports = { allocateSharedRebate };
