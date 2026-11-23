-- @transaction
-- Retain activation evidence and the metadata reader while v3 is active.
IF EXISTS(SELECT 1 FROM wf.NativeWriterRelease)
 OR EXISTS(SELECT 1 FROM wf.NativeWriterContract WHERE IsEnabled=1)
 OR EXISTS(SELECT 1 FROM wf.CouponBridgeContract WHERE Enabled=1)
 BEGIN RAISERROR('NATIVE_RELEASE_HISTORY_PREVENTS_DOWN',16,1);RETURN;END;
DROP PROCEDURE wf.usp_ReadNativeDocumentMetadata;
DROP TABLE wf.NativeWriterRelease;
REVOKE INSERT,UPDATE,DELETE ON OBJECT::wf.NativeWriterContract FROM public;
GO
