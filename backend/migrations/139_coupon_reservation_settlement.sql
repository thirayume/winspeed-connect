-- Migration 139: Coupon Reservation Partial Settlement Tracking (R6 §1.4 / D4)
-- Allows partial cuts from WinSpeed to consume reserved quantity while keeping remaining active.
-- UNAPPLIED — pending owner decision and migrator execution.

-- 1. Add ConsumedQty column to wf.CouponReservation if not exists
IF COL_LENGTH('wf.CouponReservation', 'ConsumedQty') IS NULL
BEGIN
    ALTER TABLE wf.CouponReservation
    ADD ConsumedQty DECIMAL(12, 4) NOT NULL CONSTRAINT DF_CouponReservation_ConsumedQty_139 DEFAULT 0;
END
GO

-- 2. Create child table wf.CouponReservationSettlement to record audit provenance of each settlement cut
IF OBJECT_ID('wf.CouponReservationSettlement', 'U') IS NULL
BEGIN
    CREATE TABLE wf.CouponReservationSettlement (
        Id BIGINT IDENTITY(1,1) PRIMARY KEY,
        ReservationId BIGINT NOT NULL,
        CouponId INT NOT NULL,
        NativeRedemptionId BIGINT NOT NULL,
        NativeDocuNo VARCHAR(50) NOT NULL,
        SettledQty DECIMAL(12, 4) NOT NULL,
        SettledAt DATETIME2 NOT NULL CONSTRAINT DF_CouponResSettlement_SettledAt_139 DEFAULT GETUTCDATE(),
        SettledBy INT NULL,
        Note NVARCHAR(255) NULL
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CouponResSettlement_Lookup' AND object_id = OBJECT_ID('wf.CouponReservationSettlement'))
BEGIN
    CREATE INDEX IX_CouponResSettlement_Lookup ON wf.CouponReservationSettlement (ReservationId, CouponId, NativeRedemptionId);
END
GO
