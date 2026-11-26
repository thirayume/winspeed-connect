-- @transaction
-- Fixed SELECT-only metadata reader includes required trigger order.
-- Record-scope changes revoke unstarted legacy permits too. No native DDL.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
ALTER PROCEDURE wf.usp_ReadNativeDocumentMetadata
WITH EXECUTE AS SELF
AS
BEGIN
 SET NOCOUNT ON;
 SELECT OBJECT_NAME(t.parent_id) AS TableName,t.name,t.is_disabled,m.definition,
  CONVERT(int,OBJECTPROPERTY(t.object_id,'ExecIsFirstDeleteTrigger')) FirstDelete,
  CONVERT(int,OBJECTPROPERTY(t.object_id,'ExecIsLastInsertTrigger')) LastInsert,
  CONVERT(int,OBJECTPROPERTY(t.object_id,'ExecIsFirstUpdateTrigger')) FirstUpdate
 FROM sys.triggers t LEFT JOIN sys.sql_modules m ON m.object_id=t.object_id
 WHERE t.parent_id IN(OBJECT_ID('dbo.SOHD'),OBJECT_ID('dbo.SODT'),OBJECT_ID('dbo.SOHDRemark'),OBJECT_ID('dbo.SODTRemark'),OBJECT_ID('dbo.SOInvHD'),OBJECT_ID('dbo.SOInvDT'),OBJECT_ID('dbo.SMSat'),OBJECT_ID('dbo.SMReserveSat'),OBJECT_ID('dbo.ICStockDetail'),OBJECT_ID('dbo.ICCostDetail'),OBJECT_ID('dbo.WFRedemtionHD'),OBJECT_ID('dbo.WFRedemtionDT'),OBJECT_ID('dbo.WFCoupon'),OBJECT_ID('dbo.VTVAT'),OBJECT_ID('dbo.SMAudit'),OBJECT_ID('dbo.SMEvent'),OBJECT_ID('dbo.SMID'),OBJECT_ID('dbo.EMRunBrch'),OBJECT_ID('dbo.EMRunChar'),OBJECT_ID('dbo.Define_104'));
END;
GO
ALTER PROCEDURE wf.sp_CouponBridgeScope @proof nvarchar(max) OUTPUT,@cust int=NULL AS
BEGIN
 SET NOCOUNT ON;
 -- No names/passwords. Organizational/role changes revoke a short-lived permit.
 SET @proof=CONVERT(nvarchar(max),(SELECT
  (SELECT Id,Role,EmpId,PositionCode,IsActive,MustChangePassword FROM wf.AppUser WITH(HOLDLOCK) ORDER BY Id FOR XML RAW('user'),TYPE) AS Users,
  (SELECT PositionCode,ReportsTo,RecordScope,IsActive FROM wf.OrgPosition WITH(HOLDLOCK) ORDER BY PositionCode FOR XML RAW('position'),TYPE) AS Positions,
  (SELECT u.UserId,u.RoleCode,r.BaseRole FROM wf.vUserRole u JOIN wf.RoleProfile r ON r.Code=u.RoleCode ORDER BY u.UserId,u.RoleCode FOR XML RAW('role'),TYPE) AS Roles,
  (SELECT c.CustID,c.BillEmp,e.SalespersonUserId FROM dbo.EMCust c WITH(HOLDLOCK) LEFT JOIN wf.CustomerExt e WITH(HOLDLOCK) ON e.CustId=c.CustID
    WHERE c.CustID=@cust FOR XML RAW('customer'),TYPE) AS CustomerScope,
  (SELECT h.SOID,h.EmpID,e.SalesUserId,h.DocuDate FROM dbo.SOHD h WITH(HOLDLOCK) LEFT JOIN wf.SalesOrderExt e WITH(HOLDLOCK) ON e.SOID=CONVERT(varchar(50),h.SOID)
    WHERE h.CustID=@cust AND h.DocuType=103 AND h.DocuDate>=ISNULL((SELECT CONVERT(datetime,SettingValue,120) FROM wf.SystemSetting WHERE SettingKey='GLOBAL_DATA_START_DATE'),CONVERT(datetime,'2026-01-01',120))
    ORDER BY h.SOID FOR XML RAW('bookingScope'),TYPE) AS BookingScope
 FOR XML RAW('scope'),TYPE));
END;
GO
