-- R740-SRV\SQL2008: database settings that slow every read (assessment of 18 Nov 2026).
-- Run once in SSMS as a SQL Server administrator (Windows login). Safe while users work; WinSpeed is not affected.
--
--  AUTO_CLOSE ON   closes a database when its last connection ends and throws its cache away; the next user
--                  waits for it to open and read everything from disk again. Express turns it on by default.
--  AUTO_SHRINK ON  shrinks files in the background, fragmenting every index and using CPU and disk all day.
--  PAGE_VERIFY     NONE means a damaged page is never noticed. CHECKSUM protects pages written from now on.
--  FILEGROWTH 10%  on an 18 GB log means growth steps of almost 2 GB that stop all writes while they run;
--                  fixed steps of 256 MB are quick and predictable.
USE [master];
SET NOCOUNT ON;
IF IS_SRVROLEMEMBER(N'sysadmin') <> 1 BEGIN RAISERROR(N'STOP: run as a SQL Server administrator.', 16, 1); RETURN; END;
IF @@SERVERNAME <> N'R740-SRV\SQL2008' BEGIN RAISERROR(N'STOP: this is not R740-SRV\SQL2008.', 16, 1); RETURN; END;

DECLARE @db SYSNAME, @sql NVARCHAR(MAX);
DECLARE dbs CURSOR LOCAL FAST_FORWARD FOR
    SELECT name FROM sys.databases WHERE name IN (N'dbwins_worldfert9', N'dbwins_worldfert9_uat', N'dbwins_worldfert2') AND state_desc = N'ONLINE';
OPEN dbs; FETCH NEXT FROM dbs INTO @db;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'ALTER DATABASE ' + QUOTENAME(@db) + N' SET AUTO_CLOSE OFF WITH NO_WAIT;'
             + N'ALTER DATABASE ' + QUOTENAME(@db) + N' SET AUTO_SHRINK OFF WITH NO_WAIT;'
             + N'ALTER DATABASE ' + QUOTENAME(@db) + N' SET PAGE_VERIFY CHECKSUM WITH NO_WAIT;'
             + N'ALTER DATABASE ' + QUOTENAME(@db) + N' SET AUTO_UPDATE_STATISTICS ON WITH NO_WAIT;';
    EXEC (@sql);
    -- fixed growth steps for every file of the database
    SET @sql = N'';
    SELECT @sql = @sql + N'ALTER DATABASE ' + QUOTENAME(@db) + N' MODIFY FILE (NAME = ' + QUOTENAME(f.name)
                + N', FILEGROWTH = ' + CASE WHEN f.type = 1 THEN N'256MB' ELSE N'128MB' END + N');'
    FROM sys.master_files f WHERE f.database_id = DB_ID(@db);
    EXEC (@sql);
    FETCH NEXT FROM dbs INTO @db;
END;
CLOSE dbs; DEALLOCATE dbs;

-- Report what is set now.
SELECT d.name, d.recovery_model_desc, d.is_auto_close_on, d.is_auto_shrink_on, d.page_verify_option_desc, d.log_reuse_wait_desc,
       (SELECT CAST(SUM(size) / 128.0 AS DECIMAL(12,0)) FROM sys.master_files f WHERE f.database_id = d.database_id AND f.type = 1) AS LogMB
FROM sys.databases d WHERE d.name IN (N'dbwins_worldfert9', N'dbwins_worldfert9_uat', N'dbwins_worldfert2');
