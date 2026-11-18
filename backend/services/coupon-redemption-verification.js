'use strict';

const { sql, wfTransaction } = require('../db');
const { readGlobalDataWindow } = require('./global-data-window-store');
const { couponScope } = require('./coupon-access-scope');
const { validateManualSettlementWindow, assertPrimaryDatabase } = require('./coupon-manual-window-fence');

async function allCouponsVisible(user, coupons, query, scopeReader = couponScope) {
  const scope = await scopeReader(user, query);
  const inputs = { ...scope.inputs };
  const keys = coupons.map((id, index) => {
    const key = `verifyCoupon${index}`;
    inputs[key] = { type: sql.Int, value: id };
    return `@${key}`;
  });
  const rows = (await query(`SELECT c.CouponID FROM dbo.WFCoupon c
    JOIN dbo.SOHD s ON s.SOID=c.DocuID
    LEFT JOIN wf.SalesOrderExt couponOwnerExt ON couponOwnerExt.SOID=CONVERT(VARCHAR(50),s.SOID)
    WHERE c.CouponID IN (${keys.join(',')}) AND ${scope.sql}`, inputs)).recordset || [];
  const seen = new Set(rows.map(row => Number(row.CouponID)));
  return coupons.every(id => seen.has(id));
}

// This only verifies that the committed native header and all coupon lines are
// present and visible at the time of the read. It is not approval, a receipt,
// proof of stock/GL, or an authoritative reservation link.
async function verifyRedemptionDocument(user, rawNumber, deps = {}) {
  const docNo = typeof rawNumber === 'string' ? rawNumber.trim() : '';
  if (!docNo || docNo.length > 25 || /[\u0000-\u001f\u007f]/.test(docNo)) {
    throw Object.assign(new Error('กรุณาระบุเลขใบขนไม่เกิน 25 ตัวอักษร'), { status: 400, code: 'REDEMPTION_NUMBER_INVALID' });
  }
  const window = await (deps.readWindow || readGlobalDataWindow)();
  const transact = deps.transaction || wfTransaction;
  const visible = deps.allCouponsVisible || allCouponsVisible;
  const fence = deps.validateWindow || validateManualSettlementWindow;
  return transact(async tx => {
    await (deps.assertPrimary || assertPrimaryDatabase)(tx);
    const query = async (text, inputs = {}) => {
      const request = tx.request();
      for (const [key, { type, value }] of Object.entries(inputs)) request.input(key, type, value);
      return request.query(text);
    };
    const headers = (await query(`SELECT TOP 2 h.RedemtionID FROM dbo.WFRedemtionHD h WITH (HOLDLOCK)
      WHERE LTRIM(RTRIM(h.DocuNo))=@docNo AND h.DocuType=116 AND h.DocuDate>=@start`, {
      docNo: { type: sql.NVarChar(25), value: docNo }, start: { type: sql.Date, value: window.businessDate },
    })).recordset || [];
    if (headers.length !== 1) return { status: 'NOT_VERIFIED' };
    const id = Number(headers[0].RedemtionID);
    if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) return { status: 'NOT_VERIFIED' };
    const lines = (await query(`SELECT TOP 101 d.CouponID${deps.includeEdit ? ',CONVERT(varchar(32),CAST(d.GoodQty AS decimal(12,4))) AS Qty' : ''}
      FROM dbo.WFRedemtionDT d WITH (HOLDLOCK)
      WHERE d.RedemtionID=@redemptionId ORDER BY d.Listno`, {
      redemptionId: { type: sql.Int, value: id },
    })).recordset || [];
    const coupons = [...new Set(lines.map(line => Number(line.CouponID)))];
    if (!lines.length || lines.length > 100 || coupons.some(n => !Number.isSafeInteger(n) || n <= 0 || n > 2147483647)) {
      return { status: 'NOT_VERIFIED' };
    }
    await fence(tx, { window, redemptionId: id, couponId: coupons[0] });
    if (!await visible(user, coupons, query)) return { status: 'NOT_VERIFIED' };
    const result = { status: 'PRESENT', lineCount: lines.length };
    if (deps.includeEdit && coupons.length === lines.length &&
        lines.every(line => typeof line.Qty === 'string' && /^\d{1,8}\.\d{4}$/.test(line.Qty) && Number(line.Qty) > 0)) {
      try {
        await (deps.assertEditBridge || require('./coupon-native-edit-approval').assertBridge)(query);
        result.editTarget = { redemptionId: id, lines: lines.map(line => ({ couponId: Number(line.CouponID), qtyBefore: line.Qty })) };
      } catch (error) {
        if (error.code !== 'COUPON_EDIT_APPROVAL_BRIDGE_UNAVAILABLE') throw error;
      }
    }
    return result;
  }, { isolationLevel: sql.ISOLATION_LEVEL.SERIALIZABLE });
}

module.exports = { verifyRedemptionDocument, allCouponsVisible };
