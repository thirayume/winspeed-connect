-- =============================================================
-- 023_approval_policy.sql
-- FR-028 (P1-A) — Configurable approval policy
--   ตารางนโยบายอนุมัติ: case + ช่วงจำนวนเงิน + role ที่อนุมัติได้ + วันที่มีผล
--   engine (resolveApprovalPolicy) อ่านตารางนี้แทน hardcode role
-- =============================================================

IF OBJECT_ID('wf.ApprovalPolicy','U') IS NULL
BEGIN
  CREATE TABLE wf.ApprovalPolicy (
    Id            INT IDENTITY(1,1) PRIMARY KEY,
    CaseType      NVARCHAR(40)  NOT NULL,   -- UNLOCK | REBATE_CLAIM | PRICE_CHANGE | CREDIT_OVERRIDE | GIVEAWAY_OVERRUN
    MinAmount     DECIMAL(18,2) NULL,       -- NULL = ไม่มีขั้นต่ำ
    MaxAmount     DECIMAL(18,2) NULL,       -- NULL = ไม่จำกัด
    RequiredRole  NVARCHAR(30)  NOT NULL,   -- role ที่มีอำนาจอนุมัติ
    EffectiveFrom DATE          NOT NULL DEFAULT CAST(GETDATE() AS DATE),
    EffectiveTo   DATE          NULL,
    IsActive      BIT           NOT NULL DEFAULT 1,
    Note          NVARCHAR(300) NULL,
    CreatedBy     INT           NULL REFERENCES wf.AppUser(Id),
    CreatedAt     DATETIME2     NOT NULL DEFAULT GETUTCDATE()
  );
  CREATE INDEX IX_ApprovalPolicy_Case ON wf.ApprovalPolicy(CaseType, IsActive);

  -- seed นโยบายเริ่มต้น (สะท้อน hardcode เดิม — ปรับได้ภายหลัง)
  INSERT INTO wf.ApprovalPolicy (CaseType, MinAmount, MaxAmount, RequiredRole, Note) VALUES
    ('UNLOCK',          NULL, NULL, 'MANAGER',    'ปลดล็อก SO'),
    ('REBATE_CLAIM',    NULL, 50000, 'ACCOUNTING', 'เคลมรีเบท ≤ 50,000'),
    ('REBATE_CLAIM',    50000, NULL, 'MANAGER',    'เคลมรีเบท > 50,000'),
    ('PRICE_CHANGE',    NULL, NULL, 'MANAGER',     'เปลี่ยนราคา/Price Book'),
    ('CREDIT_OVERRIDE', NULL, NULL, 'MANAGER',     'อนุมัติข้ามเครดิต'),
    ('GIVEAWAY_OVERRUN',NULL, NULL, 'MANAGER',     'เบิกของแถมเกินงบ');
END
GO

GRANT SELECT ON SCHEMA::wf TO wf_reader
GO
PRINT '✓ WF migration 023 complete (ApprovalPolicy)'
GO
