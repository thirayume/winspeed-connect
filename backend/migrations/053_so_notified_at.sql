-- ==========================================
-- 053_so_notified_at.sql
-- Add NotifiedAt to track Date/Time notified
-- ==========================================

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name = N'NotifiedAt' AND Object_ID = Object_ID(N'wf.SalesOrder'))
BEGIN
    ALTER TABLE wf.SalesOrder ADD NotifiedAt DATETIME2 NULL;
END

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name = N'NotifiedAt' AND Object_ID = Object_ID(N'wf.SalesOrderExt'))
BEGIN
    ALTER TABLE wf.SalesOrderExt ADD NotifiedAt DATETIME2 NULL;
END
