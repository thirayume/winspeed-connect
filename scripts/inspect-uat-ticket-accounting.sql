/* Read-only evidence for accounting review; NOT a reconciliation verdict.
   Set the 104 document number below, then run on R740-SRV\SQL2008 UAT only.
   Results contain operational financial information: keep them private.
   Run when the selected document is not being edited. Rows may change during
   this report because it deliberately takes no long-running business locks.
   A 202 matched by document number is a candidate, not proof of settlement;
   shared invoices, later adjustments, tax and GL require accountant review. */
SET NOCOUNT ON;
DECLARE @DeliveryNo varchar(30);
SET @DeliveryNo = ''; -- Enter the UAT 104 document number here.

IF DB_NAME() <> 'dbwins_worldfert9_uat' OR UPPER(CONVERT(varchar(128),@@SERVERNAME)) <> 'R740-SRV\SQL2008'
BEGIN RAISERROR('UAT server or database does not match.',16,1); RETURN; END;
IF LEN(LTRIM(RTRIM(@DeliveryNo)))=0
BEGIN RAISERROR('Enter the UAT 104 document number.',16,1); RETURN; END;
IF (SELECT COUNT(*) FROM dbo.SOHD WHERE DocuType=104 AND DocuNo=@DeliveryNo)<>1
BEGIN RAISERROR('Expected exactly one 104 for this document number.',16,1); RETURN; END;

DECLARE @DeliveryId int,@CustId int;
SELECT @DeliveryId=SOID,@CustId=CustID FROM dbo.SOHD WHERE DocuType=104 AND DocuNo=@DeliveryNo;
DECLARE @Invoices TABLE (SOInvID int PRIMARY KEY, LinkKind varchar(40));
INSERT @Invoices(SOInvID,LinkKind)
 SELECT DISTINCT i.SOInvID,'104 detail RefID'
 FROM dbo.SOInvHD i JOIN dbo.SOInvDT d ON d.SOInvID=i.SOInvID AND d.DocuType=i.DocuType
 WHERE i.DocuType IN (202,107) AND d.RefID=@DeliveryId AND i.CustID=@CustId;
INSERT @Invoices(SOInvID,LinkKind)
 SELECT i.SOInvID,'202 matching number and customer'
 FROM dbo.SOInvHD i WHERE i.DocuType=202 AND i.DocuNo=@DeliveryNo AND i.CustID=@CustId
 AND NOT EXISTS(SELECT 1 FROM @Invoices x WHERE x.SOInvID=i.SOInvID);

-- 103 source and 104 header and line amounts, including line references.
SELECT h.DocuType,h.DocuNo,h.DocuDate,h.DocuStatus,h.SumGoodAmnt,h.BillDiscAmnt,
 h.BillAftrDiscAmnt,h.VATType,h.VATRate,h.VATAmnt,h.NetAmnt,d.ListNo,d.GoodID,
 d.GoodQty2,d.GoodPrice2,d.GoodAmnt,d.RefSOID,d.RefListNo
FROM dbo.SOHD h JOIN dbo.SODT d ON d.SOID=h.SOID AND d.DocuType=h.DocuType
WHERE h.SOID=@DeliveryId OR (h.DocuType=103 AND EXISTS
 (SELECT 1 FROM dbo.SODT x WHERE x.SOID=@DeliveryId AND x.DocuType=104 AND x.RefSOID=h.SOID))
ORDER BY h.DocuType,d.ListNo;

-- Native C/D coupons and 116. Missing rows are evidence gaps, not a zero balance.
SELECT c.CouponID,c.CouponNo,c.GoodID,c.GoodQty,c.RemaQty,
 r.DocuNo AS RedemptionNo,r.DocuDate AS RedemptionDate,r.DocuStatus,
 rd.ListNo,rd.GoodQty AS RedeemedQty,rd.RemaQty AS RedemptionRemaining,rd.PostInv,rd.SOInvID
FROM dbo.WFCoupon c LEFT JOIN dbo.WFRedemtionDT rd ON rd.CouponID=c.CouponID
 LEFT JOIN dbo.WFRedemtionHD r ON r.RedemtionID=rd.RedemtionID AND r.DocuType=116
WHERE c.DocuType=104 AND c.DocuID=@DeliveryId ORDER BY c.CouponID,r.DocuDate,rd.ListNo;

-- 202/107 headers and lines. A 107 may contain other 104s; report them too.
SELECT x.LinkKind,i.DocuType,i.DocuNo,i.DocuDate,i.DocuStatus,i.SOInvID,i.PostID,
 i.SumGoodAmnt,i.BillDiscAmnt,i.VATType,i.VATRate,i.VATAmnt,i.NetAmnt,i.RemaAmnt,
 i.PostGL,i.CouponFlag,i.StockEffc,d.ListNo,d.RefID,d.RefListNo,d.GoodQty2,d.GoodPrice2,d.GoodAmnt
FROM @Invoices x JOIN dbo.SOInvHD i ON i.SOInvID=x.SOInvID
 LEFT JOIN dbo.SOInvDT d ON d.SOInvID=i.SOInvID AND d.DocuType=i.DocuType
ORDER BY i.DocuType,i.SOInvID,d.ListNo;

SELECT i.DocuType,i.DocuNo,v.FromFlag,v.FromID,v.BaseAmnt,v.VatType,v.VatRate,v.VatAmnt
FROM @Invoices x JOIN dbo.SOInvHD i ON i.SOInvID=x.SOInvID
 JOIN dbo.VTVAT v ON v.FromID=i.PostID AND v.FromFlag=i.DocuType ORDER BY i.DocuType,i.DocuNo;

SELECT i.DocuType AS SourceType,i.DocuNo AS SourceNo,g.GLID,g.DocuNo AS GLNo,g.FromFlag,
 g.FromID,g.DocuStatus,d.ListNo,a.AccCode,a.AccName,d.DrAmnt,d.CrAmnt
FROM @Invoices x JOIN dbo.SOInvHD i ON i.SOInvID=x.SOInvID
 JOIN dbo.GLHD g ON g.FromID=i.PostID AND g.FromFlag=i.DocuType
 JOIN dbo.GLDT d ON d.GLID=g.GLID LEFT JOIN dbo.EMAcc a ON a.AccID=d.AccID
ORDER BY i.DocuType,i.DocuNo,g.GLID,d.ListNo;
