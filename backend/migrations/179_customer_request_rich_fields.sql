-- =============================================================
-- 179_customer_request_rich_fields.sql
--
-- 1. เพิ่มฟิลด์สำหรับคำขอเพิ่มลูกค้า (wf.CustomerRequest) ให้ครบถ้วน
--    สอดคล้องกับหน้าแก้ไขข้อมูลลูกค้า (Salesperson, Region, Group, Portal, Credit)
-- 2. ยืนยันคอลัมน์ EffectiveFrom, EffectiveTo ใน wf.PriceBook
-- =============================================================

-- ── 1. ขยายคอลัมน์ใน wf.CustomerRequest ──
IF OBJECT_ID('wf.CustomerRequest', 'U') IS NOT NULL
BEGIN
    IF COL_LENGTH('wf.CustomerRequest', 'SalespersonUserId') IS NULL
        ALTER TABLE wf.CustomerRequest ADD SalespersonUserId INT NULL;

    IF COL_LENGTH('wf.CustomerRequest', 'SalespersonName') IS NULL
        ALTER TABLE wf.CustomerRequest ADD SalespersonName NVARCHAR(100) NULL;

    IF COL_LENGTH('wf.CustomerRequest', 'RegionCode') IS NULL
        ALTER TABLE wf.CustomerRequest ADD RegionCode NVARCHAR(20) NULL;

    IF COL_LENGTH('wf.CustomerRequest', 'CustGroupId') IS NULL
        ALTER TABLE wf.CustomerRequest ADD CustGroupId NVARCHAR(50) NULL;

    IF COL_LENGTH('wf.CustomerRequest', 'CustGroupName') IS NULL
        ALTER TABLE wf.CustomerRequest ADD CustGroupName NVARCHAR(100) NULL;

    IF COL_LENGTH('wf.CustomerRequest', 'Email') IS NULL
        ALTER TABLE wf.CustomerRequest ADD Email NVARCHAR(100) NULL;

    IF COL_LENGTH('wf.CustomerRequest', 'LineId') IS NULL
        ALTER TABLE wf.CustomerRequest ADD LineId NVARCHAR(100) NULL;

    IF COL_LENGTH('wf.CustomerRequest', 'CreditLimit') IS NULL
        ALTER TABLE wf.CustomerRequest ADD CreditLimit DECIMAL(18,2) NULL;

    IF COL_LENGTH('wf.CustomerRequest', 'AgingDays') IS NULL
        ALTER TABLE wf.CustomerRequest ADD AgingDays INT NULL CONSTRAINT DF_CustReq_Aging DEFAULT 60;

    IF COL_LENGTH('wf.CustomerRequest', 'CreditHold') IS NULL
        ALTER TABLE wf.CustomerRequest ADD CreditHold BIT NULL CONSTRAINT DF_CustReq_Hold DEFAULT 0;
END
GO

-- ── 2. ยืนยันคอลัมน์ช่วงวันที่รายสัปดาห์ใน wf.PriceBook ──
IF OBJECT_ID('wf.PriceBook', 'U') IS NOT NULL
BEGIN
    IF COL_LENGTH('wf.PriceBook', 'EffectiveFrom') IS NULL
        ALTER TABLE wf.PriceBook ADD EffectiveFrom DATE NULL;

    IF COL_LENGTH('wf.PriceBook', 'EffectiveTo') IS NULL
        ALTER TABLE wf.PriceBook ADD EffectiveTo DATE NULL;
END
GO

