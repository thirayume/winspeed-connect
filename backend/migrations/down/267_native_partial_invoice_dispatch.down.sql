-- @transaction
IF EXISTS(SELECT 1 FROM wf.NativeDocumentReceipt) RAISERROR('ND_HISTORY_PREVENTS_DOWN',16,1);
ELSE BEGIN
 IF OBJECT_ID('wf.usp_ApplyNativeDocument','P') IS NOT NULL DROP PROCEDURE wf.usp_ApplyNativeDocument;
 IF OBJECT_ID('wf.usp_WriteNativeInvoice','P') IS NOT NULL DROP PROCEDURE wf.usp_WriteNativeInvoice;
END;
GO
