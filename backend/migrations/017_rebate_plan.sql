-- =============================================================
-- 017_rebate_plan.sql
-- Rebate Plan (FR-008) + Pool allocation (FR-009)
--   - wf.RebatePlan: นิยามโปรโมชั่นรีเบท (สูตร/ภาค/ประเภทคืน/งบ/ช่วงเวลา/priority/status)
--   - ผูก accrual กับ Plan ที่ ACTIVE (best-effort) → tag PlanId/Region ใน RebateLedger
--   - allocate งบ Plan → Pool (Pool.AllocatedAmt)
-- Price Book (FR-023) ใช้ของเดิม dbo.EMSetPriceDT ผ่าน /master/prices (ไม่สร้างซ้ำ)
-- Safe to re-run (idempotent)
-- =============================================================

IF OBJECT_ID('wf.RebatePlan','U') IS NULL
BEGIN
  CREATE TABLE wf.RebatePlan (
    PlanId          INT IDENTITY(1,1) PRIMARY KEY,
    PlanNo          NVARCHAR(30)  NOT NULL,
    Title           NVARCHAR(200) NULL,
    GoodCodePattern NVARCHAR(50)  NULL,                      -- เช่น '15-5-35' หรือ NULL = ทุกสูตร
    Region          NVARCHAR(20)  NOT NULL DEFAULT 'ALL',    -- ใต้/กลาง/เหนือ/ตะวันออก/ALL
    ReturnType      NVARCHAR(20)  NOT NULL DEFAULT 'REBATE'  -- REBATE (คืนรีเบท) / PRICEDIFF (คืนส่วนต่าง)
      CONSTRAINT chk_RebatePlan_RT CHECK (ReturnType IN ('REBATE','PRICEDIFF')),
    NetPrice        DECIMAL(12,2) NULL,                      -- ราคา NET ที่คืน (อ้างอิง)
    ValidFrom       DATE          NULL,
    ValidTo         DATE          NULL,
    AllocatedAmount DECIMAL(14,2) NOT NULL DEFAULT 0,
    Priority        INT           NOT NULL DEFAULT 100,
    Status          NVARCHAR(20)  NOT NULL DEFAULT 'DRAFT'
      CONSTRAINT chk_RebatePlan_Status CHECK (Status IN ('DRAFT','ACTIVE','CLOSED')),
    Note            NVARCHAR(300) NULL,
    CreatedBy       INT           NULL REFERENCES wf.AppUser(Id),
    CreatedAt       DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
    UpdatedAt       DATETIME2     NOT NULL DEFAULT GETUTCDATE()
  );
  CREATE INDEX IX_RebatePlan_Status ON wf.RebatePlan(Status);
END
GO

-- trace: ผูก ledger กับ plan ที่ match
IF COL_LENGTH('wf.RebateLedger','PlanId') IS NULL
  ALTER TABLE wf.RebateLedger ADD PlanId INT NULL;
GO
IF COL_LENGTH('wf.RebateLedger','Region') IS NULL
  ALTER TABLE wf.RebateLedger ADD Region NVARCHAR(20) NULL;
GO

-- log การจัดสรรงบ Plan → Sales (ตรวจสอบย้อนหลัง)
IF OBJECT_ID('wf.RebatePlanAllocation','U') IS NULL
BEGIN
  CREATE TABLE wf.RebatePlanAllocation (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    PlanId      INT           NOT NULL REFERENCES wf.RebatePlan(PlanId),
    PoolId      INT           NOT NULL REFERENCES wf.RebatePool(Id),
    SalesUserId INT           NOT NULL,
    Amount      DECIMAL(14,2) NOT NULL,
    Note        NVARCHAR(300) NULL,
    CreatedBy   INT           NULL,
    CreatedAt   DATETIME2     NOT NULL DEFAULT GETUTCDATE()
  );
END
GO

GRANT SELECT ON SCHEMA::wf TO wf_reader
GO
PRINT '✓ WF migration 017 complete (RebatePlan + allocation + ledger trace)'
GO
