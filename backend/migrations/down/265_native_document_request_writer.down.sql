-- @transaction
IF OBJECT_ID('wf.NativeDocumentReceipt','U') IS NOT NULL
BEGIN
 IF EXISTS(SELECT 1 FROM wf.NativeDocumentReceipt)
 BEGIN RAISERROR('ROLLBACK_265_BLOCKED: native document history exists',16,1);RETURN;END;
END;
IF OBJECT_ID('wf.usp_WriteNativeRedemption','P') IS NOT NULL DROP PROCEDURE wf.usp_WriteNativeRedemption;
IF OBJECT_ID('wf.usp_WriteNativeBookingApproval','P') IS NOT NULL DROP PROCEDURE wf.usp_WriteNativeBookingApproval;
IF OBJECT_ID('wf.usp_ReadNativeDocumentRequest','P') IS NOT NULL DROP PROCEDURE wf.usp_ReadNativeDocumentRequest;
GO
