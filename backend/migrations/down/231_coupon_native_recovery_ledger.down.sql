-- A recovery ledger and its audit may never be discarded by a normal down.
DECLARE @hasRecovery BIT;SET @hasRecovery=0;
IF OBJECT_ID('wf.CouponNativeRecovery','U') IS NOT NULL
 EXEC sp_executesql N'IF EXISTS(SELECT 1 FROM wf.CouponNativeRecovery) SET @found=1',
  N'@found BIT OUTPUT',@found=@hasRecovery OUTPUT;
IF @hasRecovery=1 BEGIN RAISERROR('COUPON_RECOVERY_LEDGER_NOT_EMPTY',16,1);RETURN;END;
IF OBJECT_ID('wf.CouponNativeRecovery','U') IS NOT NULL DROP TABLE wf.CouponNativeRecovery;
GO
