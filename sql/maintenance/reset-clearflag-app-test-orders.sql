-- =============================================================
-- reset-clearflag-app-test-orders.sql
--   คืนค่า clearflag ของใบสั่งขายที่ "แอปเราตั้งเอง" กลับเป็น 'N'
--
-- แทนที่ไฟล์ fix_winspeed_visibility.sql ที่ไม่ปลอดภัย — ฉบับนั้นสั่ง
--   UPDATE dbo.SOHD SET clearflag='N' WHERE DocuType=103 AND clearflag='Y'
-- ซึ่งไม่ได้จำกัดว่าเป็นใบของใคร ถ้ารันบน production ที่ WINSpeed เองตั้งธงนี้ไว้
-- ตามกระบวนการจริง จะล้างของเขาไปด้วยโดยไม่มีทางรู้ว่าล้างอะไรไปบ้าง
--
-- ── ที่มาของปัญหา ────────────────────────────────────────────────
--   PATCH /api/so/:id/ship เคยสั่ง clearflag='Y' เพื่อให้ kanban เห็นเป็น SHIPPED
--   ผลข้างเคียงคือ WINSpeed ถือว่าใบถูกปิดแล้ว จึงซ่อนจากหน้าออกบิล
--   โค้ดส่วนนั้นถูกลบออกแล้ว (backend/routes/so.js) เหลือแต่ข้อมูลที่ค้างอยู่
--
-- ── สำรวจก่อนเขียนสคริปต์นี้ (ฐาน DEV เมื่อ 6 ส.ค. 2569) ──────────────
--   ใบที่ clearflag='Y' มี 24 ใบ · **ทั้งหมดเป็นข้อมูลทดสอบ**
--   ทะเบียนขึ้นต้น UAT- หรือลูกค้าชื่อ "ทดสอบ" ทั้งหมด ไม่มีใบของงานจริงแม้ใบเดียว
--   ทุกใบลงวันที่ 27 ก.ค. – 6 ส.ค. 2569 ซึ่งเป็นช่วงที่แอปตั้งธงนี้พอดี
--
-- ── สิ่งที่ต้องรู้ก่อนรัน ──────────────────────────────────────────────
--   ใบเหล่านี้ไม่มี WeighOutWeight ใน wf.SalesOrderExt เลย (ถูกล้างไปตอนล้างข้อมูลทดสอบ)
--   เมื่อคืน clearflag เป็น 'N' ใบจะหลุดจากสถานะ SHIPPED บน kanban ทันที
--   ซึ่ง **ถูกต้องแล้ว** เพราะไม่มีหลักฐานน้ำหนักรองรับ — ใบที่แสดงว่าส่งของแล้ว
--   โดยไม่มีน้ำหนักคือสิ่งที่ v1.6.0 ตั้งใจกำจัด
--
--   ถ้าพบใบของงานจริงในผลขั้นที่ 1 **ห้ามรันขั้นที่ 2** ให้แจ้งผู้ดูแลก่อน
--   เพราะใบงานจริงต้องเติม WeighOutWeight ให้ก่อน ไม่งั้นสถานะจะหายไปจริง ๆ
--
-- ⚠ เขียนลง dbo.SOHD ซึ่งเป็นข้อมูลหลักของ WINSpeed
-- =============================================================

SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- ── ขั้นที่ 1 · ดูก่อนว่ามีใบอะไรบ้าง และมีใบงานจริงปนหรือไม่ (อ่านอย่างเดียว) ──

SELECT h.DocuNo            AS [เลขที่ใบสั่งขาย],
       h.DocuDate          AS [วันที่],
       h.CustName          AS [ลูกค้า],
       h.NetAmnt           AS [ยอดเงิน],
       h.DocuStatus        AS [สถานะเอกสาร],
       h.TransRegistration AS [ทะเบียนรถ],
       ext.WeighOutWeight  AS [น้ำหนักชั่งออกในแอป],
       CASE
         WHEN h.TransRegistration LIKE 'UAT-%'
           OR h.TransRegistration LIKE 'CMP-%'
           OR h.CustName LIKE N'%ทดสอบ%'
           OR h.Remark   LIKE N'%ทดสอบ%'
         THEN N'ข้อมูลทดสอบ'
         ELSE N'*** งานจริง - อย่ารันขั้นที่ 2 จนกว่าจะตรวจ ***'
       END                 AS [ประเภท]
FROM dbo.SOHD h
LEFT JOIN wf.SalesOrderExt ext ON ext.SOID = h.SOID
WHERE h.DocuType = 103 AND h.clearflag = 'Y'
ORDER BY [ประเภท] DESC, h.DocuDate DESC;

SELECT COUNT(*) AS [รวมทั้งหมด],
       SUM(CASE WHEN h.TransRegistration LIKE 'UAT-%' OR h.TransRegistration LIKE 'CMP-%'
                  OR h.CustName LIKE N'%ทดสอบ%' OR h.Remark LIKE N'%ทดสอบ%'
                THEN 1 ELSE 0 END) AS [ข้อมูลทดสอบ],
       SUM(CASE WHEN h.TransRegistration LIKE 'UAT-%' OR h.TransRegistration LIKE 'CMP-%'
                  OR h.CustName LIKE N'%ทดสอบ%' OR h.Remark LIKE N'%ทดสอบ%'
                THEN 0 ELSE 1 END) AS [งานจริง_ต้องตรวจก่อน]
FROM dbo.SOHD h WHERE h.DocuType = 103 AND h.clearflag = 'Y';
GO

-- ── ขั้นที่ 2 · คืนค่าเฉพาะใบที่เป็นข้อมูลทดสอบ ────────────────────────
--
-- เงื่อนไขแคบไว้สามชั้น: ต้องเป็นใบสั่งขาย · ต้องมีธงตั้งอยู่จริง · ต้องระบุได้ว่าเป็นใบทดสอบ
-- ไม่แตะใบงานจริงไม่ว่ากรณีใด แม้จะมี clearflag='Y' ก็ตาม

BEGIN TRANSACTION;

UPDATE h
SET h.clearflag = 'N',
    h.ClearDate = NULL
FROM dbo.SOHD h
WHERE h.DocuType = 103
  AND h.clearflag = 'Y'
  AND ( h.TransRegistration LIKE 'UAT-%'
     OR h.TransRegistration LIKE 'CMP-%'
     OR h.CustName LIKE N'%ทดสอบ%'
     OR h.Remark   LIKE N'%ทดสอบ%' );

PRINT N'คืนค่า clearflag ของใบทดสอบ ' + CAST(@@ROWCOUNT AS NVARCHAR(10)) + N' ใบ';

COMMIT TRANSACTION;
GO

-- ── ขั้นที่ 3 · ตรวจผล ────────────────────────────────────────────────

SELECT N'ใบที่ยังมี clearflag = Y' AS [ตรวจสอบ], COUNT(*) AS [จำนวน]
FROM dbo.SOHD WHERE DocuType = 103 AND clearflag = 'Y';
-- ควรเหลือ 0 ถ้าไม่มีใบงานจริงปนอยู่ · ถ้าเหลือ ให้ดูรายชื่อจากขั้นที่ 1

SELECT N'ใบที่แอปเห็นเป็น SHIPPED จากน้ำหนักจริง' AS [ตรวจสอบ], COUNT(*) AS [จำนวน]
FROM dbo.SOHD h JOIN wf.SalesOrderExt ext ON ext.SOID = h.SOID
WHERE h.DocuType = 103 AND ext.WeighOutWeight IS NOT NULL;
GO
