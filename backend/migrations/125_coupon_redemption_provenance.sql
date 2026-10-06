-- =============================================================
-- 125_coupon_redemption_provenance.sql
-- Slice 2: Add provenance and status tracking to wf.CouponRedemptionMirror
-- Record sale-app origin and reversal lifecycle in wf schema without touching dbo
-- =============================================================

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('wf.CouponRedemptionMirror') AND name = 'DocuNo')
BEGIN
    ALTER TABLE wf.CouponRedemptionMirror ADD DocuNo NVARCHAR(50) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('wf.CouponRedemptionMirror') AND name = 'Source')
BEGIN
    ALTER TABLE wf.CouponRedemptionMirror ADD Source NVARCHAR(50) NOT NULL CONSTRAINT DF_CouponRedemptionMirror_Source DEFAULT 'SALE_APP';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('wf.CouponRedemptionMirror') AND name = 'Status')
BEGIN
    ALTER TABLE wf.CouponRedemptionMirror ADD Status NVARCHAR(20) NOT NULL CONSTRAINT DF_CouponRedemptionMirror_Status DEFAULT 'COMPLETED';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('wf.CouponRedemptionMirror') AND name = 'ReversedAt')
BEGIN
    ALTER TABLE wf.CouponRedemptionMirror ADD ReversedAt DATETIME2 NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('wf.CouponRedemptionMirror') AND name = 'ReversedBy')
BEGIN
    ALTER TABLE wf.CouponRedemptionMirror ADD ReversedBy INT NULL;
END
GO
