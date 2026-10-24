-- R740-SRV: pre-migrate COPY_ONLY backup of dbwins_worldfert2 (a live company database).
-- Run in SSMS as a SQL administrator right before deploy.bat prod applies migrations;
-- the deploy refuses to apply without a dbwins_worldfert2_predeploy_*.bak younger than
-- 120 minutes in D:\MSSQL\MSSQL10_50.SQL2008\Backup (SQL Server's backup folder).
--
-- COPY_ONLY leaves the regular backup chain untouched. CHECKSUM plus RESTORE VERIFYONLY
-- prove the file is readable. If a deploy fails, first stop the saleapp-prod stack: the
-- migrations only add wf objects, so WINSpeed keeps working. Restore this file only for real
-- damage, and remember a restore also discards WINSpeed entries made after this backup.
USE [master];
SET NOCOUNT ON;

IF IS_SRVROLEMEMBER(N'sysadmin') <> 1
BEGIN
    RAISERROR(N'STOP: run this backup in SSMS with the approved SQL Server administrator account.', 16, 1);
    RETURN;
END;
IF @@SERVERNAME <> N'R740-SRV\SQL2008' OR DB_ID(N'dbwins_worldfert2') IS NULL
BEGIN
    RAISERROR(N'STOP: this is not R740-SRV\SQL2008 with dbwins_worldfert2.', 16, 1);
    RETURN;
END;

DECLARE @dir NVARCHAR(260) = N'D:\MSSQL\MSSQL10_50.SQL2008\Backup';
DECLARE @stamp NVARCHAR(15) = REPLACE(REPLACE(REPLACE(CONVERT(NVARCHAR(19), GETDATE(), 120), N'-', N''), N':', N''), N' ', N'-');
DECLARE @file NVARCHAR(400) = @dir + N'\dbwins_worldfert2_predeploy_' + @stamp + N'.bak';

-- Created by the SQL Server service, so it keeps the rights SQL Server needs.
EXEC master.dbo.xp_create_subdir @dir;

BACKUP DATABASE [dbwins_worldfert2] TO DISK = @file
    WITH COPY_ONLY, CHECKSUM, INIT, NAME = N'Sale-App pre-deploy (copy-only)', STATS = 10;

RESTORE VERIFYONLY FROM DISK = @file WITH CHECKSUM;

SELECT @file AS backup_file, GETDATE() AS finished_at,
       N'Verified. deploy.bat prod may apply migrations within 120 minutes.' AS next_step;
