'use strict';

// This is an internal transaction reader. It returns source details, including
// older documents; UI/API callers must redact opening-balance source details.
// scopeSql is constructed by sharedRebateScopeFilter, never from a request.
async function readShipmentLots(query, { epoch, custId, scopeSql='1=0', scopeInputs={} } = {}) {
  return (await query(`SELECT a.Id AS AccrualId,a.SourceSOID,a.SourceListNo,a.CouponId,a.GoodId,
      a.EvidenceId,e.RedemptionId,e.RedemptionListNo,a.QuantityTon AS OriginalTon,a.AmountBaht AS OriginalAmount,
      a.OccurredAtUtc,CONVERT(varchar(10),DATEADD(hour,7,a.OccurredAtUtc),23) AS EarnedDate,
      a.ListPricePerTon,a.NetPricePerTon,a.RebatePerTon,a.PlanId,a.BookingSOID,a.BookingLineNo,
      l.SourceDocuNo,CONVERT(varchar(10),l.SourceDocuDate,23) AS SourceDocuDate,l.CouponNo,
      l.SourceRefSOID,l.SourceRefListNo,l.SourceBookingDocuNo,l.CustCode,l.CustName,l.GoodCode,l.GoodName,
      CAST(a.QuantityTon-COALESCE(u.UsedTon,0) AS decimal(18,3)) AS RemainingTon,
      CAST(a.AmountBaht-COALESCE(u.UsedAmount,0) AS decimal(18,2)) AS RemainingAmountBaht
    FROM wf.RebateShipmentAccrual a
    JOIN wf.RebateShipmentEvidence e ON e.Id=a.EvidenceId AND e.EnvironmentKind=a.EnvironmentKind AND e.ResetId=a.ResetId
    JOIN (SELECT h.SOID AS SourceSOID,d.ListNo AS SourceListNo,h.DocuNo AS SourceDocuNo,h.DocuDate AS SourceDocuDate,
        d.RefSOID AS SourceRefSOID,d.RefListNo AS SourceRefListNo,b.DocuNo AS SourceBookingDocuNo,
        CONVERT(nvarchar(20),h.CustID) AS CustId,cu.CustCode,COALESCE(cu.CustName,h.CustName) AS CustName,
        h.EmpID AS SalesEmpId,c.CouponID,c.CouponNo,d.GoodID,g.GoodCode,COALESCE(d.GoodName,g.GoodName1) AS GoodName
      FROM dbo.SOHD h JOIN dbo.SODT d ON d.SOID=h.SOID AND d.DocuType=104
      JOIN dbo.WFCoupon c ON c.DocuID=h.SOID AND c.RefListno=d.ListNo
      JOIN dbo.SOHD b ON b.SOID=d.RefSOID AND b.DocuType=103
      JOIN dbo.EMGood g ON g.GoodID=d.GoodID LEFT JOIN dbo.EMCust cu ON cu.CustID=h.CustID
      WHERE h.DocuType=104) l ON l.SourceSOID=a.SourceSOID AND l.SourceListNo=a.SourceListNo AND l.CouponID=a.CouponId
      AND l.GoodID=a.GoodId AND l.CustId=CONVERT(nvarchar(20),a.CustId)
      AND l.SourceRefSOID=a.BookingSOID AND l.SourceRefListNo=a.BookingLineNo
    OUTER APPLY (SELECT SUM(r.QuantityTon) AS UsedTon,SUM(r.AmountBaht) AS UsedAmount FROM wf.RebateShipmentReservation r
      WHERE r.AccrualId=a.Id AND r.Status='ACTIVE') u
    WHERE a.EnvironmentKind=@environment AND a.ResetId=@resetId AND a.Generation=@generation AND a.CustId=@cid
      AND ${scopeSql}
    ORDER BY a.OccurredAtUtc,a.Id`,
  {...scopeInputs,environment:epoch.environment,resetId:epoch.resetId,generation:epoch.generation,cid:custId})).recordset||[];
}
module.exports={readShipmentLots};
