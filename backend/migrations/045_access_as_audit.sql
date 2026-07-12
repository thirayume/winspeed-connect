-- 045_access_as_audit.sql
-- Records Access As sessions and API write actions with both the real actor
-- and the effective user account being used.

IF OBJECT_ID('wf.AccessAsAudit', 'U') IS NULL
BEGIN
  CREATE TABLE wf.AccessAsAudit (
    Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    ActorUserId INT NOT NULL,
    EffectiveUserId INT NOT NULL,
    Action NVARCHAR(20) NOT NULL,
    IpAddress NVARCHAR(80) NULL,
    UserAgent NVARCHAR(500) NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_AccessAsAudit_CreatedAt DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID('wf.ApiAuditLog', 'U') IS NULL
BEGIN
  CREATE TABLE wf.ApiAuditLog (
    Id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    ActorUserId INT NULL,
    EffectiveUserId INT NULL,
    Method NVARCHAR(12) NOT NULL,
    Path NVARCHAR(500) NOT NULL,
    StatusCode INT NOT NULL,
    DurationMs INT NOT NULL,
    IpAddress NVARCHAR(80) NULL,
    UserAgent NVARCHAR(500) NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ApiAuditLog_CreatedAt DEFAULT SYSUTCDATETIME()
  );
END
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_AccessAsAudit_CreatedAt'
    AND object_id = OBJECT_ID('wf.AccessAsAudit')
)
BEGIN
  CREATE INDEX IX_AccessAsAudit_CreatedAt
    ON wf.AccessAsAudit (CreatedAt DESC)
    INCLUDE (ActorUserId, EffectiveUserId, Action);
END
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_ApiAuditLog_CreatedAt'
    AND object_id = OBJECT_ID('wf.ApiAuditLog')
)
BEGIN
  CREATE INDEX IX_ApiAuditLog_CreatedAt
    ON wf.ApiAuditLog (CreatedAt DESC)
    INCLUDE (ActorUserId, EffectiveUserId, Method, StatusCode);
END
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_ApiAuditLog_Actor_Effective'
    AND object_id = OBJECT_ID('wf.ApiAuditLog')
)
BEGIN
  CREATE INDEX IX_ApiAuditLog_Actor_Effective
    ON wf.ApiAuditLog (ActorUserId, EffectiveUserId, CreatedAt DESC);
END
GO
