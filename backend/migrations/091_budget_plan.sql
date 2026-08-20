-- =============================================================
-- 091_budget_plan.sql
--
-- แผนส่งเสริมการขาย (Budget Plan) — งบเป็นบาท แยกรายภาค มีสายอนุมัติ 3 ลายเซ็น
--
-- ที่มา
--   เจ้าของระบบส่งเอกสารแผนส่งเสริมการขายมาให้ และยืนยันขอบเขตเมื่อ 20/08/2569 ว่า
--     • เก็บเป็น "บาท" (ของเดิมเก็บเป็นจำนวนชิ้น)
--     • แยกยอดรายภาค
--     • มีรายการตามหัวข้อในเอกสาร (1.3 / 2 / 3)
--     • มีช่องทางโรงงานน้ำตาลแยกจากช่องทางทั่วไป
--     • อนุมัติ 3 ลายเซ็น
--
--   **แผนส่งเสริมการขายเป็นคนละเรื่องกับการสะสมรีเบท** (ย้ำโดยเจ้าของระบบ)
--   รีเบทสะสมจากตันที่ส่งจริงและอ่านจาก dbo ตรง ๆ ([[worldfert-rebate-model]])
--   ส่วนแผนนี้คืองบที่จัดสรรไว้ล่วงหน้าให้พนักงานขายแต่ละคนเบิกใช้
--
-- ของเดิม
--   wf.GiveawayBudget เก็บ BudgetQty (จำนวนชิ้น) ต่อ พนักงาน × ภาค × ปี × แบรนด์ × รายการ
--   65 แถว ทุกแถว BudgetQty = 0 — โครงใช้ได้ แต่ยังไม่มีหน่วยเงินและไม่มีสายอนุมัติ
--   จึงเพิ่มเข้าไปแทนการสร้างตารางใหม่ทับของเดิม เพื่อไม่ให้มีงบสองชุดให้สับสน
-- =============================================================

/*
 * หัวแผน — หนึ่งปีหนึ่งฉบับต่อช่องทาง
 *
 * สามลายเซ็นเก็บเป็นสามชุดแยกกัน ไม่ยุบเป็น ApprovedBy เดียว
 * เพราะเอกสารจริงมีสามช่องและผู้ตรวจ ISO ต้องเห็นว่าใครเซ็นในบทบาทไหนเมื่อไร
 */
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'BudgetPlan' AND schema_id = SCHEMA_ID('wf'))
CREATE TABLE wf.BudgetPlan (
    PlanId        INT IDENTITY(1,1) PRIMARY KEY,
    PeriodYear    INT           NOT NULL,               -- พ.ศ. เช่น 2569
    Channel       NVARCHAR(30)  NOT NULL DEFAULT N'ทั่วไป'
        CONSTRAINT chk_BudgetPlan_Channel CHECK (Channel IN (N'ทั่วไป', N'โรงงานน้ำตาล')),
    Title         NVARCHAR(200) NULL,
    Status        NVARCHAR(20)  NOT NULL DEFAULT 'DRAFT'
        CONSTRAINT chk_BudgetPlan_Status CHECK (Status IN ('DRAFT','PENDING','APPROVED','REJECTED','CLOSED')),

    -- ลายเซ็นที่ 1 ผู้จัดทำ · 2 ผู้ตรวจสอบ · 3 ผู้อนุมัติ
    PreparedBy    INT           NULL REFERENCES wf.AppUser(Id),
    PreparedAt    DATETIME2     NULL,
    ReviewedBy    INT           NULL REFERENCES wf.AppUser(Id),
    ReviewedAt    DATETIME2     NULL,
    ApprovedBy    INT           NULL REFERENCES wf.AppUser(Id),
    ApprovedAt    DATETIME2     NULL,
    RejectNote    NVARCHAR(300) NULL,

    Note          NVARCHAR(500) NULL,
    CreatedAt     DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
    UpdatedAt     DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT UQ_BudgetPlan UNIQUE (PeriodYear, Channel)
);
GO

-- งบเป็นบาท · ของเดิม BudgetQty (ชิ้น) คงไว้ ไม่ลบ เพราะบางรายการนับเป็นชิ้นจริง ๆ
IF COL_LENGTH('wf.GiveawayBudget', 'BudgetAmt') IS NULL
    ALTER TABLE wf.GiveawayBudget ADD BudgetAmt DECIMAL(14,2) NOT NULL DEFAULT 0;
GO

-- หัวข้อในเอกสารแผน เช่น '1.3' · '2' · '3' — เก็บเป็นข้อความเพราะเลขหัวข้อไม่ได้เรียงเป็นตัวเลขล้วน
IF COL_LENGTH('wf.GiveawayBudget', 'PlanSection') IS NULL
    ALTER TABLE wf.GiveawayBudget ADD PlanSection NVARCHAR(20) NULL;
GO

IF COL_LENGTH('wf.GiveawayBudget', 'PlanId') IS NULL
    ALTER TABLE wf.GiveawayBudget ADD PlanId INT NULL REFERENCES wf.BudgetPlan(PlanId);
GO

-- ช่องทาง — โรงงานน้ำตาลมีงบแยกจากช่องทางทั่วไป
IF COL_LENGTH('wf.GiveawayBudget', 'Channel') IS NULL
    ALTER TABLE wf.GiveawayBudget ADD Channel NVARCHAR(30) NOT NULL DEFAULT N'ทั่วไป';
GO

-- ยอดเบิกก็ต้องมีหน่วยเงิน ไม่งั้นเทียบกับงบไม่ได้
IF COL_LENGTH('wf.GiveawayWithdrawal', 'Amount') IS NULL
    ALTER TABLE wf.GiveawayWithdrawal ADD Amount DECIMAL(14,2) NOT NULL DEFAULT 0;
GO

/*
 * งบคงเหลือรายภาค — ตัวเลขที่ผู้บริหารดูจากเอกสารแผน
 *
 * รวมทั้งจำนวนชิ้นและจำนวนเงินไว้ด้วยกัน เพราะแผนจริงมีทั้งสองแบบปนกัน
 * (แบนเนอร์นับเป็นชิ้น · ส่วนลดและของสมนาคุณนับเป็นบาท)
 */
CREATE OR ALTER VIEW wf.v_BudgetPlanRegion AS
SELECT
    b.PeriodYear,
    b.Channel,
    b.Region,
    b.PlanSection,
    COUNT(DISTINCT b.SalesUserId)            AS SalesCount,
    SUM(b.BudgetAmt)                         AS BudgetAmt,
    SUM(b.BudgetQty)                         AS BudgetQty,
    ISNULL(SUM(w.UsedAmt), 0)                AS UsedAmt,
    ISNULL(SUM(w.UsedQty), 0)                AS UsedQty,
    SUM(b.BudgetAmt) - ISNULL(SUM(w.UsedAmt), 0) AS RemainingAmt,
    SUM(b.BudgetQty) - ISNULL(SUM(w.UsedQty), 0) AS RemainingQty
FROM wf.GiveawayBudget b
OUTER APPLY (
    SELECT SUM(x.Amount) AS UsedAmt, SUM(x.Qty) AS UsedQty
    FROM wf.GiveawayWithdrawal x
    WHERE x.SalesUserId = b.SalesUserId
      AND x.PeriodYear  = b.PeriodYear
      AND ISNULL(x.Brand, '')    = ISNULL(b.Brand, '')
      AND ISNULL(x.ItemName, '') = ISNULL(b.ItemName, '')
) w
GROUP BY b.PeriodYear, b.Channel, b.Region, b.PlanSection;
GO
