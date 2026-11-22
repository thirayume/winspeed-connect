-- @transaction
-- Versioned 116 bridge. No WinSpeed table/trigger is changed or enabled here.
-- Immutable settlements + additive returns; current document proofs may advance.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('wf.CouponBridgeContract','U') IS NULL
CREATE TABLE wf.CouponBridgeContract(
 Version varchar(20) NOT NULL PRIMARY KEY,Enabled bit NOT NULL DEFAULT(0),ModulesHash char(64) NULL,
 ApprovedById int NULL,ActorId int NULL,Evidence nvarchar(1000) NULL,ApprovedAtUtc datetime2 NULL,
 CHECK(Enabled=0 OR(ModulesHash IS NOT NULL AND ApprovedById>0 AND ActorId>0 AND ApprovedAtUtc IS NOT NULL AND LEN(Evidence)>=20))
);
IF NOT EXISTS(SELECT 1 FROM wf.CouponBridgeContract WHERE Version='116-BRIDGE-v1')
 INSERT wf.CouponBridgeContract(Version,Enabled) VALUES('116-BRIDGE-v1',0);
IF OBJECT_ID('wf.CouponBridgeDocument','U') IS NULL
CREATE TABLE wf.CouponBridgeDocument(
 NativeId int NOT NULL PRIMARY KEY,DocuNo varchar(25) NOT NULL UNIQUE,CustId int NOT NULL,
 Origin varchar(10) NOT NULL CHECK(Origin IN('APP','WINSPEED','LEGACY')),RequestId varchar(36) NULL,
 Revision int NOT NULL DEFAULT(1),State varchar(12) NOT NULL CHECK(State IN('ACTIVE','CANCELLED')),
 HeaderProof nvarchar(max) NOT NULL,LineProof nvarchar(max) NOT NULL,
 ObservedById int NOT NULL,ActorId int NOT NULL,ChangedAtUtc datetime2 NOT NULL DEFAULT(GETUTCDATE())
);
IF OBJECT_ID('wf.CouponBridgePermit','U') IS NULL
CREATE TABLE wf.CouponBridgePermit(
 PermitId varchar(36) NOT NULL PRIMARY KEY,RequestId varchar(36) NULL,Operation char(1) NOT NULL CHECK(Operation IN('C','E','D')),
 NativeId int NULL,DocuNo varchar(25) NOT NULL,CustId int NOT NULL,
 State varchar(12) NOT NULL CHECK(State IN('APPROVED','STARTED','COMPLETE','CANCELLED')),
 ExpiresAtUtc datetime2 NOT NULL,StartedAtUtc datetime2 NULL,CompletedAtUtc datetime2 NULL,ReleasedAtUtc datetime2 NULL,
 OriginTransactionId bigint NULL,OriginStartedAt datetime NULL,Marker nvarchar(255) NOT NULL,
 BeforeHeader nvarchar(max) NOT NULL,BeforeLines nvarchar(max) NOT NULL,ExpectedRevision int NULL,
 DocuDate date NOT NULL,Receiver nvarchar(100) NOT NULL,Plate nvarchar(25) NOT NULL,RecorderEmpId int NOT NULL,
 UserId int NOT NULL,ActorId int NOT NULL,PrimaryUserId int NOT NULL,PrimaryActorId int NOT NULL,
 ScopeProof nvarchar(max) NOT NULL,Reason nvarchar(500) NOT NULL,
 CreatedAtUtc datetime2 NOT NULL DEFAULT(GETUTCDATE()),
 CHECK((OriginTransactionId IS NULL AND OriginStartedAt IS NULL) OR(OriginTransactionId IS NOT NULL AND OriginStartedAt IS NOT NULL))
);
IF OBJECT_ID('wf.CouponBridgeDocumentLine','U') IS NULL
CREATE TABLE wf.CouponBridgeDocumentLine(
 NativeId int NOT NULL REFERENCES wf.CouponBridgeDocument(NativeId),CouponId int NOT NULL,
 [LineNo] int NOT NULL,Quantity decimal(18,4) NOT NULL CHECK(Quantity>0),PRIMARY KEY(NativeId,CouponId),UNIQUE(NativeId,[LineNo])
);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('wf.CouponBridgeDocumentLine') AND name='IX_CouponBridgeDocumentLine_Coupon')
 CREATE INDEX IX_CouponBridgeDocumentLine_Coupon ON wf.CouponBridgeDocumentLine(CouponId,NativeId);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('wf.CouponBridgePermit') AND name='IX_CouponBridgePermit_Document')
CREATE INDEX IX_CouponBridgePermit_Document ON wf.CouponBridgePermit(DocuNo,State);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('wf.CouponBridgePermit') AND name='IX_CouponBridgePermit_Native')
CREATE INDEX IX_CouponBridgePermit_Native ON wf.CouponBridgePermit(NativeId,State);
IF OBJECT_ID('wf.CouponBridgeLine','U') IS NULL
CREATE TABLE wf.CouponBridgeLine(
 PermitId varchar(36) NOT NULL REFERENCES wf.CouponBridgePermit(PermitId),CouponId int NOT NULL,
 [LineNo] int NOT NULL,BeforeQty decimal(18,4) NOT NULL,AfterQty decimal(18,4) NOT NULL,NativeBefore decimal(18,4) NOT NULL,
 SourceProof nvarchar(max) NOT NULL,
 PRIMARY KEY(PermitId,CouponId),CHECK(BeforeQty>=0 AND AfterQty>=0 AND BeforeQty+AfterQty>0 AND NativeBefore>=0)
);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('wf.CouponBridgeLine') AND name='IX_CouponBridgeLine_Coupon')
 CREATE INDEX IX_CouponBridgeLine_Coupon ON wf.CouponBridgeLine(CouponId,PermitId);
IF OBJECT_ID('wf.CouponBridgeAllocation','U') IS NULL
CREATE TABLE wf.CouponBridgeAllocation(
 Id bigint IDENTITY(1,1) NOT NULL PRIMARY KEY,PermitId varchar(36) NOT NULL REFERENCES wf.CouponBridgePermit(PermitId),
 CouponId int NOT NULL,ReservationId bigint NOT NULL,SettlementId bigint NULL,
 DeltaQty decimal(12,4) NOT NULL,BeforeConsumed decimal(12,4) NOT NULL,BeforeRevision int NOT NULL,
 CHECK(DeltaQty<>0 AND BeforeConsumed>=0 AND(DeltaQty>0 OR SettlementId IS NOT NULL))
);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('wf.CouponBridgeAllocation') AND name='IX_CouponBridgeAllocation_Hold')
 CREATE INDEX IX_CouponBridgeAllocation_Hold ON wf.CouponBridgeAllocation(ReservationId,PermitId);
IF OBJECT_ID('wf.CouponBridgeReturn','U') IS NULL
CREATE TABLE wf.CouponBridgeReturn(
 Id bigint IDENTITY(1,1) NOT NULL PRIMARY KEY,PermitId varchar(36) NOT NULL REFERENCES wf.CouponBridgePermit(PermitId),
 SettlementId bigint NOT NULL REFERENCES wf.CouponReservationSettlement(Id),Quantity decimal(12,4) NOT NULL CHECK(Quantity>0),
 AuditId bigint NOT NULL REFERENCES wf.ChangeEvent(EventId),UNIQUE(PermitId,SettlementId)
);
IF OBJECT_ID('wf.CouponBridgeSession','U') IS NULL
CREATE TABLE wf.CouponBridgeSession(PermitId varchar(36) NOT NULL PRIMARY KEY,SessionId smallint NOT NULL,
 UserId int NOT NULL,ActorId int NOT NULL,PrimaryUserId int NOT NULL,PrimaryActorId int NOT NULL,Reason nvarchar(500) NOT NULL);
GO
DENY INSERT,UPDATE,DELETE ON OBJECT::wf.CouponBridgeContract TO public;
DENY INSERT,UPDATE,DELETE ON OBJECT::wf.CouponBridgeDocument TO public;
DENY INSERT,UPDATE,DELETE ON OBJECT::wf.CouponBridgeDocumentLine TO public;
DENY INSERT,UPDATE,DELETE ON OBJECT::wf.CouponBridgePermit TO public;
DENY INSERT,UPDATE,DELETE ON OBJECT::wf.CouponBridgeLine TO public;
DENY INSERT,UPDATE,DELETE ON OBJECT::wf.CouponBridgeAllocation TO public;
DENY INSERT,UPDATE,DELETE ON OBJECT::wf.CouponBridgeReturn TO public;
DENY SELECT,INSERT,UPDATE,DELETE ON OBJECT::wf.CouponBridgeSession TO public;
GO
IF OBJECT_ID('wf.fn_CouponBridgeReservationHeld','FN') IS NULL
 EXEC('CREATE FUNCTION wf.fn_CouponBridgeReservationHeld(@id bigint) RETURNS bit AS BEGIN RETURN 0;END');
GO
ALTER FUNCTION wf.fn_CouponBridgeReservationHeld(@id bigint) RETURNS bit AS
BEGIN
 RETURN CASE WHEN EXISTS(SELECT 1 FROM wf.CouponBridgeAllocation a JOIN wf.CouponBridgePermit p ON p.PermitId=a.PermitId
  WHERE a.ReservationId=@id AND p.ReleasedAtUtc IS NULL AND p.State<>'CANCELLED'
   AND(p.ExpiresAtUtc>GETUTCDATE() OR p.StartedAtUtc IS NOT NULL)) THEN 1 ELSE 0 END;
END;
GO
IF OBJECT_ID('wf.CouponBridgeEffectiveSettlement','V') IS NULL
 EXEC('CREATE VIEW wf.CouponBridgeEffectiveSettlement AS SELECT * FROM wf.CouponEffectiveSettlement');
GO
ALTER VIEW wf.CouponBridgeEffectiveSettlement AS
 SELECT s.Id,s.ReservationId,s.CouponId,s.NativeRedemptionId,s.NativeDocuNo,
  CAST(s.SettledQty-ISNULL(r.Returned,0) AS decimal(12,4)) AS SettledQty
 FROM wf.CouponEffectiveSettlement s
 OUTER APPLY(SELECT SUM(b.Quantity) AS Returned FROM wf.CouponBridgeReturn b
  JOIN wf.CouponBridgePermit p ON p.PermitId=b.PermitId AND p.State='COMPLETE' AND p.ReleasedAtUtc IS NOT NULL
  WHERE b.SettlementId=s.Id)r
 WHERE s.SettledQty-ISNULL(r.Returned,0)>0;
GO
IF OBJECT_ID('wf.sp_CouponBridgePhysical','P') IS NULL EXEC('CREATE PROCEDURE wf.sp_CouponBridgePhysical AS RETURN');
GO
ALTER PROCEDURE wf.sp_CouponBridgePhysical @id int,@head nvarchar(max) OUTPUT,@lines nvarchar(max) OUTPUT AS
BEGIN
 SET NOCOUNT ON;
 SET @head=CONVERT(nvarchar(max),(SELECT RedemtionID,DocuNo,DocuDate,CardNo,IssueName,CarLicense,SaveEmpID,IssueEmpID,AppvEmpID,SumGoodQty,IsCheckAll
  FROM dbo.WFRedemtionHD WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID=@id AND DocuType=116 FOR XML RAW('head'),TYPE));
 SET @lines=CONVERT(nvarchar(max),(SELECT Listno,CouponID,CouponNo,GoodID,InveID,LocaID,GoodUnitID,
  CONVERT(decimal(18,4),GoodPrice) AS GoodPrice,CONVERT(decimal(18,4),GoodQty) AS GoodQty,IsCheck
  FROM dbo.WFRedemtionDT WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID=@id ORDER BY Listno FOR XML RAW('line'),TYPE));
 SET @head=ISNULL(@head,N'');SET @lines=ISNULL(@lines,N'');
END;
GO
IF OBJECT_ID('wf.sp_CouponBridgeSource','P') IS NULL EXEC('CREATE PROCEDURE wf.sp_CouponBridgeSource AS RETURN');
GO
ALTER PROCEDURE wf.sp_CouponBridgeSource @coupon int,@cust int,@proof nvarchar(max) OUTPUT AS
BEGIN
 SET NOCOUNT ON;
 SET @proof=CONVERT(nvarchar(max),(SELECT c.CouponID,c.DocuID AS DeliveryId,c.RefListno AS DeliveryLine,c.CouponNo,c.GoodID,c.GoodUnitID,c.GoodQty,c.GoodPrice,c.InveID,c.LocaID,
  h.DocuNo,h.CustID,h.EmpID,h.DocuDate,h.DocuStatus,h.SumGoodAmnt,h.BillDiscAmnt,h.NetAmnt,d.GoodQty2,d.GoodPrice2,d.RefSOID AS BookingId,d.RefListNo AS BookingLine,
  d.GoodID AS SourceGoodId,d.GoodUnitID2,d.InveID AS SourceInveId,d.LocaID AS SourceLocaId,d.GoodStockRate2,d.GoodStockQty,d.GoodAmnt,
  (SELECT e.SalesUserId FROM wf.SalesOrderExt e WITH(HOLDLOCK) WHERE e.SOID=CONVERT(varchar(50),h.SOID) FOR XML RAW('owner'),TYPE) AS OwnerScope,
  (SELECT b.OwnerCustId,b.BeneficiaryCustId,b.Scope,b.Status,b.EffectiveFrom,b.EffectiveTo
   FROM wf.CouponBeneficiary b WITH(UPDLOCK,HOLDLOCK) WHERE b.OwnerCustId=CONVERT(varchar(50),h.CustID)
    AND b.BeneficiaryCustId=CONVERT(varchar(50),@cust) ORDER BY b.Id FOR XML RAW('grant'),TYPE) AS Grants,
  (SELECT SettingValue FROM wf.SystemSetting WITH(HOLDLOCK) WHERE SettingKey='GLOBAL_DATA_START_DATE' FOR XML RAW('window'),TYPE) AS DataWindow
  FROM dbo.WFCoupon c WITH(UPDLOCK,HOLDLOCK) JOIN dbo.SOHD h WITH(UPDLOCK,HOLDLOCK) ON h.SOID=c.DocuID AND h.DocuType=104
  JOIN dbo.SODT d WITH(UPDLOCK,HOLDLOCK) ON d.SOID=h.SOID AND d.ListNo=c.RefListno AND d.DocuType=104
  WHERE c.CouponID=@coupon FOR XML RAW('source'),TYPE));
END;
GO
IF OBJECT_ID('wf.sp_CouponBridgeScope','P') IS NULL EXEC('CREATE PROCEDURE wf.sp_CouponBridgeScope AS RETURN');
GO
ALTER PROCEDURE wf.sp_CouponBridgeScope @proof nvarchar(max) OUTPUT,@cust int=NULL AS
BEGIN
 SET NOCOUNT ON;
 -- No names/passwords. Organizational/role changes revoke a short-lived permit.
 SET @proof=CONVERT(nvarchar(max),(SELECT
  (SELECT Id,Role,EmpId,PositionCode,IsActive,MustChangePassword FROM wf.AppUser WITH(HOLDLOCK) ORDER BY Id FOR XML RAW('user'),TYPE) AS Users,
  (SELECT PositionCode,ReportsTo FROM wf.OrgPosition WITH(HOLDLOCK) ORDER BY PositionCode FOR XML RAW('position'),TYPE) AS Positions,
  (SELECT u.UserId,u.RoleCode,r.BaseRole FROM wf.vUserRole u JOIN wf.RoleProfile r ON r.Code=u.RoleCode ORDER BY u.UserId,u.RoleCode FOR XML RAW('role'),TYPE) AS Roles,
  (SELECT c.CustID,c.BillEmp,e.SalespersonUserId FROM dbo.EMCust c WITH(HOLDLOCK) LEFT JOIN wf.CustomerExt e WITH(HOLDLOCK) ON e.CustId=c.CustID
    WHERE c.CustID=@cust FOR XML RAW('customer'),TYPE) AS CustomerScope,
  (SELECT h.SOID,h.EmpID,e.SalesUserId,h.DocuDate FROM dbo.SOHD h WITH(HOLDLOCK) LEFT JOIN wf.SalesOrderExt e WITH(HOLDLOCK) ON e.SOID=CONVERT(varchar(50),h.SOID)
    WHERE h.CustID=@cust AND h.DocuType=103 AND h.DocuDate>=ISNULL((SELECT CONVERT(datetime,SettingValue,120) FROM wf.SystemSetting WHERE SettingKey='GLOBAL_DATA_START_DATE'),CONVERT(datetime,'2026-01-01',120))
    ORDER BY h.SOID FOR XML RAW('bookingScope'),TYPE) AS BookingScope
 FOR XML RAW('scope'),TYPE));
END;
GO
DENY EXECUTE ON OBJECT::wf.sp_CouponBridgeSource TO public;
DENY EXECUTE ON OBJECT::wf.sp_CouponBridgeScope TO public;
GO
IF OBJECT_ID('wf.sp_CouponBridgePublish','P') IS NULL EXEC('CREATE PROCEDURE wf.sp_CouponBridgePublish AS RETURN');
GO
ALTER PROCEDURE wf.sp_CouponBridgePublish
 @permit varchar(36),@request varchar(36),@operation char(1),@native int,@number varchar(25),@cust int,
 @date date,@receiver nvarchar(100),@plate nvarchar(25),@emp int,@user int,@actor int,@primary int,@primaryActor int,
 @revision int,@reason nvarchar(500),@lines xml,@allocations xml AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<1 OR XACT_STATE()<>1 OR wf.fn_IsNativeDocumentTarget()<>1
  OR NOT EXISTS(SELECT 1 FROM wf.CouponBridgeContract WITH(HOLDLOCK) WHERE Version='116-BRIDGE-v1' AND Enabled=1)
 BEGIN RAISERROR('BRIDGE_NOT_READY',16,1);RETURN;END;
 DECLARE @permission varchar(80),@head nvarchar(max),@before nvarchar(max),@scope nvarchar(max),@requestPlan xml,@requestCust int,@validated int;
 SET @permission=CASE WHEN @operation='C' THEN 'coupon.manual116' ELSE 'coupon.settle' END;
 IF @operation NOT IN('C','E','D') OR wf.fn_UserHasPermission(@user,@permission)<>1 OR wf.fn_UserHasPermission(@actor,@permission)<>1
  OR LEN(LTRIM(RTRIM(ISNULL(@reason,''))))<10 OR NULLIF(@number,'') IS NULL OR @primary<=0 OR @primaryActor<=0
  OR NOT EXISTS(SELECT 1 FROM wf.AppUser WHERE Id=@user AND IsActive=1 AND MustChangePassword=0)
  OR NOT EXISTS(SELECT 1 FROM wf.AppUser WHERE Id=@actor AND IsActive=1 AND MustChangePassword=0)
 BEGIN RAISERROR('BRIDGE_ACTOR_INVALID',16,1);RETURN;END;
 IF EXISTS(SELECT 1 FROM wf.CouponBridgePermit WITH(UPDLOCK,HOLDLOCK) WHERE PermitId=@permit OR
   (DocuNo=@number AND ReleasedAtUtc IS NULL AND State<>'CANCELLED'))
 BEGIN RAISERROR('BRIDGE_PERMIT_EXISTS',16,1);RETURN;END;
 IF @operation='C'
 BEGIN
  IF @native IS NOT NULL OR @request IS NULL
   OR EXISTS(SELECT 1 FROM dbo.WFRedemtionHD WITH(UPDLOCK,HOLDLOCK) WHERE DocuNo=@number)
   OR NOT EXISTS(SELECT 1 FROM wf.NativeDocumentRequest WITH(UPDLOCK,HOLDLOCK) WHERE RequestId=@request AND DocuType=116
     AND Status='APPROVED' AND ExpiresAtUtc>DATEADD(minute,1,GETUTCDATE()) AND SourceId=@cust
     AND PlanXml.value('(/plan/@slipNo)[1]','varchar(25)')=@number)
  BEGIN RAISERROR('BRIDGE_REQUEST_INVALID',16,1);RETURN;END;
  EXEC @validated=wf.usp_ReadNativeDocumentRequest @request,116,@user,@actor,@requestPlan OUTPUT,@requestCust OUTPUT;
  IF @validated<>0 OR @requestCust<>@cust OR @requestPlan.value('(/plan/@docDate)[1]','date')<>@date
   OR @requestPlan.value('(/plan/@receiver)[1]','nvarchar(100)')<>@receiver OR @requestPlan.value('(/plan/@plate)[1]','nvarchar(25)')<>@plate
  BEGIN RAISERROR('BRIDGE_APPROVED_PLAN_CHANGED',16,1);RETURN;END;
  SET @head='';SET @before='';
 END
 ELSE
 BEGIN
  EXEC wf.sp_CouponBridgePhysical @native,@head OUTPUT,@before OUTPUT;
  IF NOT EXISTS(SELECT 1 FROM wf.CouponBridgeDocument WITH(UPDLOCK,HOLDLOCK) WHERE NativeId=@native AND DocuNo=@number AND CustId=@cust
    AND Revision=@revision AND State='ACTIVE' AND HeaderProof=@head AND LineProof=@before)
   OR EXISTS(SELECT 1 FROM dbo.WFRedemtionDT WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID=@native
    AND(PostInv<>'N' OR SOInvID IS NOT NULL OR RemaQty<>GoodQty))
  BEGIN RAISERROR('BRIDGE_SOURCE_CHANGED_OR_INVOICED',16,1);RETURN;END;
 END;
 EXEC wf.sp_CouponBridgeScope @scope OUTPUT,@cust;
 INSERT wf.CouponBridgePermit(PermitId,RequestId,Operation,NativeId,DocuNo,CustId,State,ExpiresAtUtc,Marker,
  BeforeHeader,BeforeLines,ExpectedRevision,DocuDate,Receiver,Plate,RecorderEmpId,UserId,ActorId,PrimaryUserId,PrimaryActorId,ScopeProof,Reason)
 VALUES(@permit,@request,@operation,@native,@number,@cust,'APPROVED',DATEADD(minute,15,GETUTCDATE()),N'WF_116_BRIDGE_'+@permit,
  @head,@before,@revision,@date,@receiver,@plate,@emp,@user,@actor,@primary,@primaryActor,@scope,@reason);
 INSERT wf.CouponBridgeLine(PermitId,CouponId,[LineNo],BeforeQty,AfterQty,NativeBefore,SourceProof)
  SELECT @permit,n.value('@couponId','int'),n.value('@lineNo','int'),n.value('@before','decimal(18,4)'),
   n.value('@after','decimal(18,4)'),n.value('@nativeBefore','decimal(18,4)'),'' FROM @lines.nodes('/lines/line')t(n);
 IF NOT EXISTS(SELECT 1 FROM wf.CouponBridgeLine WHERE PermitId=@permit)
  OR EXISTS(SELECT 1 FROM wf.CouponBridgeLine WHERE PermitId=@permit AND
    (NativeBefore+BeforeQty<AfterQty OR(@operation='C' AND BeforeQty<>0) OR(@operation='D' AND AfterQty<>0)))
 BEGIN RAISERROR('BRIDGE_LINES_INVALID',16,1);RETURN;END;
 IF @operation='C' AND((SELECT COUNT(*) FROM @requestPlan.nodes('/plan/line')t(n))<>(SELECT COUNT(*) FROM wf.CouponBridgeLine WHERE PermitId=@permit)
  OR EXISTS(SELECT 1 FROM @requestPlan.nodes('/plan/line')t(n) WHERE NOT EXISTS(SELECT 1 FROM wf.CouponBridgeLine l WHERE l.PermitId=@permit
   AND l.CouponId=n.value('@couponId','int') AND l.AfterQty=n.value('@quantity','decimal(18,4)')
   AND l.NativeBefore=n.value('@beforeRemaining','decimal(18,4)'))))
 BEGIN RAISERROR('BRIDGE_APPROVED_LINES_CHANGED',16,1);RETURN;END;
 DECLARE @coupon int,@proof nvarchar(max);
 DECLARE sources CURSOR LOCAL FAST_FORWARD FOR SELECT CouponId FROM wf.CouponBridgeLine WHERE PermitId=@permit ORDER BY CouponId;
 OPEN sources;FETCH NEXT FROM sources INTO @coupon;
 WHILE @@FETCH_STATUS=0 BEGIN
  EXEC wf.sp_CouponBridgeSource @coupon,@cust,@proof OUTPUT;
  IF NULLIF(@proof,'') IS NULL OR NOT EXISTS(SELECT 1 FROM dbo.WFCoupon WITH(UPDLOCK,HOLDLOCK)
    WHERE CouponID=@coupon AND RemaQty=(SELECT NativeBefore FROM wf.CouponBridgeLine WHERE PermitId=@permit AND CouponId=@coupon))
   BEGIN RAISERROR('BRIDGE_COUPON_CHANGED',16,1);RETURN;END;
  UPDATE wf.CouponBridgeLine SET SourceProof=@proof WHERE PermitId=@permit AND CouponId=@coupon;
  FETCH NEXT FROM sources INTO @coupon;
 END;
 CLOSE sources;DEALLOCATE sources;
 INSERT wf.CouponBridgeAllocation(PermitId,CouponId,ReservationId,SettlementId,DeltaQty,BeforeConsumed,BeforeRevision)
 SELECT @permit,n.value('@couponId','int'),n.value('@reservationId','bigint'),NULLIF(n.value('@settlementId','bigint'),0),
  n.value('@delta','decimal(12,4)'),n.value('@beforeConsumed','decimal(12,4)'),n.value('@revision','int') FROM @allocations.nodes('/allocations/allocation')t(n);
 IF @operation='C' AND((SELECT COUNT(*) FROM @requestPlan.nodes('/plan/line/settlement')t(n))<>
    (SELECT COUNT(*) FROM wf.CouponBridgeAllocation WHERE PermitId=@permit)
  OR EXISTS(SELECT 1 FROM @requestPlan.nodes('/plan/line/settlement')t(n) WHERE NOT EXISTS(SELECT 1 FROM wf.CouponBridgeAllocation a
   WHERE a.PermitId=@permit AND a.CouponId=n.value('(../@couponId)[1]','int') AND a.ReservationId=n.value('@reservationId','bigint')
    AND a.DeltaQty=n.value('@quantity','decimal(12,4)') AND a.BeforeConsumed=n.value('@beforeConsumed','decimal(12,4)')
    AND a.BeforeRevision=n.value('@revision','int'))))
 BEGIN RAISERROR('BRIDGE_APPROVED_ALLOCATIONS_CHANGED',16,1);RETURN;END;
 IF EXISTS(SELECT 1 FROM wf.CouponBridgeAllocation a LEFT JOIN wf.CouponReservation r WITH(UPDLOCK,HOLDLOCK) ON r.Id=a.ReservationId
   LEFT JOIN wf.CouponBridgeLine l ON l.PermitId=a.PermitId AND l.CouponId=a.CouponId
   WHERE a.PermitId=@permit AND(l.CouponId IS NULL OR r.Id IS NULL OR r.CouponId<>a.CouponId OR ISNULL(r.ConsumedQty,0)<>a.BeforeConsumed
    OR r.Revision<>a.BeforeRevision OR r.Status NOT IN('RESERVED','CONSUMED')
    OR r.BeneficiaryCustId<>CONVERT(varchar(50),@cust)))
  OR EXISTS(SELECT ReservationId FROM wf.CouponBridgeAllocation WHERE PermitId=@permit GROUP BY ReservationId
   HAVING MIN(BeforeConsumed)<>MAX(BeforeConsumed) OR MIN(BeforeRevision)<>MAX(BeforeRevision)
    OR MIN(BeforeConsumed)+SUM(DeltaQty)<0)
 BEGIN RAISERROR('BRIDGE_RESERVATION_CHANGED',16,1);RETURN;END;
 IF(@operation<>'C' AND EXISTS(SELECT 1 FROM dbo.WFRedemtionDT d WHERE d.RedemtionID=@native AND
   NOT EXISTS(SELECT 1 FROM wf.CouponBridgeLine l WHERE l.PermitId=@permit AND l.CouponId=d.CouponID AND l.BeforeQty=d.GoodQty)))
  OR EXISTS(SELECT 1 FROM wf.CouponBridgeLine l WHERE l.PermitId=@permit AND l.BeforeQty>0 AND
   NOT EXISTS(SELECT 1 FROM dbo.WFRedemtionDT d WHERE d.RedemtionID=@native AND d.CouponID=l.CouponId AND d.GoodQty=l.BeforeQty))
  OR EXISTS(SELECT [LineNo] FROM wf.CouponBridgeLine WHERE PermitId=@permit AND AfterQty>0 GROUP BY [LineNo] HAVING COUNT(*)<>1)
 BEGIN RAISERROR('BRIDGE_BEFORE_LINES_CHANGED',16,1);RETURN;END;
 IF EXISTS(SELECT 1 FROM wf.CouponBridgeLine l
   OUTER APPLY(SELECT ISNULL(SUM(s.SettledQty),0) Qty FROM wf.CouponBridgeEffectiveSettlement s
    WHERE s.NativeRedemptionId=@native AND s.CouponId=l.CouponId) old
   OUTER APPLY(SELECT ISNULL(SUM(DeltaQty),0) Delta,ISNULL(SUM(CASE WHEN DeltaQty>0 THEN DeltaQty ELSE 0 END),0) Added,
    ISNULL(SUM(CASE WHEN DeltaQty<0 THEN -DeltaQty ELSE 0 END),0) Returned
    FROM wf.CouponBridgeAllocation a WHERE a.PermitId=@permit AND a.CouponId=l.CouponId)x
   WHERE l.PermitId=@permit AND(old.Qty+x.Delta<0 OR old.Qty+x.Delta>l.AfterQty
     OR x.Added>CASE WHEN l.AfterQty>l.BeforeQty THEN l.AfterQty-l.BeforeQty ELSE 0 END
     OR x.Returned>CASE WHEN l.BeforeQty>l.AfterQty THEN l.BeforeQty-l.AfterQty ELSE 0 END))
 BEGIN RAISERROR('BRIDGE_ALLOCATION_QUANTITY_INVALID',16,1);RETURN;END;
 INSERT wf.ChangeEvent(EntityType,EntityId,Action,ReasonCode,ReasonText,UserId,ActorUserId,AfterJson)
 VALUES('COUPON_BRIDGE',@permit,'AUTHORIZE','NATIVE_116_BRIDGE',@reason,CONVERT(varchar(20),@user),CONVERT(varchar(20),@actor),
  N'{"operation":"'+@operation+N'","primaryUserId":'+CONVERT(nvarchar(20),@primary)+N',"primaryActorId":'+CONVERT(nvarchar(20),@primaryActor)+N'}');
END;
GO
IF OBJECT_ID('wf.sp_CouponBridgeRegister','P') IS NULL EXEC('CREATE PROCEDURE wf.sp_CouponBridgeRegister AS RETURN');
GO
ALTER PROCEDURE wf.sp_CouponBridgeRegister @request varchar(36),@native int AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS(SELECT 1 FROM wf.CouponBridgeContract WHERE Version='116-BRIDGE-v1' AND Enabled=1) RETURN;
 IF @@TRANCOUNT<1 OR NOT EXISTS(SELECT 1 FROM wf.NativeDocumentReceipt WHERE RequestId=@request AND NativeId=@native AND DocuType=116)
  OR EXISTS(SELECT 1 FROM wf.CouponBridgeDocument WITH(UPDLOCK,HOLDLOCK) WHERE NativeId=@native)
 BEGIN RAISERROR('BRIDGE_REGISTER_INVALID',16,1);RETURN;END;
 DECLARE @h nvarchar(max),@l nvarchar(max);
 EXEC wf.sp_CouponBridgePhysical @native,@h OUTPUT,@l OUTPUT;
 INSERT wf.CouponBridgeDocument(NativeId,DocuNo,CustId,Origin,RequestId,State,HeaderProof,LineProof,ObservedById,ActorId)
 SELECT NativeId,NativeNo,SourceId,'APP',RequestId,'ACTIVE',@h,@l,UserId,ActorUserId FROM wf.NativeDocumentReceipt WHERE RequestId=@request;
 INSERT wf.CouponBridgeDocumentLine(NativeId,CouponId,[LineNo],Quantity)
 SELECT @native,CouponID,Listno,GoodQty FROM dbo.WFRedemtionDT WHERE RedemtionID=@native;
END;
GO
DENY EXECUTE ON OBJECT::wf.sp_CouponBridgeRegister TO public;
GO
IF OBJECT_ID('wf.sp_CouponBridgeFinish','P') IS NULL EXEC('CREATE PROCEDURE wf.sp_CouponBridgeFinish AS RETURN');
GO
ALTER PROCEDURE wf.sp_CouponBridgeFinish @permit varchar(36) AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @id int,@op char(1),@cust int,@number varchar(25),@date date,@receiver nvarchar(100),@plate nvarchar(25),@emp int,
  @u int,@a int,@primary int,@primaryActor int,@scope nvarchar(max),@actualScope nvarchar(max),@marker nvarchar(255),@tx bigint,@began datetime,
  @origin bigint,@originStart datetime,@expiry datetime2,@h nvarchar(max),@l nvarchar(max),@revision int,@recovery bit;
 SELECT @id=NativeId,@op=Operation,@cust=CustId,@number=DocuNo,@date=DocuDate,@receiver=Receiver,@plate=Plate,@emp=RecorderEmpId,
  @u=UserId,@a=ActorId,@primary=PrimaryUserId,@primaryActor=PrimaryActorId,@scope=ScopeProof,@marker=Marker,
  @origin=OriginTransactionId,@originStart=OriginStartedAt,@expiry=ExpiresAtUtc,@revision=ExpectedRevision
 FROM wf.CouponBridgePermit WITH(UPDLOCK,HOLDLOCK) WHERE PermitId=@permit AND State='STARTED' AND ReleasedAtUtc IS NULL;
 SET @recovery=CASE WHEN EXISTS(SELECT 1 FROM wf.CouponBridgeSession WHERE PermitId=@permit AND SessionId=@@SPID) THEN 1 ELSE 0 END;
 IF @recovery=1 SELECT @u=UserId,@a=ActorId,@primary=PrimaryUserId,@primaryActor=PrimaryActorId
  FROM wf.CouponBridgeSession WHERE PermitId=@permit AND SessionId=@@SPID;
 IF @recovery=0 SELECT @tx=c.transaction_id,@began=a.transaction_begin_time
  FROM sys.dm_tran_current_transaction c JOIN sys.dm_tran_active_transactions a ON a.transaction_id=c.transaction_id;
 IF @@TRANCOUNT<1 OR @id IS NULL OR ISNULL(APPLOCK_MODE('public',@marker,'Transaction'),'NoLock')<>'Exclusive'
  OR(@recovery=0 AND(@tx IS NULL OR @began IS NULL OR @tx<>@origin OR @began<>@originStart OR @expiry<=GETUTCDATE()))
 BEGIN RAISERROR('BRIDGE_TRANSACTION_PROOF_REQUIRED',16,1);RETURN;END;
 EXEC wf.sp_CouponBridgeScope @actualScope OUTPUT,@cust;
 IF(@recovery=0 AND @scope<>@actualScope)
  OR wf.fn_UserHasPermission(@u,CASE WHEN @op='C' AND @recovery=0 THEN 'coupon.manual116' ELSE 'coupon.settle' END)<>1
  OR wf.fn_UserHasPermission(@a,CASE WHEN @op='C' AND @recovery=0 THEN 'coupon.manual116' ELSE 'coupon.settle' END)<>1
 BEGIN RAISERROR('BRIDGE_PERMISSION_CHANGED',16,1);RETURN;END;
 IF NOT EXISTS(SELECT 1 FROM wf.AppUser WHERE Id=@u AND IsActive=1 AND MustChangePassword=0)
  OR NOT EXISTS(SELECT 1 FROM wf.AppUser WHERE Id=@a AND IsActive=1 AND MustChangePassword=0)
  OR NOT EXISTS(SELECT 1 FROM dbo.EMEmp WHERE EmpID=@emp AND EmpStatus='1')
 BEGIN RAISERROR('BRIDGE_ACTOR_UNAVAILABLE',16,1);RETURN;END;
 IF @op='D'
 BEGIN
  IF EXISTS(SELECT 1 FROM dbo.WFRedemtionHD WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID=@id)
   OR EXISTS(SELECT 1 FROM dbo.WFRedemtionDT WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID=@id)
  BEGIN RAISERROR('BRIDGE_CANCEL_NOT_COMPLETE',16,1);RETURN;END;
 END
 ELSE
 BEGIN
  IF NOT EXISTS(SELECT 1 FROM dbo.WFRedemtionHD WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID=@id AND DocuType=116 AND DocuStatus='N'
    AND DocuNo=@number AND CONVERT(date,DocuDate)=@date AND IssueName=@receiver AND CarLicense=@plate AND SaveEmpID=@emp
    AND IsCheckAll='Y' AND SumGoodQty=(SELECT SUM(AfterQty) FROM wf.CouponBridgeLine WHERE PermitId=@permit))
   OR(SELECT COUNT(*) FROM dbo.WFRedemtionDT WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID=@id)<>
     (SELECT COUNT(*) FROM wf.CouponBridgeLine WHERE PermitId=@permit AND AfterQty>0)
   OR EXISTS(SELECT 1 FROM wf.CouponBridgeLine x LEFT JOIN dbo.WFRedemtionDT d WITH(UPDLOCK,HOLDLOCK)
    ON d.RedemtionID=@id AND d.CouponID=x.CouponId
    LEFT JOIN dbo.WFCoupon c WITH(UPDLOCK,HOLDLOCK) ON c.CouponID=x.CouponId
    WHERE x.PermitId=@permit AND x.AfterQty>0 AND(d.CouponID IS NULL OR d.GoodQty<>x.AfterQty OR d.Listno<>x.[LineNo] OR d.IsCheck<>'Y'
     OR d.PostInv<>'N' OR d.SOInvID IS NOT NULL OR d.RemaQty<>d.GoodQty OR c.CouponNo<>d.CouponNo OR c.GoodID<>d.GoodID
     OR c.InveID<>d.InveID OR ISNULL(c.LocaID,0)<>ISNULL(d.LocaID,0) OR c.GoodUnitID<>d.GoodUnitID OR c.GoodPrice<>d.GoodPrice))
  BEGIN RAISERROR('BRIDGE_NATIVE_DOCUMENT_INCOMPLETE',16,1);RETURN;END;
 END;
 IF EXISTS(SELECT 1 FROM wf.CouponBridgeLine l LEFT JOIN dbo.WFCoupon c WITH(UPDLOCK,HOLDLOCK) ON c.CouponID=l.CouponId
   WHERE l.PermitId=@permit AND(c.CouponID IS NULL OR c.RemaQty<>l.NativeBefore+l.BeforeQty-l.AfterQty))
 BEGIN RAISERROR('BRIDGE_NATIVE_BALANCE_INCOMPLETE',16,1);RETURN;END;
 DECLARE @coupon int,@expected nvarchar(max),@source nvarchar(max);
 DECLARE source_check CURSOR LOCAL FAST_FORWARD FOR SELECT CouponId,SourceProof FROM wf.CouponBridgeLine WHERE PermitId=@permit ORDER BY CouponId;
 OPEN source_check;FETCH NEXT FROM source_check INTO @coupon,@expected;
 WHILE @@FETCH_STATUS=0 BEGIN
  EXEC wf.sp_CouponBridgeSource @coupon,@cust,@source OUTPUT;
  IF NULLIF(@source,'') IS NULL OR @source<>@expected BEGIN RAISERROR('BRIDGE_COUPON_SOURCE_CHANGED',16,1);RETURN;END;
  IF NOT EXISTS(SELECT 1 FROM dbo.WFCoupon c JOIN dbo.SOHD h ON h.SOID=c.DocuID AND h.DocuType=104
   WHERE c.CouponID=@coupon AND c.DocuType=104 AND h.DocuStatus<>'C' AND h.DocuDate<=@date
    AND(h.CustID=@cust OR EXISTS(SELECT 1 FROM wf.CouponBeneficiary b WITH(HOLDLOCK)
     WHERE b.OwnerCustId=CONVERT(varchar(50),h.CustID) AND b.BeneficiaryCustId=CONVERT(varchar(50),@cust)
      AND b.Status='ACTIVE' AND(b.Scope='ALL' OR b.Scope=CONVERT(varchar(50),c.GoodID))
      AND(b.EffectiveFrom IS NULL OR b.EffectiveFrom<=@date) AND(b.EffectiveTo IS NULL OR b.EffectiveTo>=@date)
      AND(b.EffectiveFrom IS NULL OR b.EffectiveFrom<=CONVERT(date,DATEADD(hour,7,GETUTCDATE())))
      AND(b.EffectiveTo IS NULL OR b.EffectiveTo>=CONVERT(date,DATEADD(hour,7,GETUTCDATE()))))))
   BEGIN RAISERROR('BRIDGE_BENEFICIARY_CHANGED',16,1);RETURN;END;
  FETCH NEXT FROM source_check INTO @coupon,@expected;
 END;CLOSE source_check;DEALLOCATE source_check;
 IF EXISTS(SELECT 1 FROM wf.CouponBridgeAllocation a LEFT JOIN wf.CouponReservation r WITH(UPDLOCK,HOLDLOCK) ON r.Id=a.ReservationId
  WHERE a.PermitId=@permit AND(r.Id IS NULL OR r.CouponId<>a.CouponId OR ISNULL(r.ConsumedQty,0)<>a.BeforeConsumed
    OR r.Revision<>a.BeforeRevision OR r.Status NOT IN('RESERVED','CONSUMED')
    OR(a.DeltaQty>0 AND(r.Status<>'RESERVED' OR(@recovery=0 AND r.ExpiresAt IS NOT NULL AND r.ExpiresAt<@expiry)))))
  OR EXISTS(SELECT 1 FROM wf.CouponBridgeAllocation a JOIN wf.CouponReservation r ON r.Id=a.ReservationId WHERE a.PermitId=@permit
    GROUP BY a.ReservationId,r.ConsumedQty,r.ReservedQty HAVING r.ConsumedQty+SUM(a.DeltaQty)<0 OR r.ConsumedQty+SUM(a.DeltaQty)>r.ReservedQty)
  OR EXISTS(SELECT 1 FROM wf.CouponBridgeAllocation a LEFT JOIN wf.CouponBridgeEffectiveSettlement s WITH(HOLDLOCK) ON s.Id=a.SettlementId
    WHERE a.PermitId=@permit AND a.DeltaQty<0 AND(s.Id IS NULL OR s.NativeRedemptionId<>@id OR s.ReservationId<>a.ReservationId
      OR s.CouponId<>a.CouponId OR s.SettledQty< -a.DeltaQty))
 BEGIN RAISERROR('BRIDGE_SETTLEMENT_CHANGED',16,1);RETURN;END;
 IF EXISTS(SELECT a.SettlementId FROM wf.CouponBridgeAllocation a JOIN wf.CouponBridgeEffectiveSettlement s ON s.Id=a.SettlementId
  WHERE a.PermitId=@permit AND a.DeltaQty<0 GROUP BY a.SettlementId,s.SettledQty HAVING SUM(-a.DeltaQty)>s.SettledQty)
 BEGIN RAISERROR('BRIDGE_RETURN_EXCEEDS_SETTLEMENT',16,1);RETURN;END;
 DECLARE @audit bigint;
 INSERT wf.ChangeEvent(EntityType,EntityId,Action,ReasonCode,UserId,ActorUserId,AfterJson)
 VALUES('COUPON_BRIDGE',@permit,'COMPLETE','NATIVE_116_ATOMIC',CONVERT(varchar(20),@u),CONVERT(varchar(20),@a),
  N'{"nativeId":'+CONVERT(nvarchar(20),@id)+N',"operation":"'+@op+N'","primaryUserId":'+CONVERT(nvarchar(20),@primary)+N',"primaryActorId":'+CONVERT(nvarchar(20),@primaryActor)+N'}');
 SET @audit=SCOPE_IDENTITY();
 INSERT wf.ChangeEvent(EntityType,EntityId,Action,ReasonCode,ReasonText,UserId,ActorUserId,AfterJson)
  SELECT 'COUPON',CONVERT(varchar(50),b.CouponId),'EXPIRED_USE_WARNING','WARN_AND_ALLOW',
   N'Native 116 bridge; expired ticket allowed under owner policy',CONVERT(varchar(20),@u),CONVERT(varchar(20),@a),
   N'{"permit":"'+@permit+N'","expiryDate":"'+CONVERT(nvarchar(10),ISNULL(o.ExpiryDate,e.ExpiryDate),120)+N'"}'
  FROM wf.CouponBridgeLine b LEFT JOIN wf.ControlTicketOverlay o ON o.DocuId=b.CouponId
   LEFT JOIN wf.CouponExpiry e ON e.CouponId=b.CouponId
  WHERE b.PermitId=@permit AND b.AfterQty>b.BeforeQty
   AND ISNULL(o.ExpiryDate,e.ExpiryDate)<CONVERT(date,DATEADD(hour,7,GETUTCDATE()));
 INSERT wf.CouponBridgeReturn(PermitId,SettlementId,Quantity,AuditId)
  SELECT @permit,SettlementId,-SUM(DeltaQty),@audit FROM wf.CouponBridgeAllocation WHERE PermitId=@permit AND DeltaQty<0 GROUP BY SettlementId;
 INSERT wf.CouponReservationSettlement(ReservationId,CouponId,NativeRedemptionId,NativeDocuNo,SettledQty,SettledBy,Note)
  SELECT ReservationId,CouponId,@id,@number,DeltaQty,@u,N'116-BRIDGE-v1; permit='+@permit
   FROM wf.CouponBridgeAllocation WHERE PermitId=@permit AND DeltaQty>0;
 UPDATE r SET ConsumedQty=r.ConsumedQty+x.Delta,
  Status=CASE WHEN r.ConsumedQty+x.Delta=r.ReservedQty THEN 'CONSUMED' ELSE 'RESERVED' END,Revision=r.Revision+1,UpdatedAt=GETUTCDATE()
  FROM wf.CouponReservation r JOIN(SELECT ReservationId,SUM(DeltaQty) Delta FROM wf.CouponBridgeAllocation WHERE PermitId=@permit GROUP BY ReservationId)x ON x.ReservationId=r.Id;
 INSERT wf.ChangeEvent(EntityType,EntityId,Action,ReasonCode,UserId,ActorUserId,AfterJson)
  SELECT 'COUPON_RESERVATION',CONVERT(varchar(50),ReservationId),'BRIDGE_SETTLE','NATIVE_116_ATOMIC',
   CONVERT(varchar(20),@u),CONVERT(varchar(20),@a),N'{"permit":"'+@permit+N'","delta":'+CONVERT(nvarchar(40),SUM(DeltaQty))+N'}'
  FROM wf.CouponBridgeAllocation WHERE PermitId=@permit GROUP BY ReservationId;
 EXEC wf.sp_CouponBridgePhysical @id,@h OUTPUT,@l OUTPUT;
 IF @op='C'
 BEGIN
  INSERT wf.CouponBridgeDocument(NativeId,DocuNo,CustId,Origin,RequestId,State,HeaderProof,LineProof,ObservedById,ActorId)
   SELECT @id,@number,@cust,'WINSPEED',RequestId,'ACTIVE',@h,@l,@u,@a FROM wf.CouponBridgePermit WHERE PermitId=@permit;
  UPDATE r SET Status='CONSUMED',Revision=Revision+1 FROM wf.NativeDocumentRequest r JOIN wf.CouponBridgePermit p ON p.RequestId=r.RequestId
   WHERE p.PermitId=@permit AND r.Status='APPROVED' AND(@recovery=1 OR r.ExpiresAtUtc>GETUTCDATE())
    AND(wf.fn_UserHasPermission(r.UserId,'coupon.request116')=1 OR wf.fn_UserHasPermission(r.UserId,'coupon.manual116')=1)
    AND(wf.fn_UserHasPermission(r.ActorUserId,'coupon.request116')=1 OR wf.fn_UserHasPermission(r.ActorUserId,'coupon.manual116')=1)
    AND wf.fn_UserHasPermission(r.ApprovedById,'coupon.manual116')=1
    AND wf.fn_UserHasPermission(r.ApproverActorId,'coupon.manual116')=1;
  IF @@ROWCOUNT<>1 BEGIN RAISERROR('BRIDGE_REQUEST_CHANGED',16,1);RETURN;END;
 END
 ELSE
 BEGIN
  UPDATE wf.CouponBridgeDocument SET State=CASE WHEN @op='D' THEN 'CANCELLED' ELSE 'ACTIVE' END,
   HeaderProof=@h,LineProof=@l,Revision=Revision+1,ChangedAtUtc=GETUTCDATE()
   WHERE NativeId=@id AND State='ACTIVE' AND Revision=@revision;
  IF @@ROWCOUNT<>1 BEGIN RAISERROR('BRIDGE_DOCUMENT_REVISION_CHANGED',16,1);RETURN;END;
 END;
 DELETE wf.CouponBridgeDocumentLine WHERE NativeId=@id;
 INSERT wf.CouponBridgeDocumentLine(NativeId,CouponId,[LineNo],Quantity)
  SELECT @id,CouponID,Listno,GoodQty FROM dbo.WFRedemtionDT WHERE RedemtionID=@id;
 UPDATE wf.CouponBridgePermit SET State='COMPLETE',CompletedAtUtc=GETUTCDATE(),
  ReleasedAtUtc=CASE WHEN @op='C' THEN GETUTCDATE() ELSE NULL END WHERE PermitId=@permit AND State='STARTED';
 IF @@ROWCOUNT<>1 BEGIN RAISERROR('BRIDGE_PERMIT_CHANGED',16,1);RETURN;END;
 INSERT wf.SalesOrderAudit(SoId,UserId,ActorUserId,Action,Note)
  SELECT DISTINCT CONVERT(varchar(50),COALESCE(NULLIF(d.RefSOID,0),c.DocuID)),@u,@a,'NATIVE_116_BRIDGE',
   N'permit='+@permit+N';operation='+@op+N';primary='+CONVERT(nvarchar(20),@primary)+N';actorPrimary='+CONVERT(nvarchar(20),@primaryActor)
  FROM wf.CouponBridgeLine l JOIN dbo.WFCoupon c ON c.CouponID=l.CouponId
   JOIN dbo.SODT d ON d.SOID=c.DocuID AND d.ListNo=c.RefListno AND d.DocuType=104 WHERE l.PermitId=@permit;
END;
GO
DENY EXECUTE ON OBJECT::wf.sp_CouponBridgeFinish TO public;
GO
IF OBJECT_ID('wf.sp_CouponBridgeObserve','P') IS NULL EXEC('CREATE PROCEDURE wf.sp_CouponBridgeObserve AS RETURN');
GO
ALTER PROCEDURE wf.sp_CouponBridgeObserve @entity char(1),@native int,@before xml,@after xml AS
BEGIN
 SET NOCOUNT ON;
 SET @before=ISNULL(@before,CONVERT(xml,N''));SET @after=ISNULL(@after,CONVERT(xml,N''));
 -- Only the reviewed wf recovery writer can insert this private session row.
 -- Its final proof and balance check run before it deletes the row and commits.
 IF EXISTS(SELECT 1 FROM wf.CouponBridgeSession s JOIN wf.CouponBridgePermit p ON p.PermitId=s.PermitId
   WHERE s.SessionId=@@SPID AND APPLOCK_MODE('public',p.Marker,'Transaction')='Exclusive') RETURN;
 DECLARE @permit varchar(36),@op char(1),@state varchar(12),@number varchar(25),@id int,@marker nvarchar(255),
  @tx bigint,@began datetime,@origin bigint,@originStart datetime,@lock int,@expiry datetime2,
  @h nvarchar(max),@l nvarchar(max),@oldH nvarchar(max),@oldL nvarchar(max),@scope nvarchar(max),@actual nvarchar(max);
 DECLARE @changes TABLE(CouponId int PRIMARY KEY,BeforeBalance decimal(18,4),AfterBalance decimal(18,4));
 IF @entity='B'
 BEGIN
  INSERT @changes SELECT n.value('@couponId','int'),n.value('@before','decimal(18,4)'),n.value('@after','decimal(18,4)')
   FROM @after.nodes('/changes/row')t(n);
  IF NOT EXISTS(SELECT 1 FROM @changes) RETURN;
  -- A completed cut cannot debit again in the very same native transaction.
  IF EXISTS(SELECT 1 FROM @changes c JOIN wf.CouponBridgeLine l ON l.CouponId=c.CouponId
   JOIN wf.CouponBridgePermit p ON p.PermitId=l.PermitId AND p.State='COMPLETE'
   WHERE c.AfterBalance<c.BeforeBalance AND ISNULL(APPLOCK_MODE('public',p.Marker,'Transaction'),'NoLock')='Exclusive'
    AND NOT EXISTS(SELECT 1 FROM wf.CouponBridgeLine nl JOIN wf.CouponBridgePermit np ON np.PermitId=nl.PermitId
      WHERE nl.CouponId=c.CouponId AND np.State='STARTED' AND np.ReleasedAtUtc IS NULL
       AND APPLOCK_MODE('public',np.Marker,'Transaction')='Exclusive'))
  BEGIN RAISERROR('BRIDGE_DUPLICATE_NATIVE_DEBIT',16,1);RETURN;END;
  DECLARE @candidates TABLE(Id varchar(36) PRIMARY KEY);
  INSERT @candidates SELECT DISTINCT p.PermitId FROM wf.CouponBridgePermit p WITH(UPDLOCK,HOLDLOCK)
   JOIN wf.CouponBridgeLine l ON l.PermitId=p.PermitId JOIN @changes c ON c.CouponId=l.CouponId
   WHERE p.ReleasedAtUtc IS NULL AND((p.State='APPROVED' AND p.Operation IN('E','D') AND c.AfterBalance>c.BeforeBalance)
     OR(p.State='STARTED' AND c.AfterBalance<c.BeforeBalance));
  IF(SELECT COUNT(*) FROM @candidates)>1 BEGIN RAISERROR('BRIDGE_NATIVE_OPERATION_AMBIGUOUS',16,1);RETURN;END;
  SELECT @permit=Id FROM @candidates;
 END
 ELSE
 BEGIN
  SELECT @number=DocuNo FROM dbo.WFRedemtionHD WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID=@native;
  SELECT @permit=MIN(PermitId) FROM wf.CouponBridgePermit WITH(UPDLOCK,HOLDLOCK)
   WHERE ReleasedAtUtc IS NULL AND State IN('APPROVED','STARTED') AND(NativeId=@native OR(Operation='C' AND DocuNo=@number));
  IF(SELECT COUNT(*) FROM wf.CouponBridgePermit WHERE ReleasedAtUtc IS NULL AND State IN('APPROVED','STARTED')
    AND(NativeId=@native OR(Operation='C' AND DocuNo=@number)))>1
   BEGIN RAISERROR('BRIDGE_NATIVE_OPERATION_AMBIGUOUS',16,1);RETURN;END;
 END;
 IF @permit IS NULL
 BEGIN
  IF @entity='B' AND EXISTS(SELECT 1 FROM @changes c JOIN wf.CouponBridgeDocumentLine l ON l.CouponId=c.CouponId
   JOIN wf.CouponBridgeDocument d ON d.NativeId=l.NativeId AND d.State='ACTIVE' WHERE c.AfterBalance>c.BeforeBalance)
   BEGIN RAISERROR('BRIDGE_NATIVE_UNWIND_REQUIRES_PERMIT',16,1);RETURN;END;
  IF @entity IN('H','D') AND EXISTS(SELECT 1 FROM wf.CouponBridgeDocument WHERE NativeId=@native)
   AND CONVERT(nvarchar(max),@before)<>CONVERT(nvarchar(max),@after)
  BEGIN RAISERROR('BRIDGE_NATIVE_EDIT_REQUIRES_PERMIT',16,1);RETURN;END;
  RETURN;
 END;
 IF NOT EXISTS(SELECT 1 FROM wf.CouponBridgeContract WHERE Version='116-BRIDGE-v1' AND Enabled=1)
  OR wf.fn_IsNativeDocumentTarget()<>1 BEGIN RAISERROR('BRIDGE_NOT_READY',16,1);RETURN;END;
 SELECT @op=Operation,@state=State,@id=NativeId,@marker=Marker,@origin=OriginTransactionId,@originStart=OriginStartedAt,
  @expiry=ExpiresAtUtc,@oldH=BeforeHeader,@oldL=BeforeLines,@scope=ScopeProof FROM wf.CouponBridgePermit WHERE PermitId=@permit;
 SELECT @tx=c.transaction_id,@began=a.transaction_begin_time
  FROM sys.dm_tran_current_transaction c JOIN sys.dm_tran_active_transactions a ON a.transaction_id=c.transaction_id;
 IF @tx IS NULL OR @began IS NULL OR @expiry<=GETUTCDATE()
 BEGIN RAISERROR('BRIDGE_NATIVE_TRANSACTION_OR_EXPIRY',16,1);RETURN;END;
 IF @state='APPROVED'
 BEGIN
  IF(@op='C' AND(@entity<>'H' OR NULLIF(CONVERT(nvarchar(max),@before),'') IS NOT NULL))
    OR(@op IN('E','D') AND @entity<>'B')
   BEGIN RAISERROR('BRIDGE_NATIVE_UNWIND_REQUIRED',16,1);RETURN;END;
  IF @op IN('E','D')
  BEGIN
   EXEC wf.sp_CouponBridgePhysical @id,@h OUTPUT,@l OUTPUT;
   IF @h<>@oldH OR @l<>@oldL
    OR EXISTS(SELECT 1 FROM dbo.WFRedemtionDT WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID=@id AND(PostInv<>'N' OR SOInvID IS NOT NULL OR RemaQty<>GoodQty))
    OR EXISTS(SELECT 1 FROM wf.CouponBridgeLine l LEFT JOIN @changes c ON c.CouponId=l.CouponId
      WHERE l.PermitId=@permit AND l.BeforeQty>0 AND(c.CouponId IS NULL OR c.BeforeBalance<>l.NativeBefore OR c.AfterBalance<>l.NativeBefore+l.BeforeQty))
    OR EXISTS(SELECT 1 FROM @changes c WHERE NOT EXISTS(SELECT 1 FROM wf.CouponBridgeLine l
      WHERE l.PermitId=@permit AND l.CouponId=c.CouponId AND l.BeforeQty>0))
   BEGIN RAISERROR('BRIDGE_NATIVE_UNWIND_CHANGED',16,1);RETURN;END;
  END
  ELSE SET @id=@native;
  DECLARE @scopeCust int;SELECT @scopeCust=CustId FROM wf.CouponBridgePermit WHERE PermitId=@permit;
  EXEC wf.sp_CouponBridgeScope @actual OUTPUT,@scopeCust;
  IF @actual<>@scope BEGIN RAISERROR('BRIDGE_PERMISSION_CHANGED',16,1);RETURN;END;
  EXEC @lock=sp_getapplock @Resource=@marker,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=0;
  IF @lock<0 BEGIN RAISERROR('BRIDGE_NATIVE_BUSY',16,1);RETURN;END;
  UPDATE wf.CouponBridgePermit SET State='STARTED',NativeId=@id,StartedAtUtc=GETUTCDATE(),
   OriginTransactionId=@tx,OriginStartedAt=@began WHERE PermitId=@permit AND State='APPROVED';
  IF @@ROWCOUNT<>1 BEGIN RAISERROR('BRIDGE_PERMIT_CHANGED',16,1);RETURN;END;
  RETURN;
 END;
 IF @state<>'STARTED' OR @tx<>@origin OR @began<>@originStart OR ISNULL(APPLOCK_MODE('public',@marker,'Transaction'),'NoLock')<>'Exclusive'
 BEGIN RAISERROR('BRIDGE_NATIVE_PENDING_RECOVERY',16,1);RETURN;END;
 IF @entity='B'
 BEGIN
  -- WinSpeed's observed save changes all final coupon balances in one batch.
  -- Refuse a partial batch instead of hoping another statement precedes COMMIT.
  IF EXISTS(SELECT 1 FROM wf.CouponBridgeLine l LEFT JOIN @changes c ON c.CouponId=l.CouponId WHERE l.PermitId=@permit AND l.AfterQty>0
    AND(c.CouponId IS NULL OR c.BeforeBalance<>l.NativeBefore+l.BeforeQty OR c.AfterBalance<>l.NativeBefore+l.BeforeQty-l.AfterQty))
   OR EXISTS(SELECT 1 FROM @changes c WHERE NOT EXISTS(SELECT 1 FROM wf.CouponBridgeLine l WHERE l.PermitId=@permit AND l.CouponId=c.CouponId AND l.AfterQty>0))
  BEGIN RAISERROR('BRIDGE_NATIVE_DEBIT_BATCH_INCOMPLETE',16,1);RETURN;END;
  EXEC wf.sp_CouponBridgeFinish @permit;
 END
 ELSE
 BEGIN
  IF @native<>@id BEGIN RAISERROR('BRIDGE_NATIVE_ID_CHANGED',16,1);RETURN;END;
  IF @op='D' AND NULLIF(CONVERT(nvarchar(max),@after),'') IS NOT NULL
   BEGIN RAISERROR('BRIDGE_NATIVE_CANCEL_WRITE',16,1);RETURN;END;
  IF @op='D' AND NOT EXISTS(SELECT 1 FROM dbo.WFRedemtionHD WHERE RedemtionID=@id)
    AND NOT EXISTS(SELECT 1 FROM dbo.WFRedemtionDT WHERE RedemtionID=@id)
   EXEC wf.sp_CouponBridgeFinish @permit;
 END;
END;
GO
DENY EXECUTE ON OBJECT::wf.sp_CouponBridgeObserve TO public;
GO
IF OBJECT_ID('wf.sp_CouponBridgeFloor','P') IS NULL EXEC('CREATE PROCEDURE wf.sp_CouponBridgeFloor AS RETURN');
GO
ALTER PROCEDURE wf.sp_CouponBridgeFloor @changes xml,@final bit=0 AS
BEGIN
 SET NOCOUNT ON;
 IF @final=0 AND EXISTS(SELECT 1 FROM wf.CouponBridgeSession s JOIN wf.CouponBridgePermit p ON p.PermitId=s.PermitId
  WHERE s.SessionId=@@SPID AND APPLOCK_MODE('public',p.Marker,'Transaction')='Exclusive') RETURN;
 IF EXISTS(SELECT 1 FROM @changes.nodes('/changes/row')t(n)
  JOIN wf.CouponBridgeLine l ON l.CouponId=n.value('@couponId','int')
  JOIN wf.CouponBridgePermit p ON p.PermitId=l.PermitId
  WHERE p.ReleasedAtUtc IS NULL AND p.State IN('STARTED','COMPLETE')
   AND ISNULL(APPLOCK_MODE('public',p.Marker,'Transaction'),'NoLock')<>'Exclusive'
   AND NOT EXISTS(SELECT 1 FROM wf.CouponBridgeSession s WHERE s.PermitId=p.PermitId AND s.SessionId=@@SPID))
 BEGIN RAISERROR('BRIDGE_COUPON_PENDING_REVIEW',16,1);RETURN;END;
 IF EXISTS(SELECT 1 FROM @changes.nodes('/changes/row')t(n)
  OUTER APPLY(SELECT SUM(r.ReservedQty-ISNULL(r.ConsumedQty,0)) Held,
   SUM(CASE WHEN r.ReservedQty<0 OR ISNULL(r.ConsumedQty,0)<0 OR r.ReservedQty<ISNULL(r.ConsumedQty,0) THEN 1 ELSE 0 END) Invalid
   FROM wf.CouponReservation r WITH(UPDLOCK,HOLDLOCK)
   WHERE r.CouponId=n.value('@couponId','int') AND r.Status='RESERVED' AND(r.ExpiresAt IS NULL OR r.ExpiresAt>GETUTCDATE()
    OR wf.fn_CouponBridgeReservationHeld(r.Id)=1
    OR EXISTS(SELECT 1 FROM wf.CouponNativeCutAuthorizationLine al JOIN wf.CouponNativeCutAuthorization a ON a.Id=al.AuthorizationId
      WHERE al.ReservationId=r.Id AND(a.State='ACTIVE' OR EXISTS(SELECT 1 FROM wf.CouponNativeCutEvidence e WHERE e.AuthorizationLineId=al.Id)))))held
  WHERE n.value('@after','decimal(18,4)')<0 OR( (@final=1 OR n.value('@after','decimal(18,4)')<n.value('@before','decimal(18,4)'))
   AND(ISNULL(held.Invalid,0)>0 OR n.value('@after','decimal(18,4)')<ISNULL(held.Held,0))))
 BEGIN RAISERROR('COUPON_RESERVED_BALANCE_BLOCKED',16,1);RETURN;END;
END;
GO
DENY EXECUTE ON OBJECT::wf.sp_CouponBridgeFloor TO public;
GO
IF OBJECT_ID('wf.sp_CouponBridgeAdopt','P') IS NULL EXEC('CREATE PROCEDURE wf.sp_CouponBridgeAdopt AS RETURN');
GO
ALTER PROCEDURE wf.sp_CouponBridgeAdopt @native int,@cust int,@user int,@actor int,@head nvarchar(max),@lines nvarchar(max),@reason nvarchar(500) AS
BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT<1 OR wf.fn_IsNativeDocumentTarget()<>1 OR wf.fn_UserHasPermission(@user,'coupon.settle')<>1
  OR wf.fn_UserHasPermission(@actor,'coupon.settle')<>1 OR LEN(ISNULL(@reason,''))<10
  OR NOT EXISTS(SELECT 1 FROM wf.CouponBridgeContract WHERE Version='116-BRIDGE-v1' AND Enabled=1)
 BEGIN RAISERROR('BRIDGE_ADOPTION_FORBIDDEN',16,1);RETURN;END;
 DECLARE @h nvarchar(max),@l nvarchar(max);
 EXEC wf.sp_CouponBridgePhysical @native,@h OUTPUT,@l OUTPUT;
 IF @h<>@head OR @l<>@lines OR NULLIF(@h,'') IS NULL OR NULLIF(@l,'') IS NULL
  OR NOT EXISTS(SELECT 1 FROM dbo.WFRedemtionHD WHERE RedemtionID=@native AND DocuType=116 AND DocuStatus IN('N','Y')
    AND SumGoodQty=(SELECT SUM(GoodQty) FROM dbo.WFRedemtionDT WHERE RedemtionID=@native))
  OR EXISTS(SELECT CouponID FROM dbo.WFRedemtionDT WHERE RedemtionID=@native GROUP BY CouponID HAVING COUNT(*)<>1)
  OR EXISTS(SELECT 1 FROM dbo.WFRedemtionDT d LEFT JOIN dbo.WFCoupon c ON c.CouponID=d.CouponID
    LEFT JOIN dbo.SOHD s ON s.SOID=c.DocuID AND s.DocuType=104
    WHERE d.RedemtionID=@native AND(c.CouponID IS NULL OR s.SOID IS NULL OR s.DocuStatus='C' OR d.GoodQty<=0
      OR d.GoodQty<>CONVERT(decimal(18,4),d.GoodQty) OR c.GoodID<>d.GoodID OR c.CouponNo<>d.CouponNo
      OR ISNULL((SELECT SUM(SettledQty) FROM wf.CouponBridgeEffectiveSettlement e WHERE e.NativeRedemptionId=@native AND e.CouponId=c.CouponID),0)>d.GoodQty))
 BEGIN RAISERROR('BRIDGE_LEGACY_PROOF_INVALID',16,1);RETURN;END;
 IF EXISTS(SELECT 1 FROM wf.CouponBridgeDocument WITH(UPDLOCK,HOLDLOCK) WHERE NativeId=@native)
 BEGIN
  IF NOT EXISTS(SELECT 1 FROM wf.CouponBridgeDocument WHERE NativeId=@native AND CustId=@cust AND HeaderProof=@h AND LineProof=@l AND State='ACTIVE')
   BEGIN RAISERROR('BRIDGE_LEGACY_PROOF_CHANGED',16,1);RETURN;END;
  RETURN;
 END;
 INSERT wf.CouponBridgeDocument(NativeId,DocuNo,CustId,Origin,State,HeaderProof,LineProof,ObservedById,ActorId)
  SELECT @native,DocuNo,@cust,'LEGACY','ACTIVE',@h,@l,@user,@actor FROM dbo.WFRedemtionHD WHERE RedemtionID=@native;
 INSERT wf.CouponBridgeDocumentLine(NativeId,CouponId,[LineNo],Quantity)
  SELECT @native,CouponID,Listno,GoodQty FROM dbo.WFRedemtionDT WHERE RedemtionID=@native;
 INSERT wf.ChangeEvent(EntityType,EntityId,Action,ReasonCode,ReasonText,UserId,ActorUserId)
 VALUES('COUPON_BRIDGE_DOCUMENT',CONVERT(varchar(20),@native),'ADOPT_CURRENT_PROOF','LEGACY_OBSERVATION',@reason,
  CONVERT(varchar(20),@user),CONVERT(varchar(20),@actor));
 -- Adoption observes current facts. It never backfills guessed consumption,
 -- original operator identity, transport time or Rebate evidence.
END;
GO
IF OBJECT_ID('wf.sp_CouponBridgeRelease','P') IS NULL EXEC('CREATE PROCEDURE wf.sp_CouponBridgeRelease AS RETURN');
GO
ALTER PROCEDURE wf.sp_CouponBridgeRelease @permit varchar(36),@user int,@actor int,@reason nvarchar(500) AS
BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT<1 OR wf.fn_UserHasPermission(@user,'coupon.settle')<>1 OR wf.fn_UserHasPermission(@actor,'coupon.settle')<>1
  OR LEN(ISNULL(@reason,''))<10 BEGIN RAISERROR('BRIDGE_RELEASE_FORBIDDEN',16,1);RETURN;END;
 DECLARE @id int,@state varchar(12),@released datetime2,@h nvarchar(max),@l nvarchar(max);
 SELECT @id=NativeId,@state=State,@released=ReleasedAtUtc FROM wf.CouponBridgePermit WITH(UPDLOCK,HOLDLOCK) WHERE PermitId=@permit;
 IF @id IS NULL OR @state<>'COMPLETE' BEGIN RAISERROR('BRIDGE_RELEASE_NOT_COMPLETE',16,1);RETURN;END;
 IF @released IS NOT NULL RETURN;
 DECLARE @coupon int,@cust int,@expected nvarchar(max),@source nvarchar(max);
 SELECT @cust=CustId FROM wf.CouponBridgePermit WHERE PermitId=@permit;
 DECLARE release_sources CURSOR LOCAL FAST_FORWARD FOR SELECT CouponId,SourceProof FROM wf.CouponBridgeLine WHERE PermitId=@permit ORDER BY CouponId;
 OPEN release_sources;FETCH NEXT FROM release_sources INTO @coupon,@expected;
 WHILE @@FETCH_STATUS=0 BEGIN
  EXEC wf.sp_CouponBridgeSource @coupon,@cust,@source OUTPUT;
  IF NULLIF(@source,'') IS NULL OR @source<>@expected BEGIN RAISERROR('BRIDGE_RELEASE_SOURCE_CHANGED',16,1);RETURN;END;
  FETCH NEXT FROM release_sources INTO @coupon,@expected;
 END;CLOSE release_sources;DEALLOCATE release_sources;
 EXEC wf.sp_CouponBridgePhysical @id,@h OUTPUT,@l OUTPUT;
 IF NOT EXISTS(SELECT 1 FROM wf.CouponBridgeDocument WITH(UPDLOCK,HOLDLOCK) WHERE NativeId=@id AND HeaderProof=@h AND LineProof=@l)
  OR EXISTS(SELECT 1 FROM wf.CouponBridgeLine l LEFT JOIN dbo.WFCoupon c WITH(UPDLOCK,HOLDLOCK) ON c.CouponID=l.CouponId
    WHERE l.PermitId=@permit AND(c.CouponID IS NULL OR c.RemaQty<>l.NativeBefore+l.BeforeQty-l.AfterQty))
  OR EXISTS(SELECT 1 FROM wf.CouponReservation r WITH(UPDLOCK,HOLDLOCK)
    WHERE EXISTS(SELECT 1 FROM wf.CouponBridgeAllocation a WHERE a.PermitId=@permit AND a.ReservationId=r.Id)
    AND(r.ConsumedQty<>(SELECT ISNULL(SUM(s.SettledQty),0) FROM wf.CouponEffectiveSettlement s WHERE s.ReservationId=r.Id)
      -(SELECT ISNULL(SUM(b.Quantity),0) FROM wf.CouponBridgeReturn b JOIN wf.CouponBridgePermit p ON p.PermitId=b.PermitId
         WHERE b.SettlementId IN(SELECT Id FROM wf.CouponReservationSettlement WHERE ReservationId=r.Id)
          AND p.State='COMPLETE' AND(p.ReleasedAtUtc IS NOT NULL OR p.PermitId=@permit))
      OR r.Status<>CASE WHEN r.ConsumedQty=r.ReservedQty THEN 'CONSUMED' ELSE 'RESERVED' END))
 BEGIN RAISERROR('BRIDGE_RELEASE_PROOF_CHANGED',16,1);RETURN;END;
 INSERT wf.ChangeEvent(EntityType,EntityId,Action,ReasonCode,ReasonText,UserId,ActorUserId)
 VALUES('COUPON_BRIDGE',@permit,'RELEASE','NATIVE_116_REVIEWED',@reason,CONVERT(varchar(20),@user),CONVERT(varchar(20),@actor));
 UPDATE wf.CouponBridgePermit SET ReleasedAtUtc=GETUTCDATE() WHERE PermitId=@permit AND ReleasedAtUtc IS NULL;
END;
GO
IF OBJECT_ID('wf.sp_CouponBridgeWithdraw','P') IS NULL EXEC('CREATE PROCEDURE wf.sp_CouponBridgeWithdraw AS RETURN');
GO
ALTER PROCEDURE wf.sp_CouponBridgeWithdraw @permit varchar(36),@user int,@actor int,@reason nvarchar(500) AS
BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT<1 OR wf.fn_UserHasPermission(@user,'coupon.settle')<>1 OR wf.fn_UserHasPermission(@actor,'coupon.settle')<>1
  OR LEN(ISNULL(@reason,''))<10 BEGIN RAISERROR('BRIDGE_WITHDRAW_FORBIDDEN',16,1);RETURN;END;
 DECLARE @id int,@op char(1),@number varchar(25),@h nvarchar(max),@l nvarchar(max),@oldh nvarchar(max),@oldl nvarchar(max);
 SELECT @id=NativeId,@op=Operation,@number=DocuNo,@oldh=BeforeHeader,@oldl=BeforeLines FROM wf.CouponBridgePermit WITH(UPDLOCK,HOLDLOCK)
  WHERE PermitId=@permit AND State='APPROVED' AND StartedAtUtc IS NULL;
 IF @op IS NULL BEGIN RAISERROR('BRIDGE_WITHDRAW_REVIEW_REQUIRED',16,1);RETURN;END;
 IF @op='C' AND EXISTS(SELECT 1 FROM dbo.WFRedemtionHD WITH(UPDLOCK,HOLDLOCK) WHERE DocuNo=@number)
  BEGIN RAISERROR('BRIDGE_WITHDRAW_REVIEW_REQUIRED',16,1);RETURN;END;
 IF @op<>'C' BEGIN
  EXEC wf.sp_CouponBridgePhysical @id,@h OUTPUT,@l OUTPUT;
  IF @h<>@oldh OR @l<>@oldl BEGIN RAISERROR('BRIDGE_WITHDRAW_REVIEW_REQUIRED',16,1);RETURN;END;
 END;
 UPDATE wf.CouponBridgePermit SET State='CANCELLED',ReleasedAtUtc=GETUTCDATE() WHERE PermitId=@permit AND State='APPROVED';
 INSERT wf.ChangeEvent(EntityType,EntityId,Action,ReasonCode,ReasonText,UserId,ActorUserId)
 VALUES('COUPON_BRIDGE',@permit,'WITHDRAW','NATIVE_116_UNSTARTED',@reason,CONVERT(varchar(20),@user),CONVERT(varchar(20),@actor));
END;
GO
IF OBJECT_ID('wf.sp_CouponBridgeResume','P') IS NULL EXEC('CREATE PROCEDURE wf.sp_CouponBridgeResume AS RETURN');
GO
ALTER PROCEDURE wf.sp_CouponBridgeResume
 @permit varchar(36),@user int,@actor int,@primary int,@primaryActor int,@reason nvarchar(500),
 @head nvarchar(max),@lines nvarchar(max) AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET ARITHABORT ON;SET ANSI_WARNINGS ON;
 IF @@TRANCOUNT<1 OR XACT_STATE()<>1 OR wf.fn_IsNativeDocumentTarget()<>1
  OR wf.fn_UserHasPermission(@user,'coupon.settle')<>1 OR wf.fn_UserHasPermission(@actor,'coupon.settle')<>1
  OR LEN(LTRIM(RTRIM(ISNULL(@reason,''))))<10 OR @primary<=0 OR @primaryActor<=0
  OR NOT EXISTS(SELECT 1 FROM wf.CouponBridgeContract WHERE Version='116-BRIDGE-v1' AND Enabled=1)
 BEGIN RAISERROR('BRIDGE_RECOVERY_FORBIDDEN',16,1);RETURN;END;
 DECLARE @id int,@op char(1),@marker nvarchar(255),@h nvarchar(max),@l nvarchar(max),@lock int,
  @number varchar(25),@date date,@receiver nvarchar(100),@plate nvarchar(25),@emp int,@before xml,@changes xml;
 SELECT @id=NativeId,@op=Operation,@marker=Marker,@number=DocuNo,@date=DocuDate,@receiver=Receiver,@plate=Plate,
  @emp=RecorderEmpId,@before=CONVERT(xml,BeforeHeader) FROM wf.CouponBridgePermit WITH(UPDLOCK,HOLDLOCK)
  WHERE PermitId=@permit AND State='STARTED' AND ReleasedAtUtc IS NULL;
 IF @id IS NULL BEGIN RAISERROR('BRIDGE_RECOVERY_NOT_PENDING',16,1);RETURN;END;
 EXEC @lock=sp_getapplock @Resource=@marker,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=5000;
 IF @lock<0 BEGIN RAISERROR('BRIDGE_NATIVE_BUSY',16,1);RETURN;END;
 EXEC wf.sp_CouponBridgePhysical @id,@h OUTPUT,@l OUTPUT;
 IF @h<>@head OR @l<>@lines
  OR EXISTS(SELECT 1 FROM dbo.WFRedemtionDT WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID=@id
    AND(PostInv<>'N' OR SOInvID IS NOT NULL OR RemaQty<>GoodQty))
  OR EXISTS(SELECT 1 FROM dbo.WFRedemtionHD WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID=@id
    AND(DocuType<>116 OR DocuNo<>@number OR DocuStatus NOT IN('N','Y')))
  OR EXISTS(SELECT 1 FROM dbo.WFRedemtionHD WITH(UPDLOCK,HOLDLOCK) WHERE DocuNo=@number AND RedemtionID<>@id)
  OR NOT EXISTS(SELECT 1 FROM dbo.EMEmp WITH(HOLDLOCK) WHERE EmpID=@emp)
 BEGIN RAISERROR('BRIDGE_RECOVERY_PREVIEW_CHANGED',16,1);RETURN;END;
 -- Only a proved, fully unwound save is recoverable automatically. A partly
 -- debited batch, invoice, unknown balance or changed 104 stays in review.
 IF EXISTS(SELECT 1 FROM wf.CouponBridgeLine b LEFT JOIN dbo.WFCoupon c WITH(UPDLOCK,HOLDLOCK) ON c.CouponID=b.CouponId
   WHERE b.PermitId=@permit AND(c.CouponID IS NULL OR c.RemaQty IS NULL OR c.RemaQty<>b.NativeBefore+b.BeforeQty))
 BEGIN RAISERROR('BRIDGE_RECOVERY_BALANCE_UNPROVEN',16,1);RETURN;END;
 INSERT wf.CouponBridgeSession(PermitId,SessionId,UserId,ActorId,PrimaryUserId,PrimaryActorId,Reason)
  VALUES(@permit,@@SPID,@user,@actor,@primary,@primaryActor,@reason);
 INSERT wf.ChangeEvent(EntityType,EntityId,Action,ReasonCode,ReasonText,UserId,ActorUserId,AfterJson)
 VALUES('COUPON_BRIDGE',@permit,'RECOVER','INCOMPLETE_NATIVE_SAVE',@reason,CONVERT(varchar(20),@user),CONVERT(varchar(20),@actor),
  N'{"primaryUserId":'+CONVERT(nvarchar(20),@primary)+N',"primaryActorId":'+CONVERT(nvarchar(20),@primaryActor)+N'}');
 DELETE dbo.WFRedemtionHD WHERE RedemtionID=@id;
 DELETE dbo.WFRedemtionDT WHERE RedemtionID=@id;
 IF @op<>'D'
 BEGIN
  INSERT dbo.WFRedemtionHD(RedemtionID,DocuNo,DocuDate,DocuType,IssueName,CarLicense,SaveEmpID,SumGoodQty,DocuStatus,IsCheckAll,
   CardNo,IssueEmpID,AppvEmpID)
  VALUES(@id,@number,@date,116,@receiver,@plate,@emp,(SELECT SUM(AfterQty) FROM wf.CouponBridgeLine WHERE PermitId=@permit),'N','Y',
   @before.value('(/head/@CardNo)[1]','varchar(50)'),@before.value('(/head/@IssueEmpID)[1]','int'),@before.value('(/head/@AppvEmpID)[1]','int'));
  INSERT dbo.WFRedemtionDT(RedemtionID,Listno,GoodID,InveID,LocaID,GoodUnitID,GoodPrice,CouponID,CouponNo,PostInv,GoodQty,RemaQty,IsCheck)
   SELECT @id,b.[LineNo],c.GoodID,c.InveID,c.LocaID,c.GoodUnitID,c.GoodPrice,c.CouponID,c.CouponNo,'N',b.AfterQty,b.AfterQty,'Y'
   FROM wf.CouponBridgeLine b JOIN dbo.WFCoupon c ON c.CouponID=b.CouponId WHERE b.PermitId=@permit AND b.AfterQty>0;
  UPDATE c SET RemaQty=b.NativeBefore+b.BeforeQty-b.AfterQty FROM dbo.WFCoupon c
   JOIN wf.CouponBridgeLine b ON b.CouponId=c.CouponID WHERE b.PermitId=@permit AND b.AfterQty>0;
 END;
 EXEC wf.sp_CouponBridgeFinish @permit;
 SET @changes=(SELECT b.CouponId AS [@couponId],b.NativeBefore AS [@before],c.RemaQty AS [@after]
  FROM wf.CouponBridgeLine b JOIN dbo.WFCoupon c ON c.CouponID=b.CouponId WHERE b.PermitId=@permit FOR XML PATH('row'),ROOT('changes'),TYPE);
 EXEC wf.sp_CouponBridgeFloor @changes,1;
 DELETE wf.CouponBridgeSession WHERE PermitId=@permit AND SessionId=@@SPID;
END;
GO
IF OBJECT_ID('wf.WF_CouponBridgeReservationFence','TR') IS NULL
 EXEC('CREATE TRIGGER wf.WF_CouponBridgeReservationFence ON wf.CouponReservation AFTER INSERT,UPDATE,DELETE AS RETURN');
GO
ALTER TRIGGER wf.WF_CouponBridgeReservationFence ON wf.CouponReservation AFTER INSERT,UPDATE,DELETE AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS(SELECT 1 FROM wf.CouponBridgeContract WHERE Enabled=1 AND Version='116-BRIDGE-v1') RETURN;
 DECLARE @trusted bit;SET @trusted=0;
 IF EXISTS(SELECT 1 FROM wf.CouponBridgePermit p WHERE p.State='STARTED' AND p.ReleasedAtUtc IS NULL
  AND APPLOCK_MODE('public',p.Marker,'Transaction')='Exclusive' AND(
   EXISTS(SELECT 1 FROM wf.CouponBridgeSession s WHERE s.PermitId=p.PermitId AND s.SessionId=@@SPID)
   OR ISNULL(TRIGGER_NESTLEVEL(OBJECT_ID('dbo.WF_CouponNativeConsume'),'AFTER','DML'),0)>0
   OR ISNULL(TRIGGER_NESTLEVEL(OBJECT_ID('dbo.WF_CouponNativeEditHeadHook'),'AFTER','DML'),0)>0
   OR ISNULL(TRIGGER_NESTLEVEL(OBJECT_ID('dbo.WF_CouponNativeEditDetailHook'),'AFTER','DML'),0)>0)) SET @trusted=1;
 IF @trusted=0 AND(EXISTS(SELECT 1 FROM deleted d WHERE wf.fn_CouponBridgeReservationHeld(d.Id)=1)
  OR EXISTS(SELECT 1 FROM inserted i JOIN wf.CouponBridgeLine l ON l.CouponId=i.CouponId
   JOIN wf.CouponBridgePermit p ON p.PermitId=l.PermitId WHERE p.State IN('STARTED','COMPLETE') AND p.ReleasedAtUtc IS NULL))
 BEGIN
  IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
  RAISERROR('BRIDGE_RESERVATION_HELD',16,1);RETURN;
 END;
END;
GO
IF OBJECT_ID('wf.sp_CouponBridgeAssertDocument','P') IS NULL EXEC('CREATE PROCEDURE wf.sp_CouponBridgeAssertDocument AS RETURN');
GO
ALTER PROCEDURE wf.sp_CouponBridgeAssertDocument @native int AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @h nvarchar(max),@l nvarchar(max);
 EXEC wf.sp_CouponBridgePhysical @native,@h OUTPUT,@l OUTPUT;
 IF EXISTS(SELECT 1 FROM wf.CouponBridgePermit WITH(UPDLOCK,HOLDLOCK) WHERE NativeId=@native AND ReleasedAtUtc IS NULL AND State<>'CANCELLED')
  OR NOT EXISTS(SELECT 1 FROM wf.CouponBridgeDocument WITH(UPDLOCK,HOLDLOCK)
    WHERE NativeId=@native AND State='ACTIVE' AND HeaderProof=@h AND LineProof=@l)
 BEGIN RAISERROR('BRIDGE_CURRENT_DOCUMENT_PROOF_REQUIRED',16,1);RETURN;END;
END;
GO
DENY EXECUTE ON OBJECT::wf.sp_CouponBridgeAssertDocument TO public;
GO
IF OBJECT_ID('wf.WF_CouponBridgeRequestFence','TR') IS NULL
 EXEC('CREATE TRIGGER wf.WF_CouponBridgeRequestFence ON wf.NativeDocumentRequest AFTER UPDATE,DELETE AS RETURN');
GO
ALTER TRIGGER wf.WF_CouponBridgeRequestFence ON wf.NativeDocumentRequest AFTER UPDATE,DELETE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM deleted d JOIN wf.CouponBridgePermit p ON p.RequestId=d.RequestId
  WHERE p.ReleasedAtUtc IS NULL AND p.State IN('APPROVED','STARTED') AND NOT(
   p.State='STARTED' AND APPLOCK_MODE('public',p.Marker,'Transaction')='Exclusive' AND(
    EXISTS(SELECT 1 FROM wf.CouponBridgeSession s WHERE s.PermitId=p.PermitId AND s.SessionId=@@SPID)
    OR ISNULL(TRIGGER_NESTLEVEL(OBJECT_ID('dbo.WF_CouponNativeConsume'),'AFTER','DML'),0)>0)))
 BEGIN
  IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
  RAISERROR('BRIDGE_WITHDRAW_PERMIT_BEFORE_REQUEST_CHANGE',16,1);RETURN;
 END;
END;
GO
