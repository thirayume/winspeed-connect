-- @transaction
-- Native WinSpeed callers use legacy SET options. Normalize only this procedure
-- scope before evaluating XML methods; SQL Server restores the caller on return.
-- Preserve the pending-save fence, native hooks and every native trigger.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
ALTER PROCEDURE wf.sp_Native116Floor @changes xml AS
BEGIN
 SET NOCOUNT ON;SET ANSI_WARNINGS ON;SET ANSI_PADDING ON;SET ARITHABORT ON;SET CONCAT_NULL_YIELDS_NULL ON;SET NUMERIC_ROUNDABORT OFF;
 IF EXISTS(SELECT 1 FROM @changes.nodes('/changes/row')t(n)
  JOIN wf.Native116StageCoupon c WITH(UPDLOCK,HOLDLOCK) ON c.CouponId=n.value('@couponId','int')
  JOIN wf.Native116Stage s WITH(UPDLOCK,HOLDLOCK) ON s.StageId=c.StageId
  WHERE s.State='PENDING' AND wf.fn_Native116StageOwned(s.StageId)<>1)
 BEGIN RAISERROR('NATIVE_116_COUPON_PENDING_REVIEW',16,1);RETURN;END;
END;
GO
