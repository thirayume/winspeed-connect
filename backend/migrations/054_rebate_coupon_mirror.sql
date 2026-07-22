-- 054_rebate_coupon_mirror.sql
-- สร้างตารางกระจกสำหรับคูปอง Rebate จากฝั่ง WINSpeed เพื่อใช้เป็น Source of Truth ในการแสดงผล

IF OBJECT_ID('wf.CouponMirror', 'U') IS NULL
BEGIN
    CREATE TABLE wf.CouponMirror (
        CouponID      INT           NOT NULL PRIMARY KEY,   -- = dbo.WFCoupon.CouponID
        CouponNo      NVARCHAR(30)  NULL,
        SourceSOID    INT           NOT NULL,               -- = dbo.WFCoupon.DocuID (SOHD 104)
        SourceDocuNo  NVARCHAR(25)  NULL,
        CustId        NVARCHAR(20)  NULL,
        SalesEmpId    INT           NULL,
        GoodId        INT           NULL,
        IssuedTon     DECIMAL(18,3) NOT NULL,
        RemainingTon  DECIMAL(18,3) NOT NULL,
        GoodPrice     DECIMAL(18,2) NULL,
        LastSyncAt    DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_CouponMirror_CustId' AND object_id=OBJECT_ID('wf.CouponMirror'))
    CREATE INDEX IX_CouponMirror_CustId ON wf.CouponMirror (CustId);
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_CouponMirror_SalesEmpId' AND object_id=OBJECT_ID('wf.CouponMirror'))
    CREATE INDEX IX_CouponMirror_SalesEmpId ON wf.CouponMirror (SalesEmpId);
GO

IF OBJECT_ID('wf.CouponRedemptionMirror', 'U') IS NULL
BEGIN
    CREATE TABLE wf.CouponRedemptionMirror (
        RedemtionID    INT           NOT NULL,
        CouponID       INT           NOT NULL,
        AppliedSOInvID INT           NULL,                   -- = dbo.WFRedemtionDT.SOInvID (107)
        AppliedInvoiceNo NVARCHAR(25) NULL,
        RedeemedTon    DECIMAL(18,3) NOT NULL,
        RedeemedAt     DATETIME2     NULL,
        CONSTRAINT PK_CouponRedemptionMirror PRIMARY KEY (RedemtionID, CouponID)
    );
END
GO
