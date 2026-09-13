-- Migration 121: SO-08 Coupon Line Trace, Durable Identity, and Beneficiary Governance
-- Adds durable line link between wf.SalesOrderLine and wf.CouponReservation
-- Adds payload fingerprinting and revocation audit to coupon schema

-- 1. Add Coupon columns to wf.SalesOrderLine
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('wf.SalesOrderLine') AND name = 'CouponReservationId')
BEGIN
    ALTER TABLE wf.SalesOrderLine ADD CouponReservationId INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('wf.SalesOrderLine') AND name = 'RefCouponDocuNo')
BEGIN
    ALTER TABLE wf.SalesOrderLine ADD RefCouponDocuNo VARCHAR(50) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('wf.SalesOrderLine') AND name = 'IsCouponDrawn')
BEGIN
    ALTER TABLE wf.SalesOrderLine ADD IsCouponDrawn BIT NOT NULL CONSTRAINT DF_SalesOrderLine_IsCouponDrawn DEFAULT 0;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_SalesOrderLine_CouponReservationId' AND object_id = OBJECT_ID('wf.SalesOrderLine'))
BEGIN
    CREATE INDEX IX_SalesOrderLine_CouponReservationId ON wf.SalesOrderLine (CouponReservationId) WHERE CouponReservationId IS NOT NULL;
END
GO

-- 2. Add Trace and Governance columns to wf.CouponReservation
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('wf.CouponReservation') AND name = 'LineNum')
BEGIN
    ALTER TABLE wf.CouponReservation ADD LineNum INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('wf.CouponReservation') AND name = 'GoodUnit')
BEGIN
    ALTER TABLE wf.CouponReservation ADD GoodUnit VARCHAR(20) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('wf.CouponReservation') AND name = 'PayloadHash')
BEGIN
    ALTER TABLE wf.CouponReservation ADD PayloadHash VARCHAR(64) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('wf.CouponReservation') AND name = 'CancelledBy')
BEGIN
    ALTER TABLE wf.CouponReservation ADD CancelledBy INT NULL;
END
GO

-- 3. Add Revocation columns to wf.CouponBeneficiary
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('wf.CouponBeneficiary') AND name = 'RevokedAt')
BEGIN
    ALTER TABLE wf.CouponBeneficiary ADD RevokedAt DATETIME2 NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('wf.CouponBeneficiary') AND name = 'RevokedBy')
BEGIN
    ALTER TABLE wf.CouponBeneficiary ADD RevokedBy INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('wf.CouponBeneficiary') AND name = 'RevokeReason')
BEGIN
    ALTER TABLE wf.CouponBeneficiary ADD RevokeReason NVARCHAR(255) NULL;
END
GO

-- 4. Prevent duplicate active grants for the exact same owner, beneficiary, and scope
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_CouponBeneficiary_ActiveGrant' AND object_id = OBJECT_ID('wf.CouponBeneficiary'))
BEGIN
    CREATE UNIQUE INDEX UQ_CouponBeneficiary_ActiveGrant 
    ON wf.CouponBeneficiary (OwnerCustId, BeneficiaryCustId, Scope) 
    WHERE Status = 'ACTIVE';
END
GO
