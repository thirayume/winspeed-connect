-- =============================================================
-- 104_carry_trip_through_confirm.sql
--
-- ทำให้ใบสั่งขายยังอยู่ในเที่ยวรถหลังกดยืนยัน
--
-- ปัญหาที่แก้
--   `wf.SalesTrip` ผูกสมาชิกผ่าน `wf.SalesOrder.TripId`
--   แต่ `sp_ConfirmSalesOrder` จบด้วย `DELETE FROM wf.SalesOrder WHERE Id = @SoId`
--   พอยืนยันแล้วแถวร่างหายไป **`TripId` จึงหายไปด้วย**
--   ผลคือเที่ยวรถที่ยืนยันครบทุกใบแล้วจะกลายเป็นเที่ยวว่าง ไม่มีสมาชิกเหลือเลย
--
--   ยังไม่เคยมีใครเจอ เพราะ `wf.SalesTrip` มี 0 แถวในทุกฐาน — ฟีเจอร์ยังไม่ถูกใช้จริง
--   แต่ Sale Trip Board ทั้งหน้าตั้งอยู่บนความสัมพันธ์นี้ ถ้าไม่แก้ก่อนก็สร้างหน้าจอไปเปล่า ๆ
--
-- วิธีแก้
--   1. เพิ่ม `TripId` ให้ `wf.SalesOrderExt` ซึ่งเป็นแถวที่อยู่ต่อหลังยืนยัน
--   2. แก้ `sp_ConfirmSalesOrder` ให้ยก `TripId` จากร่างมาใส่ก่อนลบร่างทิ้ง
--
-- ⚠ ไม่แตะ dbo แม้แต่คำสั่งเดียว
-- =============================================================

-- ── 1. คอลัมน์ที่หายไป ────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[wf].[SalesOrderExt]') AND name='TripId')
    ALTER TABLE wf.SalesOrderExt ADD TripId INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name='FK_SalesOrderExt_Trip')
    ALTER TABLE wf.SalesOrderExt
      ADD CONSTRAINT FK_SalesOrderExt_Trip FOREIGN KEY (TripId) REFERENCES wf.SalesTrip (TripId);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_SalesOrderExt_Trip' AND object_id=OBJECT_ID(N'[wf].[SalesOrderExt]'))
    CREATE INDEX IX_SalesOrderExt_Trip ON wf.SalesOrderExt (TripId) WHERE TripId IS NOT NULL;
GO

-- ── 2. ให้ยกค่าข้ามการยืนยัน ─────────────────────────────────
--
-- แก้ด้วย sp_executesql เพื่อ **ไม่ต้องเขียนตัว procedure ใหม่ทั้งก้อน**
-- ตัวจริงยาวหลายร้อยบรรทัดและมีตรรกะที่พิสูจน์มาแล้ว การคัดลอกมาวางใหม่
-- เสี่ยงกว่าการแทรกคอลัมน์เดียวเข้าไปในคำสั่ง INSERT ที่มีอยู่
DECLARE @src NVARCHAR(MAX) = OBJECT_DEFINITION(OBJECT_ID('wf.sp_ConfirmSalesOrder'));

IF @src IS NULL
    THROW 51041, 'ไม่พบ wf.sp_ConfirmSalesOrder — migration 104 ต้องรันหลัง procedure นี้ถูกสร้างแล้ว', 1;

IF CHARINDEX('TripId', @src) > 0
BEGIN
    PRINT 'sp_ConfirmSalesOrder ยก TripId อยู่แล้ว — ข้าม';
END
ELSE
BEGIN
    DECLARE @needleCols NVARCHAR(200) = N'CreditDays, TruckRemark, BillRemark, EnteredByUserId';
    DECLARE @needleVals NVARCHAR(200) = N'@CreditDays, @TruckRemark, @BillRemark, @EnteredByUserId';

    IF CHARINDEX(@needleCols, @src) = 0 OR CHARINDEX(@needleVals, @src) = 0
        THROW 51042, 'รูปแบบ INSERT ใน sp_ConfirmSalesOrder ไม่ตรงกับที่คาด — หยุดไว้ก่อน ห้ามเดา', 1;

    SET @src = REPLACE(@src, @needleCols, @needleCols + N', TripId');
    SET @src = REPLACE(@src, @needleVals, @needleVals + N',
            (SELECT TripId FROM wf.SalesOrder WHERE Id = @SoId)');

    -- เปลี่ยนหัวเป็น ALTER
    --
    -- ห้ามใช้ REPLACE(@src, 'CREATE PROCEDURE', ...) เด็ดขาด
    -- SQL Server เก็บ `CREATE OR ALTER PROCEDURE` ไว้เป็น `CREATE   PROCEDURE`
    -- (แทน OR ALTER ด้วยช่องว่าง) ตัวจริงจึงมีสามช่องว่าง REPLACE แบบตายตัวจะไม่เจอ
    -- แล้วเงียบ ๆ ไปยิง CREATE ซ้ำจนได้ error 'already an object named'
    DECLARE @pi INT = CHARINDEX(N'PROCEDURE wf.sp_ConfirmSalesOrder', @src);
    IF @pi = 0
        SET @pi = CHARINDEX(N'PROCEDURE [wf].[sp_ConfirmSalesOrder]', @src);
    IF @pi = 0
        THROW 51043, 'หาหัว PROCEDURE ไม่เจอ — หยุดไว้ก่อน', 1;

    -- ถอยข้ามช่องว่างทุกชนิดกลับไปหาคำว่า CREATE
    DECLARE @hs INT = @pi;
    WHILE @hs > 1 AND SUBSTRING(@src, @hs - 1, 1) IN (N' ', NCHAR(9), NCHAR(13), NCHAR(10))
        SET @hs -= 1;

    IF @hs <= 6 OR UPPER(SUBSTRING(@src, @hs - 6, 6)) <> N'CREATE'
        THROW 51044, 'คำที่นำหน้า PROCEDURE ไม่ใช่ CREATE — หยุดไว้ก่อน', 1;

    SET @src = STUFF(@src, @hs - 6, (@pi + 9) - (@hs - 6), N'ALTER PROCEDURE');

    EXEC sp_executesql @src;
    PRINT 'sp_ConfirmSalesOrder ยก TripId ข้ามการยืนยันแล้ว';
END
GO

-- ── 3. มุมมองสมาชิกของเที่ยว — ร่างและที่ยืนยันแล้วรวมกัน ──────
--
-- ก่อนยืนยันสมาชิกอยู่ที่ wf.SalesOrder · หลังยืนยันย้ายไป wf.SalesOrderExt
-- หน้าจอต้องเห็นทั้งสองแบบพร้อมกันในเที่ยวเดียว จึง union ให้ตรงนี้ที่เดียว
-- ไม่ต้องให้ทุกหน้าจอไปเขียน union เองแล้วเพี้ยนกันคนละแบบ
CREATE OR ALTER VIEW wf.v_TripMember
AS
SELECT
    o.TripId,
    'DRAFT'                      AS MemberKind,
    CAST(o.Id AS VARCHAR(50))    AS MemberId,
    o.WfRef                      AS DocuNo,
    o.SoPrefix,
    o.CustId,
    o.CustName,
    o.Status,
    o.DeliveryDate,
    o.SalesUserId,
    CAST(NULL AS INT)            AS SOID
FROM   wf.SalesOrder o
WHERE  o.TripId IS NOT NULL
UNION ALL
SELECT
    e.TripId,
    'CONFIRMED'                  AS MemberKind,
    e.SOID                       AS MemberId,
    RTRIM(s.DocuNo)              AS DocuNo,
    e.SoPrefix,
    CAST(s.CustID AS VARCHAR(50)) AS CustId,
    RTRIM(c.CustName)            AS CustName,
    -- สถานะที่แท้จริงหลังยืนยันอยู่ฝั่ง WINSpeed ไม่ใช่ในคอลัมน์ของเรา
    CASE WHEN s.AppvFlag = 'W' AND s.AppvDocuNo IS NULL THEN 'PENDING_APPROVAL'
         ELSE 'CONFIRMED' END    AS Status,
    e.DeliveryDate,
    e.SalesUserId,
    TRY_CAST(e.SOID AS INT)      AS SOID
FROM   wf.SalesOrderExt e
LEFT   JOIN dbo.SOHD   s ON s.SOID = TRY_CAST(e.SOID AS INT) AND s.DocuType = 103
LEFT   JOIN dbo.EMCust c ON c.CustID = s.CustID
WHERE  e.TripId IS NOT NULL;
GO
