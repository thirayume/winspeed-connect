-- =============================================================
-- 102_org_structure_2025.sql
--
-- นำโครงสร้างองค์กรปี 2568/2025 เข้าระบบ เพื่อใช้กำหนดสิทธิ์
-- สายบังคับบัญชา และสายอนุมัติเอกสาร
--
-- ที่มา: ผังองค์กร "WF Org Chart 2025 - Position" ที่เจ้าของระบบส่งมา 03/09/2569
--
-- ⚠ เก็บเฉพาะ "ตำแหน่ง" ไม่เก็บชื่อพนักงาน
--   repo นี้เป็น repo สาธารณะ และเคยมีชื่อพนักงานหลุดออกไปแล้วครั้งหนึ่ง
--   การผูกคนเข้ากับตำแหน่งทำผ่าน wf.AppUser.PositionCode ซึ่งอยู่ในฐานข้อมูล
--   ไม่ได้อยู่ในไฟล์ migration
--
-- สิ่งที่ migration นี้ทำ (เพิ่มอย่างเดียว ไม่ลบและไม่แก้ของเดิม)
--   1. wf.OrgPosition   — ผังตำแหน่ง + สายบังคับบัญชา + บทบาทเริ่มต้น
--   2. wf.AppUser.PositionCode — ผูกผู้ใช้เข้ากับตำแหน่ง
--   3. เติมเขตการขายที่ขาดใน wf.SaleRegion ให้ตรงกับผังจริง
--
-- ⚠ ปัญหาที่พบระหว่างทำ และ **ยังไม่แก้ในนี้** เพราะกระทบข้อมูลจริง
--   wf.SaleRegion กับ wf.GiveawayBudget.Region เก็บ "เขตการขาย" คนละชุดกัน
--     SaleRegion  : 01 กรุงเทพฯ · 02 ภาคกลาง-ตะวันตก · 03 อีสาน(รวม) · 04 เหนือ · 05 ใต้ · 06 ตะวันออก · 99
--     GiveawayBudget (65 แถวจริง) : อีสานล่าง/กลาง/บน · เหนือ · กลาง · ตะวันออก · ใต้ · ปุ๋ยเทพ 1 · ปุ๋ยเทพ 2
--   ผังองค์กรยืนยันว่าฝั่ง GiveawayBudget ถูก — อีสานแยกสามเขตจริง และมีสายปุ๋ยเทพแยก
--   migration นี้จึง **เพิ่ม** เขตที่ขาดเข้า SaleRegion แต่ไม่แตะ 6 แถวเดิม
--   เพราะ wf.UserSaleArea มี FK ชี้อยู่ การย้ายรหัสต้องทำพร้อมย้ายข้อมูลผู้ใช้
--   → ต้องให้เจ้าของระบบตัดสินก่อนว่าจะ map ผู้ใช้เดิมไปเขตใหม่อย่างไร
-- =============================================================

-- ── 1. ผังตำแหน่ง ────────────────────────────────────────────
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[wf].[OrgPosition]') AND type = N'U')
BEGIN
    CREATE TABLE wf.OrgPosition (
        PositionCode   VARCHAR(30)   NOT NULL,
        PositionName   NVARCHAR(150) NOT NULL,
        ReportsTo      VARCHAR(30)   NULL,        -- PositionCode ของหัวหน้า · NULL = สูงสุด
        OrgUnit        NVARCHAR(60)  NOT NULL,    -- สายงาน: บริหาร/บัญชี-การเงิน/โรงงาน/ขาย-การตลาด
        Tier           TINYINT       NOT NULL,    -- 1 สูงสุด → 5 ระดับปฏิบัติการ
        DefaultRole    VARCHAR(20)   NULL,        -- บทบาทในแอปที่ตำแหน่งนี้ควรได้
        CanApprove     BIT           NOT NULL CONSTRAINT DF_OrgPosition_CanApprove DEFAULT (0),
        IsActive       BIT           NOT NULL CONSTRAINT DF_OrgPosition_IsActive   DEFAULT (1),
        Note           NVARCHAR(300) NULL,
        CreatedAt      DATETIME2     NOT NULL CONSTRAINT DF_OrgPosition_CreatedAt  DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_OrgPosition PRIMARY KEY CLUSTERED (PositionCode),
        CONSTRAINT FK_OrgPosition_ReportsTo FOREIGN KEY (ReportsTo) REFERENCES wf.OrgPosition (PositionCode)
    );
    CREATE INDEX IX_OrgPosition_ReportsTo ON wf.OrgPosition (ReportsTo);
    CREATE INDEX IX_OrgPosition_Unit      ON wf.OrgPosition (OrgUnit, Tier);
END
GO

-- ── 2. ผูกผู้ใช้เข้ากับตำแหน่ง ─────────────────────────────────
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[wf].[AppUser]') AND name = 'PositionCode')
BEGIN
    ALTER TABLE wf.AppUser ADD PositionCode VARCHAR(30) NULL;
END
GO

IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_AppUser_OrgPosition')
BEGIN
    ALTER TABLE wf.AppUser
      ADD CONSTRAINT FK_AppUser_OrgPosition
      FOREIGN KEY (PositionCode) REFERENCES wf.OrgPosition (PositionCode);
END
GO

-- ── 3. ข้อมูลตำแหน่งตามผังปี 2568 ─────────────────────────────
-- MERGE เพื่อให้รันซ้ำได้ · ไม่ลบตำแหน่งที่ถูกเพิ่มเข้ามาภายหลัง
MERGE wf.OrgPosition AS t
USING (VALUES
  -- ระดับ 1–2 · บริหาร
  ('EXEC',        N'กรรมการบริหาร',                                    NULL,        N'บริหาร',        1, 'C_LEVEL',       1, N'สูงสุดของสายบริหาร'),
  ('EXEC-PUR',    N'กรรมการบริหาร จัดซื้อ/ต่างประเทศ',                  NULL,        N'บริหาร',        1, 'C_LEVEL',       1, N'สายจัดซื้อและต่างประเทศ'),
  ('EXEC-SALE',   N'กรรมการบริหาร ฝ่ายขายและการตลาด',                   NULL,        N'บริหาร',        1, 'C_LEVEL',       1, N'สูงสุดของสายขาย'),
  ('EXEC-FIN-HR', N'กรรมการบริหาร ผู้ช่วย การเงิน/HR',                  'EXEC',      N'บริหาร',        2, 'C_LEVEL',       1, N'คุมสายบัญชี-การเงิน และสายโรงงาน'),
  ('AMD-MKT',     N'ผู้ช่วยกรรมการผู้จัดการ ฝ่ายการตลาด',                'EXEC-SALE', N'ขาย-การตลาด',   2, 'MANAGER',       1, NULL),

  -- ระดับ 3 · บัญชีและการเงิน
  ('MGR-ACC',     N'ผู้จัดการฝ่ายบัญชี',                                 'EXEC-FIN-HR', N'บัญชี-การเงิน', 3, 'MANAGER',     1, NULL),
  ('MGR-FIN',     N'ผู้จัดการฝ่ายการเงิน',                               'EXEC-FIN-HR', N'บัญชี-การเงิน', 3, 'MANAGER',     1, NULL),
  ('ACC-CHIEF',   N'ผู้ช่วยสมุหบัญชี',                                   'MGR-ACC',   N'บัญชี-การเงิน', 4, 'ACCOUNTING',    0, NULL),
  ('ACC-COST',    N'บัญชีต้นทุน',                                        'MGR-ACC',   N'บัญชี-การเงิน', 4, 'ACCOUNTING',    0, NULL),
  ('FIN-AR-HEAD', N'หัวหน้าการเงินรับ',                                  'MGR-ACC',   N'บัญชี-การเงิน', 4, 'ACCOUNTING',    1, N'อนุมัติการรับชำระ'),
  ('FIN-AR',      N'เจ้าหน้าที่การเงินรับ',                              'FIN-AR-HEAD', N'บัญชี-การเงิน', 5, 'ACCOUNTING',  0, NULL),
  ('FIN-AP',      N'เจ้าหน้าที่การเงินจ่าย',                             'MGR-FIN',   N'บัญชี-การเงิน', 4, 'ACCOUNTING',    0, NULL),
  ('FIN-DOC',     N'พนักงานเดินเอกสาร',                                  'MGR-FIN',   N'บัญชี-การเงิน', 5, NULL,            0, N'ยังไม่มีบทบาทในแอป'),

  -- ระดับ 3–5 · โรงงานและสายการผลิต
  ('MGR-PLANT',   N'ผู้จัดการโรงงานและสายการผลิต',                       'EXEC-FIN-HR', N'โรงงาน',      3, 'MANAGER',       1, NULL),
  ('DMGR-PLANT',  N'รองผู้จัดการโรงงานและสายการผลิต',                    'MGR-PLANT', N'โรงงาน',        3, 'MANAGER',       1, NULL),
  ('PROD-HEAD',   N'หัวหน้าฝ่ายผลิต',                                    'DMGR-PLANT', N'โรงงาน',       4, 'WAREHOUSE',     0, NULL),
  ('PROD-STAFF',  N'พนักงานฝ่ายผลิต',                                    'PROD-HEAD', N'โรงงาน',        5, 'WAREHOUSE',     0, NULL),
  ('MAINT-HEAD',  N'หัวหน้าฝ่ายซ่อมบำรุง',                               'DMGR-PLANT', N'โรงงาน',       4, NULL,            0, N'ยังไม่มีบทบาทในแอป'),
  ('MAINT-STAFF', N'พนักงานซ่อมบำรุง',                                   'MAINT-HEAD', N'โรงงาน',       5, NULL,            0, N'ยังไม่มีบทบาทในแอป'),
  ('WEIGH-HEAD',  N'หัวหน้าฝ่ายห้องชั่ง',                                'DMGR-PLANT', N'โรงงาน',       4, 'WEIGHBRIDGE',   1, N'ดูสถานะการชั่งจาก dbo.WGHD'),
  ('WEIGH-STAFF', N'เจ้าหน้าที่ห้องชั่ง',                                'WEIGH-HEAD', N'โรงงาน',       5, 'WEIGHBRIDGE',   0, N'ดูสถานะการชั่งจาก dbo.WGHD'),
  ('LAB-HEAD',    N'หัวหน้าห้องปฏิบัติการ',                              'DMGR-PLANT', N'โรงงาน',       4, NULL,            0, N'QC — ยังไม่มีบทบาทในแอป'),
  ('LAB-STAFF',   N'เจ้าหน้าที่ห้องปฏิบัติการ',                          'LAB-HEAD',  N'โรงงาน',        5, NULL,            0, N'QC — ยังไม่มีบทบาทในแอป'),
  ('WH-HEAD',     N'หัวหน้าคลังสินค้า',                                  'DMGR-PLANT', N'โรงงาน',       4, 'WAREHOUSE',     1, NULL),
  ('WH-STAFF',    N'พนักงานคลังสินค้า',                                  'WH-HEAD',   N'โรงงาน',        5, 'WAREHOUSE',     0, NULL),
  ('SACK-HEAD',   N'หัวหน้าห้องกระสอบ',                                  'DMGR-PLANT', N'โรงงาน',       4, 'WAREHOUSE',     0, NULL),
  ('SACK-STAFF',  N'พนักงานห้องกระสอบ',                                  'SACK-HEAD', N'โรงงาน',        5, 'WAREHOUSE',     0, NULL),

  -- ระดับ 3–5 · ขายและการตลาด
  ('DIR-SALE-GOV',N'ผู้อำนวยการฝ่ายขายและการตลาด โรงงานและหน่วยงานราชการ', 'AMD-MKT', N'ขาย-การตลาด',   3, 'MANAGER',       1, NULL),
  ('SALE-GOV',    N'พนักงานขาย โรงงานและหน่วยงานราชการ',                 'DIR-SALE-GOV', N'ขาย-การตลาด', 5, 'SALES',        0, NULL),
  ('SMGR-NCES',   N'ผู้จัดการอาวุโส ฝ่ายการตลาด ภาคเหนือ กลาง ตะวันออก ใต้', 'AMD-MKT', N'ขาย-การตลาด', 3, 'APPROVER',    1, N'อนุมัติรีเบทของสี่เขตนี้'),
  ('SMGR-ISAN',   N'ผู้จัดการอาวุโส ฝ่ายการตลาด ภาคอีสาน',               'AMD-MKT',   N'ขาย-การตลาด',   3, 'APPROVER',      1, N'อนุมัติรีเบทของสามเขตอีสาน'),
  ('SALE-NORTH',  N'พนักงานขายเขตภาคเหนือ',                              'SMGR-NCES', N'ขาย-การตลาด',   5, 'SALES',         0, NULL),
  ('SALE-CENTRAL',N'พนักงานขายเขตภาคกลาง',                               'SMGR-NCES', N'ขาย-การตลาด',   5, 'SALES',         0, NULL),
  ('SALE-EAST',   N'พนักงานขายเขตภาคตะวันออก',                           'SMGR-NCES', N'ขาย-การตลาด',   5, 'SALES',         0, NULL),
  ('SALE-SOUTH',  N'พนักงานขายเขตภาคใต้',                                'SMGR-NCES', N'ขาย-การตลาด',   5, 'SALES',         0, NULL),
  ('SALE-ISAN-U', N'พนักงานขายเขตอีสานบน',                               'SMGR-ISAN', N'ขาย-การตลาด',   5, 'SALES',         0, NULL),
  ('SALE-ISAN-M', N'พนักงานขายเขตอีสานกลาง',                             'SMGR-ISAN', N'ขาย-การตลาด',   5, 'SALES',         0, NULL),
  ('SALE-ISAN-L', N'พนักงานขายเขตอีสานล่าง',                             'SMGR-ISAN', N'ขาย-การตลาด',   5, 'SALES',         0, NULL),
  ('PTHEP-HEAD',  N'หัวหน้าสายปุ๋ยเทพ',                                  'AMD-MKT',   N'ขาย-การตลาด',   3, 'MANAGER',       1, NULL),
  ('SALE-PTHEP',  N'พนักงานขายปุ๋ยเทพ',                                  'PTHEP-HEAD', N'ขาย-การตลาด',  5, 'SALES',         0, NULL),
  ('PROMO-STAFF', N'พนักงานส่งเสริมการขาย',                              'AMD-MKT',   N'ขาย-การตลาด',   5, 'SALES',         0, NULL),
  ('COUNTER-HEAD',N'หัวหน้าเคาน์เตอร์เซลล์',                             'AMD-MKT',   N'ขาย-การตลาด',   4, 'COUNTER_SALES', 1, NULL),
  ('COUNTER-SALE',N'พนักงานเคาน์เตอร์เซลล์',                             'COUNTER-HEAD', N'ขาย-การตลาด', 5, 'COUNTER_SALES', 0, NULL)
) AS s (PositionCode, PositionName, ReportsTo, OrgUnit, Tier, DefaultRole, CanApprove, Note)
   ON t.PositionCode = s.PositionCode
WHEN MATCHED THEN UPDATE SET
    t.PositionName = s.PositionName, t.ReportsTo = s.ReportsTo, t.OrgUnit = s.OrgUnit,
    t.Tier = s.Tier, t.DefaultRole = s.DefaultRole, t.CanApprove = s.CanApprove, t.Note = s.Note
WHEN NOT MATCHED BY TARGET THEN
    INSERT (PositionCode, PositionName, ReportsTo, OrgUnit, Tier, DefaultRole, CanApprove, Note)
    VALUES (s.PositionCode, s.PositionName, s.ReportsTo, s.OrgUnit, s.Tier, s.DefaultRole, s.CanApprove, s.Note);
GO

-- ── 4. เขตการขายที่ขาด — เพิ่มอย่างเดียว ไม่แตะของเดิม ──────────
-- รหัสใหม่ขึ้นต้น 1x เพื่อไม่ชนกับ 01–06/99 ที่ wf.UserSaleArea อ้างอยู่
MERGE wf.SaleRegion AS t
USING (VALUES
  ('10', N'ภาคอีสานบน'),
  ('11', N'ภาคอีสานกลาง'),
  ('12', N'ภาคอีสานล่าง'),
  ('13', N'ภาคปุ๋ยเทพ 1'),
  ('14', N'ภาคปุ๋ยเทพ 2'),
  ('15', N'โรงงานและหน่วยงานราชการ'),
  ('16', N'เคาน์เตอร์เซลล์')
) AS s (RegionCode, RegionName)
   ON t.RegionCode = s.RegionCode
WHEN NOT MATCHED BY TARGET THEN
    INSERT (RegionCode, RegionName) VALUES (s.RegionCode, s.RegionName);
GO

-- ── 5. มุมมองสายบังคับบัญชา — ใช้หาผู้อนุมัติเหนือคนหนึ่งขึ้นไป ──
-- recursive CTE ไต่ ReportsTo ขึ้นไปจนสุด · Depth 1 = หัวหน้าโดยตรง
CREATE OR ALTER VIEW wf.v_OrgChain
AS
WITH chain AS (
    SELECT p.PositionCode AS FromPosition, p.ReportsTo AS ManagerPosition, 1 AS Depth
    FROM   wf.OrgPosition p
    WHERE  p.ReportsTo IS NOT NULL
    UNION ALL
    SELECT c.FromPosition, p.ReportsTo, c.Depth + 1
    FROM   chain c
    JOIN   wf.OrgPosition p ON p.PositionCode = c.ManagerPosition
    WHERE  p.ReportsTo IS NOT NULL AND c.Depth < 10
)
SELECT c.FromPosition, c.ManagerPosition, c.Depth,
       m.PositionName AS ManagerName, m.DefaultRole AS ManagerRole, m.CanApprove
FROM   chain c
JOIN   wf.OrgPosition m ON m.PositionCode = c.ManagerPosition;
GO

-- ── 6. ผู้อนุมัติที่ใกล้ที่สุดของแต่ละตำแหน่ง ────────────────────
CREATE OR ALTER VIEW wf.v_NearestApprover
AS
SELECT p.PositionCode, p.PositionName, p.OrgUnit,
       a.ManagerPosition AS ApproverPosition, a.ManagerName AS ApproverName,
       a.ManagerRole AS ApproverRole, a.Depth AS StepsUp
FROM   wf.OrgPosition p
OUTER  APPLY (
    SELECT TOP 1 c.ManagerPosition, c.ManagerName, c.ManagerRole, c.Depth
    FROM   wf.v_OrgChain c
    WHERE  c.FromPosition = p.PositionCode AND c.CanApprove = 1
    ORDER  BY c.Depth
) a;
GO
