'use strict';

// Rebate Pool base price comes from the general WinSpeed price list effective
// on the authoritative sale date. Call only in the sale transaction; do not
// use NOLOCK or accept a list price supplied by the browser. A same-date tie
// is held for investigation rather than resolved using an arbitrary SQL row.
const { isValidStartDate } = require('./data-window');
const { shipmentUnits, shipmentMoney } = require('./rebate-shipment-accrual');
const { calculateOrderPricingAndRebate } = require('./rebate-calculator-service');
const crypto = require('crypto');

function fail(code, status = 409) { throw Object.assign(new Error(code), { code, status }); }
function positiveId(value) { return Number.isSafeInteger(value) && value > 0 && value <= 2147483647; }

// The discount limits come from App Settings (REBATE_STANDARD_LIMIT_PER_TON, REBATE_MAX_LIMIT_PER_TON), read the
// same way as the bill's price check, so the bill and its Rebate decision never disagree. The limits used are part
// of the decision and of its fingerprint, and are stored with the booking price, so a later change of the settings
// never changes a booking already priced. The markup cap follows the standard limit, as in the Rebate calculator.
function validLimits(l) {
  return !!l && Number.isSafeInteger(l.standard) && Number.isSafeInteger(l.max) && l.standard >= 0 && l.max >= l.standard && l.max <= 1500;
}
function limitOptions(l) {
  if (!validLimits(l)) fail('REBATE_LIMITS_INVALID', 503);
  return { standardDiscountLimit: l.standard, maxDiscountLimit: l.max, standardMarkupCap: l.standard };
}
async function readDecisionLimits() {
  const raw = await require('./price-authority').readDiscountLimits();
  const limits = { standard: Number(raw?.standard), max: Number(raw?.max) };
  if (!validLimits(limits)) fail('REBATE_LIMITS_INVALID', 503);
  return limits;
}

function fingerprintRebateDecision(d) {
  try {
    if (![d.draftId,d.lineNo,d.revision,d.goodId].every(positiveId) || !isValidStartDate(d.saleDate) ||
        typeof d.isCashDiscount !== 'boolean' || typeof d.calculation?.requiresManagerApproval !== 'boolean' ||
        !String(d.source?.database || '').trim() || !String(d.source?.server || '').trim() ||
        !positiveId(d.source?.setPriceId) || !positiveId(d.source?.listNo) || d.source.goodId!==d.goodId ||
        d.source.saleDate!==d.saleDate || !isValidStartDate(d.source.beginDate) || d.source.beginDate>d.saleDate ||
        (d.source.endDate != null && (!isValidStartDate(d.source.endDate) || d.source.endDate<d.saleDate))) fail('REBATE_PRICE_INPUT_INVALID', 400);
    const qty = shipmentUnits(d.quantity, 3), sale = shipmentUnits(d.sellingPrice, 2), base = shipmentUnits(d.source.basePrice, 2);
    if (qty<=0n || qty>1000000000n || sale>1000000000000n || base<=0n) fail('REBATE_PRICE_INPUT_INVALID', 400);
    const expected=calculateOrderPricingAndRebate(d.source.basePrice,d.sellingPrice,d.quantity,d.isCashDiscount,limitOptions(d.limits));
    for(const field of ['invoiceUnitPrice','rebatePerTon','totalRebateEarned','companyExtraProfitPerTon',
      'totalCompanyExtraProfit','excessApprovalAmount','totalExcessApprovalAmount','requiresManagerApproval','approvalStatus','pricingMode']) {
      if(d.calculation[field]!==expected[field]) fail('REBATE_PRICE_INPUT_INVALID',400);
    }
    return crypto.createHash('sha256').update(JSON.stringify({ version: 2,
      standardLimitPerTon: d.limits.standard, maxLimitPerTon: d.limits.max,
      database: d.source.database.toLowerCase(), server: d.source.server.toLowerCase(),
      draftId: d.draftId, lineNo: d.lineNo, revision: d.revision, goodId: d.goodId, saleDate: d.saleDate,
      priceListId: d.source.setPriceId, priceListLine: d.source.listNo, priceListBegin: d.source.beginDate,
      priceListEnd: d.source.endDate, basePrice: d.source.basePrice, sellingPrice: d.sellingPrice,
      quantity: d.quantity, isCashDiscount: d.isCashDiscount,
      invoiceUnitPrice: Number(d.calculation.invoiceUnitPrice).toFixed(2), rebatePerTon: Number(d.calculation.rebatePerTon).toFixed(2),
      requiresManagerApproval: d.calculation.requiresManagerApproval }), 'utf8').digest('hex');
  } catch (_) { fail('REBATE_PRICE_INPUT_INVALID', 400); }
}

async function resolveRebateBasePrice(query, { goodId, saleDate } = {}) {
  if (typeof query !== 'function' || !positiveId(goodId) || !isValidStartDate(saleDate)) {
    fail('REBATE_PRICE_INPUT_INVALID', 400);
  }
  const rows = (await query(`SELECT TOP 2 dt.SetPriceID,dt.ListNo,dt.ListID AS GoodId,
      CONVERT(varchar(10),hd.BeginDate,23) AS BeginDate,
      CONVERT(varchar(10),hd.EndDate,23) AS EndDate,
      CAST(dt.GoodPriceNet AS decimal(18,2)) AS BasePrice,
      DB_NAME() AS DatabaseName,CONVERT(nvarchar(128),SERVERPROPERTY('ServerName')) AS ServerName
    FROM dbo.EMSetPriceHD hd WITH(UPDLOCK,HOLDLOCK)
    JOIN dbo.EMSetPriceDT dt WITH(UPDLOCK,HOLDLOCK) ON dt.SetPriceID=hd.SetPriceID
    WHERE hd.CustID IS NULL AND dt.ListID=@goodId AND dt.GoodPriceNet>0
      AND hd.BeginDate<=CAST(@saleDate AS date) AND (hd.EndDate IS NULL OR hd.EndDate>=CAST(@saleDate AS date))
    ORDER BY hd.BeginDate DESC,dt.SetPriceID DESC,dt.ListNo ASC`, { goodId, saleDate })).recordset || [];
  if (!rows.length) fail('REBATE_BASE_PRICE_UNAVAILABLE');
  const valid = row => positiveId(Number(row.SetPriceID)) && positiveId(Number(row.ListNo)) &&
    Number(row.GoodId) === goodId && String(row.DatabaseName || '').trim() && String(row.ServerName || '').trim() &&
    isValidStartDate(row.BeginDate) && row.BeginDate <= saleDate &&
    (row.EndDate == null || isValidStartDate(row.EndDate) && row.EndDate >= saleDate);
  if (!rows.every(valid)) fail('REBATE_BASE_PRICE_INVALID');
  if (rows.length > 1 && rows[0].BeginDate === rows[1].BeginDate) fail('REBATE_BASE_PRICE_AMBIGUOUS');
  const cents = shipmentUnits(rows[0].BasePrice, 2);
  if (cents <= 0n) fail('REBATE_BASE_PRICE_INVALID');
  return { setPriceId: Number(rows[0].SetPriceID), listNo: Number(rows[0].ListNo), goodId,
    database: String(rows[0].DatabaseName).trim(), server: String(rows[0].ServerName).trim(),
    saleDate, beginDate: rows[0].BeginDate, endDate: rows[0].EndDate || null, basePrice: shipmentMoney(cents) };
}

// A deterministic decision is suitable for binding an approval and a
// saved sale revision. It is NOT itself an approval or a persisted receipt.
// Call only with server-validated sale fields inside the same transaction as
// the eventual immutable decision; never take basePrice from the client.
async function evaluateRebatePriceDecision(query, { draftId, lineNo, revision, goodId, saleDate, qtyTon, sellingPrice, isCashDiscount, limits } = {}) {
  if (![draftId, lineNo, revision].every(positiveId) || typeof isCashDiscount !== 'boolean') fail('REBATE_PRICE_INPUT_INVALID', 400);
  let qty, selling;
  try { qty = shipmentUnits(qtyTon, 3); selling = shipmentUnits(sellingPrice, 2); }
  catch (_) { fail('REBATE_PRICE_INPUT_INVALID', 400); }
  if (qty <= 0n || qty > 1000000000n || selling > 1000000000000n) fail('REBATE_PRICE_INPUT_INVALID', 400);
  const source = await resolveRebateBasePrice(query, { goodId, saleDate });
  const quantity = `${qty / 1000n}.${String(qty % 1000n).padStart(3, '0')}`;
  const salePrice = shipmentMoney(selling);
  const used = limits || await readDecisionLimits();
  const calculation = calculateOrderPricingAndRebate(source.basePrice, salePrice, quantity, isCashDiscount, limitOptions(used));
  const result = { draftId, lineNo, revision, goodId, saleDate, source, quantity, sellingPrice: salePrice, isCashDiscount,
    limits: { standard: used.standard, max: used.max }, calculation };
  return { ...result, fingerprint: fingerprintRebateDecision(result) };
}

module.exports = { resolveRebateBasePrice, evaluateRebatePriceDecision, fingerprintRebateDecision, readDecisionLimits, limitOptions, validLimits };
