-- Isolated QA only. Temporary wf triggers pause only the exact owned request
-- or permit configured by the operator. Never install on UAT/PROD.
IF DB_NAME()<>'dbwins_worldfert9_uat_v3' OR IS_SRVROLEMEMBER('sysadmin')<>1
 BEGIN RAISERROR('QA_OVERLAP_TARGET_REQUIRED',16,1);SET NOEXEC ON;END;
IF OBJECT_ID('wf.QaCouponBridgeOverlap','U') IS NOT NULL
 RAISERROR('QA_OVERLAP_ALREADY_INSTALLED',16,1);
GO
CREATE TABLE wf.QaCouponBridgeOverlap(
 Mode varchar(12) NOT NULL,ReservationKey nvarchar(120) NOT NULL,PermitId varchar(36) NOT NULL,
 Marker varbinary(128) NOT NULL,ExpiresAtUtc datetime NOT NULL
);
DENY SELECT,INSERT,UPDATE,DELETE ON OBJECT::wf.QaCouponBridgeOverlap TO public;
GO
CREATE TRIGGER wf.QaCouponBridgeReservationPause ON wf.CouponReservation AFTER INSERT AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @marker varbinary(128),@prior varbinary(128);
 SELECT @marker=q.Marker FROM wf.QaCouponBridgeOverlap q JOIN inserted i ON i.IdempotencyKey=q.ReservationKey
  WHERE q.Mode='APP_FIRST' AND q.ExpiresAtUtc>GETUTCDATE();
 IF @marker IS NULL RETURN;
 SET @prior=ISNULL(CONTEXT_INFO(),0x);
 BEGIN TRY
  SET CONTEXT_INFO @marker;
  WAITFOR DELAY '00:00:14';
  SET CONTEXT_INFO @prior;
 END TRY
 BEGIN CATCH
  SET CONTEXT_INFO @prior;
  DECLARE @message nvarchar(2048);SET @message=ERROR_MESSAGE();RAISERROR('%s',16,1,@message);
 END CATCH;
END;
GO
CREATE TRIGGER wf.QaCouponBridgeNativePause ON wf.CouponBridgeStep AFTER INSERT AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @marker varbinary(128),@prior varbinary(128);
 SELECT @marker=q.Marker FROM wf.QaCouponBridgeOverlap q JOIN inserted i ON i.PermitId=q.PermitId
  WHERE q.Mode='NATIVE_FIRST' AND q.ExpiresAtUtc>GETUTCDATE() AND i.Stage='START';
 IF @marker IS NULL RETURN;
 SET @prior=ISNULL(CONTEXT_INFO(),0x);
 BEGIN TRY
  SET CONTEXT_INFO @marker;
  WAITFOR DELAY '00:00:08';
  SET CONTEXT_INFO @prior;
 END TRY
 BEGIN CATCH
  SET CONTEXT_INFO @prior;
  DECLARE @message nvarchar(2048);SET @message=ERROR_MESSAGE();RAISERROR('%s',16,1,@message);
 END CATCH;
END;
