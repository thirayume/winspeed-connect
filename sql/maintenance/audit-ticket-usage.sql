-- Read-only localhost audit. Change @CustomerRoot to inspect another family.
DECLARE @CustomerRoot varchar(25)='0462002';
SELECT 'AUDIT_RANGE' Stage,COUNT_BIG(*) Rows,MIN(audit_datetime) FirstAudit,MAX(audit_datetime) LastAudit FROM dbo.SMAudit;
SELECT 'COUPON_KEYS' Stage,COUNT_BIG(*) CouponRows,COUNT(DISTINCT CouponID) UniqueIDs,COUNT(DISTINCT CouponNo) UniqueNumbers,
SUM(CASE WHEN GoodID IS NULL THEN 1 ELSE 0 END) MissingGoodID FROM dbo.WFCoupon;
SELECT 'CUSTOMER_FAMILY' Stage,CustID,CustCode,CustGroupID FROM dbo.EMCust WHERE RTRIM(CustCode)=@CustomerRoot OR RTRIM(CustCode) LIKE @CustomerRoot+'-%';
SELECT 'OWNER_DOWNSTREAM' Stage,RTRIM(oc.CustCode) OwnerCode,RTRIM(bc.CustCode) DownstreamCustomerCode,
COUNT_BIG(*) DrawLines,COUNT(DISTINCT c.CouponID) Coupons
FROM dbo.WFCoupon c JOIN dbo.SOHD d ON d.SOID=c.DocuID AND d.DocuType=104
JOIN dbo.EMCust oc ON oc.CustID=d.CustID
JOIN dbo.WFRedemtionDT rd ON rd.CouponID=c.CouponID
JOIN dbo.SOInvHD ih ON ih.SOInvID=rd.SOInvID
JOIN dbo.EMCust bc ON bc.CustID=ih.CustID
WHERE RTRIM(oc.CustCode)=@CustomerRoot OR RTRIM(oc.CustCode) LIKE @CustomerRoot+'-%'
GROUP BY RTRIM(oc.CustCode),RTRIM(bc.CustCode);
WITH H AS (
SELECT rd.RedemtionID,COUNT(DISTINCT RTRIM(bc.CustCode)) Customers
FROM dbo.WFRedemtionDT rd JOIN dbo.WFRedemtionHD rh ON rh.RedemtionID=rd.RedemtionID AND rh.DocuType=116
JOIN dbo.SOInvHD ih ON ih.SOInvID=rd.SOInvID JOIN dbo.EMCust bc ON bc.CustID=ih.CustID
WHERE RTRIM(bc.CustCode)=@CustomerRoot OR RTRIM(bc.CustCode) LIKE @CustomerRoot+'-%'
GROUP BY rd.RedemtionID)
SELECT 'FAMILY_COLOAD' Stage,COUNT_BIG(*) HeadersWithMultipleFamilyCodes FROM H WHERE Customers>1;
SELECT 'BALANCE_EXAMPLES' Stage,c.CouponID,c.CouponNo,c.GoodID,c.GoodUnitID,c.GoodQty OriginalQty,c.RemaQty CouponRemaining,
rh.DocuStatus,COUNT_BIG(*) DrawLines,SUM(rd.GoodQty) DrawQty,SUM(rd.RemaQty) DrawRemaining
FROM dbo.WFCoupon c JOIN dbo.WFRedemtionDT rd ON rd.CouponID=c.CouponID
JOIN dbo.WFRedemtionHD rh ON rh.RedemtionID=rd.RedemtionID
WHERE c.CouponID IN (235487,235488)
GROUP BY c.CouponID,c.CouponNo,c.GoodID,c.GoodUnitID,c.GoodQty,c.RemaQty,rh.DocuStatus;
