-- @transaction
IF EXISTS(SELECT 1 FROM wf.CouponBridgeProgress)
 OR EXISTS(SELECT 1 FROM wf.CouponBridgeStep) RAISERROR('BRIDGE_NEW_PROTOCOL_HISTORY_PREVENTS_DOWN',16,1);
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
DROP PROCEDURE wf.sp_CouponBridgeTryFinish;
DROP TABLE wf.CouponBridgeStep;
DROP TABLE wf.CouponBridgeProgress;
GO
