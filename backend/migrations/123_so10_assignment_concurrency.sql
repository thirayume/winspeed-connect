-- Migration 123: SO-10 Report Template Assignment Optimistic Concurrency Control
-- Adds Version column to wf.ReportTemplateAssignment to support expectedVersion concurrency checks.

IF NOT EXISTS (
    SELECT 1 FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'wf.ReportTemplateAssignment') AND name = N'Version'
)
BEGIN
    ALTER TABLE wf.ReportTemplateAssignment 
    ADD Version INT NOT NULL CONSTRAINT DF_ReportTemplateAssignment_Version DEFAULT 1;
    PRINT 'Added Version column to wf.ReportTemplateAssignment';
END
GO
