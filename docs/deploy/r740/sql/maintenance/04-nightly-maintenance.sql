-- R740-SRV\SQL2008: nightly maintenance for the WinSpeed databases (assessment of 18 Nov 2026).
-- SQL Server Express has no SQL Agent, so nothing has ever maintained these databases: statistics on SOHD date
-- from June/August 2026 and on SOInvDT from 2024–2025. With stale statistics SQL Server picks plans that take
-- 30 s for work that takes 0.3 s. Run every night at 02:00 by 05-run-maintenance.cmd (Task Scheduler).
--
--  1. Index care: rebuild indexes fragmented over 30 % (offline on Express, a few seconds per index at 02:00),
--     reorganize 10–30 %; small indexes (< 500 pages) are skipped.
--  2. Statistics: FULLSCAN on the tables Sale-App and WinSpeed read most, sampled update on everything else.
-- Read-only for the data itself; WinSpeed is not affected. Writes progress to the console for the log file.
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ARITHABORT ON;
IF IS_SRVROLEMEMBER(N'sysadmin') <> 1 BEGIN RAISERROR(N'STOP: run as a SQL Server administrator.', 16, 1); RETURN; END;

DECLARE @db SYSNAME, @sql NVARCHAR(MAX);
DECLARE dbs CURSOR LOCAL FAST_FORWARD FOR
    SELECT name FROM sys.databases WHERE name IN (N'dbwins_worldfert9', N'dbwins_worldfert2', N'dbwins_worldfert9_uat') AND state_desc = N'ONLINE'
    ORDER BY CASE name WHEN N'dbwins_worldfert9' THEN 0 ELSE 1 END;
OPEN dbs; FETCH NEXT FROM dbs INTO @db;
WHILE @@FETCH_STATUS = 0
BEGIN
    PRINT CONVERT(VARCHAR(19), GETDATE(), 120) + ' ' + @db + ': indexes';
    SET @sql = N'USE ' + QUOTENAME(@db) + N';
    DECLARE @cmd NVARCHAR(1000);
    DECLARE @dbid INT = DB_ID();   -- compatibility 80 refuses a function call as a DMF argument
    DECLARE ix CURSOR LOCAL FAST_FORWARD FOR
        SELECT CASE WHEN ps.avg_fragmentation_in_percent >= 30
                    THEN N''ALTER INDEX '' + QUOTENAME(i.name) + N'' ON '' + QUOTENAME(s.name) + N''.'' + QUOTENAME(o.name) + N'' REBUILD''
                    ELSE N''ALTER INDEX '' + QUOTENAME(i.name) + N'' ON '' + QUOTENAME(s.name) + N''.'' + QUOTENAME(o.name) + N'' REORGANIZE'' END
        FROM sys.dm_db_index_physical_stats(@dbid, NULL, NULL, NULL, ''LIMITED'') ps
        JOIN sys.indexes i ON i.object_id = ps.object_id AND i.index_id = ps.index_id
        JOIN sys.objects o ON o.object_id = ps.object_id AND o.type = ''U''
        JOIN sys.schemas s ON s.schema_id = o.schema_id
        WHERE ps.index_id > 0 AND ps.page_count >= 500 AND ps.avg_fragmentation_in_percent >= 10 AND i.name IS NOT NULL
        ORDER BY ps.page_count DESC;
    OPEN ix; FETCH NEXT FROM ix INTO @cmd;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        BEGIN TRY EXEC (@cmd); PRINT ''  '' + @cmd; END TRY
        BEGIN CATCH PRINT ''  skipped: '' + @cmd + '' ('' + ERROR_MESSAGE() + '')''; END CATCH;
        FETCH NEXT FROM ix INTO @cmd;
    END;
    CLOSE ix; DEALLOCATE ix;

    DECLARE @t NVARCHAR(300);
    DECLARE hot CURSOR LOCAL FAST_FORWARD FOR
        SELECT QUOTENAME(OBJECT_SCHEMA_NAME(object_id)) + N''.'' + QUOTENAME(name) FROM sys.tables
        WHERE object_id IN (OBJECT_ID(''dbo.SOHD''), OBJECT_ID(''dbo.SODT''), OBJECT_ID(''dbo.SOInvHD''), OBJECT_ID(''dbo.SOInvDT''),
                            OBJECT_ID(''dbo.WFCoupon''), OBJECT_ID(''dbo.WFRedemtionHD''), OBJECT_ID(''dbo.WFRedemtionDT''), OBJECT_ID(''dbo.WGHD''),
                            OBJECT_ID(''dbo.EMGood''), OBJECT_ID(''dbo.EMCust''), OBJECT_ID(''dbo.EMSetPriceHD''), OBJECT_ID(''dbo.EMSetPriceDT''),
                            OBJECT_ID(''wf.SalesOrder''), OBJECT_ID(''wf.SalesOrderLine''), OBJECT_ID(''wf.SalesOrderExt''), OBJECT_ID(''wf.SalesTrip''));
    OPEN hot; FETCH NEXT FROM hot INTO @t;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        EXEC (N''UPDATE STATISTICS '' + @t + N'' WITH FULLSCAN''); PRINT ''  statistics FULLSCAN '' + @t;
        FETCH NEXT FROM hot INTO @t;
    END;
    CLOSE hot; DEALLOCATE hot;
    EXEC sp_updatestats;';
    EXEC (@sql);
    PRINT CONVERT(VARCHAR(19), GETDATE(), 120) + ' ' + @db + ': done';
    FETCH NEXT FROM dbs INTO @db;
END;
CLOSE dbs; DEALLOCATE dbs;
