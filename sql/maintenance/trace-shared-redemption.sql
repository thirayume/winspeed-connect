-- SQL Server compatibility level 100. Read-only; change DocuNo below.
DECLARE @DrawDocuNo varchar(25) = '69060358';
-- All matches retained. DocuNo is for display; IDs remain linkage keys.
SELECT rh.RedemtionID,rh.DocuNo,rh.DocuDate,rh.DocuStatus,
       CASE WHEN NULLIF(LTRIM(RTRIM(rh.CarLicense)),'') IS NULL THEN 0 ELSE 1 END HasVehicle,
       CASE WHEN NULLIF(LTRIM(RTRIM(rh.IssueName)),'') IS NULL THEN 0 ELSE 1 END HasIssueName,
       CASE WHEN NULLIF(LTRIM(RTRIM(rh.CardNo)),'') IS NULL THEN 0 ELSE 1 END HasCardNo
FROM dbo.WFRedemtionHD rh WHERE rh.DocuType=116 AND RTRIM(rh.DocuNo)=@DrawDocuNo;
SELECT rh.DocuNo DrawDocuNo,rd.Listno,rd.CouponID,rd.CouponNo,
       rd.GoodID,rd.GoodQty,rd.RemaQty DrawRemainingQty,u.GoodUnitName,
       RTRIM(oc.CustCode) CouponOwnerCode,d.DocuNo DeliveryDocuNo,
       b.DocuNo BookingDocuNo,b.AppvDocuNo,
       CASE WHEN LTRIM(RTRIM(b.TransRegistration))=N'ตั๋วคุม' THEN 1 ELSE 0 END BookingMarkedControlTicket,
       ih.DocuNo DownstreamDocuNo,RTRIM(ic.CustCode) DownstreamCustomerCode,
       CASE WHEN c.CouponID IS NULL THEN 'UNRESOLVED_COUPON'
            WHEN d.SOID IS NULL OR ih.SOInvID IS NULL OR d.CustID IS NULL OR ih.CustID IS NULL THEN 'UNRESOLVED_CUSTOMER'
            WHEN d.CustID=ih.CustID THEN 'SAME_DOCUMENT_CUSTOMER'
            ELSE 'DIFFERENT_DOCUMENT_CUSTOMER' END EvidenceStatus
FROM dbo.WFRedemtionHD rh JOIN dbo.WFRedemtionDT rd ON rd.RedemtionID=rh.RedemtionID
LEFT JOIN dbo.WFCoupon c ON c.CouponID=rd.CouponID
LEFT JOIN dbo.SOHD d ON d.SOID=c.DocuID AND d.DocuType=104
LEFT JOIN dbo.EMCust oc ON oc.CustID=d.CustID
LEFT JOIN dbo.SODT dl ON dl.SOID=d.SOID AND dl.ListNo=c.RefListno
LEFT JOIN dbo.SOHD b ON b.SOID=dl.RefSOID AND b.DocuType=103
LEFT JOIN dbo.SOInvHD ih ON ih.SOInvID=rd.SOInvID
LEFT JOIN dbo.EMCust ic ON ic.CustID=ih.CustID
LEFT JOIN dbo.EMGoodUnit u ON u.GoodUnitID=rd.GoodUnitID
WHERE rh.DocuType=116 AND RTRIM(rh.DocuNo)=@DrawDocuNo
ORDER BY rh.RedemtionID,rd.Listno;
-- This screen/id mapping is observed for the selected examples, not a global audit convention.
SELECT rh.DocuNo,rh.RedemtionID,a.audit_id,a.audit_screen,a.audit_action,
       a.audit_datetime,a.audit_docudate,a.audit_columnid,a.audit_refid,a.audit_query
FROM dbo.WFRedemtionHD rh JOIN dbo.SMAudit a
 ON RTRIM(a.audit_docuno)=RTRIM(rh.DocuNo) AND a.audit_columnid=rh.RedemtionID
 AND a.audit_screen=2098003052
WHERE rh.DocuType=116 AND RTRIM(rh.DocuNo)=@DrawDocuNo
ORDER BY rh.RedemtionID,a.audit_datetime,a.audit_id;
