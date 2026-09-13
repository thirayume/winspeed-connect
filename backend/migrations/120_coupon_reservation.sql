-- Migration 120: SO-08 Coupon Reservation, Beneficiary Authorization, and Ledger Foundation
-- Implements robust coupon allocation, multi-customer shared trips, and invariant balance tracking (100 -> 90 -> 90)

-- 1. Create wf.CouponBeneficiary Table
IF OBJECT_ID('wf.CouponBeneficiary', 'U') IS NULL
BEGIN
    CREATE TABLE wf.CouponBeneficiary (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        OwnerCustId VARCHAR(50) NOT NULL,
        OwnerCustCode VARCHAR(50) NULL,
        OwnerCustName NVARCHAR(255) NULL,
        BeneficiaryCustId VARCHAR(50) NOT NULL,
        BeneficiaryCustCode VARCHAR(50) NULL,
        BeneficiaryCustName NVARCHAR(255) NULL,
        EffectiveFrom DATETIME2 NULL,
        EffectiveTo DATETIME2 NULL,
        Scope VARCHAR(50) NOT NULL CONSTRAINT DF_CouponBeneficiary_Scope_120 DEFAULT 'ALL',
        Reason NVARCHAR(255) NOT NULL,
        Status VARCHAR(20) NOT NULL CONSTRAINT DF_CouponBeneficiary_Status_120 DEFAULT 'ACTIVE',
        CreatedBy INT NOT NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_CouponBeneficiary_CreatedAt_120 DEFAULT GETUTCDATE(),
        UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_CouponBeneficiary_UpdatedAt_120 DEFAULT GETUTCDATE()
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CouponBeneficiary_Pair' AND object_id = OBJECT_ID('wf.CouponBeneficiary'))
BEGIN
    CREATE INDEX IX_CouponBeneficiary_Pair ON wf.CouponBeneficiary (OwnerCustId, BeneficiaryCustId, Status)
    INCLUDE (EffectiveFrom, EffectiveTo, Scope);
END
GO

-- 2. Create wf.CouponReservation Table
IF OBJECT_ID('wf.CouponReservation', 'U') IS NULL
BEGIN
    CREATE TABLE wf.CouponReservation (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        CouponId INT NOT NULL,
        CouponNo VARCHAR(25) NOT NULL,
        GoodId INT NOT NULL,
        CarrierSoId VARCHAR(50) NOT NULL,
        CarrierDocuNo VARCHAR(50) NULL,
        TripId INT NULL,
        BeneficiaryCustId VARCHAR(50) NOT NULL,
        OwnerCustId VARCHAR(50) NOT NULL,
        ReservedQty DECIMAL(12, 4) NOT NULL,
        Status VARCHAR(20) NOT NULL CONSTRAINT DF_CouponReservation_Status_120 DEFAULT 'RESERVED',
        ReservedAt DATETIME2 NOT NULL CONSTRAINT DF_CouponReservation_ReservedAt_120 DEFAULT GETUTCDATE(),
        ExpiresAt DATETIME2 NULL,
        CreatedBy INT NOT NULL,
        Revision INT NOT NULL CONSTRAINT DF_CouponReservation_Revision_120 DEFAULT 1,
        IdempotencyKey NVARCHAR(120) NOT NULL,
        NativeDocuNo VARCHAR(50) NULL,
        NativeRedemptionId INT NULL,
        SettledAt DATETIME2 NULL,
        CancelledAt DATETIME2 NULL,
        CancelReason NVARCHAR(255) NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_CouponReservation_CreatedAt_120 DEFAULT GETUTCDATE(),
        UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_CouponReservation_UpdatedAt_120 DEFAULT GETUTCDATE()
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_CouponReservation_IdempotencyKey' AND object_id = OBJECT_ID('wf.CouponReservation'))
BEGIN
    CREATE UNIQUE INDEX UQ_CouponReservation_IdempotencyKey ON wf.CouponReservation (IdempotencyKey);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CouponReservation_Coupon_Status' AND object_id = OBJECT_ID('wf.CouponReservation'))
BEGIN
    CREATE INDEX IX_CouponReservation_Coupon_Status ON wf.CouponReservation (CouponId, Status)
    INCLUDE (ReservedQty, ExpiresAt);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CouponReservation_CarrierSo' AND object_id = OBJECT_ID('wf.CouponReservation'))
BEGIN
    CREATE INDEX IX_CouponReservation_CarrierSo ON wf.CouponReservation (CarrierSoId, Status);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CouponReservation_Trip' AND object_id = OBJECT_ID('wf.CouponReservation'))
BEGIN
    CREATE INDEX IX_CouponReservation_Trip ON wf.CouponReservation (TripId, Status);
END
GO
