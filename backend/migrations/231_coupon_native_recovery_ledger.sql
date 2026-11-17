-- Candidate schema only: its fail-closed trigger rejects all ledger changes;
-- no writer, route or recovery is enabled.
-- Before using this table, every settlement reader must account for its rows,
-- and a reviewed bridge must prove native reversal, authorization, audit,
-- locking and atomicity against the actual WinSpeed transaction.
IF OBJECT_ID('wf.CouponNativeCutEvidence','U') IS NULL OR
 OBJECT_ID('wf.CouponReservationSettlement','U') IS NULL OR OBJECT_ID('wf.ChangeEvent','U') IS NULL
BEGIN RAISERROR('COUPON_RECOVERY_DEPENDENCIES_MISSING',16,1);RETURN;END;
IF OBJECT_ID('wf.CouponNativeRecovery','U') IS NOT NULL AND
 (COL_LENGTH('wf.CouponNativeRecovery','Id') IS NULL OR
  COL_LENGTH('wf.CouponNativeRecovery','AuthorizationLineId') IS NULL OR
  COL_LENGTH('wf.CouponNativeRecovery','SettlementId') IS NULL OR
  COL_LENGTH('wf.CouponNativeRecovery','RecoveryKey') IS NULL OR
  COL_LENGTH('wf.CouponNativeRecovery','SettledBefore') IS NULL OR
  COL_LENGTH('wf.CouponNativeRecovery','SettledAfter') IS NULL OR
  COL_LENGTH('wf.CouponNativeRecovery','RestoredQty') IS NULL OR
  COL_LENGTH('wf.CouponNativeRecovery','NativeBefore') IS NULL OR
  COL_LENGTH('wf.CouponNativeRecovery','NativeAfter') IS NULL OR
  COL_LENGTH('wf.CouponNativeRecovery','AuditEventId') IS NULL OR
  COL_LENGTH('wf.CouponNativeRecovery','EffectiveUserId') IS NULL OR
  COL_LENGTH('wf.CouponNativeRecovery','ActorUserId') IS NULL OR
  COL_LENGTH('wf.CouponNativeRecovery','CreatedAt') IS NULL OR
  NOT EXISTS(SELECT 1 FROM sys.key_constraints WHERE parent_object_id=OBJECT_ID('wf.CouponNativeRecovery') AND name='PK_CouponRecovery_231' AND type='PK') OR
  NOT EXISTS(SELECT 1 FROM sys.key_constraints WHERE parent_object_id=OBJECT_ID('wf.CouponNativeRecovery') AND name='UQ_CouponRecovery_Key_231' AND type='UQ') OR
  NOT EXISTS(SELECT 1 FROM sys.key_constraints WHERE parent_object_id=OBJECT_ID('wf.CouponNativeRecovery') AND name='UQ_CouponRecovery_State_231' AND type='UQ') OR
  NOT EXISTS(SELECT 1 FROM sys.key_constraints WHERE parent_object_id=OBJECT_ID('wf.CouponNativeRecovery') AND name='UQ_CouponRecovery_Audit_231' AND type='UQ') OR
  NOT EXISTS(SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID('wf.CouponNativeRecovery') AND name='FK_CouponRecovery_Evidence_231' AND is_disabled=0 AND is_not_trusted=0) OR
  NOT EXISTS(SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID('wf.CouponNativeRecovery') AND name='FK_CouponRecovery_Settlement_231' AND is_disabled=0 AND is_not_trusted=0) OR
  NOT EXISTS(SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID('wf.CouponNativeRecovery') AND name='FK_CouponRecovery_Audit_231' AND is_disabled=0 AND is_not_trusted=0) OR
  NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('wf.CouponNativeRecovery') AND name='CK_CouponRecovery_Qty_231' AND is_disabled=0 AND is_not_trusted=0) OR
  NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('wf.CouponNativeRecovery') AND name='CK_CouponRecovery_Actor_231' AND is_disabled=0 AND is_not_trusted=0) OR
  NOT EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID('wf.WF_CouponRecoveryFence') AND parent_id=OBJECT_ID('wf.CouponNativeRecovery') AND is_disabled=0) OR
  ISNULL(OBJECT_DEFINITION(OBJECT_ID('wf.WF_CouponRecoveryFence')),'') NOT LIKE '%WF_RECOVERY_FENCE_231_V1%')
BEGIN RAISERROR('COUPON_RECOVERY_EXISTING_REVIEW_REQUIRED',16,1);RETURN;END;
IF OBJECT_ID('wf.CouponNativeRecovery','U') IS NULL AND OBJECT_ID('wf.WF_CouponRecoveryFence','TR') IS NOT NULL
BEGIN RAISERROR('COUPON_RECOVERY_EXISTING_REVIEW_REQUIRED',16,1);RETURN;END;
BEGIN TRY
 BEGIN TRANSACTION;
IF OBJECT_ID('wf.CouponNativeRecovery','U') IS NULL
BEGIN
 CREATE TABLE wf.CouponNativeRecovery (
  Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CouponRecovery_231 PRIMARY KEY,
  AuthorizationLineId BIGINT NOT NULL,
  SettlementId BIGINT NOT NULL,
  RecoveryKey VARCHAR(100) NOT NULL,
  SettledBefore DECIMAL(12,4) NOT NULL,
  SettledAfter DECIMAL(12,4) NOT NULL,
  RestoredQty DECIMAL(12,4) NOT NULL,
  NativeBefore DECIMAL(18,4) NOT NULL,
  NativeAfter DECIMAL(18,4) NOT NULL,
  AuditEventId BIGINT NOT NULL,
  EffectiveUserId INT NOT NULL,
  ActorUserId INT NOT NULL,
  CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_CouponRecovery_Created_231 DEFAULT GETUTCDATE(),
  CONSTRAINT UQ_CouponRecovery_Key_231 UNIQUE(RecoveryKey),
  CONSTRAINT UQ_CouponRecovery_State_231 UNIQUE(SettlementId,SettledBefore),
  CONSTRAINT UQ_CouponRecovery_Audit_231 UNIQUE(AuditEventId),
  CONSTRAINT FK_CouponRecovery_Evidence_231 FOREIGN KEY(AuthorizationLineId) REFERENCES wf.CouponNativeCutEvidence(AuthorizationLineId),
  CONSTRAINT FK_CouponRecovery_Settlement_231 FOREIGN KEY(SettlementId) REFERENCES wf.CouponReservationSettlement(Id),
  CONSTRAINT FK_CouponRecovery_Audit_231 FOREIGN KEY(AuditEventId) REFERENCES wf.ChangeEvent(EventId),
  CONSTRAINT CK_CouponRecovery_Qty_231 CHECK(LEN(RecoveryKey)>0 AND SettledBefore>0 AND SettledAfter>=0 AND
   SettledAfter<SettledBefore AND RestoredQty=SettledBefore-SettledAfter AND NativeBefore>=0 AND NativeAfter-NativeBefore=RestoredQty),
  CONSTRAINT CK_CouponRecovery_Actor_231 CHECK(EffectiveUserId>0 AND ActorUserId>0)
 );
 EXEC(N'CREATE TRIGGER wf.WF_CouponRecoveryFence ON wf.CouponNativeRecovery AFTER INSERT,UPDATE,DELETE AS -- WF_RECOVERY_FENCE_231_V1
  BEGIN SET NOCOUNT ON;
   IF EXISTS(SELECT 1 FROM inserted) OR EXISTS(SELECT 1 FROM deleted)
   BEGIN ROLLBACK TRANSACTION;RAISERROR(''COUPON_RECOVERY_WRITER_UNAVAILABLE'',16,1);RETURN;END;
  END');
END;
 COMMIT TRANSACTION;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
 DECLARE @recoveryError NVARCHAR(2048);SET @recoveryError=ERROR_MESSAGE();RAISERROR(@recoveryError,16,1);RETURN;
END CATCH;
GO
