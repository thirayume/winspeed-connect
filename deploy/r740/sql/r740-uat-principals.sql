-- R740-SRV UAT: database-side setup for the Sale-App application and migrator logins.
-- Adapted from docs/deploy/onprem/sql/local-uat2-principals.sql (same reviewed grants).
--
-- BEFORE RUNNING (IT, in SSMS connected to R740-SRV\SQL2008 as a SQL administrator):
--   1. Security > Logins > New Login: create wf_r740_uat_app_v2 and wf_r740_uat_migrator_v2,
--      SQL Server authentication, two different strong passwords typed in the SSMS UI.
--      Default database: dbwins_worldfert9_uat. Server Roles: public only.
--      User Mapping: map NOTHING (this script maps the UAT database only).
--      Never map either login to dbwins_worldfert9 (the future production database).
--   2. Run this whole file once (F5).
--
-- It contains no passwords, does not create or drop logins, does not run migrations
-- and never changes dbwins_worldfert9. It checks the server, database and logins first,
-- then in one transaction sets default databases, creates the dbo-owned wf schema, the
-- empty wf_reader role (grantee of immutable migration 002), the two database users and
-- the reviewed permissions. Finally it proves, read-only, that neither login can open
-- dbwins_worldfert9 or any other user database.
USE [dbwins_worldfert9_uat];
GO
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @machine NVARCHAR(128), @instance NVARCHAR(128), @servername NVARCHAR(128), @version NVARCHAR(32);
SELECT @machine = CONVERT(NVARCHAR(128), SERVERPROPERTY('MachineName')),
       @instance = CONVERT(NVARCHAR(128), SERVERPROPERTY('InstanceName')),
       @servername = @@SERVERNAME,
       @version = CONVERT(NVARCHAR(32), SERVERPROPERTY('ProductVersion'));

IF IS_SRVROLEMEMBER(N'sysadmin') <> 1
BEGIN
    RAISERROR(N'STOP: run this setup in SSMS with the approved SQL Server administrator account.', 16, 1);
    RETURN;
END;

-- If this stops, send the three values in the message to the Sale-App team; do not edit the check.
IF @machine <> N'R740-SRV' OR @instance <> N'SQL2008' OR @servername <> N'R740-SRV\SQL2008'
BEGIN
    RAISERROR(N'STOP: unexpected server. MachineName=%s InstanceName=%s @@SERVERNAME=%s', 16, 1,
              @machine, @instance, @servername);
    RETURN;
END;

IF DB_NAME() <> N'dbwins_worldfert9_uat' OR DB_ID() <> 10
BEGIN
    RAISERROR(N'STOP: current database is not dbwins_worldfert9_uat.', 16, 1);
    RETURN;
END;

IF @version NOT LIKE N'10.50.%'
BEGIN
    RAISERROR(N'STOP: SQL Server version %s is not the approved 10.50.x target.', 16, 1, @version);
    RETURN;
END;

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'wf_r740_uat_app_v2' AND type_desc = N'SQL_LOGIN' AND is_disabled = 0)
   OR NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'wf_r740_uat_migrator_v2' AND type_desc = N'SQL_LOGIN' AND is_disabled = 0)
BEGIN
    RAISERROR(N'STOP: create/enable both SQL logins in SSMS first (separate passwords, no server roles).', 16, 1);
    RETURN;
END;

IF EXISTS (
    SELECT 1
    FROM sys.server_role_members rm
    JOIN sys.server_principals rolep ON rolep.principal_id = rm.role_principal_id
    JOIN sys.server_principals memberp ON memberp.principal_id = rm.member_principal_id
    WHERE memberp.name IN (N'wf_r740_uat_app_v2', N'wf_r740_uat_migrator_v2')
      AND rolep.name IN (N'sysadmin', N'securityadmin', N'serveradmin', N'setupadmin', N'processadmin', N'diskadmin', N'dbcreator', N'bulkadmin')
) OR EXISTS (
    SELECT 1
    FROM sys.server_permissions p
    JOIN sys.server_principals memberp ON memberp.principal_id = p.grantee_principal_id
    WHERE memberp.name IN (N'wf_r740_uat_app_v2', N'wf_r740_uat_migrator_v2')
      AND p.permission_name = N'CONTROL SERVER'
      AND p.state IN ('G', 'W')
)
BEGIN
    RAISERROR(N'STOP: a Sale-App login has an elevated server role or CONTROL SERVER.', 16, 1);
    RETURN;
END;

-- These WINSpeed tables are required by the reviewed app permission set.
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
    RAISERROR(N'STOP: required WINSpeed dbo tables/columns are missing; no permissions were changed.', 16, 1);
    RETURN;
END;

IF EXISTS (
    SELECT 1
    FROM sys.database_principals dp
    JOIN sys.server_principals sp ON sp.name = dp.name
    WHERE dp.name IN (N'wf_r740_uat_app_v2', N'wf_r740_uat_migrator_v2')
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
    WHERE memberp.name IN (N'wf_r740_uat_app_v2', N'wf_r740_uat_migrator_v2')
      AND rolep.name IN (N'db_owner', N'db_datareader', N'db_datawriter', N'db_ddladmin', N'db_securityadmin', N'db_accessadmin', N'db_backupoperator')
) OR EXISTS (
    SELECT 1
    FROM sys.database_permissions p
    JOIN sys.database_principals memberp ON memberp.principal_id = p.grantee_principal_id
    WHERE memberp.name IN (N'wf_r740_uat_app_v2', N'wf_r740_uat_migrator_v2')
      AND p.class = 0 AND p.permission_name = N'CONTROL' AND p.state IN ('G', 'W')
)
BEGIN
    RAISERROR(N'STOP: a Sale-App user has a broad fixed database role or CONTROL DATABASE.', 16, 1);
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

    ALTER LOGIN [wf_r740_uat_app_v2]
        WITH DEFAULT_DATABASE = [dbwins_worldfert9_uat], CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;
    ALTER LOGIN [wf_r740_uat_migrator_v2]
        WITH DEFAULT_DATABASE = [dbwins_worldfert9_uat], CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;

    IF SCHEMA_ID(N'wf') IS NULL EXEC(N'CREATE SCHEMA wf AUTHORIZATION dbo');
    IF DATABASE_PRINCIPAL_ID(N'wf_reader') IS NULL
        EXEC(N'CREATE ROLE [wf_reader] AUTHORIZATION [dbo]');

    IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'wf_r740_uat_app_v2')
        CREATE USER [wf_r740_uat_app_v2] FOR LOGIN [wf_r740_uat_app_v2] WITH DEFAULT_SCHEMA = dbo;
    IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'wf_r740_uat_migrator_v2')
        CREATE USER [wf_r740_uat_migrator_v2] FOR LOGIN [wf_r740_uat_migrator_v2] WITH DEFAULT_SCHEMA = dbo;

    -- Run the grants after the schema exists so they compile against it.
    EXEC(N'
        GRANT SELECT ON SCHEMA::dbo TO [wf_r740_uat_app_v2];
        GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE, REFERENCES ON SCHEMA::wf TO [wf_r740_uat_app_v2];
        GRANT INSERT, DELETE ON dbo.SODT TO [wf_r740_uat_app_v2];
        GRANT INSERT, DELETE ON dbo.SODTRemark TO [wf_r740_uat_app_v2];
        GRANT INSERT ON dbo.SMAudit TO [wf_r740_uat_app_v2];
        GRANT UPDATE (LastNo) ON dbo.EMRunBrch TO [wf_r740_uat_app_v2];
        GRANT UPDATE (TranspID, CustID, CustName, SumGoodAmnt, BillAftrDiscAmnt, NetAmnt, Remark, DocuStatus, PkgStatus,
                      CheckAll, TransRegistration) ON dbo.SOHD TO [wf_r740_uat_app_v2];

        GRANT SELECT ON SCHEMA::dbo TO [wf_r740_uat_migrator_v2];
        GRANT CONTROL ON SCHEMA::wf TO [wf_r740_uat_migrator_v2];
        GRANT CREATE TABLE, CREATE VIEW, CREATE PROCEDURE, CREATE FUNCTION, CREATE TYPE, VIEW DEFINITION TO [wf_r740_uat_migrator_v2];
    ');

    -- Owner approved on 28 October 2026: Production backups copy these app
    -- users into UAT. Deny CONNECT only in this guarded clone after every restore.
    -- Their login objects and live Production permissions are not changed.
    IF EXISTS (SELECT 1 FROM sys.database_principals
               WHERE name IN (N'wf_r740_prod_app', N'wf_r740_prod_migrator')
                 AND (type <> 'S' OR SUSER_SID(name) IS NULL OR sid <> SUSER_SID(name)))
        RAISERROR(N'STOP: copied Production identity does not match its login; inspect before isolating UAT.',16,1);
    IF USER_ID(N'wf_r740_prod_app') IS NOT NULL
        EXEC(N'DENY CONNECT TO [wf_r740_prod_app]');
    IF USER_ID(N'wf_r740_prod_migrator') IS NOT NULL
        EXEC(N'DENY CONNECT TO [wf_r740_prod_migrator]');

    -- A Production backup also copies EXECUTE AS SELF's resolved principal ID.
    -- Keep the copied Production migrator denied CONNECT; rebind only this fixed
    -- SELECT-only metadata reader to the existing isolated UAT migrator instead.
    -- Immutable migration 157 and all native writer bodies/guards stay unchanged.
    IF OBJECT_ID(N'wf.usp_ReadInitialInvoiceMetadata', N'P') IS NOT NULL
    BEGIN
        DECLARE @expected_reader NVARCHAR(MAX), @actual_reader NVARCHAR(MAX), @uat_reader NVARCHAR(MAX);
        SET @expected_reader = N'ALTER PROCEDURE wf.usp_ReadInitialInvoiceMetadata WITH EXECUTE AS SELF
AS
BEGIN
 SET NOCOUNT ON;
 SELECT OBJECT_NAME(t.parent_id) AS TableName,t.name,t.is_disabled,m.definition
 FROM sys.triggers t LEFT JOIN sys.sql_modules m ON m.object_id=t.object_id
 WHERE t.parent_id IN(OBJECT_ID(''dbo.SOInvHD''),OBJECT_ID(''dbo.SOInvDT''),OBJECT_ID(''dbo.SMSat''),OBJECT_ID(''dbo.SMReserveSat''),
  OBJECT_ID(''dbo.ICStockDetail''),OBJECT_ID(''dbo.ICCostDetail''),OBJECT_ID(''dbo.SODT''),OBJECT_ID(''dbo.WFRedemtionHD''),OBJECT_ID(''dbo.WFRedemtionDT''));
END';
        SET @expected_reader = REPLACE(@expected_reader, CHAR(13), N'');
        SET @uat_reader = REPLACE(@expected_reader, N'WITH EXECUTE AS SELF',
                                 N'WITH EXECUTE AS ''wf_r740_uat_migrator_v2''');
        SET @actual_reader = LTRIM(RTRIM(REPLACE(OBJECT_DEFINITION(OBJECT_ID(N'wf.usp_ReadInitialInvoiceMetadata')), CHAR(13), N'')));
        WHILE RIGHT(@actual_reader, 1) = CHAR(10)
            SET @actual_reader = RTRIM(LEFT(@actual_reader, LEN(@actual_reader) - 1));
        WHILE LEFT(@actual_reader, 1) = CHAR(10)
            SET @actual_reader = LTRIM(SUBSTRING(@actual_reader, 2, LEN(@actual_reader)));
        -- SQL2008 may retain CREATE rather than ALTER in the catalog header.
        IF LEFT(@actual_reader, 17) COLLATE Latin1_General_BIN2 = N'CREATE PROCEDURE ' COLLATE Latin1_General_BIN2
            SET @actual_reader = N'ALTER' + SUBSTRING(@actual_reader, 7, LEN(@actual_reader));
        IF @actual_reader IS NULL OR
           ((@actual_reader COLLATE Latin1_General_BIN2 <> @expected_reader COLLATE Latin1_General_BIN2
             OR DATALENGTH(@actual_reader) <> DATALENGTH(@expected_reader)) AND
            (@actual_reader COLLATE Latin1_General_BIN2 <> @uat_reader COLLATE Latin1_General_BIN2
             OR DATALENGTH(@actual_reader) <> DATALENGTH(@uat_reader)))
            RAISERROR(N'STOP: invoice metadata reader differs from the reviewed SELECT-only body; remapping rolled back.', 16, 1);
        IF @actual_reader COLLATE Latin1_General_BIN2 <> @uat_reader COLLATE Latin1_General_BIN2
           OR (SELECT execute_as_principal_id FROM sys.sql_modules WHERE object_id=OBJECT_ID(N'wf.usp_ReadInitialInvoiceMetadata'))
              <> USER_ID(N'wf_r740_uat_migrator_v2')
            EXEC(@uat_reader);
    END;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    DECLARE @error_message NVARCHAR(2048);
    SET @error_message = ERROR_MESSAGE();
    RAISERROR(N'R740 UAT principal setup rolled back: %s', 16, 1, @error_message);
    RETURN;
END CATCH;
GO

-- Read-only isolation proof. The Sale-App guards stop the app and the migrator if either
-- login can open dbwins_worldfert9; a non-zero here usually means that database has its
-- guest user enabled. Do not change dbwins_worldfert9 - report the result instead.
SET NOCOUNT ON;
IF DB_NAME() <> N'dbwins_worldfert9_uat' OR DB_ID() <> 10
   OR USER_ID(N'wf_r740_uat_app_v2') IS NULL OR USER_ID(N'wf_r740_uat_migrator_v2') IS NULL
BEGIN
    RAISERROR(N'Setup above did not complete; isolation proof skipped. Read the first error message.', 16, 1);
    RETURN;
END;
DECLARE @results TABLE (login_name SYSNAME, can_open_production INT, other_user_databases INT, is_db_owner INT);

EXECUTE AS LOGIN = N'wf_r740_uat_app_v2';
INSERT INTO @results
SELECT SUSER_SNAME(), HAS_DBACCESS(N'dbwins_worldfert9'),
       (SELECT COUNT(*) FROM sys.databases WHERE database_id > 4 AND name <> DB_NAME() AND HAS_DBACCESS(name) = 1),
       IS_ROLEMEMBER(N'db_owner');
REVERT;

EXECUTE AS LOGIN = N'wf_r740_uat_migrator_v2';
INSERT INTO @results
SELECT SUSER_SNAME(), HAS_DBACCESS(N'dbwins_worldfert9'),
       (SELECT COUNT(*) FROM sys.databases WHERE database_id > 4 AND name <> DB_NAME() AND HAS_DBACCESS(name) = 1),
       IS_ROLEMEMBER(N'db_owner');
REVERT;

SELECT login_name, can_open_production, other_user_databases, is_db_owner,
       CASE WHEN can_open_production = 0 AND other_user_databases = 0 AND is_db_owner = 0 THEN N'OK' ELSE N'STOP - report to Sale-App team' END AS result
FROM @results;

IF EXISTS (SELECT 1 FROM @results WHERE ISNULL(can_open_production,1) <> 0
           OR other_user_databases <> 0 OR ISNULL(is_db_owner,1) <> 0)
BEGIN
    RAISERROR(N'STOP: isolated UAT login can open another user database or has db_owner. No deploy is allowed.',16,1);
    RETURN;
END;

SELECT @@SERVERNAME AS server_name, DB_NAME() AS database_name,
       CONVERT(NVARCHAR(32), SERVERPROPERTY('ProductVersion')) AS product_version;

-- Impersonation starts in master because these logins must be unable to open UAT.
-- Dynamic USE stays inside EXEC; the administrator session remains in the clone.
DECLARE @reverse TABLE (login_name SYSNAME, can_open_uat INT);
IF SUSER_ID(N'wf_r740_prod_app') IS NOT NULL
    INSERT INTO @reverse EXEC(N'USE [master]; EXECUTE AS LOGIN=N''wf_r740_prod_app'';
        SELECT SUSER_SNAME(),HAS_DBACCESS(N''dbwins_worldfert9_uat''); REVERT;');
IF SUSER_ID(N'wf_r740_prod_migrator') IS NOT NULL
    INSERT INTO @reverse EXEC(N'USE [master]; EXECUTE AS LOGIN=N''wf_r740_prod_migrator'';
        SELECT SUSER_SNAME(),HAS_DBACCESS(N''dbwins_worldfert9_uat''); REVERT;');
IF EXISTS (SELECT 1 FROM @reverse WHERE ISNULL(can_open_uat,1) <> 0)
    RAISERROR(N'STOP: Production application identity can still open UAT. No deploy is allowed.',16,1);
SELECT login_name,can_open_uat FROM @reverse;
