-- Never discard unresolved edit evidence during a schema rollback.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    IF OBJECT_ID('wf.CouponNativeEditHold','U') IS NOT NULL
    BEGIN
        DECLARE @nonempty BIT;
        SET @nonempty=0;
        EXEC sys.sp_executesql
          N'IF EXISTS (SELECT 1 FROM wf.CouponNativeEditHold WITH (TABLOCKX,HOLDLOCK))
                SET @found=1;',
          N'@found BIT OUTPUT', @found=@nonempty OUTPUT;
        IF @nonempty=1 RAISERROR('COUPON_NATIVE_EDIT_HOLD_NOT_EMPTY',16,1);
    END;
    IF OBJECT_ID('dbo.WF_CouponNativeEditHoldGuard','TR') IS NOT NULL
        DROP TRIGGER dbo.WF_CouponNativeEditHoldGuard;
    IF OBJECT_ID('wf.CouponNativeEditHold','U') IS NOT NULL DROP TABLE wf.CouponNativeEditHold;
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    DECLARE @message NVARCHAR(2048);
    SET @message=ERROR_MESSAGE();
    RAISERROR(@message,16,1);
END CATCH;
GO
