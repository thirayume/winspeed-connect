-- =============================================================
-- 066_create_rebate_claim_invoices.sql
-- สร้างตารางผูกใบขอเคลียร์รีเบทกับใบกำกับสินค้าหลายใบ (wf.RebateClaimInvoice)
-- ตรงตามแบบฟอร์มธุรกิจ RBD68-049 ที่อ้างอิงใบกำกับหลายใบ (I68-01781, I68-02952, ...)
-- Safe to re-run (idempotent)
-- =============================================================

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'RebateClaimInvoice' AND schema_id = SCHEMA_ID('wf'))
BEGIN
    CREATE TABLE wf.RebateClaimInvoice (
        Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        ClaimId INT NOT NULL,
        DocuNo NVARCHAR(50) NOT NULL,
        InvoiceAmount DECIMAL(18,2) NULL,
        ApprovedAmount DECIMAL(18,2) NULL,
        ApprovedAt DATETIME2 NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        CONSTRAINT FK_RebateClaimInvoice_Claim FOREIGN KEY (ClaimId) REFERENCES wf.RebateClaim(Id) ON DELETE CASCADE
    );

    CREATE INDEX IX_RebateClaimInvoice_ClaimId ON wf.RebateClaimInvoice(ClaimId);
    CREATE INDEX IX_RebateClaimInvoice_DocuNo ON wf.RebateClaimInvoice(DocuNo);
END;
GO
