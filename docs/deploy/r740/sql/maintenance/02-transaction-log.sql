-- R740-SRV\SQL2008: the transaction log of dbwins_worldfert9 (PROD) and dbwins_worldfert9_uat (assessment of 18 Nov 2026).
--
-- Both run in FULL recovery, but no log backup is ever taken, so the log never empties: on the UAT copy it is
-- 18.3 GB with 135 MB in use, and PROD is the same. Only the nightly full backup (task "AUTO Backup SQL2008", 21:00)
-- exists. Choose ONE of the two options with the owner, then run this once in SSMS as a SQL Server administrator.
--
--  Option A (simple, matches today's backups): SIMPLE recovery. The log empties itself; restore points stay the
--           nightly full backups, which is already all that can be restored today.
--  Option B (less data at risk): keep FULL and back the log up every 30 minutes with 03-log-backup.cmd in Task
--           Scheduler; a failure then loses at most 30 minutes instead of a day.
--
-- After either option the log is shrunk ONCE to 2 GB. Never shrink the data file (it fragments every index), and do
-- not schedule shrinking.
USE [master];
SET NOCOUNT ON;
IF IS_SRVROLEMEMBER(N'sysadmin') <> 1 BEGIN RAISERROR(N'STOP: run as a SQL Server administrator.', 16, 1); RETURN; END;
IF @@SERVERNAME <> N'R740-SRV\SQL2008' BEGIN RAISERROR(N'STOP: this is not R740-SRV\SQL2008.', 16, 1); RETURN; END;

DECLARE @option CHAR(1) = 'A';   -- <<< set to 'A' or 'B' as agreed

-- UAT is restored from PROD every night: SIMPLE always (Refresh-UAT.ps1 should set it after each restore).
IF DB_ID(N'dbwins_worldfert9_uat') IS NOT NULL ALTER DATABASE [dbwins_worldfert9_uat] SET RECOVERY SIMPLE WITH NO_WAIT;

IF @option = 'A'
    ALTER DATABASE [dbwins_worldfert9] SET RECOVERY SIMPLE WITH NO_WAIT;
ELSE
BEGIN
    -- start the log chain with one log backup now; 03-log-backup.cmd keeps it going
    DECLARE @file NVARCHAR(400) = N'D:\MSSQL\MSSQL10_50.SQL2008\Backup\dbwins_worldfert9_log_'
        + REPLACE(REPLACE(REPLACE(CONVERT(NVARCHAR(19), GETDATE(), 120), N'-', N''), N':', N''), N' ', N'-') + N'.trn';
    BACKUP LOG [dbwins_worldfert9] TO DISK = @file WITH CHECKSUM, INIT;
END;
GO

-- Shrink each log once to 2 GB (data files are not touched).
USE [dbwins_worldfert9];
CHECKPOINT;
DECLARE @log SYSNAME = (SELECT name FROM sys.database_files WHERE type = 1);
DBCC SHRINKFILE (@log, 2048) WITH NO_INFOMSGS;
GO
IF DB_ID(N'dbwins_worldfert9_uat') IS NOT NULL
BEGIN
    EXEC (N'USE [dbwins_worldfert9_uat]; CHECKPOINT; DECLARE @log SYSNAME = (SELECT name FROM sys.database_files WHERE type = 1); DBCC SHRINKFILE (@log, 2048) WITH NO_INFOMSGS;');
END;
GO
SELECT d.name, d.recovery_model_desc, d.log_reuse_wait_desc,
       (SELECT CAST(SUM(size) / 128.0 AS DECIMAL(12,0)) FROM sys.master_files f WHERE f.database_id = d.database_id AND f.type = 1) AS LogMB
FROM sys.databases d WHERE d.name IN (N'dbwins_worldfert9', N'dbwins_worldfert9_uat');
