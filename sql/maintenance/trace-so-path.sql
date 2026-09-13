-- Local read-only SO trace. Supply @Lookup varchar(25) = booking DocuNo or approval AppvDocuNo.
-- Includes all matches; never infer 103/104 relationships from equal document numbers.
WITH B AS (SELECT * FROM dbo.SOHD WHERE DocuType=103 AND (RTRIM(DocuNo)=@Lookup OR RTRIM(AppvDocuNo)=@Lookup))
SELECT 'BOOKING_APPROVAL' Stage,DocuNo,AppvDocuNo,AppvFlag,AppvDate,DocuStatus,CheckAll FROM B;
WITH B AS (SELECT * FROM dbo.SOHD WHERE DocuType=103 AND (RTRIM(DocuNo)=@Lookup OR RTRIM(AppvDocuNo)=@Lookup))
SELECT 'AUDIT' Stage,b.DocuNo,b.AppvDocuNo,a.audit_screen,a.audit_action,a.audit_datetime
FROM B b JOIN dbo.SMAudit a ON RTRIM(a.audit_docuno)=RTRIM(b.DocuNo)
WHERE a.audit_screen IN (2098003048,2098003080) ORDER BY a.audit_datetime;
WITH B AS (SELECT * FROM dbo.SOHD WHERE DocuType=103 AND (RTRIM(DocuNo)=@Lookup OR RTRIM(AppvDocuNo)=@Lookup)), D AS (SELECT DISTINCT h.SOID,h.DocuNo,h.CustID,l.ListNo,l.RefSOID,l.RefListNo,l.GoodID,l.GoodQty2 FROM dbo.SODT l JOIN dbo.SOHD h ON h.SOID=l.SOID AND h.DocuType=104 JOIN B ON B.SOID=l.RefSOID)
SELECT 'DELIVERY_LINE' Stage,b.DocuNo BookingDocuNo,b.AppvDocuNo,d.DocuNo DeliveryDocuNo,d.ListNo,d.RefListNo,d.GoodID,d.GoodQty2,
CASE WHEN d.CustID=b.CustID THEN 'MATCH' ELSE 'REVIEW' END CustomerMatch
FROM D d JOIN B b ON b.SOID=d.RefSOID ORDER BY d.DocuNo,d.ListNo;
WITH B AS (SELECT * FROM dbo.SOHD WHERE DocuType=103 AND (RTRIM(DocuNo)=@Lookup OR RTRIM(AppvDocuNo)=@Lookup))
SELECT 'WEIGHING' Stage,b.DocuNo BookingDocuNo,h.DocuNo WeighDocuNo,h.Status,h.WeightIn,h.WeightOut,h.WeightNet
FROM B b JOIN dbo.WGHD h ON h.SPID=b.SOID;
WITH B AS (SELECT * FROM dbo.SOHD WHERE DocuType=103 AND (RTRIM(DocuNo)=@Lookup OR RTRIM(AppvDocuNo)=@Lookup)), D AS (SELECT DISTINCT h.SOID,h.DocuNo,h.CustID,l.ListNo,l.RefSOID,l.RefListNo,l.GoodID,l.GoodQty2 FROM dbo.SODT l JOIN dbo.SOHD h ON h.SOID=l.SOID AND h.DocuType=104 JOIN B ON B.SOID=l.RefSOID)
SELECT 'COUPON' Stage,d.DocuNo DeliveryDocuNo,d.ListNo,c.CouponID,c.CouponNo,c.GoodID,c.GoodQty,c.RemaQty,u.GoodUnitName
FROM D d JOIN dbo.WFCoupon c ON c.DocuID=d.SOID AND c.RefListno=d.ListNo
LEFT JOIN dbo.EMGoodUnit u ON u.GoodUnitID=c.GoodUnitID;
WITH B AS (SELECT * FROM dbo.SOHD WHERE DocuType=103 AND (RTRIM(DocuNo)=@Lookup OR RTRIM(AppvDocuNo)=@Lookup)), D AS (SELECT DISTINCT h.SOID,h.DocuNo,h.CustID,l.ListNo,l.RefSOID,l.RefListNo,l.GoodID,l.GoodQty2 FROM dbo.SODT l JOIN dbo.SOHD h ON h.SOID=l.SOID AND h.DocuType=104 JOIN B ON B.SOID=l.RefSOID)
SELECT 'DRAW_DOWNSTREAM' Stage,d.DocuNo DeliveryDocuNo,c.CouponID,c.CouponNo,rh.DocuNo DrawDocuNo,rh.DocuType DrawType,rh.DocuStatus DrawStatus,
rd.GoodQty DrawQty,rd.RemaQty DrawRemainingQty,ih.DocuNo DownstreamDocuNo,ih.DocuType DownstreamType
FROM D d JOIN dbo.WFCoupon c ON c.DocuID=d.SOID AND c.RefListno=d.ListNo
JOIN dbo.WFRedemtionDT rd ON rd.CouponID=c.CouponID
JOIN dbo.WFRedemtionHD rh ON rh.RedemtionID=rd.RedemtionID
LEFT JOIN dbo.SOInvHD ih ON ih.SOInvID=rd.SOInvID;
