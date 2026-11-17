-- This rollback is for an unused candidate only. Keep approvals, holds and
-- completion receipts once written so their audit can be reconstructed.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF EXISTS (SELECT 1 FROM wf.CouponNativeEditIntent WITH (TABLOCKX,HOLDLOCK))
   OR EXISTS (SELECT 1 FROM wf.CouponNativeEditHold WITH (TABLOCKX,HOLDLOCK))
   OR EXISTS (SELECT 1 FROM wf.CouponNativeEditCompletion WITH (TABLOCKX,HOLDLOCK))
   OR EXISTS (SELECT 1 FROM wf.CouponNativeEditRelease WITH (TABLOCKX,HOLDLOCK))
BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR('COUPON_NATIVE_EDIT_HOOKS_HAS_EVIDENCE',16,1);
    RETURN;
END;
DROP TRIGGER dbo.WF_CouponNativeEditBalanceHook;
DROP TRIGGER dbo.WF_CouponNativeEditHeadHook;
DROP TRIGGER dbo.WF_CouponNativeEditDetailHook;
DROP PROCEDURE wf.sp_CouponNativeEditCheckSource;
DROP PROCEDURE wf.sp_CouponNativeEditFinish;
DROP TABLE wf.CouponNativeEditIntent;
DROP TABLE wf.CouponNativeEditRelease;
COMMIT TRANSACTION;
GO
