-- =============================================================
-- db_maintenance.sql
-- DB Maintenance: Rebuild Indexes + Shrink Log + Update Stats
--
-- !! รัน manual ใน SSMS เท่านั้น — ไม่ใส่ใน migration pipeline !!
-- !! ควรรันช่วง off-peak (กลางคืน หรือ weekend) !!
-- !! ใช้เวลาประมาณ 10-30 นาที ขึ้นกับขนาด DB !!
--
-- วิธีใช้:
--   1. เปิด SSMS → Connect remote / local
--   2. เลือก database dbwins_worldfert9
--   3. รัน script นี้ทีละ section ตามลำดับ
-- =============================================================

USE dbwins_worldfert9;
GO

-- ══════════════════════════════════════════════════════════════
-- SECTION 1: ตรวจ Fragmentation ก่อน (ดูว่า index ไหนต้องซ่อม)
-- ══════════════════════════════════════════════════════════════
SELECT
    OBJECT_SCHEMA_NAME(i.object_id)        AS Sch,
    OBJECT_NAME(i.object_id)               AS Tbl,
    i.name                                 AS IdxName,
    CAST(s.avg_fragmentation_in_percent AS DECIMAL(5,1)) AS FragPct,
    s.page_count                           AS Pages,
    CASE
        WHEN s.avg_fragmentation_in_percent > 30 THEN 'REBUILD'
        WHEN s.avg_fragmentation_in_percent > 10 THEN 'REORGANIZE'
        ELSE 'OK'
    END AS Action
FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, 'LIMITED') s
JOIN sys.indexes i ON i.object_id = s.object_id AND i.index_id = s.index_id
WHERE s.page_count > 100
  AND i.type > 0
ORDER BY s.avg_fragmentation_in_percent DESC;
GO

-- ══════════════════════════════════════════════════════════════
-- SECTION 2: Rebuild fragmented indexes (> 30% fragmentation)
--            บน tables ที่ WS-Sale-App ใช้งาน
-- ══════════════════════════════════════════════════════════════
PRINT 'Rebuilding wf schema indexes...';

ALTER INDEX ALL ON wf.SalesOrder         REBUILD WITH (ONLINE = OFF, FILLFACTOR = 85);
ALTER INDEX ALL ON wf.SalesOrderLine     REBUILD WITH (ONLINE = OFF, FILLFACTOR = 85);
ALTER INDEX ALL ON wf.SalesOrderAudit    REBUILD WITH (ONLINE = OFF, FILLFACTOR = 85);
ALTER INDEX ALL ON wf.RebatePool         REBUILD WITH (ONLINE = OFF, FILLFACTOR = 90);
ALTER INDEX ALL ON wf.RebateLedger       REBUILD WITH (ONLINE = OFF, FILLFACTOR = 85);
ALTER INDEX ALL ON wf.RebateClaim        REBUILD WITH (ONLINE = OFF, FILLFACTOR = 90);
ALTER INDEX ALL ON wf.GiveawayBudget     REBUILD WITH (ONLINE = OFF, FILLFACTOR = 90);
ALTER INDEX ALL ON wf.GiveawayWithdrawal REBUILD WITH (ONLINE = OFF, FILLFACTOR = 85);
ALTER INDEX ALL ON wf.GiveawayItem       REBUILD WITH (ONLINE = OFF, FILLFACTOR = 90);
ALTER INDEX ALL ON wf.AppUser            REBUILD WITH (ONLINE = OFF, FILLFACTOR = 90);

PRINT 'Rebuilding dbo tables used by WS-Sale-App...';

ALTER INDEX ALL ON dbo.SOHD         REBUILD WITH (ONLINE = OFF, FILLFACTOR = 85);
ALTER INDEX ALL ON dbo.SODT         REBUILD WITH (ONLINE = OFF, FILLFACTOR = 85);
ALTER INDEX ALL ON dbo.EMCust       REBUILD WITH (ONLINE = OFF, FILLFACTOR = 85);
ALTER INDEX ALL ON dbo.EMGood       REBUILD WITH (ONLINE = OFF, FILLFACTOR = 85);
ALTER INDEX ALL ON dbo.EMSetPriceDT REBUILD WITH (ONLINE = OFF, FILLFACTOR = 85);
ALTER INDEX ALL ON dbo.SOInvHD      REBUILD WITH (ONLINE = OFF, FILLFACTOR = 85);
ALTER INDEX ALL ON dbo.SOInvDT      REBUILD WITH (ONLINE = OFF, FILLFACTOR = 85);
GO

-- ══════════════════════════════════════════════════════════════
-- SECTION 3: Update Statistics
-- ══════════════════════════════════════════════════════════════
PRINT 'Updating statistics...';

UPDATE STATISTICS wf.SalesOrder         WITH FULLSCAN;
UPDATE STATISTICS wf.SalesOrderLine     WITH FULLSCAN;
UPDATE STATISTICS wf.RebatePool         WITH FULLSCAN;
UPDATE STATISTICS wf.RebateLedger       WITH FULLSCAN;
UPDATE STATISTICS wf.GiveawayBudget     WITH FULLSCAN;
UPDATE STATISTICS wf.GiveawayWithdrawal WITH FULLSCAN;
UPDATE STATISTICS dbo.SOHD              WITH FULLSCAN;
UPDATE STATISTICS dbo.SODT              WITH FULLSCAN;
UPDATE STATISTICS dbo.EMCust            WITH FULLSCAN;
UPDATE STATISTICS dbo.EMGood            WITH FULLSCAN;
UPDATE STATISTICS dbo.EMSetPriceDT      WITH FULLSCAN;
GO

-- ══════════════════════════════════════════════════════════════
-- SECTION 4: Shrink LOG file
-- Data file: 3,038 MB / Used: 2,833 MB  → ไม่ควร shrink (จะ fragment)
-- Log file:  27.5 MB  / Used: 26.4 MB   → shrink ได้ปลอดภัย
-- ══════════════════════════════════════════════════════════════
PRINT 'Shrinking log file...';

-- ตั้งเป็น SIMPLE recovery ชั่วคราว เพื่อ truncate active log
ALTER DATABASE dbwins_worldfert9 SET RECOVERY SIMPLE;
GO

DBCC SHRINKFILE (dbERP_New_Log, 5);  -- shrink เหลือ 5 MB
GO

-- เปลี่ยนกลับ FULL recovery (สำคัญมาก! อย่าลืม)
ALTER DATABASE dbwins_worldfert9 SET RECOVERY FULL;
GO

PRINT 'Log shrink complete.';
GO

-- ══════════════════════════════════════════════════════════════
-- SECTION 5: ตรวจสอบขนาด DB หลัง maintenance
-- ══════════════════════════════════════════════════════════════
SELECT
    name,
    type_desc,
    CAST(size * 8.0 / 1024 AS DECIMAL(10,1))                      AS SizeMB,
    CAST(FILEPROPERTY(name, 'SpaceUsed') * 8.0 / 1024 AS DECIMAL(10,1)) AS UsedMB,
    CAST((size - FILEPROPERTY(name, 'SpaceUsed')) * 8.0 / 1024 AS DECIMAL(10,1)) AS FreeMB
FROM sys.database_files;
GO

PRINT 'Maintenance complete!';
GO
