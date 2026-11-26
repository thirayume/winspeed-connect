-- @transaction
IF EXISTS(SELECT 1 FROM wf.CouponBridgePermit WHERE DATALENGTH(Receiver)>200)
 BEGIN RAISERROR('NATIVE_116_RECIPIENT_WIDTH_BLOCKS_DOWNGRADE',16,1);RETURN;END;
IF OBJECT_ID('dbo.WF_Native116AuditHook','TR') IS NOT NULL
 BEGIN RAISERROR('NATIVE_116_HOOK_DOWNGRADE_REQUIRED',16,1);RETURN;END;
IF EXISTS(SELECT 1 FROM sys.triggers WHERE name IN('WF_CouponNativeConsume','WF_CouponReservationGuard','WF_CouponNativeEditHeadHook','WF_CouponNativeEditDetailHook')
 AND(parent_id=OBJECT_ID('dbo.WFCoupon') OR parent_id=OBJECT_ID('dbo.WFRedemtionHD') OR parent_id=OBJECT_ID('dbo.WFRedemtionDT'))
 AND(OBJECT_DEFINITION(object_id) IS NULL OR CHARINDEX('Native116',OBJECT_DEFINITION(object_id))>0))
 BEGIN RAISERROR('NATIVE_116_HOOK_DOWNGRADE_REQUIRED',16,1);RETURN;END;
IF EXISTS(SELECT 1 FROM wf.Native116Stage) OR EXISTS(SELECT 1 FROM wf.CouponBridgePermit WHERE AuthorityMode='NATIVE_PFC_AUDIT')
 OR EXISTS(SELECT 1 FROM wf.Native116Contract WHERE Enabled=1)
 BEGIN RAISERROR('NATIVE_116_HISTORY_OR_ENABLEMENT_BLOCKS_DOWNGRADE',16,1);RETURN;END;
GO
ALTER FUNCTION wf.fn_CouponBridgeReservationHeld(@id bigint) RETURNS bit AS
BEGIN
 RETURN CASE WHEN EXISTS(SELECT 1 FROM wf.CouponBridgeAllocation a JOIN wf.CouponBridgePermit p ON p.PermitId=a.PermitId
  WHERE a.ReservationId=@id AND p.ReleasedAtUtc IS NULL AND p.State<>'CANCELLED'
   AND(p.ExpiresAtUtc>GETUTCDATE() OR p.StartedAtUtc IS NOT NULL)) THEN 1 ELSE 0 END;
END;
GO
ALTER TRIGGER wf.WF_CouponBridgeReservationFence ON wf.CouponReservation AFTER INSERT,UPDATE,DELETE AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS(SELECT 1 FROM wf.CouponBridgeContract WHERE Enabled=1 AND Version='116-BRIDGE-v1') RETURN;
 DECLARE @trusted bit;SET @trusted=0;
 IF EXISTS(SELECT 1 FROM wf.CouponBridgePermit p WHERE p.State='STARTED' AND p.ReleasedAtUtc IS NULL
  AND (wf.fn_CouponBridgeNativeOwned(p.PermitId)=1 OR wf.fn_CouponBridgeRecoveryOwned(p.PermitId)=1) AND(
   EXISTS(SELECT 1 FROM wf.CouponBridgeSession s WHERE s.PermitId=p.PermitId AND s.SessionId=@@SPID)
   OR ISNULL(TRIGGER_NESTLEVEL(OBJECT_ID('dbo.WF_CouponNativeConsume'),'AFTER','DML'),0)>0
   OR ISNULL(TRIGGER_NESTLEVEL(OBJECT_ID('dbo.WF_CouponNativeEditHeadHook'),'AFTER','DML'),0)>0
   OR ISNULL(TRIGGER_NESTLEVEL(OBJECT_ID('dbo.WF_CouponNativeEditDetailHook'),'AFTER','DML'),0)>0)) SET @trusted=1;
 IF @trusted=0 AND(EXISTS(SELECT 1 FROM deleted d WHERE wf.fn_CouponBridgeReservationHeld(d.Id)=1)
  OR EXISTS(SELECT 1 FROM inserted i JOIN wf.CouponBridgeLine l ON l.CouponId=i.CouponId
   JOIN wf.CouponBridgePermit p ON p.PermitId=l.PermitId WHERE p.State IN('STARTED','COMPLETE') AND p.ReleasedAtUtc IS NULL))
 BEGIN
  IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
  RAISERROR('BRIDGE_RESERVATION_HELD',16,1);RETURN;
 END;
END;
GO
DROP TRIGGER wf.Native116PermitLineFence;
DROP TRIGGER wf.Native116PermitFence;
DROP TRIGGER wf.Native116SettlementFence;
DROP TRIGGER wf.Native116ReservationFence;
DROP PROCEDURE wf.sp_CouponNative116Admit;
DROP PROCEDURE wf.sp_Native116DocumentFence;
DROP PROCEDURE wf.sp_Native116Floor;
DROP FUNCTION wf.fn_Native116BalanceWriter;
DROP TABLE wf.Native116BalanceContext;
DROP TABLE wf.Native116AuditContext;
ALTER TABLE wf.CouponBridgePermit DROP CONSTRAINT DF_CouponBridgePermit_AuthorityMode;
ALTER TABLE wf.CouponBridgePermit DROP COLUMN AuthorityMode,NativeAuditId;
ALTER TABLE wf.CouponBridgePermit ALTER COLUMN Receiver nvarchar(100) NOT NULL;
GO
