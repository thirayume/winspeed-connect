-- @transaction
-- Retain the native record needed when WinSpeed commits an unwind and
-- source deletion but never finishes an approved reduction.
IF OBJECT_ID('wf.sp_CouponNativeEditFinish','P') IS NULL
 OR OBJECT_ID('wf.CouponNativeEditIntent','U') IS NULL
 OR OBJECT_ID('wf.CouponNativeEditRelease','U') IS NULL
BEGIN RAISERROR('COUPON_EDIT_RESUME_DEPENDENCIES',16,1);RETURN;END;
CREATE TABLE wf.CouponNativeEditSnapshot (
    EditId uniqueidentifier NOT NULL PRIMARY KEY,
    NativeRedemptionId int NOT NULL,
    SourceHeader xml NOT NULL,
    SourceLines xml NOT NULL,
    CapturedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE TABLE wf.CouponNativeEditResume (
    EditId uniqueidentifier NOT NULL PRIMARY KEY REFERENCES wf.CouponNativeEditSnapshot(EditId),
    TransactionId bigint NOT NULL,
    TransactionStartedAt datetime NOT NULL,
    AuditEventId bigint NOT NULL UNIQUE REFERENCES wf.ChangeEvent(EventId),
    ResumedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME()
);
DENY INSERT,UPDATE,DELETE ON OBJECT::wf.CouponNativeEditSnapshot TO public;
DENY INSERT,UPDATE,DELETE ON OBJECT::wf.CouponNativeEditResume TO public;
GO
CREATE FUNCTION wf.fn_CouponNativeEditTransactionMatches
 (@edit uniqueidentifier,@tx bigint,@began datetime,@origin bigint,@originBegan datetime)
RETURNS bit
AS
BEGIN
 RETURN CASE WHEN @tx=@origin AND @began=@originBegan THEN 1
  WHEN EXISTS(SELECT 1 FROM wf.CouponNativeEditResume WHERE EditId=@edit AND TransactionId=@tx
    AND TransactionStartedAt=@began) THEN 1 ELSE 0 END;
END;
GO
CREATE PROCEDURE wf.sp_SnapshotCouponNativeEdit @EditId uniqueidentifier
AS
BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT<1 OR XACT_STATE()<>1
 BEGIN RAISERROR('COUPON_EDIT_SNAPSHOT_TRANSACTION_REQUIRED',16,1);RETURN;END;
 DECLARE @id int,@head xml,@lines xml;
 SELECT @id=MIN(NativeRedemptionId) FROM wf.CouponNativeEditIntent WITH(HOLDLOCK) WHERE EditId=@EditId;
 IF @id IS NULL OR EXISTS(SELECT 1 FROM wf.CouponNativeEditIntent WHERE EditId=@EditId AND NativeRedemptionId<>@id)
  OR (SELECT COUNT(*) FROM dbo.WFRedemtionHD WITH(HOLDLOCK) WHERE RedemtionID=@id AND DocuType=116)<>1
  OR (SELECT COUNT(*) FROM dbo.WFRedemtionDT WITH(HOLDLOCK) WHERE RedemtionID=@id)
    <>(SELECT COUNT(*) FROM wf.CouponNativeEditIntent WHERE EditId=@EditId)
  OR EXISTS(SELECT 1 FROM dbo.WFRedemtionDT d WITH(HOLDLOCK)
    LEFT JOIN wf.CouponNativeEditIntent i ON i.EditId=@EditId AND i.CouponId=d.CouponID AND i.QtyBefore=d.GoodQty
    WHERE d.RedemtionID=@id AND (i.CouponId IS NULL OR ISNULL(d.PostInv,'')<>'N'
      OR ISNULL(d.SOInvID,0)>0 OR d.RemaQty IS NULL OR d.RemaQty<>d.GoodQty))
 BEGIN RAISERROR('COUPON_EDIT_SNAPSHOT_SOURCE_CHANGED',16,1);RETURN;END;
 SET @head=(SELECT DocuNo,DocuDate,CardNo,IssueName,CarLicense,SaveEmpID,IssueEmpID,AppvEmpID,DocuStatus,IsCheckAll
   FROM dbo.WFRedemtionHD WITH(HOLDLOCK) WHERE RedemtionID=@id FOR XML RAW('head'),TYPE);
 SET @lines=(SELECT Listno,GoodID,InveID,LocaID,GoodUnitID,CONVERT(decimal(19,4),GoodPrice) AS GoodPrice,
   CouponID,CouponNo,PostInv,CONVERT(decimal(19,4),RemaQty) AS RemaQty,SOInvID,SOListNo,IsCheck
   FROM dbo.WFRedemtionDT WITH(HOLDLOCK) WHERE RedemtionID=@id ORDER BY Listno FOR XML RAW('line'),TYPE);
 INSERT wf.CouponNativeEditSnapshot(EditId,NativeRedemptionId,SourceHeader,SourceLines)
 VALUES(@EditId,@id,@head,@lines);
END;
GO
CREATE PROCEDURE wf.sp_ResumeCouponNativeEdit
 @EditId uniqueidentifier,@EffectiveUserId int,@ActorUserId int,@Reason nvarchar(500)
AS
BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT<1 OR XACT_STATE()<>1
 BEGIN RAISERROR('COUPON_EDIT_RESUME_TRANSACTION_REQUIRED',16,1);RETURN;END;
 IF LEN(LTRIM(RTRIM(ISNULL(@Reason,''))))<10
  OR NOT EXISTS(SELECT 1 FROM wf.AppUser WITH(HOLDLOCK) WHERE Id=@EffectiveUserId AND IsActive=1)
  OR NOT EXISTS(SELECT 1 FROM wf.AppUser WITH(HOLDLOCK) WHERE Id=@ActorUserId AND IsActive=1)
 BEGIN RAISERROR('COUPON_EDIT_RESUME_ACTOR_INVALID',16,1);RETURN;END;
 DECLARE @lock int,@resource nvarchar(255),@tx bigint,@began datetime,@audit bigint;
 DECLARE @id int,@head xml,@lines xml,@lineCount int;
 SET @resource=N'WF_NATIVE_EDIT_'+CONVERT(nvarchar(36),@EditId);
 EXEC @lock=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=0,@DbPrincipal='public';
 SELECT @tx=c.transaction_id,@began=a.transaction_begin_time
 FROM sys.dm_tran_current_transaction c JOIN sys.dm_tran_active_transactions a ON a.transaction_id=c.transaction_id;
 SELECT @id=NativeRedemptionId,@head=SourceHeader,@lines=SourceLines
 FROM wf.CouponNativeEditSnapshot WITH(UPDLOCK,HOLDLOCK) WHERE EditId=@EditId;
 SELECT @lineCount=COUNT(*) FROM wf.CouponNativeEditHold WITH(UPDLOCK,HOLDLOCK) WHERE EditId=@EditId;
 IF @lock<0 OR @tx IS NULL OR @began IS NULL OR @id IS NULL OR @lineCount NOT BETWEEN 1 AND 100
  OR EXISTS(SELECT 1 FROM wf.CouponNativeEditCompletion WHERE EditId=@EditId)
  OR EXISTS(SELECT 1 FROM wf.CouponNativeEditResume WHERE EditId=@EditId)
  OR @lineCount<>(SELECT COUNT(*) FROM wf.CouponNativeEditIntent WHERE EditId=@EditId)
  OR @lineCount<>@lines.value('count(/line)','int')
  OR EXISTS(SELECT 1 FROM dbo.WFRedemtionHD WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID=@id
    OR DocuNo=@head.value('(/head/@DocuNo)[1]','varchar(25)'))
  OR EXISTS(SELECT 1 FROM dbo.WFRedemtionDT WITH(UPDLOCK,HOLDLOCK) WHERE RedemtionID=@id)
 BEGIN RAISERROR('COUPON_EDIT_RESUME_SOURCE_CONFLICT',16,1);RETURN;END;
 IF EXISTS(SELECT 1 FROM wf.CouponNativeEditHold h
   LEFT JOIN dbo.WFCoupon c WITH(UPDLOCK,HOLDLOCK) ON c.CouponID=h.CouponId
   LEFT JOIN wf.CouponNativeEditIntent i ON i.EditId=h.EditId AND i.CouponId=h.CouponId
   WHERE h.EditId=@EditId AND (c.CouponId IS NULL OR i.CouponId IS NULL OR h.NativeRedemptionId<>@id
    OR ISNULL(h.PlannedOperation,'')<>'E' OR h.OriginTransactionId=@tx
    OR h.PlannedBeforeQty IS NULL OR h.PlannedAfterQty IS NULL OR h.PlannedNativeBefore IS NULL
    OR h.PlannedBeforeQty<>i.QtyBefore OR h.PlannedAfterQty<>i.QtyAfter
    OR c.RemaQty<>h.PlannedNativeBefore+h.PlannedBeforeQty))
  OR NOT EXISTS(SELECT 1 FROM wf.CouponNativeEditHold WHERE EditId=@EditId AND PlannedAfterQty>0)
 BEGIN RAISERROR('COUPON_EDIT_RESUME_BALANCE_CONFLICT',16,1);RETURN;END;
 DECLARE @replacement TABLE(Listno smallint PRIMARY KEY,CouponID int UNIQUE,Qty money);
 INSERT @replacement
 SELECT x.n.value('(@Listno)[1]','smallint'),h.CouponId,h.PlannedAfterQty
 FROM @lines.nodes('/line') x(n)
 JOIN wf.CouponNativeEditHold h ON h.EditId=@EditId AND h.CouponId=x.n.value('(@CouponID)[1]','int');
 IF @@ROWCOUNT<>@lineCount
 BEGIN RAISERROR('COUPON_EDIT_RESUME_SOURCE_CONFLICT',16,1);RETURN;END;
 INSERT wf.ChangeEvent(EntityType,EntityId,Action,ReasonCode,ReasonText,UserId,ActorUserId)
 VALUES('COUPON_NATIVE_EDIT',CONVERT(varchar(36),@EditId),'RESUME','NATIVE_116_RESUME',@Reason,
 CONVERT(varchar(20),@EffectiveUserId),CONVERT(varchar(20),@ActorUserId));
 SET @audit=SCOPE_IDENTITY();
 INSERT wf.CouponNativeEditResume(EditId,TransactionId,TransactionStartedAt,AuditEventId)
 VALUES(@EditId,@tx,@began,@audit);
 INSERT dbo.WFRedemtionHD(RedemtionID,DocuNo,DocuDate,DocuType,CardNo,IssueName,CarLicense,SaveEmpID,IssueEmpID,AppvEmpID,SumGoodQty,DocuStatus,IsCheckAll)
 SELECT @id,x.n.value('(@DocuNo)[1]','varchar(25)'),x.n.value('(@DocuDate)[1]','datetime'),116,x.n.value('(@CardNo)[1]','varchar(25)'),
  x.n.value('(@IssueName)[1]','nvarchar(255)'),x.n.value('(@CarLicense)[1]','nvarchar(25)'),x.n.value('(@SaveEmpID)[1]','int'),
  x.n.value('(@IssueEmpID)[1]','int'),x.n.value('(@AppvEmpID)[1]','int'),(SELECT SUM(Qty) FROM @replacement),
  x.n.value('(@DocuStatus)[1]','char(1)'),x.n.value('(@IsCheckAll)[1]','char(1)')
 FROM @head.nodes('/head') x(n);
 INSERT dbo.WFRedemtionDT(RedemtionID,Listno,GoodID,InveID,LocaID,GoodUnitID,GoodPrice,CouponID,CouponNo,PostInv,GoodQty,RemaQty,SOInvID,SOListNo,IsCheck)
 SELECT @id,r.Listno,x.n.value('(@GoodID)[1]','int'),x.n.value('(@InveID)[1]','int'),x.n.value('(@LocaID)[1]','int'),x.n.value('(@GoodUnitID)[1]','int'),
  x.n.value('(@GoodPrice)[1]','money'),r.CouponID,x.n.value('(@CouponNo)[1]','varchar(25)'),x.n.value('(@PostInv)[1]','char(1)'),
  r.Qty,r.Qty,x.n.value('(@SOInvID)[1]','int'),x.n.value('(@SOListNo)[1]','smallint'),x.n.value('(@IsCheck)[1]','char(1)')
 FROM @lines.nodes('/line') x(n) JOIN @replacement r ON r.Listno=x.n.value('(@Listno)[1]','smallint') AND r.CouponID=x.n.value('(@CouponID)[1]','int')
 WHERE r.Qty>0;
 UPDATE c SET RemaQty=c.RemaQty-r.Qty
 FROM dbo.WFCoupon c JOIN @replacement r ON r.CouponID=c.CouponID WHERE r.Qty>0;
 IF NOT EXISTS(SELECT 1 FROM wf.CouponNativeEditCompletion WHERE EditId=@EditId)
 BEGIN RAISERROR('COUPON_EDIT_RESUME_DID_NOT_COMPLETE',16,1);RETURN;END;
END;
GO

-- ALTER TRIGGER reenables a disabled trigger. Preserve its original state.
CREATE TABLE #CouponResumeTriggerState(Name sysname PRIMARY KEY,WasDisabled bit NOT NULL);
INSERT #CouponResumeTriggerState SELECT name,is_disabled FROM sys.triggers
 WHERE object_id IN(OBJECT_ID('wf.WF_CouponNativeEditFinalize'),OBJECT_ID('dbo.WF_CouponNativeEditBalanceHook'));
IF @@ROWCOUNT<>2 RAISERROR('COUPON_EDIT_RESUME_TRIGGER_MISSING',16,1);
GO
ALTER TRIGGER wf.WF_CouponNativeEditFinalize ON wf.CouponNativeEditCompletion
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    -- Each receipt is one full document, owned by the original transaction.
    IF EXISTS (SELECT 1 FROM deleted) OR (SELECT COUNT(*) FROM inserted)<>1
    BEGIN ROLLBACK TRANSACTION;RAISERROR('COUPON_EDIT_COMPLETION_RECEIPT_INVALID',16,1);RETURN;END;

    DECLARE @edit UNIQUEIDENTIFIER,@tx BIGINT,@began DATETIME,@resource NVARCHAR(255);
    DECLARE @doc INT,@operation CHAR(1),@number VARCHAR(50),@date DATE,@effective INT,@actor INT;
    SELECT @edit=EditId FROM inserted;
    SET @resource=N'WF_NATIVE_EDIT_'+CONVERT(nvarchar(36),@edit);
    SELECT @tx=c.transaction_id,@began=a.transaction_begin_time
      FROM sys.dm_tran_current_transaction c
      JOIN sys.dm_tran_active_transactions a ON a.transaction_id=c.transaction_id;
    IF @tx IS NULL OR @began IS NULL
       OR ISNULL(APPLOCK_MODE('public',@resource,'Transaction'),'NoLock')<>'Exclusive'
    BEGIN ROLLBACK TRANSACTION;RAISERROR('COUPON_EDIT_COMPLETION_ORIGIN',16,1);RETURN;END;

    SELECT TOP 1 @doc=NativeRedemptionId,@operation=PlannedOperation,@number=PlannedDocuNo,
        @date=PlannedDocuDate,@effective=PlannedEffectiveUserId,@actor=PlannedActorUserId
    FROM wf.CouponNativeEditHold WITH (UPDLOCK,HOLDLOCK) WHERE EditId=@edit ORDER BY CouponId;
    IF @doc IS NULL OR @operation IS NULL OR @operation NOT IN ('E','C')
       OR NULLIF(RTRIM(@number),'') IS NULL OR @date IS NULL
       OR ISNULL(@effective,0)<=0 OR ISNULL(@actor,0)<=0
       OR EXISTS(
          SELECT 1 FROM wf.CouponNativeEditHold h WITH (UPDLOCK,HOLDLOCK)
          WHERE h.EditId=@edit AND (
              wf.fn_CouponNativeEditTransactionMatches(@edit,@tx,@began,h.OriginTransactionId,h.OriginTransactionStartedAt)<>1
              OR h.NativeRedemptionId<>@doc OR ISNULL(h.PlannedOperation,'')<>@operation
              OR ISNULL(h.PlannedDocuNo,'')<>@number OR h.PlannedDocuDate IS NULL OR h.PlannedDocuDate<>@date
              OR ISNULL(h.PlannedEffectiveUserId,0)<>@effective OR ISNULL(h.PlannedActorUserId,0)<>@actor
              OR h.PlannedSettlementId IS NULL OR ISNULL(h.PlannedBeforeQty,0)<=0
              OR h.PlannedAfterQty IS NULL OR h.PlannedAfterQty<0 OR h.PlannedAfterQty>h.PlannedBeforeQty
              OR h.PlannedNativeBefore IS NULL OR h.PlannedNativeBefore<0
              OR (@operation='C' AND h.PlannedAfterQty<>0)
          )
       )
       OR NOT EXISTS(SELECT 1 FROM wf.AppUser WITH (HOLDLOCK) WHERE Id=@effective AND IsActive=1)
       OR NOT EXISTS(SELECT 1 FROM wf.AppUser WITH (HOLDLOCK) WHERE Id=@actor AND IsActive=1)
       OR NOT EXISTS(SELECT 1 FROM wf.CouponNativeEditHold WHERE EditId=@edit AND PlannedAfterQty<PlannedBeforeQty)
    BEGIN ROLLBACK TRANSACTION;RAISERROR('COUPON_EDIT_COMPLETION_PLAN_INVALID',16,1);RETURN;END;

    -- Do not infer "cancel" from temporary absence during WinSpeed's edit.
    IF (@operation='C' AND (
        EXISTS(SELECT 1 FROM dbo.WFRedemtionHD WITH (HOLDLOCK) WHERE RedemtionID=@doc)
        OR EXISTS(SELECT 1 FROM dbo.WFRedemtionDT WITH (HOLDLOCK) WHERE RedemtionID=@doc)
    )) OR (@operation='E' AND (
        (SELECT COUNT(*) FROM dbo.WFRedemtionHD WITH (HOLDLOCK) WHERE RedemtionID=@doc
          AND DocuType=116 AND RTRIM(DocuNo)=@number AND CONVERT(date,DocuDate)=@date
          AND LTRIM(RTRIM(DocuStatus)) IN ('N','Y'))<>1
        OR NOT EXISTS(SELECT 1 FROM wf.CouponNativeEditHold WHERE EditId=@edit AND PlannedAfterQty>0)
        OR (SELECT COUNT(*) FROM dbo.WFRedemtionDT WITH (HOLDLOCK) WHERE RedemtionID=@doc)<>
           (SELECT COUNT(*) FROM wf.CouponNativeEditHold WHERE EditId=@edit AND PlannedAfterQty>0)
    ))
    BEGIN ROLLBACK TRANSACTION;RAISERROR('COUPON_EDIT_COMPLETION_SOURCE_INCOMPLETE',16,1);RETURN;END;

    -- Version one handles the first recovery only, and all original 116
    -- settlements must be covered. History is checked across the cutoff.
    IF EXISTS(
        SELECT 1 FROM wf.CouponReservationSettlement s WITH (HOLDLOCK)
        WHERE s.NativeRedemptionId=@doc AND NOT EXISTS (
            SELECT 1 FROM wf.CouponNativeEditHold h WHERE h.EditId=@edit AND h.PlannedSettlementId=s.Id
        )
    ) OR EXISTS(
        SELECT 1 FROM wf.CouponNativeEditHold h WITH (HOLDLOCK)
        LEFT JOIN dbo.WFCoupon c WITH (UPDLOCK,HOLDLOCK) ON c.CouponID=h.CouponId
        LEFT JOIN wf.CouponNativeCutAuthorizationLine al WITH (HOLDLOCK) ON al.Id=h.AuthorizationLineId
        LEFT JOIN wf.CouponNativeCutEvidence e WITH (HOLDLOCK) ON e.AuthorizationLineId=al.Id
        LEFT JOIN wf.CouponReservationSettlement s WITH (UPDLOCK,HOLDLOCK) ON s.Id=h.PlannedSettlementId
        LEFT JOIN wf.CouponReservation r WITH (UPDLOCK,HOLDLOCK) ON r.Id=s.ReservationId
        WHERE h.EditId=@edit AND (
            c.RemaQty IS NULL OR c.RemaQty<>h.PlannedNativeBefore+h.PlannedBeforeQty-h.PlannedAfterQty
            OR al.Id IS NULL OR al.CouponId<>h.CouponId OR al.AuthorizedQty<>h.PlannedBeforeQty
            OR e.AuthorizationLineId IS NULL OR e.EvidenceState<>'APPLIED' OR e.NativeRedemptionId<>@doc
            OR e.BalanceBefore-e.BalanceAfter<>h.PlannedBeforeQty
            OR s.Id IS NULL OR s.ReservationId<>al.ReservationId OR s.CouponId<>h.CouponId
            OR s.NativeRedemptionId<>@doc OR ISNULL(RTRIM(s.NativeDocuNo),'')<>@number OR s.SettledQty<>h.PlannedBeforeQty
            OR r.Id IS NULL OR r.CouponId<>h.CouponId OR r.ConsumedQty IS NULL
            OR r.ReservedQty IS NULL OR r.ConsumedQty<h.PlannedBeforeQty OR r.ConsumedQty>r.ReservedQty
            OR ISNULL(r.Status,'')<>CASE WHEN r.ConsumedQty=r.ReservedQty THEN 'CONSUMED' ELSE 'RESERVED' END
            OR EXISTS(SELECT 1 FROM wf.CouponNativeRecovery prior WITH (HOLDLOCK)
                       WHERE prior.SettlementId=s.Id OR prior.AuthorizationLineId=al.Id)
            OR (SELECT COUNT(*) FROM dbo.WFRedemtionDT d WITH (HOLDLOCK)
                 WHERE d.RedemtionID=@doc AND d.CouponID=h.CouponId)<>
                 CASE WHEN h.PlannedAfterQty>0 THEN 1 ELSE 0 END
            OR (h.PlannedAfterQty>0 AND NOT EXISTS(
                SELECT 1 FROM dbo.WFRedemtionDT d WITH (HOLDLOCK)
                WHERE d.RedemtionID=@doc AND d.CouponID=h.CouponId AND d.GoodQty=h.PlannedAfterQty
            ))
        )
    )
    BEGIN ROLLBACK TRANSACTION;RAISERROR('COUPON_EDIT_COMPLETION_PROOF_INVALID',16,1);RETURN;END;

    DECLARE @line BIGINT,@sid BIGINT,@reservation INT,@audit BIGINT;
    DECLARE @before DECIMAL(12,4),@after DECIMAL(12,4),@returned DECIMAL(12,4);
    DECLARE @nativeBefore DECIMAL(18,4),@nativeAfter DECIMAL(18,4),@json NVARCHAR(MAX);
    DECLARE changes CURSOR LOCAL FAST_FORWARD FOR
       SELECT h.AuthorizationLineId,h.PlannedSettlementId,s.ReservationId,
              h.PlannedBeforeQty,h.PlannedAfterQty,h.PlannedNativeBefore
       FROM wf.CouponNativeEditHold h
       JOIN wf.CouponReservationSettlement s ON s.Id=h.PlannedSettlementId
       WHERE h.EditId=@edit AND h.PlannedAfterQty<h.PlannedBeforeQty ORDER BY h.CouponId;
    OPEN changes;
    FETCH NEXT FROM changes INTO @line,@sid,@reservation,@before,@after,@nativeBefore;
    WHILE @@FETCH_STATUS=0
    BEGIN
        SET @returned=@before-@after;
        SET @nativeAfter=@nativeBefore+@returned;
        SET @json=N'{"authorizationLineId":"'+CONVERT(nvarchar(20),@line)+N'","settlementId":"'+CONVERT(nvarchar(20),@sid)+
          N'","settledBefore":"'+CONVERT(nvarchar(32),@before)+N'","settledAfter":"'+CONVERT(nvarchar(32),@after)+
          N'","restoredQty":"'+CONVERT(nvarchar(32),@returned)+N'","nativeBefore":"'+CONVERT(nvarchar(32),@nativeBefore)+
          N'","nativeAfter":"'+CONVERT(nvarchar(32),@nativeAfter)+N'"}';
        INSERT wf.ChangeEvent(EntityType,EntityId,Action,ReasonCode,UserId,ActorUserId,AfterJson)
          VALUES('COUPON_RESERVATION',CONVERT(varchar(100),@reservation),'NATIVE_RECOVERY','NATIVE_116_RECOVERY',
                 CONVERT(varchar(20),@effective),CONVERT(varchar(20),@actor),@json);
        SET @audit=SCOPE_IDENTITY();
        INSERT wf.CouponNativeRecovery(AuthorizationLineId,SettlementId,RecoveryKey,SettledBefore,SettledAfter,
            RestoredQty,NativeBefore,NativeAfter,AuditEventId,EffectiveUserId,ActorUserId)
          VALUES(@line,@sid,CONVERT(varchar(36),@edit)+':'+CONVERT(varchar(20),@sid),
            @before,@after,@returned,@nativeBefore,@nativeAfter,@audit,@effective,@actor);
        UPDATE wf.CouponReservation
          SET ConsumedQty=ConsumedQty-@returned,Status='RESERVED',UpdatedAt=GETUTCDATE()
          WHERE Id=@reservation AND ConsumedQty>=@returned;
        IF @@ROWCOUNT<>1
        BEGIN ROLLBACK TRANSACTION;RAISERROR('COUPON_EDIT_COMPLETION_RESERVATION_CHANGED',16,1);RETURN;END;
        FETCH NEXT FROM changes INTO @line,@sid,@reservation,@before,@after,@nativeBefore;
    END;
    CLOSE changes;
    DEALLOCATE changes;
    -- Retain the hold until readers support reversals and verified release.
END;
GO
ALTER TRIGGER dbo.WF_CouponNativeEditBalanceHook ON dbo.WFCoupon
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT UPDATE(RemaQty) RETURN;
    DECLARE @changed TABLE(CouponId INT PRIMARY KEY, BeforeBalance DECIMAL(18,4), AfterBalance DECIMAL(18,4));
    INSERT @changed
      SELECT i.CouponID,d.RemaQty,i.RemaQty FROM inserted i JOIN deleted d ON d.CouponID=i.CouponID
      WHERE i.RemaQty IS NULL OR d.RemaQty IS NULL OR i.RemaQty<>d.RemaQty;
    DECLARE @candidates TABLE(EditId UNIQUEIDENTIFIER PRIMARY KEY);
    INSERT @candidates
      SELECT p.EditId FROM @changed c JOIN wf.CouponNativeEditIntent p WITH (UPDLOCK,HOLDLOCK) ON p.CouponId=c.CouponId
      WHERE p.ExpiresAt>GETUTCDATE()
        AND NOT EXISTS(SELECT 1 FROM wf.CouponNativeEditRelease x WITH (HOLDLOCK) WHERE x.EditId=p.EditId)
      UNION
      SELECT h.EditId FROM @changed c JOIN wf.CouponNativeEditHold h WITH (UPDLOCK,HOLDLOCK) ON h.CouponId=c.CouponId
      WHERE NOT EXISTS(SELECT 1 FROM wf.CouponNativeEditRelease x WITH (HOLDLOCK) WHERE x.EditId=h.EditId);
    IF NOT EXISTS(SELECT 1 FROM @candidates) RETURN;
    IF (SELECT COUNT(*) FROM @candidates)<>1
    BEGIN ROLLBACK TRANSACTION;RAISERROR('COUPON_EDIT_HOOK_AMBIGUOUS',16,1);RETURN;END;

    DECLARE @edit UNIQUEIDENTIFIER,@tx BIGINT,@began DATETIME,@resource NVARCHAR(255),@lock INT;
    SELECT @edit=EditId FROM @candidates;
    SET @resource=N'WF_NATIVE_EDIT_'+CONVERT(nvarchar(36),@edit);
    SELECT @tx=c.transaction_id,@began=a.transaction_begin_time
       FROM sys.dm_tran_current_transaction c
       JOIN sys.dm_tran_active_transactions a ON a.transaction_id=c.transaction_id;
    IF @tx IS NULL OR @began IS NULL
    BEGIN ROLLBACK TRANSACTION;RAISERROR('COUPON_EDIT_HOOK_ORIGIN_UNAVAILABLE',16,1);RETURN;END;

    IF EXISTS(SELECT 1 FROM wf.CouponNativeEditHold WHERE EditId=@edit)
    BEGIN
        IF ISNULL(APPLOCK_MODE('public',@resource,'Transaction'),'NoLock')<>'Exclusive'
           OR EXISTS(SELECT 1 FROM wf.CouponNativeEditHold h WHERE h.EditId=@edit
                     AND (wf.fn_CouponNativeEditTransactionMatches(@edit,@tx,@began,h.OriginTransactionId,h.OriginTransactionStartedAt)<>1 OR h.PlannedOperation<>'E'))
           OR EXISTS(
             SELECT 1 FROM wf.CouponNativeEditHold h LEFT JOIN @changed c ON c.CouponId=h.CouponId
             WHERE h.EditId=@edit AND h.PlannedAfterQty>0 AND
               (c.BeforeBalance IS NULL OR c.AfterBalance IS NULL
               OR c.BeforeBalance<>h.PlannedNativeBefore+h.PlannedBeforeQty
               OR c.AfterBalance<>c.BeforeBalance-h.PlannedAfterQty)
           )
           OR EXISTS(SELECT 1 FROM @changed c WHERE NOT EXISTS(
             SELECT 1 FROM wf.CouponNativeEditHold h WHERE h.EditId=@edit AND h.CouponId=c.CouponId AND h.PlannedAfterQty>0))
        BEGIN ROLLBACK TRANSACTION;RAISERROR('COUPON_EDIT_HOOK_FINAL_BALANCE_INVALID',16,1);RETURN;END;
        EXEC wf.sp_CouponNativeEditFinish @edit;
        RETURN;
    END;

    EXEC @lock=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=0,@DbPrincipal='public';
    IF @lock<0 OR EXISTS(SELECT 1 FROM wf.CouponNativeEditCompletion WHERE EditId=@edit)
       OR EXISTS(SELECT 1 FROM @changed c WHERE NOT EXISTS(
         SELECT 1 FROM wf.CouponNativeEditIntent p WHERE p.EditId=@edit AND p.CouponId=c.CouponId))
       OR EXISTS(
          SELECT 1 FROM wf.CouponNativeEditIntent p WITH (UPDLOCK,HOLDLOCK)
          LEFT JOIN @changed c ON c.CouponId=p.CouponId
          LEFT JOIN dbo.WFRedemtionHD h WITH (HOLDLOCK) ON h.RedemtionID=p.NativeRedemptionId
          WHERE p.EditId=@edit AND (p.ExpiresAt<=GETUTCDATE() OR
            c.BeforeBalance IS NULL OR c.AfterBalance IS NULL OR c.BeforeBalance<>p.NativeBefore
            OR c.AfterBalance<>p.NativeBefore+p.QtyBefore OR h.RedemtionID IS NULL OR h.DocuType<>116
            OR ISNULL(LTRIM(RTRIM(h.DocuStatus)),'') NOT IN ('N','Y')
            OR h.DocuNo IS NULL OR RTRIM(h.DocuNo)<>p.DocuNo OR h.DocuDate IS NULL OR CONVERT(date,h.DocuDate)<>p.DocuDate
            OR (SELECT COUNT(*) FROM dbo.WFRedemtionDT d WITH (HOLDLOCK)
              WHERE d.RedemtionID=p.NativeRedemptionId AND d.CouponID=p.CouponId)<>1
            OR NOT EXISTS(SELECT 1 FROM dbo.WFRedemtionDT d WITH (HOLDLOCK)
              WHERE d.RedemtionID=p.NativeRedemptionId AND d.CouponID=p.CouponId AND d.GoodQty=p.QtyBefore))
       )
    BEGIN ROLLBACK TRANSACTION;RAISERROR('COUPON_EDIT_HOOK_UNWIND_INVALID',16,1);RETURN;END;
    INSERT wf.CouponNativeEditHold(CouponId,AuthorizationLineId,NativeRedemptionId,EditId,
        OriginTransactionId,OriginTransactionStartedAt,PlannedSettlementId,PlannedBeforeQty,PlannedAfterQty,
        PlannedNativeBefore,PlannedOperation,PlannedDocuNo,PlannedDocuDate,PlannedEffectiveUserId,PlannedActorUserId)
    SELECT CouponId,AuthorizationLineId,NativeRedemptionId,EditId,@tx,@began,SettlementId,QtyBefore,QtyAfter,
        NativeBefore,Operation,DocuNo,DocuDate,EffectiveUserId,ActorUserId
    FROM wf.CouponNativeEditIntent WHERE EditId=@edit;
END;
GO
ALTER PROCEDURE wf.sp_CouponNativeEditCheckSource @doc INT,@hasInserted BIT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @edit UNIQUEIDENTIFIER,@operation CHAR(1),@tx BIGINT,@began DATETIME,@resource NVARCHAR(255);
    SELECT @tx=c.transaction_id,@began=a.transaction_begin_time
      FROM sys.dm_tran_current_transaction c
      JOIN sys.dm_tran_active_transactions a ON a.transaction_id=c.transaction_id;
    SELECT TOP 1 @edit=EditId,@operation=PlannedOperation
      FROM wf.CouponNativeEditHold WITH (UPDLOCK,HOLDLOCK) WHERE NativeRedemptionId=@doc ORDER BY CouponId;
    SET @resource=N'WF_NATIVE_EDIT_'+CONVERT(nvarchar(36),@edit);
    IF @operation='C' AND @hasInserted=1
    BEGIN ROLLBACK TRANSACTION;RAISERROR('COUPON_EDIT_HOOK_CANCEL_SOURCE_WRITE',16,1);RETURN;END;
    IF @edit IS NULL OR @tx IS NULL OR @began IS NULL
       OR @operation IS NULL OR @operation NOT IN ('E','C')
       OR ISNULL(APPLOCK_MODE('public',@resource,'Transaction'),'NoLock')<>'Exclusive'
       OR EXISTS(SELECT 1 FROM wf.CouponNativeEditHold WHERE NativeRedemptionId=@doc AND
                 (EditId<>@edit OR wf.fn_CouponNativeEditTransactionMatches(@edit,@tx,@began,OriginTransactionId,OriginTransactionStartedAt)<>1
                   OR PlannedOperation IS NULL OR PlannedOperation<>@operation))
    BEGIN ROLLBACK TRANSACTION;RAISERROR('COUPON_EDIT_HOOK_SOURCE_HELD',16,1);RETURN;END;
    IF EXISTS(SELECT 1 FROM wf.CouponNativeEditCompletion WHERE EditId=@edit)
    BEGIN
        -- Cascading deletes can notify both source triggers after the same
        -- cancellation has completed. Validate the original transaction above
        -- and accept only a repeat delete notification for an absent source.
        IF @operation='C' AND @hasInserted=0
           AND NOT EXISTS(SELECT 1 FROM dbo.WFRedemtionHD WITH (HOLDLOCK) WHERE RedemtionID=@doc)
           AND NOT EXISTS(SELECT 1 FROM dbo.WFRedemtionDT WITH (HOLDLOCK) WHERE RedemtionID=@doc) RETURN;
        ROLLBACK TRANSACTION;RAISERROR('COUPON_EDIT_HOOK_SOURCE_ALREADY_FINAL',16,1);RETURN;
    END;
    IF @operation='C' AND NOT EXISTS(SELECT 1 FROM dbo.WFRedemtionHD WITH (HOLDLOCK) WHERE RedemtionID=@doc)
       AND NOT EXISTS(SELECT 1 FROM dbo.WFRedemtionDT WITH (HOLDLOCK) WHERE RedemtionID=@doc)
        EXEC wf.sp_CouponNativeEditFinish @edit;
END;
GO
IF EXISTS(SELECT 1 FROM #CouponResumeTriggerState WHERE Name='WF_CouponNativeEditFinalize' AND WasDisabled=1)
 DISABLE TRIGGER wf.WF_CouponNativeEditFinalize ON wf.CouponNativeEditCompletion;
IF EXISTS(SELECT 1 FROM #CouponResumeTriggerState WHERE Name='WF_CouponNativeEditBalanceHook' AND WasDisabled=1)
 DISABLE TRIGGER dbo.WF_CouponNativeEditBalanceHook ON dbo.WFCoupon;
DROP TABLE #CouponResumeTriggerState;
GO
