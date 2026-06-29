-- =============================================================
-- 026_credit_master.sql
-- FR-003 (P2-A) — Credit Hold / credit master (wf)
--   WINSpeed ไม่มีวงเงินใน flow นี้ → เก็บใน wf · ตรวจตอน confirm
--   CreditHold=1 → บล็อกการ confirm จนกว่าจะ override โดย role ตามนโยบาย CREDIT_OVERRIDE
-- =============================================================

IF OBJECT_ID('wf.CreditMaster','U') IS NULL
BEGIN
  CREATE TABLE wf.CreditMaster (
    CustId      NVARCHAR(20)  NOT NULL PRIMARY KEY,
    CustName    NVARCHAR(200) NULL,
    CreditLimit DECIMAL(18,2) NULL,        -- NULL = ไม่กำหนด
    CreditHold  BIT           NOT NULL DEFAULT 0,
    Note        NVARCHAR(300) NULL,
    UpdatedBy   INT           NULL REFERENCES wf.AppUser(Id),
    UpdatedAt   DATETIME2     NOT NULL DEFAULT GETUTCDATE()
  );
END
GO

GRANT SELECT ON SCHEMA::wf TO wf_reader
GO
PRINT '✓ WF migration 026 complete (CreditMaster)'
GO
