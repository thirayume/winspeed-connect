-- =============================================================
-- 069_rebate_plan_approval.sql
--
-- แบบขออนุมัติรายการส่งเสริมการขาย (เช่น เลขที่ 14/2568) เป็นเอกสารต้นทาง
-- ที่กำหนด "ราคาสุทธิ" ให้ใบขอเคลียร์ทุกใบใช้อ้างอิง แต่ wf.RebatePlan
-- มีแค่คอลัมน์ Status ไม่มีร่องรอยการอนุมัติเลย ทั้งที่ฟอร์มจริงมีลายเซ็น 4 ตำแหน่ง
--
-- สายอนุมัติ "ไม่เหมือน" ใบขอเคลียร์ — ต่างกันที่ชั้นที่ 3
--
--   ชั้น | ใบขออนุมัติโปรโมชั่น        | ใบขอเคลียร์
--   -----|----------------------------|---------------------------
--    1   | ผู้แทนขาย (ผู้ยื่น)          | ผู้แทนขาย (ผู้ยื่น)
--    2   | ผู้จัดการภาค                | ผู้จัดการภาค
--    3   | ผู้จัดการฝ่ายขาย  ← ต่าง     | ผู้จัดการฝ่ายตลาด
--    4   | กรรมการบริหาร               | กรรมการบริหาร
--
-- ใช้โครงเดียวกับ wf.RebateClaimApproval เพื่อให้กติกาและการอ่านหลักฐานเหมือนกัน
-- แต่แยกตารางเพราะเป็นคนละเอกสารและมี foreign key คนละตัว
--
-- Safe to re-run (idempotent)
-- =============================================================

IF OBJECT_ID('wf.RebatePlanApproval', 'U') IS NULL
BEGIN
  CREATE TABLE wf.RebatePlanApproval (
    ApprovalId    INT IDENTITY(1,1) PRIMARY KEY,
    PlanId        INT           NOT NULL,
    Tier          INT           NOT NULL,
    RequiredRole  VARCHAR(30)   NOT NULL,
    Decision      NVARCHAR(10)  NOT NULL,
    DecidedBy     INT           NULL,
    DecidedByName NVARCHAR(150) NULL,
    DecidedAt     DATETIME2     NULL,
    Reason        NVARCHAR(500) NULL,
    CreatedAt     DATETIME2     NOT NULL CONSTRAINT df_RPA_CreatedAt DEFAULT GETUTCDATE(),
    CONSTRAINT fk_RPA_Plan FOREIGN KEY (PlanId) REFERENCES wf.RebatePlan (PlanId),
    CONSTRAINT fk_RPA_User FOREIGN KEY (DecidedBy) REFERENCES wf.AppUser (Id),
    CONSTRAINT chk_RPA_Decision CHECK (Decision IN ('PENDING', 'APPROVED', 'REJECTED')),
    CONSTRAINT chk_RPA_Tier CHECK (Tier BETWEEN 1 AND 4)
  );
  CREATE INDEX ix_RPA_PlanId ON wf.RebatePlanApproval (PlanId, Tier);
END
GO

-- ชั้นที่กำลังรออนุมัติอยู่ เก็บที่หัวเอกสารเพื่อไม่ต้องคำนวณทุกครั้งที่แสดงรายการ
IF COL_LENGTH('wf.RebatePlan', 'CurrentTier') IS NULL
  ALTER TABLE wf.RebatePlan ADD CurrentTier INT NULL;
GO

-- สถานะเดิมของ RebatePlan ไม่ได้บังคับค่าไว้ จึงต้องประกาศให้ครบก่อนเดิน workflow
-- คงค่าที่มีอยู่แล้วในข้อมูลจริงไว้ทั้งหมด ไม่ให้ข้อมูลเดิมผิด constraint
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chk_RebatePlan_Status')
  ALTER TABLE wf.RebatePlan DROP CONSTRAINT chk_RebatePlan_Status;
GO

DECLARE @bad INT = (
  SELECT COUNT(*) FROM wf.RebatePlan
  WHERE Status IS NOT NULL AND Status NOT IN
    ('DRAFT','TIER2_PENDING','TIER3_PENDING','TIER4_PENDING','ACTIVE','APPROVED','REJECTED','CLOSED','INACTIVE'));
IF @bad > 0
  RAISERROR('wf.RebatePlan มีสถานะนอกรายการที่กำหนด — ตรวจข้อมูลเดิมก่อนใช้ migration นี้', 16, 1);
GO

ALTER TABLE wf.RebatePlan WITH CHECK ADD CONSTRAINT chk_RebatePlan_Status CHECK (Status IS NULL OR Status IN (
  'DRAFT',            -- ร่าง ยังไม่ยื่น
  'TIER2_PENDING',    -- รอผู้จัดการภาค
  'TIER3_PENDING',    -- รอผู้จัดการฝ่ายขาย
  'TIER4_PENDING',    -- รอกรรมการบริหาร
  'APPROVED',         -- อนุมัติครบทุกชั้น
  'ACTIVE',           -- อนุมัติแล้วและอยู่ในช่วงเวลาที่ใช้ได้
  'REJECTED',         -- ถูกตีกลับ
  'CLOSED',           -- ปิดโปรโมชั่น
  'INACTIVE'          -- ยกเลิกการใช้งาน
));
GO
