-- Local UAT2 application administrator. Run the whole file in SSMS.
-- Creates only wf.AppUser; does not create a SQL Server login.
-- Temporary password is provided separately. Change it in the app profile after login.
-- Local credential material: do not commit or share this file.
USE [dbwins_worldfert9_uat2];
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_WARNINGS ON;
SET ANSI_PADDING ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON;
SET NUMERIC_ROUNDABORT OFF;
GO

IF CONVERT(nvarchar(128), SERVERPROPERTY('ServerName')) <> N'AMYOU-YOGA7\V2008R2'
   OR DB_NAME() <> N'dbwins_worldfert9_uat2'
BEGIN
    RAISERROR(N'STOP: Wrong SQL Server or database.', 16, 1);
    RETURN;
END;

IF OBJECT_ID(N'wf.AppUser', N'U') IS NULL
   OR COL_LENGTH(N'wf.AppUser', N'MustChangePassword') IS NULL
BEGIN
    RAISERROR(N'STOP: Complete the UAT2 migrations before creating an app account.', 16, 1);
    RETURN;
END;

IF @@TRANCOUNT <> 0
BEGIN
    RAISERROR(N'STOP: Open a new query window without an existing transaction.', 16, 1);
    RETURN;
END;

BEGIN TRY
    BEGIN TRANSACTION;

    IF EXISTS (SELECT 1 FROM wf.AppUser WITH (UPDLOCK, HOLDLOCK) WHERE Username = N'admin')
        RAISERROR(N'STOP: admin already exists; its password and role were not changed.', 16, 1);

    INSERT INTO wf.AppUser
        (Username, PasswordHash, DisplayName, Role, EmpId, IsActive, MustChangePassword)
    VALUES
        (N'admin', N'$2b$12$XCdFKNMDITQ8tHfN1F4lyOeY7Hv3nCouawG7GqAT7AgFrNav58aoK', N'UAT Administrator', N'ADMIN', NULL, 1, 1);

    COMMIT TRANSACTION;

    SELECT Id, Username, DisplayName, Role, IsActive, MustChangePassword
    FROM wf.AppUser WHERE Username = N'admin';
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    DECLARE @ErrorMessage nvarchar(4000);
    SET @ErrorMessage = ERROR_MESSAGE();
    RAISERROR(N'%s', 16, 1, @ErrorMessage);
END CATCH;
