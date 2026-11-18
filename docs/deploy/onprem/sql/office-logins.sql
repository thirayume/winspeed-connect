-- =============================================================================
-- office-logins.sql — Sale-App logins on the office SQL Server (the WINSpeed database)
--
-- Run by the SQL Server administrator, once per database (the test copy first, then the real one), in
-- SQLCMD mode (SSMS: Query → SQLCMD Mode, or sqlcmd -i). Passwords are given as variables when run and are
-- never stored in this file:
--
--   sqlcmd -S <server> -E -i office-logins.sql ^
--     -v DB_NAME="dbwins_worldfert9_test" APP_LOGIN="wf_app" APP_PASSWORD="..." ^
--        MIGRATOR_LOGIN="wf_migrator" MIGRATOR_PASSWORD="..."
--
-- What it grants is the set the app ran with through UAT on SQL Server 2008 R2 (local wf_uat_app /
-- wf_uat_migrator, 2026-10-09):
--   app login      : read dbo · read/write and EXECUTE on schema wf · a few column-level writes in dbo
--                    (everything else in dbo goes through wf procedures, ownership chaining, wf owned by dbo)
--   migrator login : read dbo · CONTROL on schema wf · CREATE TABLE/VIEW/PROCEDURE/FUNCTION/TYPE
-- Neither login is sysadmin or db_owner; the app refuses to start if either has an elevated server role.
-- Safe to run again: existing logins, users and grants are kept (passwords are not changed).
-- =============================================================================
:on error exit
SET NOCOUNT ON;

USE [master];
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'$(APP_LOGIN)')
    CREATE LOGIN [$(APP_LOGIN)] WITH PASSWORD = N'$(APP_PASSWORD)', DEFAULT_DATABASE = [$(DB_NAME)], CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'$(MIGRATOR_LOGIN)')
    CREATE LOGIN [$(MIGRATOR_LOGIN)] WITH PASSWORD = N'$(MIGRATOR_PASSWORD)', DEFAULT_DATABASE = [$(DB_NAME)], CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;
GO

USE [$(DB_NAME)];
GO
-- the app's schema, owned by dbo so its procedures may write WINSpeed tables through ownership chaining
IF SCHEMA_ID('wf') IS NULL EXEC('CREATE SCHEMA wf AUTHORIZATION dbo');
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$(APP_LOGIN)')
    CREATE USER [$(APP_LOGIN)] FOR LOGIN [$(APP_LOGIN)] WITH DEFAULT_SCHEMA = dbo;
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$(MIGRATOR_LOGIN)')
    CREATE USER [$(MIGRATOR_LOGIN)] FOR LOGIN [$(MIGRATOR_LOGIN)] WITH DEFAULT_SCHEMA = dbo;
GO

-- ── app login ────────────────────────────────────────────────────────────────
GRANT SELECT ON SCHEMA::dbo TO [$(APP_LOGIN)];
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE, REFERENCES ON SCHEMA::wf TO [$(APP_LOGIN)];
GRANT INSERT, DELETE ON dbo.SODT TO [$(APP_LOGIN)];
GRANT INSERT, DELETE ON dbo.SODTRemark TO [$(APP_LOGIN)];
GRANT INSERT ON dbo.SMAudit TO [$(APP_LOGIN)];
GRANT UPDATE (LastNo) ON dbo.EMRunBrch TO [$(APP_LOGIN)];
GRANT UPDATE (TranspID, CustID, CustName, SumGoodAmnt, BillAftrDiscAmnt, NetAmnt, Remark, DocuStatus, PkgStatus,
              CheckAll, TransRegistration) ON dbo.SOHD TO [$(APP_LOGIN)];
GO

-- ── migrator login ───────────────────────────────────────────────────────────
GRANT SELECT ON SCHEMA::dbo TO [$(MIGRATOR_LOGIN)];
GRANT CONTROL ON SCHEMA::wf TO [$(MIGRATOR_LOGIN)];
GRANT CREATE TABLE, CREATE VIEW, CREATE PROCEDURE, CREATE FUNCTION, CREATE TYPE, VIEW DEFINITION TO [$(MIGRATOR_LOGIN)];
GO

-- ── result: what both logins hold now ────────────────────────────────────────
SELECT pr.name AS principal, p.state_desc + ' ' + p.permission_name AS permission,
       CASE p.class WHEN 0 THEN 'DATABASE' WHEN 3 THEN 'SCHEMA::' + SCHEMA_NAME(p.major_id)
            ELSE OBJECT_SCHEMA_NAME(p.major_id) + '.' + OBJECT_NAME(p.major_id) END AS on_object
FROM sys.database_permissions p
JOIN sys.database_principals pr ON pr.principal_id = p.grantee_principal_id
WHERE pr.name IN (N'$(APP_LOGIN)', N'$(MIGRATOR_LOGIN)');
SELECT name, IS_SRVROLEMEMBER('sysadmin', name) AS is_sysadmin FROM sys.server_principals
WHERE name IN (N'$(APP_LOGIN)', N'$(MIGRATOR_LOGIN)');
GO
