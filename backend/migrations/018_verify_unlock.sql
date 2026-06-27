-- =============================================================
-- 018_verify_unlock.sql
-- FR-022 Counter-Sales Verification Gate + FR-006/007 Unlock Request flow
--   - wf.SalesOrder: VerifiedBy / VerifiedAt (ตรวจซ้ำก่อนยืนยัน)
--   - wf.UnlockRequest: คำขอปลดล็อก + สายอนุมัติ
-- Safe to re-run (idempotent)
-- =============================================================

IF COL_LENGTH('wf.SalesOrder','VerifiedBy') IS NULL
  ALTER TABLE wf.SalesOrder ADD VerifiedBy INT NULL;
GO
IF COL_LENGTH('wf.SalesOrder','VerifiedAt') IS NULL
  ALTER TABLE wf.SalesOrder ADD VerifiedAt DATETIME2 NULL;
GO

IF OBJECT_ID('wf.UnlockRequest','U') IS NULL
BEGIN
  CREATE TABLE wf.UnlockRequest (
    Id           INT IDENTITY(1,1) PRIMARY KEY,
    SoId         NVARCHAR(50)  NOT NULL,
    WfRef        NVARCHAR(30)  NULL,
    Reason       NVARCHAR(500) NOT NULL,
    Status       NVARCHAR(20)  NOT NULL DEFAULT 'PENDING'
      CONSTRAINT chk_UnlockReq_Status CHECK (Status IN ('PENDING','APPROVED','REJECTED')),
    RequesterId  INT           NULL REFERENCES wf.AppUser(Id),
    ApproverId   INT           NULL REFERENCES wf.AppUser(Id),
    ResponseNote NVARCHAR(300) NULL,
    RequestedAt  DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
    RespondedAt  DATETIME2     NULL
  );
  CREATE INDEX IX_UnlockRequest_Status ON wf.UnlockRequest(Status);
  CREATE INDEX IX_UnlockRequest_So     ON wf.UnlockRequest(SoId);
END
GO

GRANT SELECT ON SCHEMA::wf TO wf_reader
GO
PRINT '✓ WF migration 018 complete (Verify gate + UnlockRequest)'
GO
