-- @transaction
-- Native clients can use statement autocommit. Bind every authorized step to
-- the real SQL connection/login session. Keep incomplete physical saves held;
-- settle quantities and audit atomically with the proved final balance write.
-- Never claim these clients put all earlier header/detail statements in one TX.
IF EXISTS(SELECT 1 FROM wf.CouponBridgePermit WHERE State='STARTED' AND ReleasedAtUtc IS NULL)
 RAISERROR('BRIDGE_FINISH_PENDING_BEFORE_PROTOCOL_UPGRADE',16,1);
GO
IF OBJECT_ID('wf.CouponBridgeNativeSession','U') IS NULL
CREATE TABLE wf.CouponBridgeNativeSession(
 PermitId varchar(36) NOT NULL PRIMARY KEY REFERENCES wf.CouponBridgePermit(PermitId),
 NativeSpid smallint NOT NULL,LoginSid varbinary(85) NOT NULL,LoginTime datetime NOT NULL,ConnectionId uniqueidentifier NOT NULL,
 Mode varchar(12) NOT NULL CHECK(Mode IN('TRANSACTION','SESSION')),OriginTransactionId bigint NOT NULL,OriginStartedAt datetime NOT NULL
);
IF OBJECT_ID('wf.CouponBridgeAppContext','U') IS NULL
CREATE TABLE wf.CouponBridgeAppContext(SessionId smallint NOT NULL PRIMARY KEY,RequestId varchar(36) NOT NULL REFERENCES wf.NativeDocumentRequest(RequestId));
DENY INSERT,UPDATE,DELETE,SELECT ON OBJECT::wf.CouponBridgeNativeSession TO public;
DENY INSERT,UPDATE,DELETE,SELECT ON OBJECT::wf.CouponBridgeAppContext TO public;
GO
IF OBJECT_ID('wf.fn_CouponBridgeNativeOwned','FN') IS NULL EXEC('CREATE FUNCTION wf.fn_CouponBridgeNativeOwned(@permit varchar(36)) RETURNS bit AS BEGIN RETURN 0;END');
GO
ALTER FUNCTION wf.fn_CouponBridgeNativeOwned(@permit varchar(36)) RETURNS bit AS
BEGIN
 -- The procedural early return also avoids evaluating server DMVs for an app
 -- login, including when a closed native connection's SPID has been reused.
 IF NOT EXISTS(SELECT 1 FROM wf.CouponBridgeNativeSession WHERE PermitId=@permit AND NativeSpid=@@SPID
  AND LoginSid=SUSER_SID(ORIGINAL_LOGIN())) RETURN 0;
 DECLARE @connection uniqueidentifier,@login datetime,@mode varchar(12),@tx bigint,@began datetime;
 SELECT @connection=connection_id FROM sys.dm_exec_connections WHERE session_id=@@SPID AND parent_connection_id IS NULL;
 SELECT @login=login_time FROM sys.dm_exec_sessions WHERE session_id=@@SPID;
 SELECT @mode=Mode FROM wf.CouponBridgeNativeSession WHERE PermitId=@permit AND ConnectionId=@connection AND LoginTime=@login;
 IF @mode IS NULL RETURN 0;
 IF @mode='TRANSACTION'
 BEGIN
  SELECT @tx=c.transaction_id,@began=a.transaction_begin_time FROM sys.dm_tran_current_transaction c
   JOIN sys.dm_tran_active_transactions a ON a.transaction_id=c.transaction_id;
  IF NOT EXISTS(SELECT 1 FROM wf.CouponBridgeNativeSession WHERE PermitId=@permit AND OriginTransactionId=@tx AND OriginStartedAt=@began) RETURN 0;
 END;
 RETURN 1;
END;
GO
IF OBJECT_ID('wf.sp_CouponBridgeBindNative','P') IS NULL EXEC('CREATE PROCEDURE wf.sp_CouponBridgeBindNative AS RETURN');
GO
ALTER PROCEDURE wf.sp_CouponBridgeBindNative @permit varchar(36),@tx bigint,@began datetime AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @connection uniqueidentifier,@login datetime,@mode varchar(12);
 SELECT @connection=connection_id FROM sys.dm_exec_connections WHERE session_id=@@SPID AND parent_connection_id IS NULL;
 SELECT @login=login_time FROM sys.dm_exec_sessions WHERE session_id=@@SPID;
 SET @mode=CASE WHEN EXISTS(SELECT 1 FROM sys.dm_tran_session_transactions WHERE session_id=@@SPID AND is_user_transaction=1) THEN 'TRANSACTION' ELSE 'SESSION' END;
 IF @connection IS NULL OR @login IS NULL OR @tx IS NULL OR @began IS NULL
  OR NOT EXISTS(SELECT 1 FROM wf.CouponBridgePermit WITH(UPDLOCK,HOLDLOCK) WHERE PermitId=@permit AND State='APPROVED')
 BEGIN RAISERROR('BRIDGE_NATIVE_CONNECTION_PROOF_REQUIRED',16,1);RETURN;END;
 -- Serialize starts on the coupon rows before admitting another connection.
 DECLARE @coupon int,@balance decimal(18,4);
 DECLARE native_start_locks CURSOR LOCAL FAST_FORWARD FOR SELECT CouponId FROM wf.CouponBridgeLine WHERE PermitId=@permit ORDER BY CouponId;
 OPEN native_start_locks;FETCH NEXT FROM native_start_locks INTO @coupon;
 WHILE @@FETCH_STATUS=0 BEGIN
  SELECT @balance=RemaQty FROM dbo.WFCoupon WITH(UPDLOCK,HOLDLOCK) WHERE CouponID=@coupon;
  IF EXISTS(SELECT 1 FROM wf.CouponBridgeLine b JOIN wf.CouponBridgePermit p WITH(UPDLOCK,HOLDLOCK) ON p.PermitId=b.PermitId
    WHERE b.CouponId=@coupon AND p.PermitId<>@permit AND p.State IN('STARTED','COMPLETE') AND p.ReleasedAtUtc IS NULL)
   BEGIN RAISERROR('BRIDGE_OTHER_NATIVE_SAVE_PENDING',16,1);RETURN;END;
  FETCH NEXT FROM native_start_locks INTO @coupon;
 END;CLOSE native_start_locks;DEALLOCATE native_start_locks;
 INSERT wf.CouponBridgeNativeSession(PermitId,NativeSpid,LoginSid,LoginTime,ConnectionId,Mode,OriginTransactionId,OriginStartedAt)
 VALUES(@permit,@@SPID,SUSER_SID(ORIGINAL_LOGIN()),@login,@connection,@mode,@tx,@began);
END;
GO
DENY EXECUTE ON OBJECT::wf.sp_CouponBridgeBindNative TO public;
GO
-- Native session protocol modules.
IF OBJECT_ID('wf.fn_CouponBridgeRecoveryOwned','FN') IS NULL EXEC('CREATE FUNCTION wf.fn_CouponBridgeRecoveryOwned(@permit varchar(36)) RETURNS bit AS BEGIN RETURN 0;END');
GO
ALTER FUNCTION wf.fn_CouponBridgeRecoveryOwned(@permit varchar(36)) RETURNS bit AS
BEGIN
 IF NOT EXISTS(SELECT 1 FROM wf.CouponBridgeSession WHERE PermitId=@permit AND SessionId=@@SPID) RETURN 0;
 -- Only the wf recovery writer inserts this private row inside its explicit TX.
 -- Finish also checks its transaction-owned marker procedurally.
 IF @@TRANCOUNT>0 RETURN 1;
 RETURN 0;
END;
GO
ALTER PROCEDURE wf.sp_CouponBridgeObserve @entity char(1),@native int,@before xml,@after xml AS
BEGIN
 SET NOCOUNT ON;
 SET @before=ISNULL(@before,CONVERT(xml,N''));SET @after=ISNULL(@after,CONVERT(xml,N''));
 IF NOT EXISTS(SELECT 1 FROM wf.CouponBridgeContract WHERE Version='116-BRIDGE-v1' AND Enabled=1) RETURN;
 IF wf.fn_IsNativeDocumentTarget()<>1 BEGIN RAISERROR('BRIDGE_NOT_READY',16,1);RETURN;END;
 IF EXISTS(SELECT 1 FROM wf.CouponBridgeSession s WHERE s.SessionId=@@SPID AND wf.fn_CouponBridgeRecoveryOwned(s.PermitId)=1) RETURN;
 -- Only the validated, explicit wf writer can create this private context.
 IF EXISTS(SELECT 1 FROM wf.CouponBridgeAppContext x WHERE x.SessionId=@@SPID) RETURN;
 DECLARE @permit varchar(36),@op char(1),@state varchar(12),@number varchar(25),@id int,@marker nvarchar(255),
  @tx bigint,@began datetime,@origin bigint,@originStart datetime,@lock int,@expiry datetime2,@cust int,
  @h nvarchar(max),@l nvarchar(max),@oldH nvarchar(max),@oldL nvarchar(max),@scope nvarchar(max),@actual nvarchar(max),@unwound bit,@mode varchar(12),@start char(1);
 DECLARE @changes TABLE(CouponId int PRIMARY KEY,BeforeBalance decimal(18,4),AfterBalance decimal(18,4));
 IF @entity='B'
 BEGIN
  INSERT @changes SELECT n.value('@couponId','int'),n.value('@before','decimal(18,4)'),n.value('@after','decimal(18,4)') FROM @after.nodes('/changes/row')t(n);
  IF NOT EXISTS(SELECT 1 FROM @changes) RETURN;
  DECLARE @candidates TABLE(Id varchar(36) PRIMARY KEY);
  INSERT @candidates SELECT DISTINCT p.PermitId FROM wf.CouponBridgePermit p WITH(UPDLOCK,HOLDLOCK)
   JOIN wf.CouponBridgeLine b ON b.PermitId=p.PermitId JOIN @changes c ON c.CouponId=b.CouponId
   WHERE p.ReleasedAtUtc IS NULL AND(p.State='STARTED' OR(p.State='APPROVED' AND p.Operation IN('E','D') AND c.AfterBalance>c.BeforeBalance));
  IF(SELECT COUNT(*) FROM @candidates)>1 BEGIN RAISERROR('BRIDGE_NATIVE_OPERATION_AMBIGUOUS',16,1);RETURN;END;
  SELECT @permit=Id FROM @candidates;
  IF @permit IS NULL AND EXISTS(SELECT 1 FROM @changes c JOIN wf.CouponBridgeLine b ON b.CouponId=c.CouponId
    JOIN wf.CouponBridgePermit p ON p.PermitId=b.PermitId WHERE p.State='COMPLETE' AND wf.fn_CouponBridgeNativeOwned(p.PermitId)=1)
   BEGIN RAISERROR('BRIDGE_DUPLICATE_NATIVE_DEBIT',16,1);RETURN;END;
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
  IF @entity='B' AND EXISTS(SELECT 1 FROM @changes)
   BEGIN RAISERROR('BRIDGE_NATIVE_BALANCE_REQUIRES_PERMIT',16,1);RETURN;END;
  IF @entity IN('H','D') AND CONVERT(nvarchar(max),@before)<>CONVERT(nvarchar(max),@after)
   BEGIN RAISERROR('BRIDGE_NATIVE_EDIT_OR_ADOPTION_REQUIRES_PERMIT',16,1);RETURN;END;
  -- Invoice lifecycle-only changes are allowed only after review/release.
  IF EXISTS(SELECT 1 FROM wf.CouponBridgePermit WHERE NativeId=@native AND ReleasedAtUtc IS NULL AND State IN('STARTED','COMPLETE'))
   BEGIN RAISERROR('BRIDGE_COUPON_PENDING_REVIEW',16,1);RETURN;END;
  RETURN;
 END;
 IF NOT EXISTS(SELECT 1 FROM wf.CouponBridgeContract WHERE Version='116-BRIDGE-v1' AND Enabled=1) OR wf.fn_IsNativeDocumentTarget()<>1
  BEGIN RAISERROR('BRIDGE_NOT_READY',16,1);RETURN;END;
 SELECT @op=p.Operation,@state=p.State,@id=p.NativeId,@marker=p.Marker,@origin=p.OriginTransactionId,@originStart=p.OriginStartedAt,
  @expiry=p.ExpiresAtUtc,@oldH=p.BeforeHeader,@oldL=p.BeforeLines,@scope=p.ScopeProof,@cust=p.CustId,@unwound=ISNULL(g.UnwindObserved,0),@mode=g.BalanceMode
  FROM wf.CouponBridgePermit p WITH(UPDLOCK,HOLDLOCK) LEFT JOIN wf.CouponBridgeProgress g WITH(UPDLOCK,HOLDLOCK) ON g.PermitId=p.PermitId WHERE p.PermitId=@permit;
 SELECT @tx=c.transaction_id,@began=a.transaction_begin_time FROM sys.dm_tran_current_transaction c
  JOIN sys.dm_tran_active_transactions a ON a.transaction_id=c.transaction_id;
 IF @tx IS NULL OR @began IS NULL OR @expiry<=GETUTCDATE()
  BEGIN RAISERROR('BRIDGE_NATIVE_TRANSACTION_OR_EXPIRY',16,1);RETURN;END;
 IF @state='APPROVED'
 BEGIN
  SET @start=NULL;SET @unwound=0;
  IF @op='C' AND @entity='H' AND NULLIF(CONVERT(nvarchar(max),@before),'') IS NULL
   BEGIN SET @id=@native;SET @start='C';SET @unwound=1;END;
  IF @op IN('E','D')
  BEGIN
   EXEC wf.sp_CouponBridgePhysical @id,@h OUTPUT,@l OUTPUT;
   IF EXISTS(SELECT 1 FROM dbo.WFRedemtionDT WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID=@id AND(PostInv<>'N' OR SOInvID IS NOT NULL OR RemaQty<>GoodQty))
    BEGIN RAISERROR('BRIDGE_SOURCE_CHANGED_OR_INVOICED',16,1);RETURN;END;
   IF @entity='B' AND @h=@oldH AND @l=@oldL
    AND NOT EXISTS(SELECT 1 FROM wf.CouponBridgeLine b LEFT JOIN @changes c ON c.CouponId=b.CouponId
      WHERE b.PermitId=@permit AND b.BeforeQty>0 AND(c.CouponId IS NULL OR c.BeforeBalance<>b.NativeBefore OR c.AfterBalance<>b.NativeBefore+b.BeforeQty))
    AND NOT EXISTS(SELECT 1 FROM @changes c WHERE NOT EXISTS(SELECT 1 FROM wf.CouponBridgeLine b WHERE b.PermitId=@permit AND b.CouponId=c.CouponId AND b.BeforeQty>0))
    BEGIN SET @start='B';SET @unwound=1;END;
   IF @entity IN('H','D') AND NULLIF(CONVERT(nvarchar(max),@after),'') IS NULL
    AND((@entity='H' AND CONVERT(nvarchar(max),@before)=@oldH AND @h='' AND @l=@oldL)
     OR(@entity='D' AND CONVERT(nvarchar(max),@before)=@oldL AND @h=@oldH AND @l=''))
    AND NOT EXISTS(SELECT 1 FROM wf.CouponBridgeLine b LEFT JOIN dbo.WFCoupon c WITH(UPDLOCK,HOLDLOCK) ON c.CouponID=b.CouponId
     WHERE b.PermitId=@permit AND(c.CouponID IS NULL OR c.RemaQty IS NULL OR c.RemaQty<>b.NativeBefore)) SET @start=@entity;
  END;
  IF @op='C' AND EXISTS(SELECT 1 FROM wf.CouponBridgeLine b LEFT JOIN dbo.WFCoupon c WITH(UPDLOCK,HOLDLOCK) ON c.CouponID=b.CouponId
   WHERE b.PermitId=@permit AND(c.CouponID IS NULL OR c.RemaQty IS NULL OR c.RemaQty<>b.NativeBefore)) SET @start=NULL;
  IF @start IS NULL BEGIN RAISERROR('BRIDGE_NATIVE_START_IMAGE_UNPROVEN',16,1);RETURN;END;
  EXEC wf.sp_CouponBridgeScope @actual OUTPUT,@cust;
  IF @actual<>@scope BEGIN RAISERROR('BRIDGE_PERMISSION_CHANGED',16,1);RETURN;END;
  EXEC wf.sp_CouponBridgeBindNative @permit,@tx,@began;
  UPDATE wf.CouponBridgePermit SET State='STARTED',NativeId=@id,StartedAtUtc=GETUTCDATE(),OriginTransactionId=@tx,OriginStartedAt=@began
   WHERE PermitId=@permit AND State='APPROVED';
  IF @@ROWCOUNT<>1 BEGIN RAISERROR('BRIDGE_PERMIT_CHANGED',16,1);RETURN;END;
  INSERT wf.CouponBridgeProgress(PermitId,StartImage,UnwindObserved,BalanceMode)
   VALUES(@permit,@start,@unwound,CASE WHEN @unwound=1 THEN 'UNWIND' ELSE NULL END);
  INSERT wf.CouponBridgeStep(PermitId,Entity,Stage,OriginTransactionId,OriginStartedAt,BalanceImage)
   VALUES(@permit,@entity,'START',@tx,@began,CASE WHEN @entity='B' THEN @after ELSE NULL END);
  RETURN;
 END;
 IF @state<>'STARTED' OR wf.fn_CouponBridgeNativeOwned(@permit)<>1
  BEGIN RAISERROR('BRIDGE_NATIVE_PENDING_RECOVERY',16,1);RETURN;END;
 IF @entity='B'
 BEGIN
  IF @unwound=0 AND @mode IS NULL
   AND NOT EXISTS(SELECT 1 FROM wf.CouponBridgeLine b LEFT JOIN @changes c ON c.CouponId=b.CouponId WHERE b.PermitId=@permit AND b.BeforeQty>0
    AND(c.CouponId IS NULL OR c.BeforeBalance<>b.NativeBefore OR c.AfterBalance<>b.NativeBefore+b.BeforeQty))
   AND NOT EXISTS(SELECT 1 FROM @changes c WHERE NOT EXISTS(SELECT 1 FROM wf.CouponBridgeLine b WHERE b.PermitId=@permit AND b.CouponId=c.CouponId AND b.BeforeQty>0))
  BEGIN
   UPDATE wf.CouponBridgeProgress SET UnwindObserved=1,BalanceMode='UNWIND' WHERE PermitId=@permit;
   INSERT wf.CouponBridgeStep(PermitId,Entity,Stage,OriginTransactionId,OriginStartedAt,BalanceImage) VALUES(@permit,'B','UNWIND',@tx,@began,@after);
   EXEC wf.sp_CouponBridgeTryFinish @permit;RETURN;
  END;
  IF @unwound=0 AND @mode IS NULL
   AND NOT EXISTS(SELECT 1 FROM wf.CouponBridgeLine b LEFT JOIN @changes c ON c.CouponId=b.CouponId WHERE b.PermitId=@permit AND b.BeforeQty<>b.AfterQty
    AND(c.CouponId IS NULL OR c.BeforeBalance<>b.NativeBefore OR c.AfterBalance<>b.NativeBefore+b.BeforeQty-b.AfterQty))
   AND NOT EXISTS(SELECT 1 FROM @changes c WHERE NOT EXISTS(SELECT 1 FROM wf.CouponBridgeLine b WHERE b.PermitId=@permit AND b.CouponId=c.CouponId AND b.BeforeQty<>b.AfterQty))
  BEGIN
   UPDATE wf.CouponBridgeProgress SET BalanceMode='NET' WHERE PermitId=@permit;
   INSERT wf.CouponBridgeStep(PermitId,Entity,Stage,OriginTransactionId,OriginStartedAt,BalanceImage) VALUES(@permit,'B','NET_FINAL',@tx,@began,@after);
   EXEC wf.sp_CouponBridgeTryFinish @permit;RETURN;
  END;
  IF @unwound<>1 OR EXISTS(SELECT 1 FROM wf.CouponBridgeLine b LEFT JOIN @changes c ON c.CouponId=b.CouponId WHERE b.PermitId=@permit AND b.AfterQty>0
    AND(c.CouponId IS NULL OR c.BeforeBalance<>b.NativeBefore+b.BeforeQty OR c.AfterBalance<>b.NativeBefore+b.BeforeQty-b.AfterQty))
   OR EXISTS(SELECT 1 FROM @changes c WHERE NOT EXISTS(SELECT 1 FROM wf.CouponBridgeLine b WHERE b.PermitId=@permit AND b.CouponId=c.CouponId AND b.AfterQty>0))
   BEGIN RAISERROR('BRIDGE_NATIVE_DEBIT_BATCH_INCOMPLETE',16,1);RETURN;END;
  INSERT wf.CouponBridgeStep(PermitId,Entity,Stage,OriginTransactionId,OriginStartedAt,BalanceImage) VALUES(@permit,'B','FINAL_DEBIT',@tx,@began,@after);
  -- A final debit must not commit an incomplete physical document.
  EXEC wf.sp_CouponBridgeFinish @permit;
 END
 ELSE
 BEGIN
  IF @native<>@id BEGIN RAISERROR('BRIDGE_NATIVE_ID_CHANGED',16,1);RETURN;END;
  IF @op='D' AND NULLIF(CONVERT(nvarchar(max),@after),'') IS NOT NULL
   BEGIN RAISERROR('BRIDGE_NATIVE_CANCEL_WRITE',16,1);RETURN;END;
  INSERT wf.CouponBridgeStep(PermitId,Entity,Stage,OriginTransactionId,OriginStartedAt) VALUES(@permit,@entity,'DOCUMENT',@tx,@began);
  EXEC wf.sp_CouponBridgeTryFinish @permit;
 END;
END;
GO
ALTER PROCEDURE wf.sp_CouponBridgeFloor @changes xml,@final bit=0 AS
BEGIN
 SET NOCOUNT ON;
 IF @final=0 AND EXISTS(SELECT 1 FROM wf.CouponBridgePermit p JOIN wf.CouponBridgeProgress g ON g.PermitId=p.PermitId WHERE p.State='STARTED' AND g.BalanceMode='NET'
  AND wf.fn_CouponBridgeNativeOwned(p.PermitId)=1
  AND NOT EXISTS(SELECT 1 FROM wf.CouponBridgeLine b JOIN dbo.WFCoupon c ON c.CouponID=b.CouponId WHERE b.PermitId=p.PermitId
    AND(c.RemaQty IS NULL OR c.RemaQty<>b.NativeBefore+b.BeforeQty-b.AfterQty))
  AND NOT EXISTS(SELECT 1 FROM @changes.nodes('/changes/row')t(n) WHERE NOT EXISTS(SELECT 1 FROM wf.CouponBridgeLine b WHERE b.PermitId=p.PermitId AND b.CouponId=n.value('@couponId','int')))) RETURN;
 IF @final=0 AND EXISTS(SELECT 1 FROM wf.CouponBridgeSession s JOIN wf.CouponBridgePermit p ON p.PermitId=s.PermitId
  WHERE s.SessionId=@@SPID AND wf.fn_CouponBridgeRecoveryOwned(p.PermitId)=1) RETURN;
 IF EXISTS(SELECT 1 FROM @changes.nodes('/changes/row')t(n)
  JOIN wf.CouponBridgeLine l ON l.CouponId=n.value('@couponId','int')
  JOIN wf.CouponBridgePermit p ON p.PermitId=l.PermitId
  WHERE p.ReleasedAtUtc IS NULL AND p.State IN('STARTED','COMPLETE')
   AND wf.fn_CouponBridgeNativeOwned(p.PermitId)<>1
   AND wf.fn_CouponBridgeRecoveryOwned(p.PermitId)<>1)
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
 IF @@TRANCOUNT<1 OR @id IS NULL
 BEGIN RAISERROR('BRIDGE_TRANSACTION_PROOF_REQUIRED',16,1);RETURN;END;
 IF @recovery=1
 BEGIN
  IF wf.fn_CouponBridgeRecoveryOwned(@permit)<>1 OR ISNULL(APPLOCK_MODE('public',@marker,'Transaction'),'NoLock')<>'Exclusive'
   BEGIN RAISERROR('BRIDGE_TRANSACTION_PROOF_REQUIRED',16,1);RETURN;END;
 END
 ELSE IF wf.fn_CouponBridgeNativeOwned(@permit)<>1 OR @expiry<=GETUTCDATE()
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
 VALUES('COUPON_BRIDGE',@permit,'COMPLETE','NATIVE_116_FINALIZE',CONVERT(varchar(20),@u),CONVERT(varchar(20),@a),
  N'{"nativeMode":"'+CASE WHEN @recovery=1 THEN 'RECOVERY_TX' ELSE ISNULL((SELECT Mode FROM wf.CouponBridgeNativeSession WHERE PermitId=@permit),'UNKNOWN') END+N'","nativeId":'+CONVERT(nvarchar(20),@id)+N',"operation":"'+@op+N'","primaryUserId":'+CONVERT(nvarchar(20),@primary)+N',"primaryActorId":'+CONVERT(nvarchar(20),@primaryActor)+N'}');
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
 DECLARE @finalBalances xml;SET @finalBalances=(SELECT b.CouponId AS [@couponId],b.NativeBefore AS [@before],c.RemaQty AS [@after]
 FROM wf.CouponBridgeLine b JOIN dbo.WFCoupon c ON c.CouponID=b.CouponId WHERE b.PermitId=@permit FOR XML PATH('row'),ROOT('changes'),TYPE);
 EXEC wf.sp_CouponBridgeFloor @finalBalances,1;
END;
GO
ALTER TRIGGER wf.WF_CouponBridgeReservationFence ON wf.CouponReservation AFTER INSERT,UPDATE,DELETE AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS(SELECT 1 FROM wf.CouponBridgeContract WHERE Enabled=1 AND Version='116-BRIDGE-v1') RETURN;
 DECLARE @trusted bit;SET @trusted=0;
 IF EXISTS(SELECT 1 FROM wf.CouponBridgePermit p WHERE p.State='STARTED' AND p.ReleasedAtUtc IS NULL
  AND (wf.fn_CouponBridgeNativeOwned(p.PermitId)=1 OR wf.fn_CouponBridgeRecoveryOwned(p.PermitId)=1) AND(
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
ALTER TRIGGER wf.WF_CouponBridgeRequestFence ON wf.NativeDocumentRequest AFTER UPDATE,DELETE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM deleted d JOIN wf.CouponBridgePermit p ON p.RequestId=d.RequestId
  WHERE p.ReleasedAtUtc IS NULL AND p.State IN('APPROVED','STARTED') AND NOT(
   p.State='STARTED' AND (wf.fn_CouponBridgeNativeOwned(p.PermitId)=1 OR wf.fn_CouponBridgeRecoveryOwned(p.PermitId)=1) AND(
    EXISTS(SELECT 1 FROM wf.CouponBridgeSession s WHERE s.PermitId=p.PermitId AND s.SessionId=@@SPID)
    OR ISNULL(TRIGGER_NESTLEVEL(OBJECT_ID('dbo.WF_CouponNativeConsume'),'AFTER','DML'),0)>0)))
 BEGIN
  IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
  RAISERROR('BRIDGE_WITHDRAW_PERMIT_BEFORE_REQUEST_CHANGE',16,1);RETURN;
 END;
END;
GO
ALTER PROCEDURE wf.usp_WriteNativeRedemption @RequestId varchar(36),@UserId int,@ActorId int
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET ARITHABORT ON;SET ANSI_WARNINGS ON;
 IF @@TRANCOUNT=0 OR XACT_STATE()<>1 BEGIN RAISERROR('ND_TRANSACTION_REQUIRED',16,1);RETURN;END;
 DECLARE @Plan xml,@Source int,@Emp int,@No varchar(25),@Date datetime,@New int,@Audit int,@Event int,@User nvarchar(100),
  @Receiver nvarchar(100),@Plate nvarchar(25),@Qty decimal(18,4),@Cust int,@Approver int,@ApproverActor int,@ApproverEmp int,@ApprovedAt datetime,@RequesterActor int;
 DECLARE @Validated int;
 EXEC @Validated=wf.usp_ReadNativeDocumentRequest @RequestId,116,@UserId,@ActorId,@Plan OUTPUT,@Source OUTPUT;
 IF @Validated<>0 RETURN;
 SELECT @Emp=e.EmpID,@User=u.Username FROM wf.AppUser u WITH(UPDLOCK,HOLDLOCK) JOIN dbo.EMEmp e WITH(HOLDLOCK) ON CONVERT(varchar(30),e.EmpID)=u.EmpId WHERE u.Id=@UserId;
 IF @Emp IS NULL BEGIN RAISERROR('ND_RECORDER_MAPPING_REQUIRED',16,1);RETURN;END;
 SELECT @Approver=r.ApprovedById,@ApproverActor=r.ApproverActorId,@ApprovedAt=r.ApprovedAtUtc,@RequesterActor=r.ActorUserId,@ApproverEmp=e.EmpID
  FROM wf.NativeDocumentRequest r JOIN wf.AppUser u ON u.Id=r.ApprovedById LEFT JOIN dbo.EMEmp e ON CONVERT(varchar(30),e.EmpID)=u.EmpId WHERE r.RequestId=@RequestId;
 SET @No=@Plan.value('(/plan/@slipNo)[1]','varchar(25)');SET @Receiver=@Plan.value('(/plan/@receiver)[1]','nvarchar(100)');
 SET @Plate=@Plan.value('(/plan/@plate)[1]','nvarchar(25)');SET @Date=@Plan.value('(/plan/@docDate)[1]','datetime');
 SET @Cust=@Plan.value('(/plan/@custId)[1]','int');
 IF NULLIF(LTRIM(RTRIM(@No)),'') IS NULL OR NULLIF(LTRIM(RTRIM(@Receiver)),'') IS NULL OR NULLIF(LTRIM(RTRIM(@Plate)),'') IS NULL
  OR @Date>CONVERT(datetime,CONVERT(varchar(10),DATEADD(hour,7,GETUTCDATE()),120),120)
  OR EXISTS(SELECT 1 FROM dbo.WFRedemtionHD WITH(UPDLOCK,HOLDLOCK) WHERE DocuNo=@No)
 BEGIN RAISERROR('ND_SLIP_INVALID_OR_USED',16,1);RETURN;END;
 DECLARE @Lines TABLE(CouponId int PRIMARY KEY,Qty decimal(18,4),BeforeQty decimal(18,4),DeliveryId int,SourceLineNo int,GoodId int);
 INSERT @Lines SELECT n.value('@couponId','int'),n.value('@quantity','decimal(18,4)'),n.value('@beforeRemaining','decimal(18,4)'),
  n.value('@deliveryId','int'),n.value('@sourceLineNo','int'),n.value('@goodId','int') FROM @Plan.nodes('/plan/line') t(n);
 IF NOT EXISTS(SELECT 1 FROM @Lines) OR EXISTS(SELECT 1 FROM @Lines WHERE Qty<=0 OR Qty>BeforeQty)
 BEGIN RAISERROR('ND_LINES_INVALID',16,1);RETURN;END;
 DECLARE @Reservations TABLE(Id bigint PRIMARY KEY,CouponId int,Qty decimal(12,4),Revision int,BeforeConsumed decimal(12,4));
 INSERT @Reservations SELECT s.value('@reservationId','bigint'),s.value('(../@couponId)[1]','int'),s.value('@quantity','decimal(12,4)'),
  s.value('@revision','int'),s.value('@beforeConsumed','decimal(12,4)') FROM @Plan.nodes('/plan/line/settlement') t(s);
 IF EXISTS(SELECT 1 FROM @Reservations r LEFT JOIN @Lines l ON l.CouponId=r.CouponId WHERE l.CouponId IS NULL OR r.Qty<=0)
  OR EXISTS(SELECT 1 FROM @Reservations r JOIN @Lines l ON l.CouponId=r.CouponId GROUP BY r.CouponId,l.Qty HAVING SUM(r.Qty)>l.Qty)
 BEGIN RAISERROR('ND_RESERVATION_INVALID',16,1);RETURN;END;
 -- Same lock order as Sale-App reservation writers, including unexpired holds.
 DECLARE @Coupon int,@Amount decimal(18,4),@Delivery int,@Line int,@List int,@Held decimal(18,4),@Own decimal(18,4);SET @List=0;
 DECLARE coupon_locks CURSOR LOCAL FAST_FORWARD FOR SELECT CouponId FROM @Lines ORDER BY CouponId;
 OPEN coupon_locks;FETCH NEXT FROM coupon_locks INTO @Coupon;
 WHILE @@FETCH_STATUS=0
 BEGIN
  IF NOT EXISTS(SELECT 1 FROM dbo.WFCoupon c WITH(UPDLOCK,HOLDLOCK) JOIN @Lines l ON l.CouponId=c.CouponID
   JOIN dbo.SOHD h WITH(UPDLOCK,HOLDLOCK) ON h.SOID=c.DocuID AND h.DocuType=104 AND h.DocuStatus<>'C'
   WHERE c.CouponID=@Coupon AND c.RemaQty=l.BeforeQty AND c.DocuID=l.DeliveryId AND c.RefListno=l.SourceLineNo AND c.GoodID=l.GoodId
    AND @Date>=h.DocuDate AND LEFT(c.CouponNo,1)=CASE LEFT(h.DocuNo,1) WHEN 'I' THEN 'C' WHEN 'K' THEN 'D' END
    AND(h.CustID=@Cust OR EXISTS(SELECT 1 FROM wf.CouponBeneficiary b WITH(UPDLOCK,HOLDLOCK)
      WHERE b.OwnerCustId=CONVERT(varchar(50),h.CustID) AND b.BeneficiaryCustId=CONVERT(varchar(50),@Cust) AND b.Status='ACTIVE'
       AND(b.EffectiveFrom IS NULL OR b.EffectiveFrom<=@Date) AND(b.EffectiveTo IS NULL OR b.EffectiveTo>=@Date)
       AND(b.Scope='ALL' OR b.Scope=CONVERT(varchar(50),c.GoodID)))))
  BEGIN RAISERROR('ND_COUPON_SOURCE_CHANGED',16,1);RETURN;END;
  IF EXISTS(SELECT 1 FROM @Reservations r LEFT JOIN wf.CouponReservation cr WITH(UPDLOCK,HOLDLOCK) ON cr.Id=r.Id
    WHERE r.CouponId=@Coupon AND(cr.Id IS NULL OR cr.CouponId<>@Coupon OR cr.Status<>'RESERVED' OR cr.Revision<>r.Revision
     OR ISNULL(cr.ConsumedQty,0)<>r.BeforeConsumed OR cr.ReservedQty<r.BeforeConsumed+r.Qty
     OR cr.BeneficiaryCustId<>CONVERT(varchar(50),@Cust) OR cr.ExpiresAt<=GETUTCDATE()
     OR wf.fn_CouponBridgeReservationHeld(cr.Id)=1
     OR EXISTS(SELECT 1 FROM wf.CouponNativeCutAuthorizationLine al WITH(UPDLOCK,HOLDLOCK)
      JOIN wf.CouponNativeCutAuthorization ah WITH(UPDLOCK,HOLDLOCK) ON ah.Id=al.AuthorizationId
      WHERE al.ReservationId=cr.Id AND(ah.State='ACTIVE' OR EXISTS(SELECT 1 FROM wf.CouponNativeCutEvidence e WITH(UPDLOCK,HOLDLOCK) WHERE e.AuthorizationLineId=al.Id)))))
  BEGIN RAISERROR('ND_RESERVATION_UNAVAILABLE',16,1);RETURN;END;
  SELECT @Held=ISNULL(SUM(cr.ReservedQty-ISNULL(cr.ConsumedQty,0)),0) FROM wf.CouponReservation cr WITH(UPDLOCK,HOLDLOCK)
   WHERE cr.CouponId=@Coupon AND cr.Status='RESERVED' AND(cr.ExpiresAt IS NULL OR cr.ExpiresAt>GETUTCDATE() OR wf.fn_CouponBridgeReservationHeld(cr.Id)=1
    OR EXISTS(SELECT 1 FROM wf.CouponNativeCutAuthorizationLine al WITH(UPDLOCK,HOLDLOCK)
      JOIN wf.CouponNativeCutAuthorization ah WITH(UPDLOCK,HOLDLOCK) ON ah.Id=al.AuthorizationId
      WHERE al.ReservationId=cr.Id AND(ah.State='ACTIVE' OR EXISTS(SELECT 1 FROM wf.CouponNativeCutEvidence e WITH(UPDLOCK,HOLDLOCK) WHERE e.AuthorizationLineId=al.Id))));
  SELECT @Own=ISNULL(SUM(Qty),0) FROM @Reservations WHERE CouponId=@Coupon;
  IF @Held<0 OR EXISTS(SELECT 1 FROM wf.CouponReservation cr WITH(UPDLOCK,HOLDLOCK)
    WHERE cr.CouponId=@Coupon AND cr.Status='RESERVED' AND(cr.ReservedQty IS NULL OR cr.ReservedQty<0 OR ISNULL(cr.ConsumedQty,0)<0 OR cr.ConsumedQty>cr.ReservedQty))
   OR EXISTS(SELECT 1 FROM @Lines WHERE CouponId=@Coupon AND(Qty>BeforeQty-@Held+@Own OR @Own>@Held))
  BEGIN RAISERROR('ND_COUPON_INSUFFICIENT',16,1);RETURN;END;
  FETCH NEXT FROM coupon_locks INTO @Coupon;
 END;
 CLOSE coupon_locks;DEALLOCATE coupon_locks;
 SELECT @Qty=SUM(Qty) FROM @Lines;
 EXEC wf.usp_AllocateNativeRedemptionId @NewId=@New OUTPUT;
 EXEC wf.usp_AllocateWinspeedId @TableName='SMAudit',@NewId=@Audit OUTPUT;
 EXEC wf.usp_AllocateNativeDocumentEventId @NewId=@Event OUTPUT;
 IF EXISTS(SELECT 1 FROM wf.CouponBridgePermit WITH(UPDLOCK,HOLDLOCK) WHERE State IN('STARTED','COMPLETE') AND ReleasedAtUtc IS NULL)
  BEGIN RAISERROR('BRIDGE_COUPON_PENDING_REVIEW',16,1);RETURN;END;
 INSERT wf.CouponBridgeAppContext(SessionId,RequestId) VALUES(@@SPID,@RequestId);
 INSERT dbo.WFRedemtionHD(RedemtionID,DocuNo,DocuDate,DocuType,IssueName,CarLicense,SaveEmpID,SumGoodQty,DocuStatus,IsCheckAll)
 VALUES(@New,@No,@Date,116,@Receiver,@Plate,@Emp,@Qty,'N','Y');
 -- Release only this approved request's own hold before native debit.
 -- Both ledger and native changes remain inside the caller transaction. A
 -- trigger/verification failure rolls everything back; no hold is freed at COMMIT.
 INSERT wf.CouponReservationSettlement(ReservationId,CouponId,NativeRedemptionId,NativeDocuNo,SettledQty,SettledBy,Note)
  SELECT Id,CouponId,@New,@No,Qty,@UserId,N'NATIVE-DOCUMENTS-v3; request='+@RequestId FROM @Reservations;
 UPDATE cr SET ConsumedQty=ISNULL(cr.ConsumedQty,0)+r.Qty,
  Status=CASE WHEN ISNULL(cr.ConsumedQty,0)+r.Qty=cr.ReservedQty THEN 'CONSUMED' ELSE 'RESERVED' END,
  Revision=cr.Revision+1,UpdatedAt=GETUTCDATE()
  FROM wf.CouponReservation cr JOIN @Reservations r ON r.Id=cr.Id
  WHERE cr.Status='RESERVED' AND cr.Revision=r.Revision AND ISNULL(cr.ConsumedQty,0)=r.BeforeConsumed AND cr.ReservedQty>=r.BeforeConsumed+r.Qty;
 IF @@ROWCOUNT<>(SELECT COUNT(*) FROM @Reservations) BEGIN RAISERROR('ND_RESERVATION_CHANGED',16,1);RETURN;END;
 INSERT wf.ChangeEvent(EntityType,EntityId,Action,BeforeJson,AfterJson,ReasonCode,ReasonText,UserId,ActorUserId,CreatedAt)
  SELECT 'COUPON_RESERVATION',CONVERT(varchar(50),r.Id),'NATIVE_SETTLE',
   N'{"consumedQty":'+CONVERT(nvarchar(40),r.BeforeConsumed)+N'}',
   N'{"settledQty":'+CONVERT(nvarchar(40),r.Qty)+N',"redemptionId":'+CONVERT(nvarchar(20),@New)+N',"requestId":"'+@RequestId+N'"}',
   'NATIVE_DOCUMENT',@No,CONVERT(varchar(50),@UserId),CONVERT(varchar(50),@ActorId),GETUTCDATE() FROM @Reservations r;
 DECLARE coupon_write CURSOR LOCAL FAST_FORWARD FOR SELECT CouponId,Qty,DeliveryId,SourceLineNo FROM @Lines ORDER BY CouponId;
 OPEN coupon_write;FETCH NEXT FROM coupon_write INTO @Coupon,@Amount,@Delivery,@Line;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SET @List=@List+1;
  INSERT dbo.WFRedemtionDT(RedemtionID,Listno,GoodID,InveID,LocaID,GoodUnitID,GoodPrice,CouponID,CouponNo,PostInv,GoodQty,RemaQty,IsCheck)
   SELECT @New,@List,GoodID,InveID,LocaID,GoodUnitID,GoodPrice,CouponID,CouponNo,'N',@Amount,@Amount,'Y' FROM dbo.WFCoupon WHERE CouponID=@Coupon;
  UPDATE dbo.WFCoupon SET RemaQty=RemaQty-@Amount WHERE CouponID=@Coupon AND RemaQty>=@Amount;
  IF @@ROWCOUNT<>1 BEGIN RAISERROR('ND_COUPON_SOURCE_CHANGED',16,1);RETURN;END;
  INSERT #NativeLines(NativeLineNo,SourceId,SourceLineNo,CouponId,CouponNo,Quantity,GrossAmount,DiscountAmount,TaxBase)
   SELECT @List,@Delivery,@Line,@Coupon,CouponNo,@Amount,0,0,0 FROM dbo.WFCoupon WHERE CouponID=@Coupon;
  FETCH NEXT FROM coupon_write INTO @Coupon,@Amount,@Delivery,@Line;
 END;
 CLOSE coupon_write;DEALLOCATE coupon_write;
 INSERT dbo.SMAudit(audit_id,audit_system,audit_screen,audit_datetime,audit_username,audit_action,audit_docuno,audit_docudate,audit_columnid,brchid,audit_computername,audit_refid,version,audit_query)
 VALUES(@Audit,3,2098003052,GETDATE(),LEFT(N'wf:'+@User,100),'INSERT',@No,@Date,@New,1,HOST_NAME(),@Audit,'WF NATIVE v3',@RequestId);
 INSERT dbo.SMEvent(eventid,docudate,docuno,code,c_v_name,amount,vat,totalamnt,username,objectid,brchid,docuid,c_v_id,systemid)
 VALUES(@Event,@Date,@No,'','',0,0,0,LEFT(N'wf:'+@User,100),2098003052,1,@New,@Cust,3);
 -- v3 request + receipt carry the recorder and approver. Do not invent one
 -- SourceSOID in the legacy approval table for a mixed-order/customer cut.
 DELETE wf.CouponBridgeAppContext WHERE SessionId=@@SPID AND RequestId=@RequestId;
 INSERT #NativeResult(NativeId,NativeNo,FinanceId) VALUES(@New,@No,NULL);
END;
GO

IF OBJECT_ID('wf.fn_CouponBridgeSessionHistory','FN') IS NULL EXEC('CREATE FUNCTION wf.fn_CouponBridgeSessionHistory() RETURNS bit AS BEGIN RETURN 0;END');
GO
ALTER FUNCTION wf.fn_CouponBridgeSessionHistory() RETURNS bit AS
BEGIN
 IF EXISTS(SELECT 1 FROM wf.CouponBridgeNativeSession) OR EXISTS(SELECT 1 FROM wf.CouponBridgeAppContext) RETURN 1;
 RETURN 0;
END;
GO
