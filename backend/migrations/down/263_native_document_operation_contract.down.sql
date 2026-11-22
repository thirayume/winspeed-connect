-- @transaction
-- Applied native history is deliberately not removed by a schema rollback.
IF OBJECT_ID('wf.NativeDocumentReceipt','U') IS NOT NULL
BEGIN
 IF EXISTS(SELECT 1 FROM wf.NativeDocumentReceipt)
 BEGIN RAISERROR('ROLLBACK_263_BLOCKED: native document history exists',16,1);RETURN;END;
END;
IF OBJECT_ID('wf.NativeDocumentRequest','U') IS NOT NULL
BEGIN
 IF EXISTS(SELECT 1 FROM wf.NativeDocumentRequest)
 BEGIN RAISERROR('ROLLBACK_263_BLOCKED: native request history exists',16,1);RETURN;END;
END;
IF OBJECT_ID('wf.fn_IsNativeDocumentTarget','FN') IS NOT NULL DROP FUNCTION wf.fn_IsNativeDocumentTarget;
IF OBJECT_ID('wf.NativeDocumentReceiptLine','U') IS NOT NULL DROP TABLE wf.NativeDocumentReceiptLine;
IF OBJECT_ID('wf.NativeDocumentReceipt','U') IS NOT NULL DROP TABLE wf.NativeDocumentReceipt;
IF OBJECT_ID('wf.NativeDocumentRequest','U') IS NOT NULL DROP TABLE wf.NativeDocumentRequest;
IF OBJECT_ID('wf.NativeWriterContract','U') IS NOT NULL DROP TABLE wf.NativeWriterContract;
GO
