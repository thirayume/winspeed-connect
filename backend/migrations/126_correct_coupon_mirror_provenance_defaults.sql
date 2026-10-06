-- @transaction
-- =============================================================
-- 126_correct_coupon_mirror_provenance_defaults.sql
-- Slice 2: Correct provenance defaults on wf.CouponRedemptionMirror
-- Do not assume historical or external rows are SALE_APP or COMPLETED.
-- Require explicit attribution from the application writer.
-- =============================================================

IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_CouponRedemptionMirror_Source')
BEGIN
    ALTER TABLE wf.CouponRedemptionMirror DROP CONSTRAINT DF_CouponRedemptionMirror_Source;
END
GO

IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_CouponRedemptionMirror_Status')
BEGIN
    ALTER TABLE wf.CouponRedemptionMirror DROP CONSTRAINT DF_CouponRedemptionMirror_Status;
END
GO

ALTER TABLE wf.CouponRedemptionMirror ALTER COLUMN Source NVARCHAR(50) NULL;
GO

ALTER TABLE wf.CouponRedemptionMirror ALTER COLUMN Status NVARCHAR(20) NULL;
GO
