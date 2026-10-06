-- Migration 140: Coupon Expiry Tracking & Warning Settings (R6 §1.5 / D1)
-- Stores non-blocking ticket expiry dates and warning settings outside dbo.WFCoupon.
-- UNAPPLIED — pending owner decision and migrator execution.

-- 1. Create wf.CouponExpiry table
IF OBJECT_ID('wf.CouponExpiry', 'U') IS NULL
BEGIN
    CREATE TABLE wf.CouponExpiry (
        CouponId INT NOT NULL PRIMARY KEY,
        ExpiryDate DATE NOT NULL,
        Source VARCHAR(20) NOT NULL CONSTRAINT DF_CouponExpiry_Source_140 DEFAULT 'DEFAULT',
        SetBy INT NULL,
        SetAt DATETIME2 NOT NULL CONSTRAINT DF_CouponExpiry_SetAt_140 DEFAULT GETUTCDATE(),
        Note NVARCHAR(255) NULL,
        UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_CouponExpiry_UpdatedAt_140 DEFAULT GETUTCDATE()
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CouponExpiry_Date' AND object_id = OBJECT_ID('wf.CouponExpiry'))
BEGIN
    CREATE INDEX IX_CouponExpiry_Date ON wf.CouponExpiry (ExpiryDate);
END
GO

-- 2. Seed System Settings for Ticket Expiry (defaults: 180 days validity, 30 days warning lead time)
IF OBJECT_ID('wf.SystemSetting', 'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM wf.SystemSetting WHERE SettingKey = 'TICKET_EXPIRY_DEFAULT_DAYS')
    BEGIN
        INSERT INTO wf.SystemSetting (SettingKey, SettingValue, Description, UpdatedAt)
        VALUES ('TICKET_EXPIRY_DEFAULT_DAYS', '180', N'จำนวนวันอายุตั๋วปุ๋ยปริยายหลังเปิดบิล (วัน)', GETUTCDATE());
    END

    IF NOT EXISTS (SELECT 1 FROM wf.SystemSetting WHERE SettingKey = 'TICKET_EXPIRY_WARNING_LEAD_DAYS')
    BEGIN
        INSERT INTO wf.SystemSetting (SettingKey, SettingValue, Description, UpdatedAt)
        VALUES ('TICKET_EXPIRY_WARNING_LEAD_DAYS', '30', N'จำนวนวันแจ้งเตือนล่วงหน้าก่อนตั๋วปุ๋ยหมดอายุ (วัน)', GETUTCDATE());
    END
END
GO
