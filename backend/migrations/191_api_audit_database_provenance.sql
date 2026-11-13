-- Identity IDs in ApiAuditLog refer to the primary identity database.
-- The business database is recorded separately so an ID is never interpreted
-- as an account from a different database. Compatible with SQL Server 2008 R2.
IF OBJECT_ID('wf.ApiAuditLog', 'U') IS NOT NULL AND COL_LENGTH('wf.ApiAuditLog', 'IdentityDatabase') IS NULL
  ALTER TABLE wf.ApiAuditLog ADD IdentityDatabase NVARCHAR(128) NULL;
GO
IF OBJECT_ID('wf.ApiAuditLog', 'U') IS NOT NULL AND COL_LENGTH('wf.ApiAuditLog', 'BusinessDatabase') IS NULL
  ALTER TABLE wf.ApiAuditLog ADD BusinessDatabase NVARCHAR(128) NULL;
GO
