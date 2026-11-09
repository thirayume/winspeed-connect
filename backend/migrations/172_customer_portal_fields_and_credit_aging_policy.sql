-- ============================================================================
-- 172_customer_portal_fields_and_credit_aging_policy.sql
-- Customer portal contact fields (primary phone, secondary phone, email, Line ID)
-- Customer credit limit and AR aging limit (default 60 days)
-- System policy settings for Credit Limit & Aging Strict Mode
--
-- SQL 2008 R2 compatible, fully idempotent, wf schema additions only.
-- ============================================================================

-- ── 1. Enhance wf.CustomerExt with portal contact and credit/aging fields ───
IF COL_LENGTH('wf.CustomerExt', 'PrimaryPhone') IS NULL
    ALTER TABLE wf.CustomerExt ADD PrimaryPhone NVARCHAR(50) NULL;
GO

IF COL_LENGTH('wf.CustomerExt', 'SecondaryPhone') IS NULL
    ALTER TABLE wf.CustomerExt ADD SecondaryPhone NVARCHAR(255) NULL;
GO

IF COL_LENGTH('wf.CustomerExt', 'Email') IS NULL
    ALTER TABLE wf.CustomerExt ADD Email NVARCHAR(255) NULL;
GO

IF COL_LENGTH('wf.CustomerExt', 'LineId') IS NULL
    ALTER TABLE wf.CustomerExt ADD LineId NVARCHAR(100) NULL;
GO

IF COL_LENGTH('wf.CustomerExt', 'CreditLimit') IS NULL
    ALTER TABLE wf.CustomerExt ADD CreditLimit DECIMAL(18,2) NULL;
GO

IF COL_LENGTH('wf.CustomerExt', 'AgingDays') IS NULL
    ALTER TABLE wf.CustomerExt ADD AgingDays INT NULL CONSTRAINT DF_CustomerExt_AgingDays DEFAULT 60;
GO

-- ── 2. Enhance wf.CreditMaster with AgingDays ─────────────────────────────────
IF OBJECT_ID('wf.CreditMaster', 'U') IS NOT NULL
BEGIN
    IF COL_LENGTH('wf.CreditMaster', 'AgingDays') IS NULL
        ALTER TABLE wf.CreditMaster ADD AgingDays INT NULL CONSTRAINT DF_CreditMaster_AgingDays DEFAULT 60;
END
GO

-- ── 3. System Policy Settings for Credit Limit & Aging Strict Mode ───────────
IF OBJECT_ID('wf.SystemSetting', 'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM wf.SystemSetting WHERE SettingKey = 'CREDIT_LIMIT_STRICT_MODE')
        INSERT INTO wf.SystemSetting (SettingKey, SettingValue, Description)
        VALUES ('CREDIT_LIMIT_STRICT_MODE', 'false', N'บล็อกการเปิดบิลขายทันทีเมื่อเกินวงเงินเครดิต (true = บล็อก, false = แจ้งเตือนและบันทึกเหตุการณ์ผิดปกติ)');

    IF NOT EXISTS (SELECT 1 FROM wf.SystemSetting WHERE SettingKey = 'CREDIT_AGING_STRICT_MODE')
        INSERT INTO wf.SystemSetting (SettingKey, SettingValue, Description)
        VALUES ('CREDIT_AGING_STRICT_MODE', 'false', N'บล็อกการเปิดบิลขายทันทีเมื่อมีหนี้ค้างชำระเกินกำหนดวัน Aging (true = บล็อก, false = แจ้งเตือนและบันทึกเหตุการณ์ผิดปกติ)');

    IF NOT EXISTS (SELECT 1 FROM wf.SystemSetting WHERE SettingKey = 'CREDIT_AGING_DEFAULT_DAYS')
        INSERT INTO wf.SystemSetting (SettingKey, SettingValue, Description)
        VALUES ('CREDIT_AGING_DEFAULT_DAYS', '60', N'จำนวนวันเครดิต Aging สูงสุดตามนโยบายค่าเริ่มต้น (วัน, ค่าเริ่มต้น 60 วัน)');
END
GO

-- ── 4. Update wf.sp_MasterUpdateCustomer for full customer editing ───────────
IF OBJECT_ID('wf.sp_MasterUpdateCustomer', 'P') IS NULL
    EXEC('CREATE PROCEDURE wf.sp_MasterUpdateCustomer AS RETURN 0');
GO
ALTER PROCEDURE wf.sp_MasterUpdateCustomer
    @CustID   VARCHAR(20),
    @CustName NVARCHAR(255) = NULL,
    @Tel      NVARCHAR(50) = NULL,
    @Mobile   NVARCHAR(50) = NULL,
    @Affected INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    IF @CustName IS NOT NULL AND LTRIM(RTRIM(@CustName)) = ''
    BEGIN
        RAISERROR('ชื่อลูกค้าต้องไม่ว่าง', 16, 1);
        RETURN;
    END

    UPDATE dbo.EMCust
    SET CustName = COALESCE(@CustName, CustName),
        ContTel  = COALESCE(@Tel, ContTel),
        ContTel1 = COALESCE(@Mobile, ContTel1)
    WHERE CustID = @CustID;

    SET @Affected = @@ROWCOUNT;
END
GO

PRINT '✓ WF migration 172 complete (Customer portal fields, credit/aging policy settings)';
GO

