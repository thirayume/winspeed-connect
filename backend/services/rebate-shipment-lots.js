'use strict';

// This is an internal transaction reader. It returns source details, including
// older documents; UI/API callers must redact opening-balance source details.
// scopeSql is constructed by sharedRebateScopeFilter, never from a request.
async function readShipmentLots(query, { epoch, custId, scopeSql='1=0', scopeInputs={} } = {}) {
  return (await query(`SELECT a.Id AS AccrualId,a.SourceSOID,a.SourceListNo,a.CouponId,a.GoodId,
      a.OccurredAtUtc,CONVERT(varchar(10),DATEADD(hour,7,a.OccurredAtUtc),23) AS EarnedDate,
      a.ListPricePerTon,a.NetPricePerTon,a.RebatePerTon,a.PlanId,
      l.SourceDocuNo,CONVERT(varchar(10),l.SourceDocuDate,23) AS SourceDocuDate,l.CouponNo,
      l.SourceRefSOID,l.SourceRefListNo,l.SourceBookingDocuNo,l.CustCode,l.CustName,l.GoodCode,l.GoodName,
      CAST(a.QuantityTon-COALESCE(u.UsedTon,0) AS decimal(18,3)) AS RemainingTon,
      CAST(a.AmountBaht-COALESCE(u.UsedAmount,0) AS decimal(18,2)) AS RemainingAmountBaht
    FROM wf.RebateShipmentAccrual a
    JOIN wf.v_RebateAccrualLot l ON l.SourceSOID=a.SourceSOID AND l.SourceListNo=a.SourceListNo AND l.CouponID=a.CouponId
      AND l.GoodID=a.GoodId AND l.CustId=CONVERT(nvarchar(20),a.CustId)
    OUTER APPLY (SELECT SUM(r.QuantityTon) AS UsedTon,SUM(r.AmountBaht) AS UsedAmount FROM wf.RebateShipmentReservation r
      WHERE r.AccrualId=a.Id AND r.Status='ACTIVE') u
    WHERE a.EnvironmentKind=@environment AND a.ResetId=@resetId AND a.Generation=@generation AND a.CustId=@cid
      AND ${scopeSql}
    ORDER BY a.OccurredAtUtc,a.Id`,
  {...scopeInputs,environment:epoch.environment,resetId:epoch.resetId,generation:epoch.generation,cid:custId})).recordset||[];
}
module.exports={readShipmentLots};
