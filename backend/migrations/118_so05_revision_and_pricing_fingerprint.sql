-- Migration 118: Document Revision, Pricing Fingerprint, and Trip Payload Hash
-- Enforces SO-05 Finding 6 (Approval bound to revision) and Finding 3 (Trip Concurrency/Idempotency)

-- 1. Add DocumentRevision and PricingFingerprint to wf.SalesOrder
IF COL_LENGTH('wf.SalesOrder', 'DocumentRevision') IS NULL
BEGIN
    ALTER TABLE wf.SalesOrder ADD DocumentRevision INT NOT NULL DEFAULT 1;
END
GO

IF COL_LENGTH('wf.SalesOrder', 'PricingFingerprint') IS NULL
BEGIN
    ALTER TABLE wf.SalesOrder ADD PricingFingerprint VARCHAR(64) NULL;
END
GO

-- 2. Add DocumentRevision and PayloadHash to wf.SalesTrip
IF COL_LENGTH('wf.SalesTrip', 'DocumentRevision') IS NULL
BEGIN
    ALTER TABLE wf.SalesTrip ADD DocumentRevision INT NOT NULL DEFAULT 1;
END
GO

IF COL_LENGTH('wf.SalesTrip', 'PayloadHash') IS NULL
BEGIN
    ALTER TABLE wf.SalesTrip ADD PayloadHash VARCHAR(64) NULL;
END
GO
