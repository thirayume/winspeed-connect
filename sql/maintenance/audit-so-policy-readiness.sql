-- Read-only audit; verified on localhost, SQL Server 16 / compatibility 100.
SELECT COUNT_BIG(*) DeliveryLinesWithMultipleCoupons
FROM (SELECT DocuID,RefListno FROM dbo.WFCoupon GROUP BY DocuID,RefListno HAVING COUNT_BIG(*)>1) x;
SELECT COUNT_BIG(*) LotRows,COUNT(DISTINCT SourceSOID) Documents,
 SUM(CASE WHEN PlanId IS NULL THEN 1 ELSE 0 END) NoPlanRows
FROM wf.v_RebateAccrualLot;
SELECT h.DocuStatus,COUNT_BIG(*) RowsInAccrual
FROM wf.v_RebateAccrualLot l JOIN dbo.SOHD h ON h.SOID=l.SourceSOID
GROUP BY h.DocuStatus;
SELECT COUNT_BIG(*) Requests,
 SUM(CASE WHEN ReasonCode IS NULL OR LTRIM(RTRIM(ReasonCode))='' THEN 1 ELSE 0 END) NoReason,
 SUM(CASE WHEN ReasonCode='OTHER' AND (ReasonDetail IS NULL OR LEN(LTRIM(RTRIM(ReasonDetail)))<5) THEN 1 ELSE 0 END) OtherIncomplete
FROM wf.EditRequest;
