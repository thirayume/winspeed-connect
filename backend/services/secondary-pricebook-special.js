'use strict';
// Read-only comparison; caller holds the same serializable transaction for
// verification and display. Unexplained native customer pricing fails closed.
const { sql } = require('../db');

function unavailable() {
  return Object.assign(new Error('ราคาพิเศษฐานรองไม่ตรงกับ WinSpeed หรือข้อมูลไม่เพียงพอ กรุณาให้ผู้ดูแลตรวจสอบ'),
    { code: 'SECONDARY_PRICE_RECONCILE_UNAVAILABLE', status: 503 });
}

async function verifySecondarySpecialPrices(query, bookId, customerId) {
  const customer = Number(customerId);
  if (!/^\d+$/.test(String(customerId)) || !Number.isSafeInteger(customer) || customer <= 0 || customer > 2147483647) throw unavailable();
  const book = (await query(`SELECT Id, Status, EffectiveMonth,
    CONVERT(VARCHAR(10), EffectiveFrom, 23) AS EffectiveFrom,
    CONVERT(VARCHAR(10), EffectiveTo, 23) AS EffectiveTo
    FROM wf.PriceBook WHERE Id=@id`, { id: { type: sql.Int, value: bookId } })).recordset?.[0];
  if (!book) throw unavailable();
  const from = book.EffectiveFrom || (String(book.EffectiveMonth || '') + '-01');
  const to = book.EffectiveTo || from;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw unavailable();
  const params = {
    id: { type: sql.Int, value: bookId },
    cust: { type: sql.Int, value: customer },
    custText: { type: sql.NVarChar(20), value: String(customer) },
    from: { type: sql.Date, value: from }, to: { type: sql.Date, value: to },
  };
  const saleApp = (await query(`SELECT sp.Id, sp.CustId, sp.GoodId, sp.ApprovedPrice, sp.WinSpeedSetPriceId
    FROM wf.PriceBookSpecialPrice sp
    JOIN dbo.EMCust c ON c.CustID=@cust
    WHERE sp.PriceBookId=@id AND sp.ApprovedPrice IS NOT NULL
      AND (sp.CustId=@custText OR sp.CustId=c.CustCode)`, params)).recordset || [];
  const native = (await query(`SELECT hd.SetPriceID, hd.CustID, dt.ListID, dt.GoodPriceNet,
    CONVERT(VARCHAR(10), hd.BeginDate, 23) AS BeginDate,
    CONVERT(VARCHAR(10), hd.EndDate, 23) AS EndDate
    FROM dbo.EMSetPriceHD hd JOIN dbo.EMSetPriceDT dt ON dt.SetPriceID=hd.SetPriceID
    WHERE hd.CustID=@cust AND (hd.BeginDate IS NULL OR hd.EndDate IS NULL
      OR (CAST(hd.BeginDate AS DATE) <= @to AND CAST(hd.EndDate AS DATE) >= @from))`, params)).recordset || [];
  // No guessed customer-code alias, overlapping set, duplicate or missing row.
  const expected = new Map();
  for (const row of saleApp) {
    const good = String(row.GoodId || '').trim();
    const sid = Number(row.WinSpeedSetPriceId);
    const price = Number(row.ApprovedPrice);
    if (book.Status !== 'ACTIVE' || String(row.CustId).trim() !== String(customer) || !/^\d+$/.test(good) ||
        !Number.isSafeInteger(Number(good)) || !Number.isSafeInteger(sid) || sid <= 0 || !Number.isFinite(price) || price <= 0 || expected.has(good)) throw unavailable();
    expected.set(good, { sid, price });
  }
  const matched = new Set();
  for (const row of native) {
    const good = String(row.ListID ?? '').trim();
    const item = expected.get(good);
    if (!item || matched.has(good) || Number(row.SetPriceID) !== item.sid ||
        Number(row.CustID) !== customer || row.BeginDate !== from || row.EndDate !== to ||
        !Number.isFinite(Number(row.GoodPriceNet)) || Math.abs(Number(row.GoodPriceNet) - item.price) > 0.00005) throw unavailable();
    matched.add(good);
  }
  if (matched.size !== expected.size) throw unavailable();
}

module.exports = { verifySecondarySpecialPrices };
