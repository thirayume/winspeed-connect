'use strict';

const crypto = require('crypto');

// Must execute inside the same SQL transaction that writes/reviews evidence.
// Lock and fingerprint the native 116 line and its linked coupon/104, plus all
// matching scale and audit rows. Do not return the source snapshots themselves:
// they may contain operational or personal data. A match is NOT proof of
// physical shipment, correct unit, or an immutable event time.
const SNAPSHOT_SQL = `
SELECT h.RedemtionID, d.Listno AS RedemptionListNo, d.CouponID,
       c.DocuID AS SourceSOID, c.RefListno AS SourceListNo, d.GoodID,
       d.GoodUnitID, c.GoodID AS CouponGoodID, c.GoodUnitID AS CouponGoodUnitID,
       sd.GoodID AS SaleGoodID, sd.GoodUnitID2 AS SaleGoodUnitID, sh.SOID AS SaleHeaderId, sd.SOID AS SaleLineId,
       RTRIM(h.DocuStatus) AS RedemptionStatus, RTRIM(sh.DocuStatus) AS SaleStatus,
       CONVERT(varchar(50),d.GoodQty) AS Quantity,
       (SELECT hh.RedemtionID,hh.DocuNo,hh.DocuDate,hh.DocuType,hh.IssueName,hh.CarLicense,hh.SaveEmpID
        FROM dbo.WFRedemtionHD hh WITH(UPDLOCK,HOLDLOCK)
        WHERE hh.RedemtionID=h.RedemtionID FOR XML RAW,BINARY BASE64,ELEMENTS XSINIL) AS HeaderSnapshot,
       (SELECT dd.RedemtionID,dd.Listno,dd.CouponID,dd.CouponNo,dd.GoodID,dd.GoodUnitID,dd.GoodQty
        FROM dbo.WFRedemtionDT dd WITH(UPDLOCK,HOLDLOCK)
        WHERE dd.RedemtionID=d.RedemtionID AND dd.Listno=d.Listno FOR XML RAW,BINARY BASE64,ELEMENTS XSINIL) AS LineSnapshot,
       COALESCE((SELECT cc.CouponID,cc.CouponNo,cc.DocuID,cc.RefListno,cc.GoodID,cc.GoodUnitID,cc.GoodQty,cc.GoodPrice
        FROM dbo.WFCoupon cc WITH(UPDLOCK,HOLDLOCK)
        WHERE cc.CouponID=c.CouponID FOR XML RAW,BINARY BASE64,ELEMENTS XSINIL),N'') AS CouponSnapshot,
       COALESCE((SELECT sale.SOID,sale.DocuNo,sale.DocuDate,sale.DocuType,sale.CustID
        FROM dbo.SOHD sale WITH(UPDLOCK,HOLDLOCK)
        WHERE sale.SOID=sh.SOID FOR XML RAW,BINARY BASE64,ELEMENTS XSINIL),N'') AS SaleHeaderSnapshot,
       COALESCE((SELECT sdt.SOID,sdt.ListNo,sdt.DocuType,sdt.GoodID,sdt.GoodUnitID2,sdt.GoodQty2,sdt.GoodPrice2,sdt.GoodAmnt
        FROM dbo.SODT sdt WITH(UPDLOCK,HOLDLOCK)
        WHERE sdt.SOID=sd.SOID AND sdt.ListNo=sd.ListNo FOR XML RAW,BINARY BASE64,ELEMENTS XSINIL),N'') AS SaleLineSnapshot,
       COALESCE((SELECT u.* FROM dbo.EMGoodUnit u WITH(UPDLOCK,HOLDLOCK)
        WHERE u.GoodUnitID=d.GoodUnitID FOR XML RAW,BINARY BASE64,ELEMENTS XSINIL),N'') AS UnitSnapshot,
       COALESCE((SELECT w.Id,w.SPID,w.MoveBill,w.Status,w.DateOut,w.WeightNet,w.CarNo,w.WGType
        FROM dbo.WGHD w WITH(UPDLOCK,HOLDLOCK)
        WHERE RTRIM(w.MoveBill)=RTRIM(h.DocuNo) ORDER BY w.Id FOR XML RAW,BINARY BASE64,ELEMENTS XSINIL),N'') AS ScaleSnapshot,
       COALESCE((SELECT a.audit_id,a.audit_system,a.audit_screen,a.audit_datetime,a.audit_username,a.audit_action,a.audit_docuno,a.audit_columnid,a.brchid
        FROM dbo.SMAudit a WITH(UPDLOCK,HOLDLOCK)
        WHERE a.audit_system=3 AND a.audit_screen=2098003052 AND a.audit_columnid=h.RedemtionID
          AND a.audit_docuno=h.DocuNo AND a.brchid=1 AND UPPER(RTRIM(a.audit_action)) IN ('I','INSERT')
        ORDER BY a.audit_id FOR XML RAW,BINARY BASE64,ELEMENTS XSINIL),N'') AS AuditSnapshot
FROM dbo.WFRedemtionHD h WITH(UPDLOCK,HOLDLOCK)
JOIN dbo.WFRedemtionDT d WITH(UPDLOCK,HOLDLOCK) ON d.RedemtionID=h.RedemtionID
LEFT JOIN dbo.WFCoupon c WITH(UPDLOCK,HOLDLOCK) ON c.CouponID=d.CouponID
LEFT JOIN dbo.SOHD sh WITH(UPDLOCK,HOLDLOCK) ON sh.SOID=c.DocuID AND sh.DocuType=104
LEFT JOIN dbo.SODT sd WITH(UPDLOCK,HOLDLOCK) ON sd.SOID=c.DocuID AND sd.ListNo=c.RefListno AND sd.DocuType=104
WHERE h.DocuType=116 AND h.RedemtionID=@redemptionId AND d.Listno=@listNo`;

function fail(code) { throw Object.assign(new Error(code), { code, status: 409 }); }
function validId(n) { return Number.isSafeInteger(n) && n > 0 && n <= 2147483647; }

async function lockShipmentSource(query, { redemptionId, listNo } = {}) {
  if (typeof query !== 'function' || !validId(redemptionId) || !validId(listNo)) fail('REBATE_SHIPMENT_SOURCE_INVALID');
  const rows = (await query(SNAPSHOT_SQL, { redemptionId, listNo })).recordset || [];
  if (rows.length !== 1) fail('REBATE_SHIPMENT_SOURCE_UNAVAILABLE');
  const r = rows[0];
  const names = ['HeaderSnapshot', 'LineSnapshot', 'CouponSnapshot', 'SaleHeaderSnapshot', 'SaleLineSnapshot', 'UnitSnapshot', 'ScaleSnapshot', 'AuditSnapshot'];
  if (!names.every(name => typeof r[name] === 'string') || !r.HeaderSnapshot || !r.LineSnapshot) fail('REBATE_SHIPMENT_SNAPSHOT_UNAVAILABLE');
  if (Number(r.RedemtionID) !== redemptionId || Number(r.RedemptionListNo) !== listNo) fail('REBATE_SHIPMENT_SOURCE_CONFLICT');
  const issues = [];
  const optionalId = value => validId(Number(value)) ? Number(value) : null;
  const couponId = optionalId(r.CouponID), sourceSOID = optionalId(r.SourceSOID), sourceListNo = optionalId(r.SourceListNo);
  const goodId = optionalId(r.GoodID), goodUnitId = optionalId(r.GoodUnitID);
  if (!couponId || !r.CouponSnapshot) issues.push('COUPON_UNAVAILABLE');
  if (!sourceSOID || !optionalId(r.SaleHeaderId) || !r.SaleHeaderSnapshot) issues.push('SALE_HEADER_UNAVAILABLE');
  if (!sourceListNo || !optionalId(r.SaleLineId) || !r.SaleLineSnapshot) issues.push('SALE_LINE_UNAVAILABLE');
  // Native 116 N (before invoice) and Y (posted) and 104 Y have been used by
  // the verified posting contract. Other statuses stay held until their
  // meaning and transitions have been independently established.
  if (!['N', 'Y'].includes(String(r.RedemptionStatus || '').trim().toUpperCase())) issues.push('REDEMPTION_STATUS_UNCONFIRMED');
  if (String(r.SaleStatus || '').trim().toUpperCase() !== 'Y') issues.push('SALE_STATUS_UNCONFIRMED');
  if (!goodId || !optionalId(r.CouponGoodID) || !optionalId(r.SaleGoodID) ||
      goodId !== Number(r.CouponGoodID) || goodId !== Number(r.SaleGoodID)) issues.push('GOOD_MISMATCH');
  if (!goodUnitId || !r.UnitSnapshot || !optionalId(r.CouponGoodUnitID) || !optionalId(r.SaleGoodUnitID) ||
      goodUnitId !== Number(r.CouponGoodUnitID) || goodUnitId !== Number(r.SaleGoodUnitID)) issues.push('UNIT_UNCONFIRMED');
  const quantity = String(r.Quantity ?? '');
  if (!/^\d+(?:\.\d+)?$/.test(quantity) || Number(quantity) <= 0) issues.push('QUANTITY_INVALID');
  // Post Invoice changes 116 status, PostInv and remaining quantities. Those
  // lifecycle fields are checked separately, not fingerprinted as proof data.
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(['rebate-shipment-v2', ...names.map(n => r[n])]), 'utf8').digest('hex');
  return { redemptionId, redemptionListNo: listNo, couponId, sourceSOID, sourceListNo, goodId, goodUnitId,
    quantity, issues, fingerprint, scaleRowsPresent: r.ScaleSnapshot !== '', auditRowsPresent: r.AuditSnapshot !== '' };
}
module.exports = { SNAPSHOT_SQL, lockShipmentSource };
