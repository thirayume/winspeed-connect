-- =============================================================
-- 105_truck_hold_winspeed.sql
--
-- Hold รถที่มีผลถึงฝั่ง WINSpeed จริง — โครงสร้างรองรับ
--
-- ที่มา
--   เฟส 5 ทำ Hold ได้แค่ธงฝั่งแอป คนคุมลานเห็นแต่ระบบไม่ได้หยุดอะไร
--   ผลสำรวจว่ามีจุดควบคุมอะไรบ้าง
--     - dbo.WGHD/WGDT/WGDTReport  ห้ามเขียน (ข้อกำหนดโครงการ) และเป็น
--       state machine ของ TruckScale เอง เขียนแทรกเสี่ยงทำงานชั่งจริงพัง
--     - TruckScale sourcecode/config  แก้ไม่ได้
--     - ไม่มี proc/view/trigger ฝั่ง DB ที่บอกได้ว่าเครื่องชั่งอ่านอะไร
--     - **dbo.SOHD.OnHold**  เป็นฟิลด์ของ WINSpeed เองสำหรับพักใบสั่งขาย
--       char(1) ปัจจุบันเป็น 'N' ทั้ง 125,180 แถวทุก DocuType — ไม่เคยถูกใช้
--
--   OnHold จึงเป็นคันโยกเดียวที่มี และเป็นของ WINSpeed เอง ไม่ใช่ของตารางชั่ง
--
-- ⚠ สิ่งที่ยังพิสูจน์ไม่ได้
--   ไม่มีข้อมูลใดในฐานบอกได้ว่า TruckScale อ่าน OnHold หรือไม่
--   (ไม่มีแถวไหนเคยเป็น 'Y' เลย จึงไม่มีพฤติกรรมให้สังเกต)
--   **ต้องทดสอบกับรถจริงหนึ่งคันก่อน จึงจะสรุปได้ว่า Hold มีผลจริง**
--   จนกว่าจะพิสูจน์ หน้าจอต้องไม่บอกผู้ใช้ว่ารถถูกหยุดแล้ว
--
-- ⚠ ค่าเริ่มต้นปิดไว้ (TRUCK_HOLD_WRITE_WINSPEED = false)
--   ต้องเปิดโดยตั้งใจเท่านั้น เพราะการตั้ง OnHold='Y' อาจไปหยุดการส่งของจริง
--
-- ⚠ migration นี้ไม่แตะ schema dbo และไม่แตะตารางชั่งทั้งสามตัว
-- =============================================================

-- ── 1. สมุดบันทึกการแตะ dbo.SOHD ─────────────────────────────
--
-- เราเขียนลงฐานของ WINSpeed ทุกครั้งต้องย้อนกลับได้และตรวจสอบได้
-- จึงเก็บค่าเดิมไว้ก่อนเขียนเสมอ การปลดล็อกคืนค่าจากบันทึกนี้
-- ไม่ใช่เดาว่าเดิมเป็น 'N'
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE object_id = OBJECT_ID(N'[wf].[TruckHoldLog]'))
BEGIN
    CREATE TABLE wf.TruckHoldLog (
        Id              INT IDENTITY(1,1) PRIMARY KEY,
        SOID            VARCHAR(50)   NOT NULL,
        EditRequestId   INT           NULL,
        Action          VARCHAR(20)   NOT NULL,   -- HOLD | RELEASE
        PrevOnHold      CHAR(1)       NULL,       -- ค่าก่อนเขียน
        NewOnHold       CHAR(1)       NULL,
        PrevRemark      VARCHAR(255)  NULL,
        NewRemark       VARCHAR(255)  NULL,
        Applied         BIT           NOT NULL,   -- 0 = ตั้งค่าปิดอยู่ บันทึกเจตนาไว้เฉย ๆ
        SkipReason      NVARCHAR(200) NULL,
        ActedBy         INT           NOT NULL,
        ActedAt         DATETIME2     NOT NULL CONSTRAINT DF_TruckHoldLog_At DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT CK_TruckHoldLog_Action CHECK (Action IN ('HOLD','RELEASE'))
    );
    CREATE INDEX IX_TruckHoldLog_SOID ON wf.TruckHoldLog (SOID, Id DESC);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_TruckHoldLog_EditRequest')
   AND EXISTS (SELECT 1 FROM sys.tables WHERE object_id = OBJECT_ID(N'[wf].[EditRequest]'))
    ALTER TABLE wf.TruckHoldLog
      ADD CONSTRAINT FK_TruckHoldLog_EditRequest
          FOREIGN KEY (EditRequestId) REFERENCES wf.EditRequest (Id);
GO

-- ── 2. สวิตช์ควบคุม ───────────────────────────────────────────
MERGE wf.SystemSetting AS t
USING (VALUES
    ('TRUCK_HOLD_WRITE_WINSPEED', 'false',
     N'true = ตั้ง dbo.SOHD.OnHold=Y เมื่อ Hold รถ (มีผลถึง WINSpeed) · false = ธงฝั่งแอปอย่างเดียว (ค่าเริ่มต้น)'),
    ('TRUCK_HOLD_REMARK_PREFIX', 'WF-HOLD',
     N'คำนำหน้าที่เขียนลง dbo.SOHD.StatusRemark เพื่อให้รู้ว่าใครเป็นคนสั่งพัก'),
    ('TRUCK_HOLD_VERIFIED', 'false',
     N'true = ทดสอบกับรถจริงแล้วยืนยันว่า TruckScale หยุดตาม OnHold · false = ยังไม่พิสูจน์ ห้ามหน้าจอบอกว่ารถถูกหยุดแล้ว')
) AS s (SettingKey, SettingValue, Description)
ON t.SettingKey = s.SettingKey
WHEN NOT MATCHED THEN
    INSERT (SettingKey, SettingValue, Description) VALUES (s.SettingKey, s.SettingValue, s.Description);
GO

-- ── 3. มุมมองสถานะ Hold ที่เป็นจริงตอนนี้ ─────────────────────
--
-- รวมสองชั้นเข้าด้วยกัน — ธงฝั่งแอป (คำขอที่ยัง PENDING) กับค่าจริงใน WINSpeed
-- ถ้าสองค่าไม่ตรงกัน แปลว่ามีบางอย่างผิด เช่น เปิดสวิตช์ตอนมีคำขอค้างอยู่แล้ว
-- หรือมีคนไปแก้ OnHold ใน WINSpeed เอง หน้าจอต้องเห็นความไม่ตรงนี้ได้
CREATE OR ALTER VIEW wf.v_TruckHoldState
AS
SELECT
    CAST(s.SOID AS VARCHAR(50))            AS SOID,
    RTRIM(s.DocuNo)                        AS DocuNo,
    e.TripId,
    s.OnHold                               AS WinspeedOnHold,
    CAST(s.StatusRemark AS VARCHAR(255))   AS WinspeedRemark,
    CASE WHEN EXISTS (
        SELECT 1 FROM wf.EditRequest q
        WHERE q.SOID = CAST(s.SOID AS VARCHAR(50))
          AND q.Status = 'PENDING' AND q.HoldTruck = 1
    ) THEN 1 ELSE 0 END                    AS AppHoldActive,
    CASE WHEN s.OnHold = 'Y' THEN 1 ELSE 0 END AS WinspeedHoldActive
FROM   dbo.SOHD s
JOIN   wf.SalesOrderExt e ON TRY_CAST(e.SOID AS INT) = s.SOID
WHERE  s.DocuType = 103;
GO
