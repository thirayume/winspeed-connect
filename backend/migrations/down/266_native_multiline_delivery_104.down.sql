-- @transaction
IF OBJECT_ID('wf.NativeDocumentReceipt','U') IS NOT NULL
BEGIN
 IF EXISTS(SELECT 1 FROM wf.NativeDocumentReceipt WHERE DocuType=104)
 BEGIN RAISERROR('ROLLBACK_266_BLOCKED: delivery receipt history exists',16,1);RETURN;END;
END;
IF OBJECT_ID('wf.usp_WriteNativeDelivery','P') IS NOT NULL DROP PROCEDURE wf.usp_WriteNativeDelivery;
GO
