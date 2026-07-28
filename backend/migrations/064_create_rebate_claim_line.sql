-- =============================================================
-- 064_create_rebate_claim_line.sql
-- สร้างตารางรายการย่อยใบขอเคลียร์รีเบท (wf.RebateClaimLine)
-- ตรงตามแบบฟอร์มธุรกิจ RBD68-049 (รองรับ 6 บรรทัดต่อ 1 ใบขออนุมัติ)
-- Safe to re-run (idempotent)
-- =============================================================

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'RebateClaimLine' AND schema_id = SCHEMA_ID('wf'))
BEGIN
    CREATE TABLE wf.RebateClaimLine (
        LineId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        ClaimId INT NOT NULL,
        [LineNo] INT NOT NULL,
        LedgerId INT NULL,
        GoodCode NVARCHAR(50) NOT NULL,
        GoodName NVARCHAR(200) NULL,
        QtyTon DECIMAL(18,3) NOT NULL,
        PricePerTon DECIMAL(18,2) NOT NULL,
        NetPricePerTon DECIMAL(18,2) NOT NULL,
        RebatePerTon DECIMAL(18,2) NOT NULL,
        LineAmount AS (CAST(QtyTon * RebatePerTon AS DECIMAL(18,2))),
        PlanId INT NULL,
        Remark NVARCHAR(500) NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        CONSTRAINT FK_RebateClaimLine_Claim FOREIGN KEY (ClaimId) REFERENCES wf.RebateClaim(Id) ON DELETE CASCADE,
        CONSTRAINT FK_RebateClaimLine_Ledger FOREIGN KEY (LedgerId) REFERENCES wf.RebateLedger(Id),
        CONSTRAINT FK_RebateClaimLine_Plan FOREIGN KEY (PlanId) REFERENCES wf.RebatePlan(PlanId),
        CONSTRAINT chk_RebateClaimLine_RebatePerTon CHECK (RebatePerTon = (PricePerTon - NetPricePerTon))
    );

    CREATE INDEX IX_RebateClaimLine_ClaimId ON wf.RebateClaimLine(ClaimId);
    CREATE INDEX IX_RebateClaimLine_GoodCode ON wf.RebateClaimLine(GoodCode);
END;
GO
