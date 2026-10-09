-- ============================================================================
-- 149_native_counter_verify.sql
-- The counter check (FR-022) of a WinSpeed bill that was unlocked for an edit.
--
-- Background (UAT full loop 2026-10-09, FL13): after an approved edit request a
-- booking (103) is unlocked (wf.SalesOrderExt.IsUnlocked = 1) and reads DRAFT. The
-- counter's "ตรวจ" wrote wf.SalesOrder, where a WinSpeed bill has no row, so it
-- answered success and kept nothing; re-confirming the bill never asked for the check.
-- The check of an unlocked bill is kept here; it is cleared when the bill is locked
-- again, so each edit is checked once.
--
-- SQL 2008 R2; wf schema only, no dbo structure change.
-- ============================================================================

IF COL_LENGTH('wf.SalesOrderExt', 'VerifiedBy') IS NULL
    ALTER TABLE wf.SalesOrderExt ADD VerifiedBy INT NULL;
GO
IF COL_LENGTH('wf.SalesOrderExt', 'VerifiedAt') IS NULL
    ALTER TABLE wf.SalesOrderExt ADD VerifiedAt DATETIME2 NULL;
GO
