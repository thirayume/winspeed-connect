'use strict';

const { sql } = require('../db');

// Settlement is evidence about a particular native 116 and coupon, not a
// permanent substitute for that document. Review instead of reusing balance
// when the original header or line is missing, renamed, ambiguous or smaller.
// This reads all settlement history; the display cutoff must not erase a hold.
// N and Y are used by the observed 116/invoice workflow. Other or missing
// statuses are held for review; P has not been verified as safe or cancelled.
async function assertSettledSourcesUnchanged(tx, couponId) {
  if (!Number.isSafeInteger(couponId) || couponId <= 0 || couponId > 2147483647) {
    throw Object.assign(new Error('ไม่สามารถยืนยันรหัสตั๋วได้'), { code: 'COUPON_ID_INVALID', status: 400 });
  }
  // Only reviewed reversals are used in the effective settlement source.
  const settlementSource=await require('./coupon-recovery-readiness').assertRecoveryReadiness(text=>tx.request().query(text));
  const rows = (await tx.request().input('cid', sql.Int, couponId).query(`
    SELECT TOP 1 1 AS SourceConflict FROM (
      SELECT s.NativeRedemptionId,s.CouponId,
        SUM(s.SettledQty) AS SettledQty,
        SUM(CASE WHEN s.SettledQty IS NULL OR s.SettledQty<=0 OR NULLIF(LTRIM(RTRIM(s.NativeDocuNo)),'') IS NULL THEN 1 ELSE 0 END) AS InvalidRows,
        MIN(LTRIM(RTRIM(s.NativeDocuNo))) AS MinDocNo,
        MAX(LTRIM(RTRIM(s.NativeDocuNo))) AS MaxDocNo
      FROM ${settlementSource} s WITH (HOLDLOCK)
      WHERE s.CouponId=@cid GROUP BY s.NativeRedemptionId,s.CouponId
    ) settled
    LEFT JOIN dbo.WFRedemtionHD h WITH (HOLDLOCK) ON h.RedemtionID=settled.NativeRedemptionId
    OUTER APPLY (SELECT COUNT(*) AS LineCount,MAX(d.GoodQty) AS NativeQty
      FROM dbo.WFRedemtionDT d WITH (HOLDLOCK)
      WHERE d.RedemtionID=settled.NativeRedemptionId AND d.CouponID=settled.CouponId) nativeLine
    WHERE h.RedemtionID IS NULL OR ISNULL(h.DocuType,0)<>116
      OR ISNULL(LTRIM(RTRIM(h.DocuStatus)),'') NOT IN ('N','Y')
      OR NULLIF(LTRIM(RTRIM(h.DocuNo)),'') IS NULL OR settled.InvalidRows>0
      OR settled.MinDocNo<>settled.MaxDocNo OR settled.MinDocNo<>LTRIM(RTRIM(h.DocuNo))
      OR nativeLine.LineCount<>1 OR nativeLine.NativeQty IS NULL OR nativeLine.NativeQty<settled.SettledQty
  `)).recordset || [];
  if (rows.length) {
    throw Object.assign(new Error('ใบขนที่เคยจับคู่กับตั๋วเปลี่ยนหรือไม่ครบ กรุณาตรวจหลักฐานก่อนใช้ตั๋ว'),
      { code: 'COUPON_SETTLEMENT_SOURCE_CHANGED', status: 409 });
  }
}

module.exports = { assertSettledSourcesUnchanged };
