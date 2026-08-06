-- =============================================================
-- 073_repair_weighinbox_missing_dateout.sql
--
-- ซ่อมสำเนาใบชั่งใน wf.WeighInbox ที่ชั่งออกแล้วแต่ไม่มีวันที่ชั่งออก
--
-- ที่มา: ต้นทางในฐานเครื่องชั่ง (MySQL tblscale) มีใบที่ weight_out > 0 แต่
-- Date_Out ว่าง — สำรวจทั้งตาราง 403,918 ใบ พบ 1 ใบ (sequence 02619863)
-- sync ของเราคัดลอกมาตรงตามต้นทาง สำเนาจึงว่างตามไปด้วยอย่างซื่อสัตย์
--
-- ต้นทางซ่อมด้วย migrations/mysql/002_repair_scale_missing_dateout.sql ซึ่งคำนวณ
-- วันที่กลับจาก Date_Out2 (OLE serial) · MERGE ใน truckscale-sync.js อัปเดต DateOut
-- ทุกครั้งที่ใบถูกดึงซ้ำอยู่แล้ว แต่ใบเก่าปี 2563 ไม่เข้าช่วงที่ sync ดึงตามปกติ
-- จึงต้องซ่อมสำเนาตรงนี้ด้วย ไม่งั้นหน้าจอฝั่งเราจะยังว่างอยู่ต่อไป
--
-- ทำไมไม่คำนวณจาก serial ตรงนี้: wf.WeighInbox ไม่ได้เก็บ Date_Out2 ไว้ เก็บแต่
-- ข้อความวันที่ · การเดาวันจากคอลัมน์อื่นที่มีอยู่จะเป็นการสร้างข้อมูลขึ้นเอง
-- migration นี้จึงตั้งค่าจากรายการที่ยืนยันแล้วเท่านั้น
--
-- ตรวจสามทางก่อนยืนยันค่า: Date_Out2 = 43939 → 18/04/2563 ตรงกับ Date_In
-- ('18/04/2563') · movebill 63041135 (YYMM 6304 = เม.ย. 2563) · s_day 6304
--
-- Safe to re-run (idempotent) — แตะเฉพาะแถวที่ยังว่างอยู่จริง
-- =============================================================

SET NOCOUNT ON;
GO

-- รายการที่ยืนยันแล้ว เพิ่มบรรทัดใหม่ได้ถ้าพบใบอื่นในภายหลัง
IF OBJECT_ID('tempdb..#Known') IS NOT NULL DROP TABLE #Known;
CREATE TABLE #Known (
    Sequence NVARCHAR(50) COLLATE DATABASE_DEFAULT PRIMARY KEY,
    DateOut  NVARCHAR(30) COLLATE DATABASE_DEFAULT NOT NULL
);
INSERT INTO #Known (Sequence, DateOut) VALUES
    (N'02619863', N'18/04/2563');
GO

DECLARE @before INT = (
    SELECT COUNT(*) FROM wf.WeighInbox
    WHERE WeightOut > 0 AND (DateOut IS NULL OR LTRIM(RTRIM(DateOut)) IN (N'', N'0')));

UPDATE t
SET t.DateOut   = k.DateOut,
    t.UpdatedAt = GETUTCDATE()
FROM wf.WeighInbox t
JOIN #Known k ON k.Sequence = t.Sequence
WHERE t.WeightOut > 0
  AND (t.DateOut IS NULL OR LTRIM(RTRIM(t.DateOut)) IN (N'', N'0'));

DECLARE @fixed INT = @@ROWCOUNT;

DECLARE @after INT = (
    SELECT COUNT(*) FROM wf.WeighInbox
    WHERE WeightOut > 0 AND (DateOut IS NULL OR LTRIM(RTRIM(DateOut)) IN (N'', N'0')));

PRINT N'ใบที่ชั่งออกแล้วแต่ไม่มีวันที่: ก่อน ' + CAST(@before AS NVARCHAR(10))
    + N' · ซ่อม ' + CAST(@fixed AS NVARCHAR(10))
    + N' · เหลือ ' + CAST(@after AS NVARCHAR(10));
GO

DROP TABLE #Known;
GO
