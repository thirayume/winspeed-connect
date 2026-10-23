'use strict';

const { sql, wfQuery } = require('../db');
const { inScope } = require('./visible-scope');

// Authorize every source, including the lines of a combined invoice/redemption.
// A visible root alone does not authorize another salesperson's linked document.
async function nativeChainInScope(scope, result, queryFn = wfQuery) {
  if (scope?.all === true) return true;
  if (!scope || !result?.chain || result.truncated || result.isAmbiguous) return false;
  const chain = result.chain;
  const sources = [
    ['SO', [...(chain.bookings || []), ...(chain.deliveries || [])].map(r => r.soId)],
    ['COUPON', (chain.coupons || []).map(r => r.couponId)],
    ['REDEMPTION', (chain.redemptions || []).map(r => r.redemtionId)],
    ['INVOICE', (chain.invoices || []).map(r => r.soInvId)],
  ];
  const inputs = {};
  const expected = new Set();
  const lists = {};
  for (const [kind, values] of sources) {
    const ids = [...new Set(values.map(Number))];
    if (ids.some(id => !Number.isInteger(id) || id <= 0 || id > 2147483647)) return false;
    lists[kind] = ids.map((id, i) => {
      const name = `${kind}${i}`;
      inputs[name] = { type: sql.Int, value: id };
      expected.add(`${kind}:${id}`);
      return `@${name}`;
    }).join(',');
  }
  if (!expected.size || expected.size > 50) return false;
  const parts = [];
  if (lists.SO) parts.push(`SELECT 'SO' AS SourceType, h.SOID AS SourceID, h.SOID AS OwnerSOID
    FROM dbo.SOHD h WHERE h.SOID IN (${lists.SO}) AND h.DocuType IN (103,104)`);
  if (lists.COUPON) parts.push(`SELECT 'COUPON', c.CouponID, c.DocuID
    FROM dbo.WFCoupon c WHERE c.CouponID IN (${lists.COUPON})`);
  if (lists.REDEMPTION) parts.push(`SELECT 'REDEMPTION', r.RedemtionID, c.DocuID
    FROM dbo.WFRedemtionHD r
    LEFT JOIN dbo.WFRedemtionDT d ON d.RedemtionID = r.RedemtionID
    LEFT JOIN dbo.WFCoupon c ON c.CouponID = d.CouponID
    WHERE r.RedemtionID IN (${lists.REDEMPTION})`);
  if (lists.INVOICE) parts.push(`SELECT 'INVOICE', i.SOInvID, COALESCE(s.SOID, c.DocuID)
    FROM dbo.SOInvHD i
    LEFT JOIN dbo.SOInvDT d ON d.SOInvID = i.SOInvID
    LEFT JOIN dbo.SOHD s ON s.SOID = d.RefID AND s.DocuType IN (103,104)
    LEFT JOIN dbo.WFRedemtionDT r ON r.SOInvID = d.SOInvID AND r.SOListNo = d.ListNo
    LEFT JOIN dbo.WFCoupon c ON c.CouponID = r.CouponID
    WHERE i.SOInvID IN (${lists.INVOICE})`);
  let rows;
  try {
    rows = (await queryFn(`;WITH NativeScopeSources AS (
      ${parts.join('\nUNION ALL\n')}
    )
    SELECT TOP (1001) p.SourceType, p.SourceID, h.SOID AS OwnerSOID, h.EmpID, x.SalesUserId
    FROM NativeScopeSources p
    LEFT JOIN dbo.SOHD h ON h.SOID = p.OwnerSOID AND h.DocuType IN (103,104)
    LEFT JOIN wf.SalesOrderExt x ON x.SOID = CONVERT(VARCHAR(50), h.SOID)`, inputs)).recordset || [];
  } catch {
    throw Object.assign(new Error('Document scope could not be verified'), { status: 503 });
  }
  if (rows.length > 1000) return false;
  const seen = new Set();
  for (const row of rows) {
    const key = `${row.SourceType}:${Number(row.SourceID)}`;
    if (!expected.has(key) || !row.OwnerSOID || !inScope(scope, { userId: row.SalesUserId, empId: row.EmpID })) return false;
    seen.add(key);
  }
  return seen.size === expected.size;
}

module.exports = { nativeChainInScope };
