-- R740-SRV: create the Sale-App application + migrator users and the reviewed grants in a
-- company production database (dbwins_worldfert9 or dbwins_worldfert2). Same grants as
-- r740-uat-principals.sql; parameterised so IT runs it once per database.
--
-- RUN WITH sqlcmd variables (IT, SSMS or sqlcmd, as a SQL administrator). Example in SSMS:
--   :setvar DBNAME        "dbwins_worldfert9"
--   :setvar APPLOGIN      "wf_r740_prod_app"
--   :setvar MIGRATORLOGIN "wf_r740_prod_migrator"
--   -- then run this file (enable SQLCMD Mode: Query menu > SQLCMD Mode)
-- or sqlcmd:
--   sqlcmd -S R740-SRV\SQL2008 -E -b -v DBNAME="dbwins_worldfert9" APPLOGIN="wf_r740_prod_app" MIGRATORLOGIN="wf_r740_prod_migrator" -i r740-company-principals.sql
--
-- BEFORE: create the two SQL logins in SSMS (SQL auth, strong separate passwords, no server
-- roles, no user mapping). Create the wf schema/users only; it changes no dbo data. It does
-- NOT run migrations (do that next with the backup-gated deploy). Run r740-uat-principals.sql
-- for the -uat copy; this file is for the live company databases.
:on error exit
USE [$(DBNAME)];
GO
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF IS_SRVROLEMEMBER(N'sysadmin') <> 1
BEGIN RAISERROR(N'STOP: run as a SQL administrator.', 16, 1); RETURN; END;
IF @@SERVERNAME <> N'R740-SRV\SQL2008'
BEGIN RAISERROR(N'STOP: unexpected server %s.', 16, 1, @@SERVERNAME); RETURN; END;
IF DB_NAME() NOT LIKE N'dbwins_worldfert%'
BEGIN RAISERROR(N'STOP: $(DBNAME) is not a dbwins_worldfert database.', 16, 1); RETURN; END;
IF CONVERT(NVARCHAR(32), SERVERPROPERTY('ProductVersion')) NOT LIKE N'10.50.%'
BEGIN RAISERROR(N'STOP: not the approved 10.50.x engine.', 16, 1); RETURN; END;
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'$(APPLOGIN)' AND type_desc = N'SQL_LOGIN' AND is_disabled = 0)
   OR NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'$(MIGRATORLOGIN)' AND type_desc = N'SQL_LOGIN' AND is_disabled = 0)
BEGIN RAISERROR(N'STOP: create/enable both SQL logins first (separate passwords, no server roles).', 16, 1); RETURN; END;

-- Neither login may hold an elevated server role or CONTROL SERVER.
IF EXISTS (
    SELECT 1 FROM sys.server_role_members rm
    JOIN sys.server_principals rolep ON rolep.principal_id = rm.role_principal_id
    JOIN sys.server_principals memberp ON memberp.principal_id = rm.member_principal_id
    WHERE memberp.name IN (N'$(APPLOGIN)', N'$(MIGRATORLOGIN)')
      AND rolep.name IN (N'sysadmin', N'securityadmin', N'serveradmin', N'setupadmin', N'processadmin', N'diskadmin', N'dbcreator', N'bulkadmin')
) OR EXISTS (
    SELECT 1 FROM sys.server_permissions p
    JOIN sys.server_principals memberp ON memberp.principal_id = p.grantee_principal_id
    WHERE memberp.name IN (N'$(APPLOGIN)', N'$(MIGRATORLOGIN)') AND p.permission_name = N'CONTROL SERVER' AND p.state IN ('G','W')
)
BEGIN RAISERROR(N'STOP: a login has an elevated server role or CONTROL SERVER.', 16, 1); RETURN; END;

-- Required WINSpeed dbo tables for the reviewed grants.
IF OBJECT_ID(N'dbo.SODT',N'U') IS NULL OR OBJECT_ID(N'dbo.SODTRemark',N'U') IS NULL
   OR OBJECT_ID(N'dbo.SMAudit',N'U') IS NULL OR OBJECT_ID(N'dbo.EMRunBrch',N'U') IS NULL OR OBJECT_ID(N'dbo.SOHD',N'U') IS NULL
BEGIN RAISERROR(N'STOP: required WINSpeed dbo tables are missing; this is not a compatible company database.', 16, 1); RETURN; END;

IF SCHEMA_ID(N'wf') IS NOT NULL AND (SELECT principal_id FROM sys.schemas WHERE name = N'wf') <> DATABASE_PRINCIPAL_ID(N'dbo')
BEGIN RAISERROR(N'STOP: existing wf schema is not owned by dbo; inspect it manually.', 16, 1); RETURN; END;

BEGIN TRY
    BEGIN TRANSACTION;
    ALTER LOGIN [$(APPLOGIN)]      WITH DEFAULT_DATABASE = [$(DBNAME)], CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;
    ALTER LOGIN [$(MIGRATORLOGIN)] WITH DEFAULT_DATABASE = [$(DBNAME)], CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;

    IF SCHEMA_ID(N'wf') IS NULL EXEC(N'CREATE SCHEMA wf AUTHORIZATION dbo');
    IF DATABASE_PRINCIPAL_ID(N'wf_reader') IS NULL EXEC(N'CREATE ROLE [wf_reader] AUTHORIZATION [dbo]');
    IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$(APPLOGIN)')
        CREATE USER [$(APPLOGIN)] FOR LOGIN [$(APPLOGIN)] WITH DEFAULT_SCHEMA = dbo;
    IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$(MIGRATORLOGIN)')
        CREATE USER [$(MIGRATORLOGIN)] FOR LOGIN [$(MIGRATORLOGIN)] WITH DEFAULT_SCHEMA = dbo;

    EXEC(N'
        GRANT SELECT ON SCHEMA::dbo TO [$(APPLOGIN)];
        GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE, REFERENCES ON SCHEMA::wf TO [$(APPLOGIN)];
        GRANT INSERT, DELETE ON dbo.SODT TO [$(APPLOGIN)];
        GRANT INSERT, DELETE ON dbo.SODTRemark TO [$(APPLOGIN)];
        GRANT INSERT ON dbo.SMAudit TO [$(APPLOGIN)];
        GRANT UPDATE (LastNo) ON dbo.EMRunBrch TO [$(APPLOGIN)];
        GRANT UPDATE (TranspID, CustID, CustName, SumGoodAmnt, BillAftrDiscAmnt, NetAmnt, Remark, DocuStatus, PkgStatus,
                      CheckAll, TransRegistration) ON dbo.SOHD TO [$(APPLOGIN)];

        GRANT SELECT ON SCHEMA::dbo TO [$(MIGRATORLOGIN)];
        GRANT CONTROL ON SCHEMA::wf TO [$(MIGRATORLOGIN)];
        GRANT CREATE TABLE, CREATE VIEW, CREATE PROCEDURE, CREATE FUNCTION, CREATE TYPE, VIEW DEFINITION TO [$(MIGRATORLOGIN)];
    ');
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    DECLARE @m NVARCHAR(2048) = ERROR_MESSAGE();
    RAISERROR(N'$(DBNAME) principal setup rolled back: %s', 16, 1, @m);
    RETURN;
END CATCH;
GO
SELECT N'$(APPLOGIN)' AS login_name, USER_ID(N'$(APPLOGIN)') AS db_user_id, IS_ROLEMEMBER(N'db_owner', N'$(APPLOGIN)') AS is_db_owner
UNION ALL
SELECT N'$(MIGRATORLOGIN)', USER_ID(N'$(MIGRATORLOGIN)'), IS_ROLEMEMBER(N'db_owner', N'$(MIGRATORLOGIN)');
SELECT @@SERVERNAME AS server_name, DB_NAME() AS database_name;
