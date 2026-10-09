-- ============================================================================
-- 150_quotation_converted_link.sql
-- A bill made from a quotation could not be confirmed.
--
-- Background (UAT 2026-10-09, QT-04, bill I69-04237 from QU6910-00003): confirming a draft
-- ends in wf.sp_ConfirmSalesOrder with DELETE FROM wf.SalesOrder; wf.Quotation.ConvertedSoId
-- had a foreign key to that row, so the delete was refused ("The DELETE statement conflicted
-- with the REFERENCE constraint FK__Quotation__Conve__…") and no converted bill could ever be
-- confirmed. The key goes; ConvertedSoId keeps the draft id, and the confirmed booking is
-- found through wf.SalesOrderExt.SourceDraftId.
--
-- SQL 2008 R2; wf schema only. The constraint name is generated, so it is looked up.
-- ============================================================================

DECLARE @fk SYSNAME;
SELECT @fk = fk.name
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fc ON fc.constraint_object_id = fk.object_id
WHERE fk.parent_object_id = OBJECT_ID('wf.Quotation')
  AND fk.referenced_object_id = OBJECT_ID('wf.SalesOrder')
  AND COL_NAME(fc.parent_object_id, fc.parent_column_id) = 'ConvertedSoId';
IF @fk IS NOT NULL
    EXEC('ALTER TABLE wf.Quotation DROP CONSTRAINT ' + @fk);
GO
