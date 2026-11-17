-- @transaction
-- XML snapshot reads require SQL Server 2008 XML-compatible SET options.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO
ALTER PROCEDURE wf.sp_ResumeCouponNativeEdit
 @EditId uniqueidentifier,@EffectiveUserId int,@ActorUserId int,@Reason nvarchar(500)
AS
BEGIN
 SET NOCOUNT ON; SET ARITHABORT ON; SET ANSI_WARNINGS ON;
 IF @@TRANCOUNT<1 OR XACT_STATE()<>1
 BEGIN RAISERROR('COUPON_EDIT_RESUME_TRANSACTION_REQUIRED',16,1);RETURN;END;
 IF LEN(LTRIM(RTRIM(ISNULL(@Reason,''))))<10
  OR NOT EXISTS(SELECT 1 FROM wf.AppUser WITH(HOLDLOCK) WHERE Id=@EffectiveUserId AND IsActive=1)
  OR NOT EXISTS(SELECT 1 FROM wf.AppUser WITH(HOLDLOCK) WHERE Id=@ActorUserId AND IsActive=1)
 BEGIN RAISERROR('COUPON_EDIT_RESUME_ACTOR_INVALID',16,1);RETURN;END;
 DECLARE @lock int,@resource nvarchar(255),@audit bigint;
 DECLARE @id int,@head xml,@lines xml,@lineCount int;
 SET @resource=N'WF_NATIVE_EDIT_'+CONVERT(nvarchar(36),@EditId);
 EXEC @lock=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=0,@DbPrincipal='public';
 SELECT @id=NativeRedemptionId,@head=SourceHeader,@lines=SourceLines
 FROM wf.CouponNativeEditSnapshot WITH(UPDLOCK,HOLDLOCK) WHERE EditId=@EditId;
 SELECT @lineCount=COUNT(*) FROM wf.CouponNativeEditHold WITH(UPDLOCK,HOLDLOCK) WHERE EditId=@EditId;
 IF @lock<0 OR @id IS NULL OR @lineCount NOT BETWEEN 1 AND 100
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
    OR ISNULL(h.PlannedOperation,'')<>'E'
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
 BEGIN TRY
 INSERT wf.CouponNativeEditResumeActive(EditId,SessionId) VALUES(@EditId,@@SPID);
 INSERT wf.ChangeEvent(EntityType,EntityId,Action,ReasonCode,ReasonText,UserId,ActorUserId)
 VALUES('COUPON_NATIVE_EDIT',CONVERT(varchar(36),@EditId),'RESUME','NATIVE_116_RESUME',@Reason,
 CONVERT(varchar(20),@EffectiveUserId),CONVERT(varchar(20),@ActorUserId));
 SET @audit=SCOPE_IDENTITY();
 INSERT wf.CouponNativeEditResume(EditId,TransactionId,TransactionStartedAt,AuditEventId)
 VALUES(@EditId,NULL,NULL,@audit);
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
 BEGIN RAISERROR('COUPON_EDIT_RESUME_DID_NOT_COMPLETE',16,1);END;
 DELETE wf.CouponNativeEditResumeActive WHERE EditId=@EditId AND SessionId=@@SPID;
 IF @@ROWCOUNT<>1 RAISERROR('COUPON_EDIT_RESUME_ACTIVE_PROOF_MISSING',16,1);
 END TRY
 BEGIN CATCH
   DECLARE @failure nvarchar(2047);
   SET @failure=ERROR_MESSAGE();
   IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
   RAISERROR('%s',16,1,@failure);
 END CATCH;
END;
GO
