-- @transaction
-- Reviewed cross-database identity bindings live in the identity database.
-- Do not seed bindings: numeric IDs and usernames are not proof of identity.
IF OBJECT_ID('wf.DatabaseIdentityBinding', 'U') IS NULL
BEGIN
  CREATE TABLE wf.DatabaseIdentityBinding (
    Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_DatabaseIdentityBinding PRIMARY KEY,
    PrimaryUserId INT NOT NULL,
    PrimaryServerName NVARCHAR(128) NOT NULL,
    PrimaryDatabaseName NVARCHAR(128) NOT NULL,
    PrimaryUsername NVARCHAR(50) NOT NULL,
    PrimaryEmployeeId NVARCHAR(20) NULL,
    TargetServerName NVARCHAR(128) NOT NULL,
    TargetDatabaseName NVARCHAR(128) NOT NULL,
    TargetUserId INT NOT NULL,
    TargetUsername NVARCHAR(50) NOT NULL,
    TargetEmployeeId NVARCHAR(20) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_DatabaseIdentityBinding_Active DEFAULT (1),
    Revision INT NOT NULL CONSTRAINT DF_DatabaseIdentityBinding_Revision DEFAULT (1),
    ReviewedBy INT NOT NULL,
    ReviewedAt DATETIME2 NOT NULL CONSTRAINT DF_DatabaseIdentityBinding_ReviewedAt DEFAULT (GETUTCDATE()),
    CONSTRAINT CK_DatabaseIdentityBinding_Ids CHECK (PrimaryUserId > 0 AND TargetUserId > 0 AND ReviewedBy > 0 AND Revision > 0),
    CONSTRAINT CK_DatabaseIdentityBinding_Names CHECK (LEN(LTRIM(RTRIM(PrimaryUsername))) > 0 AND LEN(LTRIM(RTRIM(TargetUsername))) > 0 AND LEN(LTRIM(RTRIM(PrimaryServerName))) > 0 AND LEN(LTRIM(RTRIM(PrimaryDatabaseName))) > 0 AND LEN(LTRIM(RTRIM(TargetServerName))) > 0 AND LEN(LTRIM(RTRIM(TargetDatabaseName))) > 0)
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('wf.DatabaseIdentityBinding') AND name = 'UX_DatabaseIdentityBinding_Primary')
  CREATE UNIQUE INDEX UX_DatabaseIdentityBinding_Primary ON wf.DatabaseIdentityBinding (TargetServerName, TargetDatabaseName, PrimaryUserId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('wf.DatabaseIdentityBinding') AND name = 'UX_DatabaseIdentityBinding_Target')
  CREATE UNIQUE INDEX UX_DatabaseIdentityBinding_Target ON wf.DatabaseIdentityBinding (TargetServerName, TargetDatabaseName, TargetUserId);

IF OBJECT_ID('wf.DatabaseIdentityBindingAudit', 'U') IS NULL
BEGIN
  CREATE TABLE wf.DatabaseIdentityBindingAudit (
    Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_DatabaseIdentityBindingAudit PRIMARY KEY,
    BindingId BIGINT NOT NULL,
    ActorUserId INT NOT NULL,
    Action VARCHAR(20) NOT NULL,
    BeforeSnapshot NVARCHAR(MAX) NULL,
    AfterSnapshot NVARCHAR(MAX) NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_DatabaseIdentityBindingAudit_CreatedAt DEFAULT (GETUTCDATE()),
    CONSTRAINT FK_DatabaseIdentityBindingAudit_Binding FOREIGN KEY (BindingId) REFERENCES wf.DatabaseIdentityBinding(Id),
    CONSTRAINT CK_DatabaseIdentityBindingAudit_Action CHECK (Action IN ('CREATE', 'UPDATE', 'REVOKE')),
    CONSTRAINT CK_DatabaseIdentityBindingAudit_Actor CHECK (ActorUserId > 0)
  );
END;

-- These are distinct from ActorUserId/EffectiveUserId, which remain primary
-- identity IDs. Populate only after business-ID mapping is wired end to end.
IF OBJECT_ID('wf.ApiAuditLog', 'U') IS NOT NULL AND COL_LENGTH('wf.ApiAuditLog', 'BusinessActorUserId') IS NULL
  ALTER TABLE wf.ApiAuditLog ADD BusinessActorUserId INT NULL;
IF OBJECT_ID('wf.ApiAuditLog', 'U') IS NOT NULL AND COL_LENGTH('wf.ApiAuditLog', 'BusinessEffectiveUserId') IS NULL
  ALTER TABLE wf.ApiAuditLog ADD BusinessEffectiveUserId INT NULL;
IF OBJECT_ID('wf.ApiAuditLog', 'U') IS NOT NULL AND COL_LENGTH('wf.ApiAuditLog', 'IdentityServer') IS NULL
  ALTER TABLE wf.ApiAuditLog ADD IdentityServer NVARCHAR(128) NULL;
IF OBJECT_ID('wf.ApiAuditLog', 'U') IS NOT NULL AND COL_LENGTH('wf.ApiAuditLog', 'BusinessServer') IS NULL
  ALTER TABLE wf.ApiAuditLog ADD BusinessServer NVARCHAR(128) NULL;
