-- =============================================================
-- 103_sale_trip_v2.sql
--
-- โครงข้อมูลสำหรับ Sale Trip รอบ 2 ตามที่เจ้าของระบบกำหนด 03/09/2569
-- แบบเต็มอยู่ที่ docs/enterprise/03-SOLUTION-ARCHITECTURE/REDESIGN-SALE-TRIP-V2.md
--
-- ⚠ กติกาที่บังคับรูปร่างของ migration นี้
--   เจ้าของสั่งไว้ว่า "หากมีส่วนใดต้องเพิ่มใหม่ ใช้ dbo ของ winspeed ไม่ได้
--   หรือตอบได้ไม่ครบ ให้ reference ใน table ใหม่ที่สร้างภายใต้ wf schema เสมอ"
--   จึงไม่มีคำสั่งใดในไฟล์นี้แตะ dbo แม้แต่คำสั่งเดียว
--
-- สิ่งที่ **ไม่** ทำ เพราะตรวจแล้วว่ามีอยู่แล้ว
--   • ยอดตั๋วคงเหลือ  → dbo.WFCoupon.RemaQty มีอยู่แล้ว (C6902239 ออก 500 เหลือ 487.9)
--   • วันหมดอายุตั๋ว → คำนวณ dbo.SOHD.DocuDate + ValidDays (ExpireDate เป็น NULL ทุกใบ)
--   • แม่/ลูก รายรายการ → wf.SalesOrderLine.MasterQty / ChildQty มีอยู่แล้ว
--   • สัดส่วนรีเบท → wf.RebateClaim.CustomerRatio / CompanyRatio / IsSelfClaim มีอยู่แล้ว
-- =============================================================

-- ── 1. เที่ยวรถ — เพิ่มสิ่งที่ผังงานต้องใช้ ────────────────────
-- TruckCapacityTon มีอยู่แล้ว · ที่ขาดคือเผื่อพิกัด กำหนดเข้ารับ และ Pre-Sling
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[wf].[SalesTrip]') AND name='TolerancePct')
    ALTER TABLE wf.SalesTrip ADD TolerancePct DECIMAL(5,2) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[wf].[SalesTrip]') AND name='PickupDueDate')
    ALTER TABLE wf.SalesTrip ADD PickupDueDate DATE NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[wf].[SalesTrip]') AND name='PreSlingRequired')
    ALTER TABLE wf.SalesTrip ADD PreSlingRequired BIT NOT NULL CONSTRAINT DF_SalesTrip_PreSling DEFAULT (0);
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[wf].[SalesTrip]') AND name='TripRemark')
    ALTER TABLE wf.SalesTrip ADD TripRemark NVARCHAR(500) NULL;
GO

-- ── 2. กำหนดเข้ารับสินค้า นับจากวันยืนยัน ─────────────────────
-- ค่าเริ่มต้น 7 วัน · เลือกได้ 7/15/30/45 หรือกรอกเอง
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[wf].[SalesOrder]') AND name='PickupDueDays')
    ALTER TABLE wf.SalesOrder ADD PickupDueDays SMALLINT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[wf].[SalesOrder]') AND name='PickupDueDate')
    ALTER TABLE wf.SalesOrder ADD PickupDueDate DATE NULL;
GO

-- ── 3. เหตุผลการขอแก้หลังยืนยัน — ตารางแม่ ────────────────────
-- เจ้าของกำหนดว่าเหตุผลต้องจัดการได้จาก Master Settings ไม่ใช่ hardcode
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id=OBJECT_ID(N'[wf].[EditReason]') AND type=N'U')
BEGIN
    CREATE TABLE wf.EditReason (
        ReasonCode   VARCHAR(30)   NOT NULL,
        ReasonText   NVARCHAR(200) NOT NULL,
        -- ขอแก้ตอนไหนได้บ้าง: CONFIRMED / REGISTERED / LOADING (คั่นด้วยจุลภาค)
        AppliesTo    VARCHAR(100)  NOT NULL CONSTRAINT DF_EditReason_AppliesTo DEFAULT 'CONFIRMED',
        -- ต้อง Hold รถไว้ก่อนไหม (ใช้กับตอนรถมาถึงแล้ว)
        RequiresHold BIT           NOT NULL CONSTRAINT DF_EditReason_Hold DEFAULT (0),
        SortOrder    SMALLINT      NOT NULL CONSTRAINT DF_EditReason_Sort DEFAULT (100),
        IsActive     BIT           NOT NULL CONSTRAINT DF_EditReason_Active DEFAULT (1),
        CreatedAt    DATETIME2     NOT NULL CONSTRAINT DF_EditReason_Created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_EditReason PRIMARY KEY CLUSTERED (ReasonCode)
    );
END
GO

MERGE wf.EditReason AS t
USING (VALUES
  ('QTY_CHANGE',    N'ลูกค้าขอเปลี่ยนจำนวน',            'CONFIRMED,REGISTERED',          0, 10),
  ('ITEM_CHANGE',   N'ลูกค้าขอเปลี่ยนสูตรสินค้า',        'CONFIRMED,REGISTERED',          0, 20),
  ('PRICE_CHANGE',  N'ปรับราคา',                        'CONFIRMED',                     0, 30),
  ('TRUCK_CHANGE',  N'เปลี่ยนรถ / เปลี่ยนทะเบียน',       'CONFIRMED,REGISTERED',          0, 40),
  ('SPLIT_CHANGE',  N'ปรับสัดส่วนขึ้นแม่/ลูก',           'CONFIRMED,REGISTERED,LOADING',  1, 50),
  ('SEQ_CHANGE',    N'ปรับลำดับการขึ้นของ',              'REGISTERED,LOADING',            1, 60),
  ('GIVEAWAY_CHANGE',N'ปรับรายการของแถม',               'CONFIRMED,REGISTERED',          0, 70),
  ('TICKET_DRAW',   N'แก้การเบิกใช้ตั๋วคุม',             'CONFIRMED,REGISTERED',          0, 80),
  ('STOCK_SHORT',   N'สินค้าไม่พอ ต้องปรับรายการ',        'REGISTERED,LOADING',            1, 90),
  ('DATA_ERROR',    N'คีย์ข้อมูลผิด',                    'CONFIRMED,REGISTERED,LOADING',  1, 100),
  ('OTHER',         N'อื่น ๆ (ต้องระบุรายละเอียด)',      'CONFIRMED,REGISTERED,LOADING',  1, 999)
) AS s (ReasonCode, ReasonText, AppliesTo, RequiresHold, SortOrder)
   ON t.ReasonCode = s.ReasonCode
WHEN MATCHED THEN UPDATE SET
    t.ReasonText = s.ReasonText, t.AppliesTo = s.AppliesTo,
    t.RequiresHold = s.RequiresHold, t.SortOrder = s.SortOrder
WHEN NOT MATCHED BY TARGET THEN
    INSERT (ReasonCode, ReasonText, AppliesTo, RequiresHold, SortOrder)
    VALUES (s.ReasonCode, s.ReasonText, s.AppliesTo, s.RequiresHold, s.SortOrder);
GO

-- ── 4. คำขอแก้หลังยืนยัน ──────────────────────────────────────
-- ผูกกับ SOID ของ WINSpeed เป็น "ข้อความ" ไม่ทำ FK ข้าม schema
-- (FK ไป dbo จะล็อกตารางของ WINSpeed โดยไม่ตั้งใจ — ADR-001)
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id=OBJECT_ID(N'[wf].[EditRequest]') AND type=N'U')
BEGIN
    CREATE TABLE wf.EditRequest (
        Id            INT IDENTITY(1,1) NOT NULL,
        SOID          VARCHAR(50)   NULL,          -- ใบที่ยืนยันแล้ว (dbo.SOHD.SOID)
        DraftSoId     INT           NULL,          -- ใบที่ยังเป็นร่าง (wf.SalesOrder.Id)
        TripId        INT           NULL,
        StageAtRequest VARCHAR(20)  NOT NULL,      -- CONFIRMED / REGISTERED / LOADING
        ReasonCode    VARCHAR(30)   NOT NULL,
        ReasonDetail  NVARCHAR(500) NULL,
        HoldTruck     BIT           NOT NULL CONSTRAINT DF_EditRequest_Hold DEFAULT (0),
        Status        VARCHAR(20)   NOT NULL CONSTRAINT DF_EditRequest_Status DEFAULT 'PENDING',
        RequestedBy   INT           NOT NULL,
        RequestedAt   DATETIME2     NOT NULL CONSTRAINT DF_EditRequest_At DEFAULT SYSUTCDATETIME(),
        ReviewedBy    INT           NULL,
        ReviewedAt    DATETIME2     NULL,
        ReviewNote    NVARCHAR(500) NULL,
        CONSTRAINT PK_EditRequest PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_EditRequest_Reason   FOREIGN KEY (ReasonCode)  REFERENCES wf.EditReason (ReasonCode),
        CONSTRAINT FK_EditRequest_Reqester FOREIGN KEY (RequestedBy) REFERENCES wf.AppUser (Id),
        CONSTRAINT FK_EditRequest_Reviewer FOREIGN KEY (ReviewedBy)  REFERENCES wf.AppUser (Id),
        CONSTRAINT FK_EditRequest_Trip     FOREIGN KEY (TripId)      REFERENCES wf.SalesTrip (TripId),
        CONSTRAINT CK_EditRequest_Stage    CHECK (StageAtRequest IN ('CONFIRMED','REGISTERED','LOADING')),
        CONSTRAINT CK_EditRequest_Status   CHECK (Status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
        -- ต้องระบุใบใดใบหนึ่งเสมอ คำขอที่ไม่ผูกกับใบไหนเลยไม่มีความหมาย
        CONSTRAINT CK_EditRequest_Target   CHECK (SOID IS NOT NULL OR DraftSoId IS NOT NULL)
    );
    CREATE INDEX IX_EditRequest_Open ON wf.EditRequest (Status, RequestedAt) WHERE Status = 'PENDING';
    CREATE INDEX IX_EditRequest_SOID ON wf.EditRequest (SOID);
END
GO

-- ── 5. อ้างอิงการตัดตั๋ว — อยู่ใน wf ไม่เขียน dbo ──────────────
--
-- เจ้าของสั่งชัดว่าอะไรที่ต้องเพิ่มใหม่ให้อยู่ใน wf แล้ว reference ออกไป
-- แอปจึง **ไม่เขียน** dbo.WFRedemtionHD / WFRedemtionDT
-- ตารางนี้บันทึกว่าแอปตั้งใจตัดตั๋วใบไหน เท่าไร ตอนไหน
-- แล้วให้ WINSpeed เป็นผู้ลงจริง · กระทบยอดกันภายหลังได้ด้วย MatchedRedemtionID
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id=OBJECT_ID(N'[wf].[CouponRedemptionRef]') AND type=N'U')
BEGIN
    CREATE TABLE wf.CouponRedemptionRef (
        Id            INT IDENTITY(1,1) NOT NULL,
        SOID          VARCHAR(50)    NOT NULL,     -- ใบส่งขายที่ตัดตั๋วให้
        CouponNo      VARCHAR(25)    NOT NULL,     -- dbo.WFCoupon.CouponNo
        CouponID      INT            NULL,         -- dbo.WFCoupon.CouponID ถ้าทราบ
        QtyTon        DECIMAL(18,6)  NOT NULL,
        -- ยอดคงเหลือที่ "อ่านได้" ตอนบันทึก ใช้ตรวจย้อนหลังว่าตอนนั้นเห็นเท่าไร
        RemaQtyAtRef  DECIMAL(18,6)  NULL,
        TripId        INT            NULL,
        Status        VARCHAR(20)    NOT NULL CONSTRAINT DF_CouponRef_Status DEFAULT 'PENDING',
        -- เลขใบตัดตั๋วจริงฝั่ง WINSpeed เมื่อกระทบยอดเจอแล้ว
        MatchedRedemtionID INT       NULL,
        MatchedAt     DATETIME2      NULL,
        Note          NVARCHAR(300)  NULL,
        CreatedBy     INT            NOT NULL,
        CreatedAt     DATETIME2      NOT NULL CONSTRAINT DF_CouponRef_At DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_CouponRedemptionRef PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_CouponRef_User FOREIGN KEY (CreatedBy) REFERENCES wf.AppUser (Id),
        CONSTRAINT FK_CouponRef_Trip FOREIGN KEY (TripId)    REFERENCES wf.SalesTrip (TripId),
        CONSTRAINT CK_CouponRef_Status CHECK (Status IN ('PENDING','MATCHED','MISMATCHED','CANCELLED')),
        CONSTRAINT CK_CouponRef_Qty    CHECK (QtyTon > 0)
    );
    CREATE INDEX IX_CouponRef_SOID   ON wf.CouponRedemptionRef (SOID);
    CREATE INDEX IX_CouponRef_Coupon ON wf.CouponRedemptionRef (CouponNo);
    CREATE INDEX IX_CouponRef_Open   ON wf.CouponRedemptionRef (Status) WHERE Status = 'PENDING';
END
GO

-- ── 6. กันเตือนตั๋วใกล้หมดอายุซ้ำ ──────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id=OBJECT_ID(N'[wf].[ControlTicketAlert]') AND type=N'U')
BEGIN
    CREATE TABLE wf.ControlTicketAlert (
        CouponNo    VARCHAR(25)  NOT NULL,
        AlertKind   VARCHAR(20)  NOT NULL,   -- NEAR_EXPIRY / EXPIRED
        AlertedAt   DATETIME2    NOT NULL CONSTRAINT DF_CTAlert_At DEFAULT SYSUTCDATETIME(),
        DaysLeft    INT          NULL,
        CONSTRAINT PK_ControlTicketAlert PRIMARY KEY CLUSTERED (CouponNo, AlertKind),
        CONSTRAINT CK_CTAlert_Kind CHECK (AlertKind IN ('NEAR_EXPIRY','EXPIRED'))
    );
END
GO

-- ── 7. ค่าตั้งระบบที่หน้าจอใหม่ต้องใช้ ──────────────────────────
MERGE wf.SystemSetting AS t
USING (VALUES
  (N'TRIP_CAPACITY_TON',            N'50.0',  N'พิกัดบรรทุกมาตรฐานต่อคัน (ตัน) — นับรวมทั้งคัน แม่+ลูก'),
  (N'TRIP_CAPACITY_TOLERANCE_PCT',  N'5.0',   N'เผื่อพิกัดได้กี่เปอร์เซ็นต์ (50 ตัน +5% = 52.5)'),
  (N'PICKUP_DUE_DEFAULT_DAYS',      N'7',     N'กำหนดเข้ารับสินค้าเริ่มต้น นับจากวันยืนยัน'),
  (N'PICKUP_DUE_OPTIONS',           N'7,15,30,45', N'ตัวเลือกกำหนดเข้ารับที่ให้เลือกในหน้าจอ'),
  (N'CONTROL_TICKET_ALERT_DAYS',    N'7',     N'เตือนล่วงหน้ากี่วันก่อนตั๋วคุมหมดอายุ'),
  (N'CONTROL_TICKET_BLOCK_EXPIRED', N'false', N'true = ห้ามส่งของด้วยตั๋วที่หมดอายุ · false = เตือนอย่างเดียว (ค่าเริ่มต้นตามที่เจ้าของกำหนด)'),
  (N'REBATE_CUSTOMER_RATIO_PCT',    N'100',   N'สัดส่วนรีเบทที่ลูกค้าได้ — ปัจจุบัน 100/0 อนาคตปรับได้'),
  (N'REBATE_COMPANY_RATIO_PCT',     N'0',     N'สัดส่วนรีเบทที่บริษัทเก็บไว้ตั้งงบส่งเสริมการขาย')
) AS s (SettingKey, SettingValue, Description)
   ON t.SettingKey = s.SettingKey
WHEN NOT MATCHED BY TARGET THEN
    INSERT (SettingKey, SettingValue, Description, UpdatedAt)
    VALUES (s.SettingKey, s.SettingValue, s.Description, SYSUTCDATETIME());
GO

-- ── 8. มุมมองตั๋วคุมที่ยังเปิดอยู่ ─────────────────────────────
--
-- ⚠ ตัวชี้ขาดคือ RemaQty > 0 ไม่ใช่ TransRegistration = 'ตั๋วคุม'
--   ตรวจ 03/09/2569: ตั๋วที่ยังมียอดเหลือ 10 ใบ มีเพียง 2 ใบที่ติดป้ายนั้น
--   อีก 8 ใบช่องนั้นเป็นทะเบียนรถ — ป้ายข้อความจึงใช้กรองไม่ได้
--
-- ⚠ ExpireDate ใน dbo.SOHD เป็น NULL ทุกใบ จึงคำนวณจาก DocuDate + ValidDays
--   ValidDays = 0 แปลว่าไม่กำหนดวันหมดอายุ
CREATE OR ALTER VIEW wf.v_OpenControlTicket
AS
SELECT
    c.CouponNo,
    c.CouponID,
    c.SONo                                   AS BookingNo,
    RTRIM(c.GoodName)                        AS GoodName,
    c.GoodQty                                AS IssuedTon,
    c.RemaQty                                AS RemainingTon,
    c.GoodQty - c.RemaQty                    AS DrawnTon,
    s.SOID                                   AS BookingSOID,
    CAST(s.DocuDate AS DATE)                 AS BookingDate,
    s.ValidDays,
    CASE WHEN ISNULL(s.ValidDays, 0) = 0 THEN NULL
         ELSE CAST(DATEADD(day, s.ValidDays, s.DocuDate) AS DATE) END AS ExpiryDate,
    CASE WHEN ISNULL(s.ValidDays, 0) = 0 THEN NULL
         ELSE DATEDIFF(day, CAST(GETDATE() AS DATE),
                       CAST(DATEADD(day, s.ValidDays, s.DocuDate) AS DATE)) END AS DaysLeft,
    CASE WHEN ISNULL(s.ValidDays, 0) = 0 THEN N'ไม่กำหนดวันหมดอายุ'
         WHEN DATEADD(day, s.ValidDays, s.DocuDate) < GETDATE() THEN N'หมดอายุแล้ว'
         WHEN DATEDIFF(day, GETDATE(), DATEADD(day, s.ValidDays, s.DocuDate)) <= 7 THEN N'ใกล้หมดอายุ'
         ELSE N'ปกติ' END                    AS ExpiryStatus,
    cu.CustCode,
    RTRIM(cu.CustName)                       AS CustName
FROM   dbo.WFCoupon c
LEFT   JOIN dbo.SOHD  s  ON s.DocuNo = c.SONo AND s.DocuType = 103
LEFT   JOIN dbo.EMCust cu ON cu.CustID = s.CustID
WHERE  c.RemaQty > 0;
GO

-- ── 9. รวมแถวชั่งเป็นเที่ยวรถ ─────────────────────────────────
--
-- เจ้าของยืนยัน 03/09/2569: dbo.WGHD บันทึก **1 แถวต่อ 1 SO**
-- รถคันเดียวที่บรรทุกหลาย SO จึงมีหลายแถว
-- รวมกลับเป็นเที่ยวด้วย ทะเบียนรถ + วันที่ลงทะเบียน ซึ่งเป็นสิ่งที่มีร่วมกัน
CREATE OR ALTER VIEW wf.v_WeighTripGroup
AS
SELECT
    w.CarNo,
    CAST(w.DateReg AS DATE)                  AS TripDate,
    COUNT(*)                                 AS RowCountInTrip,
    COUNT(DISTINCT w.SPID)                   AS DistinctSoCount,
    MIN(w.Status)                            AS MinStatus,
    MAX(w.Status)                            AS MaxStatus,
    SUM(CASE WHEN w.Status = 3 THEN 1 ELSE 0 END) AS WeighedOutRows,
    SUM(ISNULL(w.TotalTon, 0))               AS TotalTon,
    SUM(ISNULL(w.TotalKasob, 0))             AS TotalKasob,
    MIN(w.DateIn)                            AS FirstWeighIn,
    MAX(w.DateOut)                           AS LastWeighOut,
    -- เที่ยวจะถือว่าจบเมื่อ **ทุกแถว** ชั่งออกครบ ไม่ใช่แถวใดแถวหนึ่ง
    CASE WHEN MIN(w.Status) = 3 THEN N'ชั่งออกครบทุกใบ'
         WHEN MAX(w.Status) = 1 THEN N'รอเข้าชั่ง'
         ELSE N'กำลังดำเนินการ' END          AS TripStage
FROM   dbo.WGHD w
WHERE  NULLIF(RTRIM(w.CarNo), '') IS NOT NULL
GROUP  BY w.CarNo, CAST(w.DateReg AS DATE);
GO
