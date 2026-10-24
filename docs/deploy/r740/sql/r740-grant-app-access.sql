-- R740-SRV: let one more application login use a company database that already has the wf
-- schema (set up by r740-company-principals.sql and migrated). App-level grants only, no DDL.
-- Use this to let the UAT app login switch into the live company databases:
--   sqlcmd -S R740-SRV\SQL2008 -E -b -v DBNAME="dbwins_worldfert9" APPLOGIN="wf_r740_uat_app" -i r740-grant-app-access.sql
--   sqlcmd -S R740-SRV\SQL2008 -E -b -v DBNAME="dbwins_worldfert2" APPLOGIN="wf_r740_uat_app" -i r740-grant-app-access.sql
-- Changes no dbo data. The login gets the same reviewed app grants as the owning environment.
:on error exit
USE [$(DBNAME)];
GO
SET NOCOUNT ON; SET XACT_ABORT ON;
IF IS_SRVROLEMEMBER(N'sysadmin') <> 1 BEGIN RAISERROR(N'STOP: run as a SQL administrator.', 16, 1); RETURN; END;
IF @@SERVERNAME <> N'R740-SRV\SQL2008' OR DB_NAME() NOT LIKE N'dbwins_worldfert%'
BEGIN RAISERROR(N'STOP: unexpected server or database.', 16, 1); RETURN; END;
IF SCHEMA_ID(N'wf') IS NULL
BEGIN RAISERROR(N'STOP: $(DBNAME) has no wf schema yet; run company principals + migrations first.', 16, 1); RETURN; END;
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'$(APPLOGIN)' AND type_desc = N'SQL_LOGIN' AND is_disabled = 0)
BEGIN RAISERROR(N'STOP: login $(APPLOGIN) does not exist or is disabled.', 16, 1); RETURN; END;

BEGIN TRY
    BEGIN TRANSACTION;
    IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$(APPLOGIN)')
        CREATE USER [$(APPLOGIN)] FOR LOGIN [$(APPLOGIN)] WITH DEFAULT_SCHEMA = dbo;
    EXEC(N'
        GRANT SELECT ON SCHEMA::dbo TO [$(APPLOGIN)];
        GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE, REFERENCES ON SCHEMA::wf TO [$(APPLOGIN)];
        GRANT INSERT, DELETE ON dbo.SODT TO [$(APPLOGIN)];
        GRANT INSERT, DELETE ON dbo.SODTRemark TO [$(APPLOGIN)];
        GRANT INSERT ON dbo.SMAudit TO [$(APPLOGIN)];
        GRANT UPDATE (LastNo) ON dbo.EMRunBrch TO [$(APPLOGIN)];
        GRANT UPDATE (TranspID, CustID, CustName, SumGoodAmnt, BillAftrDiscAmnt, NetAmnt, Remark, DocuStatus, PkgStatus,
                      CheckAll, TransRegistration) ON dbo.SOHD TO [$(APPLOGIN)];
    ');
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    DECLARE @m NVARCHAR(2048) = ERROR_MESSAGE();
    RAISERROR(N'$(DBNAME) app-access grant rolled back: %s', 16, 1, @m); RETURN;
END CATCH;
SELECT N'$(APPLOGIN)' AS login_name, DB_NAME() AS database_name, USER_ID(N'$(APPLOGIN)') AS db_user_id;
