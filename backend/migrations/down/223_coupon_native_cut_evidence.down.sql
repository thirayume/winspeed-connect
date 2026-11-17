-- Never discard an incomplete or applied proof with an ordinary rollback.
IF OBJECT_ID('wf.CouponNativeRecovery','U') IS NOT NULL
BEGIN RAISERROR('COUPON_RECOVERY_LEDGER_SCHEMA_EXISTS',16,1);RETURN;END;
IF OBJECT_ID('dbo.WF_CouponEvidenceHeaderFence','TR') IS NOT NULL OR
 OBJECT_ID('dbo.WF_CouponEvidenceDetailFence','TR') IS NOT NULL OR
 OBJECT_ID('dbo.WF_CouponEvidenceInsertFence','TR') IS NOT NULL
BEGIN RAISERROR('COUPON_EVIDENCE_SOURCE_FENCE_EXISTS',16,1);RETURN;END;
IF OBJECT_ID('dbo.WF_CouponReservationGuard','TR') IS NOT NULL AND
 (OBJECT_DEFINITION(OBJECT_ID('dbo.WF_CouponReservationGuard')) IS NULL OR
  OBJECT_DEFINITION(OBJECT_ID('dbo.WF_CouponReservationGuard')) LIKE '%WF_GUARD_224_V%')
BEGIN RAISERROR('COUPON_EVIDENCE_GUARD_SCHEMA_EXISTS',16,1);RETURN;END;
IF OBJECT_ID('wf.WF_CouponAuthorizationReservationFence','TR') IS NOT NULL AND
 (OBJECT_DEFINITION(OBJECT_ID('wf.WF_CouponAuthorizationReservationFence')) IS NULL OR
  OBJECT_DEFINITION(OBJECT_ID('wf.WF_CouponAuthorizationReservationFence')) LIKE '%WF_AUTH_FENCE_225_V%')
BEGIN RAISERROR('COUPON_EVIDENCE_FENCE_SCHEMA_EXISTS',16,1);RETURN;END;
DECLARE @hasEvidence BIT;SET @hasEvidence=0;
IF OBJECT_ID('wf.CouponNativeCutEvidence','U') IS NOT NULL
 EXEC sp_executesql N'IF EXISTS(SELECT 1 FROM wf.CouponNativeCutEvidence) SET @found=1',
   N'@found BIT OUTPUT',@found=@hasEvidence OUTPUT;
IF @hasEvidence=1 BEGIN RAISERROR('COUPON_NATIVE_CUT_EVIDENCE_EXISTS',16,1);RETURN;END;
IF OBJECT_ID('wf.CouponNativeCutEvidence','U') IS NOT NULL DROP TABLE wf.CouponNativeCutEvidence;
GO
