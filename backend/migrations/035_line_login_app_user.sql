IF COL_LENGTH('wf.AppUser', 'LineUserId') IS NULL
  ALTER TABLE wf.AppUser ADD LineUserId NVARCHAR(80) NULL;
GO

IF COL_LENGTH('wf.AppUser', 'LineDisplayName') IS NULL
  ALTER TABLE wf.AppUser ADD LineDisplayName NVARCHAR(150) NULL;
GO

IF COL_LENGTH('wf.AppUser', 'LinePictureUrl') IS NULL
  ALTER TABLE wf.AppUser ADD LinePictureUrl NVARCHAR(500) NULL;
GO

IF COL_LENGTH('wf.AppUser', 'LineLinkedAt') IS NULL
  ALTER TABLE wf.AppUser ADD LineLinkedAt DATETIME2 NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('wf.AppUser') AND name = 'UX_AppUser_LineUserId')
  CREATE UNIQUE INDEX UX_AppUser_LineUserId ON wf.AppUser(LineUserId) WHERE LineUserId IS NOT NULL;
