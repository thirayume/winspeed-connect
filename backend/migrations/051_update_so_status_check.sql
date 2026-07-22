-- =============================================================
-- 051_update_so_status_check.sql
-- Update chk_SO_Status to include 'QUOTATION'
-- =============================================================

ALTER TABLE wf.SalesOrder DROP CONSTRAINT chk_SO_Status;
GO

ALTER TABLE wf.SalesOrder ADD CONSTRAINT chk_SO_Status 
CHECK ([Status] IN ('DRAFT', 'CONFIRMED', 'PICKING', 'LOADED', 'SHIPPED', 'IMPORTED', 'CANCELLED', 'QUOTATION'));
GO
