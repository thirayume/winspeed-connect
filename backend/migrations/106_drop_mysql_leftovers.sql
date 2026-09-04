-- =============================================================
-- 106_drop_mysql_leftovers.sql
--
-- ลบตารางที่เหลือจากยุค MySQL TruckScale และสำเนาข้อมูลทดสอบของ WGxx
-- เจ้าของระบบสั่งลบเมื่อ 04/09/2569
--
-- ลบอะไร
--   wf.WeighInbox                       220,396 แถว · 67.8 MB
--     ตารางรับข้อมูลชั่งที่ sync มาจาก MySQL ของ TruckScale
--     ข้อมูลหยุดที่ปี 2562 และตัว sync ถูกลบไปแล้วใน commit ก่อนหน้า
--     ไม่มีโค้ดใดอ่านอีก (เหลือแค่คอมเมนต์ใน reports.js ที่บอกว่าย้ายไป dbo.WGHD)
--
--   wf.WGxxBackup_WGHD_20260903          181 แถว
--   wf.WGxxBackup_WGDT_20260903          311 แถว
--   wf.WGxxBackup_WGDTReport_20260903     29 แถว
--     สำเนาที่มีคนยกออกจาก dbo.WGxx เมื่อ 3 ก.ย. 2569
--     เจ้าของยืนยันว่าเป็นข้อมูลทดสอบล้วน
--
-- ⚠ สิ่งที่จงใจไม่ลบ — และห้ามลบ
--   wf.WeighTicket · wf.WeighTicketItemLog
--     สองตัวนี้ **ไม่ใช่** ของเหลือจาก MySQL แต่เป็นตารางของแอปเอง
--     routes/so.js เขียนลงตอนกดชั่งออก (INSERT INTO wf.WeighTicket)
--     และมี recon.js กับรายงานอีกสามฉบับอ่านอยู่
--     ตอนนี้ว่างเพราะยังไม่มีใครใช้ flow นั้นบน production เท่านั้น
--     ลบเมื่อไรระบบส่งของพังทันที
--
-- ⚠ ทำผ่าน migration ไม่ใช่ลบด้วยมือ เพื่อให้การ rebuild ฐานใหม่ยังทำงานได้
--   migration 019/029/059/060/061/073 ยังสร้างและซ่อมตารางเหล่านี้ตามลำดับเดิม
--   แล้ว 106 มาลบทีหลัง ลำดับจึงสอดคล้องกันทั้งสาย
--
-- ⚠ ไม่แตะ schema dbo
-- =============================================================

-- ── 1. ตารางรับข้อมูลจาก MySQL ────────────────────────────────
IF EXISTS (SELECT 1 FROM sys.tables WHERE object_id = OBJECT_ID(N'[wf].[WeighInbox]'))
BEGIN
    -- ตัด FK ที่ชี้เข้ามาก่อน ถ้ามี ไม่งั้น DROP จะล้ม
    DECLARE @sqlFk NVARCHAR(MAX) = N'';
    SELECT @sqlFk = @sqlFk + N'ALTER TABLE ' + QUOTENAME(SCHEMA_NAME(fk.schema_id)) + N'.' +
                    QUOTENAME(OBJECT_NAME(fk.parent_object_id)) +
                    N' DROP CONSTRAINT ' + QUOTENAME(fk.name) + N';' + CHAR(10)
    FROM sys.foreign_keys fk
    WHERE fk.referenced_object_id = OBJECT_ID(N'[wf].[WeighInbox]');
    IF LEN(@sqlFk) > 0 EXEC sp_executesql @sqlFk;

    DROP TABLE wf.WeighInbox;
    PRINT 'ลบ wf.WeighInbox แล้ว';
END
ELSE PRINT 'ไม่มี wf.WeighInbox — ข้าม';
GO

-- ── 2. สำเนาข้อมูลทดสอบของ WGxx ───────────────────────────────
IF EXISTS (SELECT 1 FROM sys.tables WHERE object_id = OBJECT_ID(N'[wf].[WGxxBackup_WGDTReport_20260903]'))
BEGIN DROP TABLE wf.WGxxBackup_WGDTReport_20260903; PRINT 'ลบ WGxxBackup_WGDTReport_20260903 แล้ว'; END
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE object_id = OBJECT_ID(N'[wf].[WGxxBackup_WGDT_20260903]'))
BEGIN DROP TABLE wf.WGxxBackup_WGDT_20260903; PRINT 'ลบ WGxxBackup_WGDT_20260903 แล้ว'; END
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE object_id = OBJECT_ID(N'[wf].[WGxxBackup_WGHD_20260903]'))
BEGIN DROP TABLE wf.WGxxBackup_WGHD_20260903; PRINT 'ลบ WGxxBackup_WGHD_20260903 แล้ว'; END
GO

-- ── 3. ค่าตั้งค่าที่เกี่ยวกับ sync ของ MySQL ──────────────────
DELETE FROM wf.SystemSetting
WHERE SettingKey IN ('TS_SYNC_INTERVAL_MS', 'TRUCKSCALE_MYSQL', 'TS_PRODUCTION_HOSTS');
GO
