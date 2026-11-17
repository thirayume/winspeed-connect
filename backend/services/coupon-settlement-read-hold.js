'use strict';
const {sql}=require('../db');
function unavailable(code='COUPON_SOURCE_HOLD_UNAVAILABLE') {
  return Object.assign(Error('ไม่สามารถตรวจใบขนที่เคยใช้ตั๋วได้ กรุณาลองใหม่หรือติดต่อผู้ดูแล'),{code,status:503});
}
// A failed legacy migration probe is not proof that no settlement exists.
// Allow the legacy read only when schema visibility confirms both pieces are
// absent; a partial/hidden schema must be reviewed instead of showing balance.
async function assertLegacySettlementSchema(query) {
  let row;
  try { row=(await query(`SELECT 'COUPON_LEGACY_SETTLEMENT_SCHEMA_V1' AS SchemaState,
    OBJECT_ID('wf.CouponReservationSettlement','U') AS SettlementTable,
    COL_LENGTH('wf.CouponReservation','ConsumedQty') AS ConsumedLength,
    HAS_PERMS_BY_NAME('wf','SCHEMA','SELECT') AS SchemaSelect`))?.recordset?.[0]; }
  catch (_) { throw unavailable(); }
  if(!row || row.SchemaState!=='COUPON_LEGACY_SETTLEMENT_SCHEMA_V1' || row.SettlementTable!==null ||
    row.ConsumedLength!==null || Number(row.SchemaSelect)!==1)
    throw unavailable();
}
// Read-side counterpart to coupon-settlement-source-fence. The complete
// settlement history matters, including before the display cutoff. Only IDs
// already in the caller's scoped result may be returned. This is a display
// hold, not an atomic authorization: mutation paths must recheck under locks.
async function findSettlementSourceConflicts(query,ids,settlementSource='wf.CouponReservationSettlement') {
  if (!['wf.CouponReservationSettlement','wf.CouponEffectiveSettlement'].includes(settlementSource)) throw unavailable();
  const unique=[...new Set(ids.map(Number))];
  if(unique.some(id=>!Number.isSafeInteger(id)||id<=0||id>2147483647))
    throw unavailable('COUPON_SOURCE_HOLD_INVALID');
  const conflicts=new Set();
  for(let offset=0;offset<unique.length;offset+=200) {
    const batch=unique.slice(offset,offset+200), inputs={};
    const params=batch.map((id,i)=>{inputs[`cid${i}`]={type:sql.Int,value:id};return `@cid${i}`;});
    let rows;
    try { rows=(await query(`
      SELECT DISTINCT settled.CouponId AS ConflictCouponId /* COUPON_SOURCE_CONFLICTS_V1 */ FROM (
        SELECT s.NativeRedemptionId,s.CouponId,SUM(s.SettledQty) AS SettledQty,
          SUM(CASE WHEN s.SettledQty IS NULL OR s.SettledQty<=0 OR NULLIF(LTRIM(RTRIM(s.NativeDocuNo)),'') IS NULL THEN 1 ELSE 0 END) AS InvalidRows,
          MIN(LTRIM(RTRIM(s.NativeDocuNo))) AS MinDocNo,MAX(LTRIM(RTRIM(s.NativeDocuNo))) AS MaxDocNo
        FROM ${settlementSource} s
        WHERE s.CouponId IN (${params.join(',')}) GROUP BY s.NativeRedemptionId,s.CouponId
      ) settled
      LEFT JOIN dbo.WFRedemtionHD h ON h.RedemtionID=settled.NativeRedemptionId
      OUTER APPLY (SELECT COUNT(*) AS LineCount,MAX(d.GoodQty) AS NativeQty FROM dbo.WFRedemtionDT d
        WHERE d.RedemtionID=settled.NativeRedemptionId AND d.CouponID=settled.CouponId) nativeLine
      WHERE h.RedemtionID IS NULL OR ISNULL(h.DocuType,0)<>116
        OR ISNULL(LTRIM(RTRIM(h.DocuStatus)),'') NOT IN ('N','Y')
        OR NULLIF(LTRIM(RTRIM(h.DocuNo)),'') IS NULL OR settled.InvalidRows>0
        OR settled.MinDocNo<>settled.MaxDocNo OR settled.MinDocNo<>LTRIM(RTRIM(h.DocuNo))
        OR nativeLine.LineCount<>1 OR nativeLine.NativeQty IS NULL OR nativeLine.NativeQty<settled.SettledQty
    `,inputs))?.recordset; } catch (_) {
      throw unavailable();
    }
    if(!Array.isArray(rows)) throw unavailable();
    const allowed=new Set(batch);
    for(const row of rows) {
      const id=Number(row?.ConflictCouponId);
      if(!Number.isSafeInteger(id)||!allowed.has(id))
        throw unavailable();
      conflicts.add(id);
    }
  }
  return conflicts;
}
module.exports={findSettlementSourceConflicts,assertLegacySettlementSchema};
