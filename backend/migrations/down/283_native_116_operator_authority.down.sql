-- @transaction
-- Direct admission is not installed by 283. Refuse removal once its consumer
-- exists rather than leave a future native hook without its authority checks.
IF OBJECT_ID('wf.sp_CouponNative116Admit','P') IS NOT NULL
 BEGIN RAISERROR('NATIVE_116_ADMISSION_DOWNGRADE_REQUIRED',16,1);RETURN;END;
GO
IF OBJECT_ID('wf.sp_ResolveNative116Operator','P') IS NOT NULL DROP PROCEDURE wf.sp_ResolveNative116Operator;
IF OBJECT_ID('wf.fn_Native116Permission','FN') IS NOT NULL DROP FUNCTION wf.fn_Native116Permission;
GO
