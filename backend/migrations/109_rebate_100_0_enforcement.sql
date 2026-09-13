-- =============================================================
-- 109_rebate_100_0_enforcement.sql
--
-- SO-02: Rebate 100/0 ให้ตรงทุกชั้น (Customer 100% / WF 0%)
-- 1. เพิ่มฟิลด์ PolicyVersionId ใน wf.RebateClaim เพื่อผูกกับ Policy Version ที่มีผล
-- 2. Backfill ค่าย้อนหลังใน wf.RebateClaim ให้ CustomerRatio=100, CompanyRatio=0, IsSelfClaim=0 ไม่ให้มี NULL
-- 3. เพิ่ม Check Constraint ให้ CustomerRatio + CompanyRatio = 100.00
--
-- ⚠ ไม่แตะ schema dbo · ไม่มีคำสั่ง USE · รองรับ Idempotency
-- =============================================================

-- ── 1. เพิ่ม PolicyVersionId ใน wf.RebateClaim ───────────────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[wf].[RebateClaim]') AND name = 'PolicyVersionId')
BEGIN
    ALTER TABLE [wf].[RebateClaim] ADD [PolicyVersionId] INT NULL;
    IF EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[wf].[PolicyVersion]') AND type = N'U')
    BEGIN
        ALTER TABLE [wf].[RebateClaim] ADD CONSTRAINT [FK_RebateClaim_PolicyVersion]
            FOREIGN KEY ([PolicyVersionId]) REFERENCES [wf].[PolicyVersion] ([PolicyVersionId]);
    END
    PRINT 'เพิ่มคอลัมน์ PolicyVersionId ใน wf.RebateClaim แล้ว';
END
ELSE
    PRINT 'คอลัมน์ PolicyVersionId มีอยู่แล้ว — ข้าม';
GO

-- ── 2. Backfill ค่า NULL ใน wf.RebateClaim ───────────────────
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[wf].[RebateClaim]') AND name = 'CustomerRatio')
BEGIN
    UPDATE wf.RebateClaim
    SET CustomerRatio = ISNULL(CustomerRatio, 100.00),
        CompanyRatio  = ISNULL(CompanyRatio, 0.00),
        CustomerAmount = ISNULL(CustomerAmount, ISNULL(ClaimAmt, 0)),
        RetainedAmount = ISNULL(RetainedAmount, 0.00),
        IsSelfClaim   = ISNULL(IsSelfClaim, 0)
    WHERE CustomerRatio IS NULL
       OR CompanyRatio IS NULL
       OR CustomerAmount IS NULL
       OR RetainedAmount IS NULL
       OR IsSelfClaim IS NULL;
    PRINT 'Backfill ข้อมูล Ratio ใน wf.RebateClaim เรียบร้อย';
END
GO

-- ── 3. Constraint ตรวจสอบสัดส่วนรวมเท่ากับ 100% ─────────────
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE object_id = OBJECT_ID(N'[wf].[CK_RebateClaim_RatioSum]'))
   AND EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[wf].[RebateClaim]') AND name = 'CustomerRatio')
BEGIN
    ALTER TABLE [wf].[RebateClaim]
    ADD CONSTRAINT [CK_RebateClaim_RatioSum]
    CHECK (ROUND(ISNULL(CustomerRatio, 100.00) + ISNULL(CompanyRatio, 0.00), 2) = 100.00);
    PRINT 'เพิ่ม Constraint CK_RebateClaim_RatioSum แล้ว';
END
ELSE
    PRINT 'Constraint CK_RebateClaim_RatioSum มีอยู่แล้ว — ข้าม';
GO
