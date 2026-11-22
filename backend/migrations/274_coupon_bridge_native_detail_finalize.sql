-- @transaction
-- Native autocommit clients may save complete 116 details without updating
-- WFCoupon at all. Only a whole approved physical image may finalize its exact
-- balance vector, reservation delta and audit in the last detail transaction.
-- Earlier native statements remain committed but held until completion/review.
IF EXISTS(SELECT 1 FROM wf.CouponBridgePermit WHERE State='STARTED' AND ReleasedAtUtc IS NULL)
 RAISERROR('BRIDGE_FINISH_PENDING_BEFORE_PROTOCOL_UPGRADE',16,1);
GO
IF OBJECT_ID('wf.CouponBridgeBalanceWrite','U') IS NULL
 CREATE TABLE wf.CouponBridgeBalanceWrite(SessionId smallint NOT NULL PRIMARY KEY,PermitId varchar(36) NOT NULL REFERENCES wf.CouponBridgePermit(PermitId));
DENY SELECT,INSERT,UPDATE,DELETE ON OBJECT::wf.CouponBridgeBalanceWrite TO public;
GO
IF OBJECT_ID('wf.fn_CouponBridgeBalanceWriter','FN') IS NULL EXEC('CREATE FUNCTION wf.fn_CouponBridgeBalanceWriter() RETURNS bit AS BEGIN RETURN 0;END');
GO
ALTER FUNCTION wf.fn_CouponBridgeBalanceWriter() RETURNS bit AS
BEGIN
 IF EXISTS(SELECT 1 FROM wf.CouponBridgeBalanceWrite WHERE SessionId=@@SPID) RETURN 1;
 RETURN 0;
END;
GO
ALTER PROCEDURE wf.sp_CouponBridgeTryFinish @permit varchar(36) AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @id int,@op char(1),@unwound bit,@mode varchar(12),@owned bit,@tx bigint,@began datetime,@changes xml;
 SELECT @id=p.NativeId,@op=p.Operation,@unwound=g.UnwindObserved,@mode=g.BalanceMode FROM wf.CouponBridgePermit p WITH(UPDLOCK,HOLDLOCK)
  JOIN wf.CouponBridgeProgress g WITH(UPDLOCK,HOLDLOCK) ON g.PermitId=p.PermitId
  WHERE p.PermitId=@permit AND p.State='STARTED' AND p.ReleasedAtUtc IS NULL;
 IF @id IS NULL RETURN;
 IF @op='D'
 BEGIN
  IF EXISTS(SELECT 1 FROM dbo.WFRedemtionHD WHERE RedemtionID=@id) OR EXISTS(SELECT 1 FROM dbo.WFRedemtionDT WHERE RedemtionID=@id) RETURN;
 END
 ELSE
 BEGIN
  IF NOT EXISTS(SELECT 1 FROM dbo.WFRedemtionHD h JOIN wf.CouponBridgePermit p ON p.NativeId=h.RedemtionID
    WHERE p.PermitId=@permit AND h.DocuType=116 AND h.DocuNo=p.DocuNo AND CONVERT(date,h.DocuDate)=p.DocuDate AND h.DocuStatus='N'
     AND h.IssueName=p.Receiver AND h.CarLicense=p.Plate AND h.SaveEmpID=p.RecorderEmpId AND h.IsCheckAll='Y'
     AND h.SumGoodQty=(SELECT SUM(AfterQty) FROM wf.CouponBridgeLine WHERE PermitId=@permit))
   OR(SELECT COUNT(*) FROM dbo.WFRedemtionDT WHERE RedemtionID=@id)<>
    (SELECT COUNT(*) FROM wf.CouponBridgeLine WHERE PermitId=@permit AND AfterQty>0)
   OR EXISTS(SELECT 1 FROM wf.CouponBridgeLine b LEFT JOIN dbo.WFRedemtionDT d ON d.RedemtionID=@id AND d.CouponID=b.CouponId
     WHERE b.PermitId=@permit AND b.AfterQty>0 AND(d.CouponID IS NULL OR d.GoodQty<>b.AfterQty OR d.Listno<>b.[LineNo])) RETURN;
 END;
 -- Explicit transaction clients retain the proved unwind/net protocol.
 -- Only connection-bound autocommit clients may finalize an untouched vector.
 SET @owned=0;
 IF @unwound=0 AND @mode IS NULL AND wf.fn_CouponBridgeNativeOwned(@permit)=1
  AND EXISTS(SELECT 1 FROM wf.CouponBridgeNativeSession WHERE PermitId=@permit AND Mode='SESSION')
  AND NOT EXISTS(SELECT 1 FROM wf.CouponBridgeLine b LEFT JOIN dbo.WFCoupon c WITH(UPDLOCK,HOLDLOCK) ON c.CouponID=b.CouponId
    WHERE b.PermitId=@permit AND(c.CouponID IS NULL OR c.RemaQty IS NULL OR c.RemaQty<>b.NativeBefore)) SET @owned=1;
 IF @owned=1
 BEGIN
  INSERT wf.CouponBridgeBalanceWrite(SessionId,PermitId) VALUES(@@SPID,@permit);
  UPDATE c SET RemaQty=b.NativeBefore+b.BeforeQty-b.AfterQty FROM dbo.WFCoupon c
   JOIN wf.CouponBridgeLine b ON b.CouponId=c.CouponID WHERE b.PermitId=@permit;
  DELETE wf.CouponBridgeBalanceWrite WHERE SessionId=@@SPID AND PermitId=@permit;
  UPDATE wf.CouponBridgeProgress SET BalanceMode='BRIDGE' WHERE PermitId=@permit;
  SELECT @tx=c.transaction_id,@began=a.transaction_begin_time FROM sys.dm_tran_current_transaction c
   JOIN sys.dm_tran_active_transactions a ON a.transaction_id=c.transaction_id;
  INSERT wf.CouponBridgeStep(PermitId,Entity,Stage,OriginTransactionId,OriginStartedAt,BalanceImage)
   SELECT @permit,'B','BRIDGE_BALANCE',@tx,@began,
    (SELECT b.CouponId AS [@couponId],b.NativeBefore AS [@before],c.RemaQty AS [@after]
      FROM wf.CouponBridgeLine b JOIN dbo.WFCoupon c ON c.CouponID=b.CouponId WHERE b.PermitId=@permit FOR XML PATH('row'),ROOT('changes'),TYPE);
 END;
 IF @owned=0 AND @unwound=0 AND ISNULL(@mode,'')<>'NET' RETURN;
 IF EXISTS(SELECT 1 FROM wf.CouponBridgeLine b LEFT JOIN dbo.WFCoupon c WITH(UPDLOCK,HOLDLOCK) ON c.CouponID=b.CouponId
  WHERE b.PermitId=@permit AND(c.CouponID IS NULL OR c.RemaQty IS NULL OR c.RemaQty<>b.NativeBefore+b.BeforeQty-b.AfterQty)) RETURN;
 -- Finish performs the full goods/prices/source/actor/scope/reservation checks.
 -- Any failure rolls back the last native statement, exact balance and audit.
 EXEC wf.sp_CouponBridgeFinish @permit;
 SET @changes=(SELECT b.CouponId AS [@couponId],b.NativeBefore AS [@before],c.RemaQty AS [@after]
  FROM wf.CouponBridgeLine b JOIN dbo.WFCoupon c ON c.CouponID=b.CouponId WHERE b.PermitId=@permit FOR XML PATH('row'),ROOT('changes'),TYPE);
 EXEC wf.sp_CouponBridgeFloor @changes,1;
END;
GO
ALTER PROCEDURE wf.sp_CouponBridgeObserve @entity char(1),@native int,@before xml,@after xml AS
BEGIN
 SET NOCOUNT ON;
 IF @entity='B' AND wf.fn_CouponBridgeBalanceWriter()=1 RETURN;
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
 IF @final=0 AND wf.fn_CouponBridgeBalanceWriter()=1 RETURN;
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
ALTER TRIGGER wf.WF_CouponBridgeRequestFence ON wf.NativeDocumentRequest AFTER UPDATE,DELETE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM deleted d JOIN wf.CouponBridgePermit p ON p.RequestId=d.RequestId
  WHERE p.ReleasedAtUtc IS NULL AND p.State IN('APPROVED','STARTED') AND NOT(
   p.State='STARTED' AND (wf.fn_CouponBridgeNativeOwned(p.PermitId)=1 OR wf.fn_CouponBridgeRecoveryOwned(p.PermitId)=1) AND(
    EXISTS(SELECT 1 FROM wf.CouponBridgeSession s WHERE s.PermitId=p.PermitId AND s.SessionId=@@SPID)
    OR ISNULL(TRIGGER_NESTLEVEL(OBJECT_ID('dbo.WF_CouponNativeConsume'),'AFTER','DML'),0)>0
    OR ISNULL(TRIGGER_NESTLEVEL(OBJECT_ID('dbo.WF_CouponNativeEditHeadHook'),'AFTER','DML'),0)>0
    OR ISNULL(TRIGGER_NESTLEVEL(OBJECT_ID('dbo.WF_CouponNativeEditDetailHook'),'AFTER','DML'),0)>0)))
 BEGIN
  IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
  RAISERROR('BRIDGE_WITHDRAW_PERMIT_BEFORE_REQUEST_CHANGE',16,1);RETURN;
 END;
END;
GO
