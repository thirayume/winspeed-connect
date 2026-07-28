-- =============================================================
-- 065_create_rebate_claim_approval.sql
-- สร้างตารางติดตามประวัติการอนุมัติ 4 ชั้น (wf.RebateClaimApproval)
-- และขยายตาราง wf.RebateClaim เพื่อรองรับสถานะการอนุมัติ 4 ชั้น และสเกลภาคการขาย
-- Safe to re-run (idempotent)
-- =============================================================

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'RebateClaimApproval' AND schema_id = SCHEMA_ID('wf'))
BEGIN
    CREATE TABLE wf.RebateClaimApproval (
        ApprovalId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        ClaimId INT NOT NULL,
        Tier INT NOT NULL, -- 1: Sales, 2: Regional Mgr, 3: Marketing Mgr, 4: Executive
        RequiredRole VARCHAR(30) NOT NULL,
        Decision VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING / APPROVED / REJECTED
        DecidedBy INT NULL,
        DecidedByName NVARCHAR(150) NULL,
        DecidedAt DATETIME2 NULL,
        Reason NVARCHAR(500) NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        CONSTRAINT FK_RebateClaimApproval_Claim FOREIGN KEY (ClaimId) REFERENCES wf.RebateClaim(Id) ON DELETE CASCADE,
        CONSTRAINT FK_RebateClaimApproval_DecidedBy FOREIGN KEY (DecidedBy) REFERENCES wf.AppUser(Id),
        CONSTRAINT chk_RebateClaimApproval_Decision CHECK (Decision IN ('PENDING', 'APPROVED', 'REJECTED'))
    );

    CREATE INDEX IX_RebateClaimApproval_ClaimId ON wf.RebateClaimApproval(ClaimId);
    CREATE INDEX IX_RebateClaimApproval_Tier ON wf.RebateClaimApproval(Tier);
END;
GO

-- เพิ่มคอลัมน์ RegionCode และ CurrentTier ให้กับ wf.RebateClaim หากยังไม่มี
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('wf.RebateClaim') AND name = 'RegionCode')
BEGIN
    ALTER TABLE wf.RebateClaim ADD RegionCode VARCHAR(10) NULL;
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('wf.RebateClaim') AND name = 'CurrentTier')
BEGIN
    ALTER TABLE wf.RebateClaim ADD CurrentTier INT NOT NULL DEFAULT 1;
END;
GO
