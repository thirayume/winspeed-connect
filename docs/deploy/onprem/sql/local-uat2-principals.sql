-- Complete database-side setup for the local UAT2 application and migrator.
-- Before running: in SSMS, create/enable the SQL logins wf_local_uat_app and
-- wf_local_uat_migrator, set separate passwords through the SSMS login UI,
-- and do not add either login to a server role. This file contains no
-- credentials, does not create/drop logins, does not change passwords, and
-- does not run migrations. It sets both default databases to the UAT2 target,
-- creates/maps database users, and grants the reviewed database permissions.
-- Also creates an empty wf_reader database role for the grantee referenced by
-- immutable legacy migration 002. No login or role membership is added for it.
-- Hard-pinned to AMYOU-YOGA7\V2008R2 / dbwins_worldfert9_uat2.
USE [dbwins_worldfert9_uat2];
GO
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF IS_SRVROLEMEMBER(N'sysadmin') <> 1
BEGIN
    RAISERROR(N'STOP: run this setup in SSMS using the approved SQL Server administrator account.', 16, 1);
    RETURN;
END;

IF CONVERT(NVARCHAR(128), SERVERPROPERTY('MachineName')) <> N'AMYOU-YOGA7'
   OR CONVERT(NVARCHAR(128), SERVERPROPERTY('InstanceName')) <> N'V2008R2'
   OR @@SERVERNAME <> N'AMYOU-YOGA7\V2008R2'
BEGIN
    RAISERROR(N'STOP: unexpected SQL Server host or instance.', 16, 1);
    RETURN;
END;

IF DB_NAME() <> N'dbwins_worldfert9_uat2'
BEGIN
    RAISERROR(N'STOP: current database is not dbwins_worldfert9_uat2.', 16, 1);
    RETURN;
END;

IF CONVERT(NVARCHAR(32), SERVERPROPERTY('ProductVersion')) NOT LIKE N'10.50.%'
BEGIN
    RAISERROR(N'STOP: SQL Server version is not the approved 10.50.x target.', 16, 1);
    RETURN;
END;

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'wf_local_uat_app' AND type_desc = N'SQL_LOGIN' AND is_disabled = 0)
   OR NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'wf_local_uat_migrator' AND type_desc = N'SQL_LOGIN' AND is_disabled = 0)
BEGIN
    RAISERROR(N'STOP: create/enable both dedicated SQL logins in SSMS first; use separate passwords and no server roles.', 16, 1);
    RETURN;
END;

IF EXISTS (
    SELECT 1
    FROM sys.server_role_members rm
    JOIN sys.server_principals rolep ON rolep.principal_id = rm.role_principal_id
    JOIN sys.server_principals memberp ON memberp.principal_id = rm.member_principal_id
    WHERE memberp.name IN (N'wf_local_uat_app', N'wf_local_uat_migrator')
      AND rolep.name IN (N'sysadmin', N'securityadmin', N'serveradmin', N'setupadmin', N'processadmin', N'diskadmin', N'dbcreator', N'bulkadmin')
) OR EXISTS (
    SELECT 1
    FROM sys.server_permissions p
    JOIN sys.server_principals memberp ON memberp.principal_id = p.grantee_principal_id
    WHERE memberp.name IN (N'wf_local_uat_app', N'wf_local_uat_migrator')
      AND p.permission_name = N'CONTROL SERVER'
      AND p.state IN ('G', 'W')
)
BEGIN
    RAISERROR(N'STOP: a dedicated login has an elevated server role or CONTROL SERVER.', 16, 1);
    RETURN;
END;

-- These legacy WINSpeed tables are required by the reviewed app permission set.
-- Fail before changing anything if this database is not a compatible clone.
IF OBJECT_ID(N'dbo.SODT', N'U') IS NULL
   OR OBJECT_ID(N'dbo.SODTRemark', N'U') IS NULL
   OR OBJECT_ID(N'dbo.SMAudit', N'U') IS NULL
   OR OBJECT_ID(N'dbo.EMRunBrch', N'U') IS NULL
   OR OBJECT_ID(N'dbo.SOHD', N'U') IS NULL
   OR COL_LENGTH(N'dbo.EMRunBrch', N'LastNo') IS NULL
   OR COL_LENGTH(N'dbo.SOHD', N'TranspID') IS NULL
   OR COL_LENGTH(N'dbo.SOHD', N'CustID') IS NULL
   OR COL_LENGTH(N'dbo.SOHD', N'CustName') IS NULL
   OR COL_LENGTH(N'dbo.SOHD', N'SumGoodAmnt') IS NULL
   OR COL_LENGTH(N'dbo.SOHD', N'BillAftrDiscAmnt') IS NULL
   OR COL_LENGTH(N'dbo.SOHD', N'NetAmnt') IS NULL
   OR COL_LENGTH(N'dbo.SOHD', N'Remark') IS NULL
   OR COL_LENGTH(N'dbo.SOHD', N'DocuStatus') IS NULL
   OR COL_LENGTH(N'dbo.SOHD', N'PkgStatus') IS NULL
   OR COL_LENGTH(N'dbo.SOHD', N'CheckAll') IS NULL
   OR COL_LENGTH(N'dbo.SOHD', N'TransRegistration') IS NULL
BEGIN
    RAISERROR(N'STOP: required dbo WINSpeed tables/columns are missing; no permissions were changed.', 16, 1);
    RETURN;
END;

IF EXISTS (
    SELECT 1
    FROM sys.database_principals dp
    JOIN sys.server_principals sp ON sp.name = dp.name
    WHERE dp.name IN (N'wf_local_uat_app', N'wf_local_uat_migrator')
      AND dp.sid <> sp.sid
)
BEGIN
    RAISERROR(N'STOP: an existing database user is mapped to a different login SID.', 16, 1);
    RETURN;
END;

IF EXISTS (
    SELECT 1
    FROM sys.database_role_members rm
    JOIN sys.database_principals rolep ON rolep.principal_id = rm.role_principal_id
    JOIN sys.database_principals memberp ON memberp.principal_id = rm.member_principal_id
    WHERE memberp.name IN (N'wf_local_uat_app', N'wf_local_uat_migrator')
      AND rolep.name IN (N'db_owner', N'db_datareader', N'db_datawriter', N'db_ddladmin', N'db_securityadmin', N'db_accessadmin', N'db_backupoperator')
) OR EXISTS (
    SELECT 1
    FROM sys.database_permissions p
    JOIN sys.database_principals memberp ON memberp.principal_id = p.grantee_principal_id
    WHERE memberp.name IN (N'wf_local_uat_app', N'wf_local_uat_migrator')
      AND p.class = 0 AND p.permission_name = N'CONTROL' AND p.state IN ('G', 'W')
)
BEGIN
    RAISERROR(N'STOP: a dedicated user has a broad fixed database role or CONTROL DATABASE.', 16, 1);
    RETURN;
END;

IF SCHEMA_ID(N'wf') IS NOT NULL
   AND (SELECT principal_id FROM sys.schemas WHERE name = N'wf') <> DATABASE_PRINCIPAL_ID(N'dbo')
BEGIN
    RAISERROR(N'STOP: existing wf schema is not owned by dbo; inspect it manually.', 16, 1);
    RETURN;
END;

IF EXISTS (
    SELECT 1 FROM sys.database_principals
    WHERE name = N'wf_reader'
      AND (type <> N'R' OR owning_principal_id <> DATABASE_PRINCIPAL_ID(N'dbo'))
) OR EXISTS (
    SELECT 1 FROM sys.database_role_members
    WHERE role_principal_id = DATABASE_PRINCIPAL_ID(N'wf_reader')
)
BEGIN
    RAISERROR(N'STOP: existing wf_reader is not an empty dbo-owned compatibility role; inspect it first.', 16, 1);
    RETURN;
END;

BEGIN TRY
    BEGIN TRANSACTION;

    -- Keep both logins opening directly into the isolated UAT2 clone.
    ALTER LOGIN [wf_local_uat_app]
        WITH DEFAULT_DATABASE = [dbwins_worldfert9_uat2], CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;
    ALTER LOGIN [wf_local_uat_migrator]
        WITH DEFAULT_DATABASE = [dbwins_worldfert9_uat2], CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;

    IF SCHEMA_ID(N'wf') IS NULL EXEC(N'CREATE SCHEMA wf AUTHORIZATION dbo');
    IF DATABASE_PRINCIPAL_ID(N'wf_reader') IS NULL
        EXEC(N'CREATE ROLE [wf_reader] AUTHORIZATION [dbo]');

    IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'wf_local_uat_app')
        CREATE USER [wf_local_uat_app] FOR LOGIN [wf_local_uat_app] WITH DEFAULT_SCHEMA = dbo;
    IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'wf_local_uat_migrator')
        CREATE USER [wf_local_uat_migrator] FOR LOGIN [wf_local_uat_migrator] WITH DEFAULT_SCHEMA = dbo;

    -- Execute grants after creating the schema so SQL Server compiles them against
    -- the now-existing schema within this transaction.
    EXEC(N'
        GRANT SELECT ON SCHEMA::dbo TO [wf_local_uat_app];
        GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE, REFERENCES ON SCHEMA::wf TO [wf_local_uat_app];
        GRANT INSERT, DELETE ON dbo.SODT TO [wf_local_uat_app];
        GRANT INSERT, DELETE ON dbo.SODTRemark TO [wf_local_uat_app];
        GRANT INSERT ON dbo.SMAudit TO [wf_local_uat_app];
        GRANT UPDATE (LastNo) ON dbo.EMRunBrch TO [wf_local_uat_app];
        GRANT UPDATE (TranspID, CustID, CustName, SumGoodAmnt, BillAftrDiscAmnt, NetAmnt, Remark, DocuStatus, PkgStatus,
                      CheckAll, TransRegistration) ON dbo.SOHD TO [wf_local_uat_app];

        GRANT SELECT ON SCHEMA::dbo TO [wf_local_uat_migrator];
        GRANT CONTROL ON SCHEMA::wf TO [wf_local_uat_migrator];
        GRANT CREATE TABLE, CREATE VIEW, CREATE PROCEDURE, CREATE FUNCTION, CREATE TYPE, VIEW DEFINITION TO [wf_local_uat_migrator];
    ');

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    DECLARE @error_message NVARCHAR(2048);
    SET @error_message = ERROR_MESSAGE();
    RAISERROR(N'Local UAT2 principal setup rolled back: %s', 16, 1, @error_message);
END CATCH;

SELECT N'wf_local_uat_app' AS login_name, USER_ID(N'wf_local_uat_app') AS database_user_id,
       IS_ROLEMEMBER(N'db_owner', N'wf_local_uat_app') AS is_db_owner;
SELECT N'wf_local_uat_migrator' AS login_name, USER_ID(N'wf_local_uat_migrator') AS database_user_id,
       IS_ROLEMEMBER(N'db_owner', N'wf_local_uat_migrator') AS is_db_owner;
