-- @transaction
IF OBJECT_ID('wf.sp_CouponNative116Admit','P') IS NOT NULL
 BEGIN RAISERROR('NATIVE_116_ADMISSION_DOWNGRADE_REQUIRED',16,1);RETURN;END;
IF EXISTS(SELECT 1 FROM wf.Native116Stage) OR EXISTS(SELECT 1 FROM wf.Native116Contract WHERE Enabled=1)
 BEGIN RAISERROR('NATIVE_116_HISTORY_OR_ENABLEMENT_BLOCKS_DOWNGRADE',16,1);RETURN;END;
GO
DROP PROCEDURE wf.sp_Native116ObserveBalance;
DROP PROCEDURE wf.sp_Native116ObserveDetail;
DROP PROCEDURE wf.sp_Native116ObserveHead;
DROP PROCEDURE wf.sp_Native116StageCoupon;
DROP PROCEDURE wf.sp_Native116StageStep;
DROP PROCEDURE wf.sp_Native116StageGet;
DROP FUNCTION wf.fn_Native116Eligible;
DROP FUNCTION wf.fn_Native116StageOwned;
DROP FUNCTION wf.fn_Native116ReservationHeld;
DROP FUNCTION wf.fn_Native116HooksReady;
DROP TABLE wf.Native116AuditReceipt;
DROP TABLE wf.Native116StageStep;
DROP TABLE wf.Native116StageReservation;
DROP TABLE wf.Native116StageCoupon;
DROP TABLE wf.Native116Stage;
DROP TABLE wf.Native116HookContract;
DROP TABLE wf.Native116Contract;
GO
