-- @transaction
-- No historical business audit is deleted or retargeted by rollback.
IF EXISTS(SELECT 1 FROM wf.NativeDocumentReceipt) RAISERROR('ND_HISTORY_PREVENTS_DOWN',16,1);
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
ALTER PROCEDURE wf.usp_ApplyNativeDocument @RequestId varchar(36),@UserId int,@ActorId int,@PrimaryUserId int,@PrimaryActorId int
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET ARITHABORT ON;SET ANSI_WARNINGS ON;
 IF @@TRANCOUNT=0 OR wf.fn_IsNativeDocumentTarget()<>1 BEGIN RAISERROR('ND_TARGET_NOT_READY',16,1);RETURN;END;
 DECLARE @Type int,@Revision int;
 SELECT @Type=DocuType,@Revision=Revision FROM wf.NativeDocumentRequest WITH(UPDLOCK,HOLDLOCK) WHERE RequestId=@RequestId;
 IF @Type IS NULL BEGIN RAISERROR('ND_REQUEST_NOT_FOUND',16,1);RETURN;END;
 IF EXISTS(SELECT 1 FROM wf.NativeDocumentReceipt WITH(UPDLOCK,HOLDLOCK) WHERE RequestId=@RequestId)
 BEGIN
  IF NOT EXISTS(SELECT 1 FROM wf.NativeDocumentReceipt WHERE RequestId=@RequestId AND UserId=@UserId AND ActorUserId=@ActorId
    AND PrimaryUserId=@PrimaryUserId AND PrimaryActorId=@PrimaryActorId AND NativeAfterHash IS NOT NULL)
   BEGIN RAISERROR('ND_REQUEST_CONFLICT',16,1);RETURN;END;
  SELECT * FROM wf.NativeDocumentReceipt WHERE RequestId=@RequestId;RETURN;
 END;
 CREATE TABLE #NativeResult(NativeId int NOT NULL,NativeNo varchar(30) NOT NULL,FinanceId int NULL);
 CREATE TABLE #NativeLines(NativeLineNo int PRIMARY KEY,SourceId int NOT NULL,SourceLineNo int NOT NULL,CouponId int NULL,CouponNo varchar(25) NULL,
  Quantity decimal(18,4) NOT NULL,GrossAmount decimal(18,4) NOT NULL,DiscountAmount decimal(18,4) NOT NULL,TaxBase decimal(18,4) NOT NULL);
 BEGIN TRY
  IF @Type=119 EXEC wf.usp_WriteNativeBookingApproval @RequestId,@UserId,@ActorId;
  ELSE IF @Type=104 EXEC wf.usp_WriteNativeDelivery @RequestId,@UserId,@ActorId;
  ELSE IF @Type=116 EXEC wf.usp_WriteNativeRedemption @RequestId,@UserId,@ActorId;
  ELSE IF @Type=107 EXEC wf.usp_WriteNativeInvoice @RequestId,@UserId,@ActorId;
  IF(SELECT COUNT(*) FROM #NativeResult)<>1 OR(@Type<>119 AND NOT EXISTS(SELECT 1 FROM #NativeLines))
   BEGIN RAISERROR('ND_WRITER_INCOMPLETE',16,1);RETURN;END;
  INSERT wf.NativeDocumentReceipt(RequestId,PolicyVersion,DocuType,OperationKey,SourceId,SourceKind,NativeId,NativeNo,FinanceId,
   UserId,ActorUserId,PrimaryUserId,PrimaryActorId,SourceBeforeHash)
  SELECT r.RequestId,r.PolicyVersion,r.DocuType,r.OperationKey,r.SourceId,r.SourceKind,n.NativeId,n.NativeNo,n.FinanceId,
   @UserId,@ActorId,@PrimaryUserId,@PrimaryActorId,r.SourceHash FROM wf.NativeDocumentRequest r CROSS JOIN #NativeResult n WHERE r.RequestId=@RequestId AND r.Status='APPROVED' AND r.ExpiresAtUtc>GETUTCDATE();
  IF @@ROWCOUNT<>1 BEGIN RAISERROR('ND_REQUEST_STALE',16,1);RETURN;END;
  INSERT wf.NativeDocumentReceiptLine(RequestId,NativeLineNo,DocuType,SourceId,SourceLineNo,CouponId,CouponNo,Quantity,GrossAmount,DiscountAmount,TaxBase)
   SELECT @RequestId,NativeLineNo,@Type,SourceId,SourceLineNo,CouponId,CouponNo,Quantity,GrossAmount,DiscountAmount,TaxBase FROM #NativeLines;
  UPDATE wf.NativeDocumentRequest SET Status='CONSUMED',Revision=Revision+1 WHERE RequestId=@RequestId AND Status='APPROVED' AND Revision=@Revision;
  IF @@ROWCOUNT<>1 BEGIN RAISERROR('ND_REQUEST_STALE',16,1);RETURN;END;
  INSERT wf.SalesOrderAudit(SoId,UserId,ActorUserId,Action,Note) SELECT CONVERT(varchar(50),SourceId),@UserId,@ActorId,'NATIVE_DOCUMENT_APPLIED',
   N'v3;type='+CONVERT(nvarchar(4),@Type)+N';request='+@RequestId+N';primary='+CONVERT(nvarchar(12),@PrimaryUserId)+N';actorPrimary='+CONVERT(nvarchar(12),@PrimaryActorId) FROM wf.NativeDocumentRequest WHERE RequestId=@RequestId;
  SELECT * FROM wf.NativeDocumentReceipt WHERE RequestId=@RequestId;
 END TRY
 BEGIN CATCH
  DECLARE @Message nvarchar(2048);SET @Message=ERROR_MESSAGE();RAISERROR('%s',16,1,@Message);
 END CATCH;
END;
GO
