-- =============================================================
-- 030_giveaway_borrow.sql
-- Giveaway Borrow Request Schema
-- =============================================================

IF OBJECT_ID('wf.GiveawayBorrowRequest','U') IS NULL
BEGIN
  CREATE TABLE wf.GiveawayBorrowRequest (
    Id            INT IDENTITY(1,1) PRIMARY KEY,
    RequesterId   INT           NOT NULL REFERENCES wf.AppUser(Id),
    LenderId      INT           NOT NULL REFERENCES wf.AppUser(Id), -- The user being borrowed from
    ApproverId    INT           NULL REFERENCES wf.AppUser(Id), -- The user who approved/rejected it (could be Lender or Manager)
    Region        NVARCHAR(60)  NOT NULL,
    PeriodYear    INT           NOT NULL,
    Brand         NVARCHAR(50)  NOT NULL,
    ItemName      NVARCHAR(100) NOT NULL,
    Qty           DECIMAL(12,2) NOT NULL,
    Reason        NVARCHAR(200) NOT NULL,
    Note          NVARCHAR(500) NULL,
    Status        NVARCHAR(20)  NOT NULL DEFAULT 'PENDING'
      CONSTRAINT chk_GReq_Status CHECK (Status IN ('PENDING', 'APPROVED', 'REJECTED')),
    RequestedAt   DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
    ResolvedAt    DATETIME2     NULL
  );
  CREATE INDEX IX_GiveawayBorrowRequest_Req ON wf.GiveawayBorrowRequest(RequesterId, Status);
  CREATE INDEX IX_GiveawayBorrowRequest_Lender ON wf.GiveawayBorrowRequest(LenderId, Status);
END
GO

GRANT SELECT ON SCHEMA::wf TO wf_reader
GO
PRINT '✓ WF migration 030 complete (GiveawayBorrowRequest)'
GO
