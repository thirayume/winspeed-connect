-- =============================================================
-- 070_pricebook_line_status_and_special_price.sql
--
-- ตารางราคาขายประจำเดือนบนกระดาษมีข้อมูลสามอย่างที่ระบบยังเก็บไม่ได้
--
--   1. เครื่องหมาย ***  ท้ายสูตร — "สูตรที่กำลังจะยกเลิกการขาย ไม่ต่อทะเบียน"
--      ยังขายได้ในเดือนนี้ แต่ฝ่ายขายต้องรู้ว่าอย่ารับออร์เดอร์ยาว
--   2. คำว่า "งดขาย" แทนตัวเลขราคา (เช่น 18-46-0, 16-20-0 COM)
--      ไม่ใช่ราคาศูนย์ — เป็นการห้ามขาย ถ้าเก็บเป็น 0 จะกลายเป็นแจกฟรี
--   3. ตารางท้ายฟอร์ม "ร้านค้าที่ได้ทำเรื่องขอราคาเป็นกรณีพิเศษสำหรับเดือน"
--      ราคาเฉพาะรายลูกค้าที่อนุมัติแยกจากราคากลาง
--
-- ช่องลงนามสองตำแหน่ง (ฝ่ายขาย / ผู้อนุมัติ) ใช้ ApprovedBy กับ ActivatedBy
-- ที่มีอยู่แล้วใน wf.PriceBook ไม่ต้องเพิ่มคอลัมน์
--
-- Safe to re-run (idempotent)
-- =============================================================

-- "งดขาย" ต้องเก็บได้โดยไม่มีราคา — เดิม Price ห้ามว่าง จึงบังคับให้ต้องใส่ตัวเลข
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('wf.PriceBookLine')
           AND name = 'Price' AND is_nullable = 0)
  ALTER TABLE wf.PriceBookLine ALTER COLUMN Price DECIMAL(18,2) NULL;
GO

IF COL_LENGTH('wf.PriceBookLine', 'LineStatus') IS NULL
  ALTER TABLE wf.PriceBookLine ADD LineStatus NVARCHAR(20) NOT NULL
    CONSTRAINT df_PBL_LineStatus DEFAULT 'ACTIVE';
GO

IF COL_LENGTH('wf.PriceBookLine', 'Note') IS NULL
  ALTER TABLE wf.PriceBookLine ADD Note NVARCHAR(200) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chk_PBL_LineStatus')
  ALTER TABLE wf.PriceBookLine WITH CHECK ADD CONSTRAINT chk_PBL_LineStatus CHECK (LineStatus IN (
    'ACTIVE',          -- ขายได้ตามปกติ
    'DISCONTINUING',   -- *** กำลังจะยกเลิกการขาย ไม่ต่อทะเบียน — ยังขายได้เดือนนี้
    'SUSPENDED'        -- งดขาย
  ));
GO

-- ราคาต้องมีเมื่อขายได้ และต้องไม่มีเมื่องดขาย มิฉะนั้น "งดขาย" จะถูกอ่านเป็นราคา 0
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chk_PBL_PriceVsStatus')
  ALTER TABLE wf.PriceBookLine WITH CHECK ADD CONSTRAINT chk_PBL_PriceVsStatus CHECK (
    (LineStatus = 'SUSPENDED' AND Price IS NULL) OR
    (LineStatus <> 'SUSPENDED' AND Price IS NOT NULL)
  );
GO

-- ราคาพิเศษรายร้านค้าที่อนุมัติเฉพาะเดือนนั้น
IF OBJECT_ID('wf.PriceBookSpecialPrice', 'U') IS NULL
BEGIN
  CREATE TABLE wf.PriceBookSpecialPrice (
    Id            INT IDENTITY(1,1) PRIMARY KEY,
    PriceBookId   INT           NOT NULL,
    CustId        NVARCHAR(20)  NOT NULL,
    CustName      NVARCHAR(200) NULL,
    GoodId        NVARCHAR(20)  NULL,
    GoodName      NVARCHAR(200) NULL,
    RequestedPrice DECIMAL(18,2) NULL,   -- "ราคาที่ขอไว้" ตามที่ร้านค้ายื่นมา
    ApprovedPrice  DECIMAL(18,2) NULL,   -- ราคาที่อนุมัติจริง ว่างไว้ได้ระหว่างรอตัดสิน
    Note          NVARCHAR(300) NULL,
    RequestedBy   INT           NULL,
    ApprovedBy    INT           NULL,
    ApprovedAt    DATETIME2     NULL,
    CreatedAt     DATETIME2     NOT NULL CONSTRAINT df_PBSP_CreatedAt DEFAULT GETUTCDATE(),
    CONSTRAINT fk_PBSP_Book FOREIGN KEY (PriceBookId) REFERENCES wf.PriceBook (Id),
    CONSTRAINT fk_PBSP_ReqBy FOREIGN KEY (RequestedBy) REFERENCES wf.AppUser (Id),
    CONSTRAINT fk_PBSP_AppBy FOREIGN KEY (ApprovedBy) REFERENCES wf.AppUser (Id)
  );
  CREATE INDEX ix_PBSP_Book ON wf.PriceBookSpecialPrice (PriceBookId, CustId);
END
GO

-- ราคาที่ใช้จริงของลูกค้ารายหนึ่ง = ราคาพิเศษถ้ามีและอนุมัติแล้ว มิฉะนั้นใช้ราคากลาง
-- รวมไว้ที่เดียวเพื่อไม่ให้แต่ละที่ในโค้ดตีความกติกานี้ต่างกัน
IF OBJECT_ID('wf.v_PriceBookEffective', 'V') IS NOT NULL DROP VIEW wf.v_PriceBookEffective;
GO
CREATE VIEW wf.v_PriceBookEffective AS
SELECT b.Id            AS PriceBookId,
       b.EffectiveMonth,
       b.Status        AS BookStatus,
       l.GoodId,
       l.GoodName,
       l.Unit,
       l.LineStatus,
       l.Price         AS StandardPrice,
       sp.CustId,
       sp.ApprovedPrice AS SpecialPrice,
       COALESCE(sp.ApprovedPrice, l.Price) AS EffectivePrice,
       CASE WHEN l.LineStatus = 'SUSPENDED' THEN 0 ELSE 1 END AS Sellable
FROM wf.PriceBook b
JOIN wf.PriceBookLine l ON l.PriceBookId = b.Id
LEFT JOIN wf.PriceBookSpecialPrice sp
       ON sp.PriceBookId = b.Id AND sp.GoodId = l.GoodId AND sp.ApprovedPrice IS NOT NULL;
GO
