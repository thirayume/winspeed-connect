-- ============================================================================
-- 174_price_book_weekly_date_range.sql
-- Support weekly and custom date range for Price Book (EffectiveFrom - EffectiveTo)
-- SQL 2008 R2 compatible, idempotent
-- ============================================================================

IF COL_LENGTH('wf.PriceBook', 'EffectiveFrom') IS NULL
    ALTER TABLE wf.PriceBook ADD EffectiveFrom DATE NULL;
GO

IF COL_LENGTH('wf.PriceBook', 'EffectiveTo') IS NULL
    ALTER TABLE wf.PriceBook ADD EffectiveTo DATE NULL;
GO

