-- Candidate journal for an interrupted WinSpeed 116 edit. A row is inserted
-- before the first native change by the future edit bridge and survives a
-- partial commit. Its lifetime is independent of authorization expiry and the
-- display cutoff. This migration installs the WinSpeed guard disabled.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;

    IF OBJECT_ID('wf.CouponNativeRecovery','U') IS NULL
       OR OBJECT_ID('dbo.WFCoupon','U') IS NULL
    BEGIN
        RAISERROR('COUPON_NATIVE_EDIT_HOLD_DEPENDENCIES_MISSING',16,1);
    END;

    IF OBJECT_ID('wf.CouponNativeEditHold','U') IS NULL
    BEGIN
        CREATE TABLE wf.CouponNativeEditHold (
            CouponId INT NOT NULL,
            AuthorizationLineId BIGINT NOT NULL,
            NativeRedemptionId INT NOT NULL,
            EditId UNIQUEIDENTIFIER NOT NULL,
            OriginTransactionId BIGINT NOT NULL,
            OriginTransactionStartedAt DATETIME NOT NULL,
            RecordedAt DATETIME2 NOT NULL CONSTRAINT DF_NativeEditHold_Recorded_232 DEFAULT GETUTCDATE(),
            CONSTRAINT PK_NativeEditHold_232 PRIMARY KEY (CouponId),
            CONSTRAINT UQ_NativeEditHold_Line_232 UNIQUE (AuthorizationLineId),
            CONSTRAINT FK_NativeEditHold_Evidence_232 FOREIGN KEY (AuthorizationLineId)
                REFERENCES wf.CouponNativeCutEvidence(AuthorizationLineId),
            CONSTRAINT CK_NativeEditHold_Identity_232 CHECK (
                CouponId > 0 AND NativeRedemptionId > 0 AND OriginTransactionId > 0
            )
        );
        CREATE INDEX IX_NativeEditHold_Source_232 ON wf.CouponNativeEditHold(NativeRedemptionId, CouponId);
        -- Only the database-owned bridge may create a journal entry. A SQL
        -- sysadmin remains a trusted administration boundary.
        DENY INSERT, UPDATE, DELETE ON OBJECT::wf.CouponNativeEditHold TO public;
        -- Deletion/reassignment is prohibited until there is a reviewed writer
        -- that consumes the journal and validates the full edit in one transaction.
        EXEC(N'CREATE TRIGGER wf.WF_NativeEditHoldRetain ON wf.CouponNativeEditHold
              AFTER INSERT, UPDATE, DELETE AS
              BEGIN
                  SET NOCOUNT ON;
                  IF EXISTS (SELECT 1 FROM deleted)
                  BEGIN
                      ROLLBACK TRANSACTION;
                      RAISERROR(''COUPON_NATIVE_EDIT_HOLD_RELEASE_UNAVAILABLE'',16,1);
                      RETURN;
                  END;
                  IF EXISTS (
                      SELECT 1
                      FROM inserted held
                      WHERE NOT EXISTS (
                          SELECT 1 FROM wf.CouponNativeCutEvidence e WITH (HOLDLOCK)
                          JOIN wf.CouponNativeCutAuthorizationLine al WITH (HOLDLOCK) ON al.Id=e.AuthorizationLineId
                          WHERE e.AuthorizationLineId=held.AuthorizationLineId
                            AND e.NativeRedemptionId=held.NativeRedemptionId
                            AND al.CouponId=held.CouponId AND e.EvidenceState=''APPLIED''
                      )
                  )
                  BEGIN
                      ROLLBACK TRANSACTION;
                      RAISERROR(''COUPON_NATIVE_EDIT_HOLD_LINK_INVALID'',16,1);
                  END;
              END');
        EXEC(N'CREATE TRIGGER dbo.WF_CouponNativeEditHoldGuard ON dbo.WFCoupon
              AFTER UPDATE, DELETE AS
              BEGIN
                  SET NOCOUNT ON;
                  IF EXISTS (
                      SELECT 1 FROM deleted old
                      JOIN wf.CouponNativeEditHold held WITH (UPDLOCK,HOLDLOCK) ON held.CouponId=old.CouponID
                      LEFT JOIN inserted fresh ON fresh.CouponID=old.CouponID
                      WHERE fresh.CouponID IS NULL OR fresh.RemaQty IS NULL OR old.RemaQty IS NULL
                         OR fresh.RemaQty<>old.RemaQty
                  )
                  BEGIN
                      ROLLBACK TRANSACTION;
                      RAISERROR(''COUPON_NATIVE_EDIT_HOLD_REVIEW_REQUIRED'',16,1);
                  END;
              END');
        DISABLE TRIGGER dbo.WF_CouponNativeEditHoldGuard ON dbo.WFCoupon;
    END
    ELSE IF COL_LENGTH('wf.CouponNativeEditHold','EditId') IS NULL
        OR NOT EXISTS (SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID('wf.WF_NativeEditHoldRetain')
                       AND parent_id=OBJECT_ID('wf.CouponNativeEditHold') AND is_disabled=0)
        OR NOT EXISTS (SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID('dbo.WF_CouponNativeEditHoldGuard')
                       AND parent_id=OBJECT_ID('dbo.WFCoupon') AND is_disabled=1)
    BEGIN
        RAISERROR('COUPON_NATIVE_EDIT_HOLD_EXISTING_REVIEW_REQUIRED',16,1);
    END;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    DECLARE @message NVARCHAR(2048);
    SET @message=ERROR_MESSAGE();
    RAISERROR(@message,16,1);
END CATCH;
GO
