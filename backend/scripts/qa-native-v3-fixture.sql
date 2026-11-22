-- Rehearsal fixture, rollback only. No native schema changes or trigger bypass.
-- Install only on the isolated QA database with the reviewed DBA script.
-- Calls require an outer transaction; all fixture documents are rolled back.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('wf.usp_QaNativeV3Fixture','P') IS NOT NULL RAISERROR('QA_FIXTURE_ALREADY_EXISTS',16,1);
GO
CREATE PROCEDURE wf.usp_QaNativeV3Fixture @FullDiscount bit=0 WITH EXECUTE AS OWNER AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT=0 OR DB_NAME()<>'dbwins_worldfert9_uat_v3' OR CONVERT(nvarchar(128),SERVERPROPERTY('ServerName'))<>N'R740-SRV\SQL2008'
  BEGIN RAISERROR('QA_FIXTURE_TARGET_INVALID',16,1);RETURN;END;
 DECLARE @Today datetime,@Base int,@BaseLine int,@New int,@User int,@Emp int,@Draft int,@Cust int,@No varchar(30),@Columns nvarchar(max),@Values nvarchar(max),@Statement nvarchar(max);
 SET @Today=CONVERT(datetime,CONVERT(varchar(10),DATEADD(hour,7,GETUTCDATE()),120),120);
 DECLARE @Discount decimal(18,4);SET @Discount=CASE WHEN @FullDiscount=1 THEN 18000 ELSE 123.45 END;
 SELECT TOP 1 @Emp=e.EmpID FROM dbo.EMEmp e JOIN wf.NativeApproverEmployee a ON a.EmpID=e.EmpID AND a.IsEnabled=1 WHERE e.EmpStatus='1' ORDER BY e.EmpID;
 SELECT TOP 200 h.SOID,d.ListNo,h.CustID,d.GoodID INTO #QaCandidates FROM dbo.SOHD h JOIN dbo.SODT d ON d.SOID=h.SOID
  JOIN dbo.EMGood g ON g.GoodID=d.GoodID JOIN dbo.EMGoodUnit u ON u.GoodUnitID=d.GoodUnitID2
  LEFT JOIN wf.CreditMaster cm ON cm.CustId=h.CustID
  WHERE h.DocuType=103 AND h.BrchID=1 AND h.VatRate=0 AND h.VatType='3' AND LEFT(h.DocuNo,1)='I'
   AND g.GoodWeight=50 AND g.ExpnID IS NOT NULL AND u.GoodUnitCode=N'ตัน' AND ISNULL(d.LotFlag,'N')='N' AND ISNULL(d.SerialFlag,'N')='N'
   AND ISNULL(cm.CreditHold,0)=0
  ORDER BY h.SOID DESC,d.ListNo OPTION(RECOMPILE);
 SELECT GoodID INTO #QaCosted FROM(
  SELECT GoodID FROM dbo.ICStockDetail WHERE DocuDate>=@Today AND CostFlag='Y'
  UNION SELECT GoodID FROM dbo.ICCostDetail WHERE DocuDate>=@Today) x;
 CREATE UNIQUE CLUSTERED INDEX IX_QaCosted ON #QaCosted(GoodID);
 SELECT TOP 1 @Base=c.SOID,@BaseLine=c.ListNo,@Cust=c.CustID FROM #QaCandidates c
  LEFT JOIN #QaCosted s ON s.GoodID=c.GoodID WHERE s.GoodID IS NULL ORDER BY c.SOID DESC,c.ListNo OPTION(RECOMPILE);
 IF @Base IS NULL OR @Emp IS NULL BEGIN RAISERROR('QA_FIXTURE_SOURCE_UNAVAILABLE',16,1);RETURN;END;
 INSERT wf.AppUser(Username,PasswordHash,DisplayName,Role,EmpId,IsActive,MustChangePassword)
 VALUES('qa-native-'+CONVERT(varchar(36),NEWID()),'!NO_LOGIN_ROLLBACK_FIXTURE!','QA rollback native writer','ADMIN',CONVERT(varchar(20),@Emp),1,0);
 SET @User=CONVERT(int,SCOPE_IDENTITY());
 IF NOT EXISTS(SELECT 1 FROM wf.NativeWriterContract)
 INSERT wf.NativeWriterContract(ServerName,DatabaseName,PolicyVersion,MetadataHash,IsEnabled,ApprovedById,ApprovedActorId,ApprovedAtUtc,Evidence)
 VALUES(CONVERT(nvarchar(128),SERVERPROPERTY('ServerName')),DB_NAME(),'NATIVE-DOCUMENTS-v3',
  '1bdd47a6ee4e84662ed0b1979d32a628ac720fd6745e5839a0afb4b1987f6c8a',1,@User,@User,GETUTCDATE(),'Rollback-only SQL integration fixture; metadata verified before apply');
 IF wf.fn_IsNativeDocumentTarget()<>1 BEGIN RAISERROR('QA_REVIEWED_CONTRACT_REQUIRED',16,1);RETURN;END;
 EXEC wf.usp_AllocateWinspeedId @TableName='SOHD',@NewId=@New OUTPUT;
 SET @Draft=2140000000+@User;
 SET @No='I'+RIGHT(CONVERT(varchar(4),YEAR(@Today)+543),2)+'-';
 SELECT @No=@No+RIGHT('00000'+CONVERT(varchar(5),ISNULL(MAX(CONVERT(int,RIGHT(DocuNo,5))),0)+1),5)
  FROM dbo.SOHD WITH(UPDLOCK,HOLDLOCK) WHERE DocuType=103 AND LEN(DocuNo)=9 AND DocuNo LIKE @No+'[0-9][0-9][0-9][0-9][0-9]';
 SELECT @Columns=STUFF((SELECT ','+QUOTENAME(name) FROM sys.columns WHERE object_id=OBJECT_ID('dbo.SOHD') AND is_identity=0 AND is_computed=0 AND system_type_id<>189 ORDER BY column_id FOR XML PATH(''),TYPE).value('.','nvarchar(max)'),1,1,'');
 SELECT @Values=STUFF((SELECT ','+CASE name
  WHEN 'SOID' THEN '@New' WHEN 'DocuNo' THEN '@No' WHEN 'DocuDate' THEN '@Today' WHEN 'ValidDays' THEN '365' WHEN 'ShipDate' THEN '@Today'
  WHEN 'AppvFlag' THEN '''W''' WHEN 'Appvid' THEN 'NULL' WHEN 'AppvDocuNo' THEN 'NULL' WHEN 'AppvDate' THEN 'NULL'
  WHEN 'DocuStatus' THEN '''N''' WHEN 'OnHold' THEN '''N''' WHEN 'ClearSO' THEN '''N''' WHEN 'RefSOID' THEN 'NULL'
  WHEN 'SumGoodAmnt' THEN '18000' WHEN 'SumExcludeAmnt' THEN '18000' WHEN 'SumIncludeAmnt' THEN '0'
  WHEN 'BillDiscAmnt' THEN '@Discount' WHEN 'BillDiscFormula' THEN 'CONVERT(varchar(40),@Discount)' WHEN 'BillAftrDiscAmnt' THEN '18000-@Discount'
  WHEN 'NetAmnt' THEN '18000-@Discount' WHEN 'VATAmnt' THEN '0' WHEN 'BaseDiscAmnt' THEN '0' WHEN 'MiscChargAmnt' THEN '0'
  WHEN 'CommissionAmnt' THEN '0' WHEN 'ExchRate' THEN '1' WHEN 'CreditDays' THEN '0' WHEN 'EmpID' THEN '@Emp'
  WHEN 'TotaBaseAmnt' THEN '18000-@Discount' ELSE QUOTENAME(name) END
  FROM sys.columns WHERE object_id=OBJECT_ID('dbo.SOHD') AND is_identity=0 AND is_computed=0 AND system_type_id<>189 ORDER BY column_id FOR XML PATH(''),TYPE).value('.','nvarchar(max)'),1,1,'');
 SET @Statement='INSERT dbo.SOHD('+@Columns+') SELECT '+@Values+' FROM dbo.SOHD WHERE SOID=@Base;';
 EXEC sp_executesql @Statement,N'@New int,@No varchar(30),@Today datetime,@Emp int,@Base int,@Discount decimal(18,4)',@New,@No,@Today,@Emp,@Base,@Discount;
 SELECT @Columns=STUFF((SELECT ','+QUOTENAME(name) FROM sys.columns WHERE object_id=OBJECT_ID('dbo.SODT') AND is_identity=0 AND is_computed=0 AND system_type_id<>189 ORDER BY column_id FOR XML PATH(''),TYPE).value('.','nvarchar(max)'),1,1,'');
 SELECT @Values=STUFF((SELECT ','+CASE name
  WHEN 'SOID' THEN '@New' WHEN 'ListNo' THEN '@Line' WHEN 'DocuType' THEN '103' WHEN 'RefSOID' THEN 'NULL' WHEN 'RefListNo' THEN 'NULL'
  WHEN 'GoodQty2' THEN '0.6' WHEN 'RemaQty' THEN '0.6' WHEN 'GoodStockQty' THEN '0.6' WHEN 'GoodStockRate2' THEN '1'
  WHEN 'GoodPrice2' THEN '@Price' WHEN 'GoodAmnt' THEN '@Price*0.6' WHEN 'GoodDiscAmnt' THEN '0' WHEN 'ShipDate' THEN '@Today'
  WHEN 'SumExcludeAmnt' THEN '@Price*0.6' WHEN 'GoodDiscFormula' THEN '''''' WHEN 'ReserveQty' THEN '0'
  ELSE QUOTENAME(name) END FROM sys.columns WHERE object_id=OBJECT_ID('dbo.SODT') AND is_identity=0 AND is_computed=0 AND system_type_id<>189 ORDER BY column_id FOR XML PATH(''),TYPE).value('.','nvarchar(max)'),1,1,'');
 SET @Statement='INSERT dbo.SODT('+@Columns+') SELECT '+@Values+' FROM dbo.SODT WHERE SOID=@Base AND ListNo=@BaseLine;';
 EXEC sp_executesql @Statement,N'@New int,@Line int,@Price decimal(18,4),@Today datetime,@Base int,@BaseLine int',@New,1,10000,@Today,@Base,@BaseLine;
 EXEC sp_executesql @Statement,N'@New int,@Line int,@Price decimal(18,4),@Today datetime,@Base int,@BaseLine int',@New,2,20000,@Today,@Base,@BaseLine;
 INSERT wf.SalesOrderExt(SOID,WfRef,SourceDraftId,SalesUserId,SoPrefix,IsUnlocked) VALUES(CONVERT(varchar(50),@New),@No,@Draft,@User,'I',0);
 DECLARE @Slip int;
 SELECT @Slip=MAX(CONVERT(int,DocuNo)) FROM dbo.WFRedemtionHD WITH(UPDLOCK,HOLDLOCK) WHERE LEN(DocuNo)<=9 AND DocuNo NOT LIKE '%[^0-9]%';
 IF ISNULL(@Slip,0)>=999999900 BEGIN RAISERROR('QA_SLIP_RANGE_EXHAUSTED',16,1);RETURN;END;
 SELECT @New AS SOID,@Draft AS DraftId,@User AS UserId,@Cust AS CustId,ISNULL(@Slip,990000000)+10 AS SlipBase,CONVERT(varchar(10),@Today,120) AS Today;
END;
GO
