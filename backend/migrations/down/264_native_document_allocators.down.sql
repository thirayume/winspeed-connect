-- @transaction
IF OBJECT_ID('wf.NativeDocumentReceipt','U') IS NOT NULL
BEGIN
 IF EXISTS(SELECT 1 FROM wf.NativeDocumentReceipt)
 BEGIN RAISERROR('ROLLBACK_264_BLOCKED: native document history exists',16,1);RETURN;END;
END;
IF OBJECT_ID('wf.usp_AllocateNativeDocumentVAT','P') IS NOT NULL DROP PROCEDURE wf.usp_AllocateNativeDocumentVAT;
IF OBJECT_ID('wf.usp_AllocateNativeDocumentNo','P') IS NOT NULL DROP PROCEDURE wf.usp_AllocateNativeDocumentNo;
IF OBJECT_ID('wf.usp_AllocateNativeDocumentEventId','P') IS NOT NULL DROP PROCEDURE wf.usp_AllocateNativeDocumentEventId;
IF OBJECT_ID('wf.usp_AllocateNativeRedemptionId','P') IS NOT NULL DROP PROCEDURE wf.usp_AllocateNativeRedemptionId;
IF OBJECT_ID('wf.usp_AllocateNativeDocumentSAT','P') IS NOT NULL DROP PROCEDURE wf.usp_AllocateNativeDocumentSAT;
GO
