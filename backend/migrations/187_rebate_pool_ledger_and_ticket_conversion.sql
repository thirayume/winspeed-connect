-- =============================================================================
-- Migration 187: Rebate Pool Ledger, Over-Limit Approval, Oct 31 Standing Price
--                & Manual FIFO Fertilizer Ticket Conversion
-- Compatible with SQL Server 2008 R2+ (R740-SRV Production) and 2022 (UAT)
-- =============================================================================

-- 1) Transaction Ledger supporting FIFO deductions, 12-month maturity, and manager approval
IF OBJECT_ID('wf.RebateTransactionLedger', 'U') IS NULL
BEGIN
  CREATE TABLE wf.RebateTransactionLedger (
    Id                         BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_RebateTransactionLedger PRIMARY KEY,
    LedgerCode                 VARCHAR(40) NOT NULL,
    SoId                       BIGINT NULL,
    SoLineId                   BIGINT NULL,
    DocNo                      NVARCHAR(40) NULL,
    CustId                     INT NOT NULL,
    CustCode                   VARCHAR(30) NULL,
    CustName                   NVARCHAR(200) NULL,
    GoodId                     INT NULL,
    GoodCode                   VARCHAR(40) NULL,
    GoodName                   NVARCHAR(200) NULL,
    QtyTons                    DECIMAL(14,4) NOT NULL,
    BasePrice                  DECIMAL(14,2) NOT NULL,
    SellingPrice               DECIMAL(14,2) NOT NULL,
    InvoiceUnitPrice           DECIMAL(14,2) NOT NULL,
    IsCashDiscount             BIT NOT NULL CONSTRAINT DF_RTL_IsCashDiscount DEFAULT (0),
    PricingMode                VARCHAR(40) NOT NULL,
    RebatePerTon               DECIMAL(14,2) NOT NULL CONSTRAINT DF_RTL_RebatePerTon DEFAULT (0),
    TotalRebateEarned          DECIMAL(18,2) NOT NULL CONSTRAINT DF_RTL_TotalRebateEarned DEFAULT (0),
    RemainingAmount            DECIMAL(18,2) NOT NULL CONSTRAINT DF_RTL_RemainingAmount DEFAULT (0),
    CompanyExtraProfitPerTon   DECIMAL(14,2) NOT NULL CONSTRAINT DF_RTL_ExtraProfitPerTon DEFAULT (0),
    TotalCompanyExtraProfit    DECIMAL(18,2) NOT NULL CONSTRAINT DF_RTL_TotalExtraProfit DEFAULT (0),
    RequiresManagerApproval    BIT NOT NULL CONSTRAINT DF_RTL_ReqMgrApproval DEFAULT (0),
    ExcessApprovalAmount       DECIMAL(14,2) NOT NULL CONSTRAINT DF_RTL_ExcessApprovalAmt DEFAULT (0),
    TotalExcessApprovalAmount  DECIMAL(18,2) NOT NULL CONSTRAINT DF_RTL_TotalExcessApprovalAmt DEFAULT (0),
    ApprovalStatus             VARCHAR(40) NOT NULL CONSTRAINT DF_RTL_ApprovalStatus DEFAULT ('NOT_REQUIRED'),
    ApprovedByUserId           INT NULL,
    ApprovedAt                 DATETIME NULL,
    ApprovalNote               NVARCHAR(500) NULL,
    EarnedDate                 DATE NOT NULL,
    CycleExpiryDate            DATE NOT NULL,
    MaturedAt                  DATETIME NULL,
    Status                     VARCHAR(40) NOT NULL CONSTRAINT DF_RTL_Status DEFAULT ('ACTIVE'),
    CreatedByUserId            INT NULL,
    CreatedAt                  DATETIME NOT NULL CONSTRAINT DF_RTL_CreatedAt DEFAULT (DATEADD(HOUR, 7, GETUTCDATE())),
    UpdatedAt                  DATETIME NOT NULL CONSTRAINT DF_RTL_UpdatedAt DEFAULT (DATEADD(HOUR, 7, GETUTCDATE())),
    CONSTRAINT UQ_RebateTransactionLedger_LedgerCode UNIQUE (LedgerCode)
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_RebateTransactionLedger_FIFO'
    AND object_id = OBJECT_ID('wf.RebateTransactionLedger')
)
BEGIN
  CREATE INDEX IX_RebateTransactionLedger_FIFO
    ON wf.RebateTransactionLedger (CustId, ApprovalStatus, Status, EarnedDate, CreatedAt, Id)
    INCLUDE (RemainingAmount, CycleExpiryDate, TotalRebateEarned, RebatePerTon, QtyTons);
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_RebateTransactionLedger_Approval'
    AND object_id = OBJECT_ID('wf.RebateTransactionLedger')
)
BEGIN
  CREATE INDEX IX_RebateTransactionLedger_Approval
    ON wf.RebateTransactionLedger (ApprovalStatus, CreatedAt DESC)
    INCLUDE (CustId, DocNo, ExcessApprovalAmount, TotalExcessApprovalAmount, RequiresManagerApproval);
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_RebateTransactionLedger_So'
    AND object_id = OBJECT_ID('wf.RebateTransactionLedger')
)
BEGIN
  CREATE INDEX IX_RebateTransactionLedger_So
    ON wf.RebateTransactionLedger (SoId, SoLineId);
END;

-- 2) Official Oct 31 Standing Price Snapshot
IF OBJECT_ID('wf.Oct31StandingPrice', 'U') IS NULL
BEGIN
  CREATE TABLE wf.Oct31StandingPrice (
    Id                BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Oct31StandingPrice PRIMARY KEY,
    StandingYear      INT NOT NULL,
    StandingDate      DATE NOT NULL,
    GoodId            INT NOT NULL,
    GoodCode          VARCHAR(40) NOT NULL,
    GoodName          NVARCHAR(200) NOT NULL,
    BasePrice         DECIMAL(14,2) NOT NULL,
    SourceType        VARCHAR(40) NOT NULL CONSTRAINT DF_O31_SourceType DEFAULT ('OCT31_SNAPSHOT'),
    SourcePriceBookId BIGINT NULL,
    PriceListCode     VARCHAR(40) NULL,
    Note              NVARCHAR(500) NULL,
    CapturedByUserId  INT NULL,
    CapturedAt        DATETIME NOT NULL CONSTRAINT DF_O31_CapturedAt DEFAULT (DATEADD(HOUR, 7, GETUTCDATE())),
    UpdatedAt         DATETIME NOT NULL CONSTRAINT DF_O31_UpdatedAt DEFAULT (DATEADD(HOUR, 7, GETUTCDATE())),
    CONSTRAINT UQ_Oct31StandingPrice_YearGood UNIQUE (StandingYear, GoodId)
  );
END;
GO

-- 3) Manual Fertilizer Ticket Conversion Header
IF OBJECT_ID('wf.FertilizerTicketConversion', 'U') IS NULL
BEGIN
  CREATE TABLE wf.FertilizerTicketConversion (
    Id                  BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_FertilizerTicketConversion PRIMARY KEY,
    ConversionNo        VARCHAR(40) NOT NULL,
    CustId              INT NOT NULL,
    CustCode            VARCHAR(30) NULL,
    CustName            NVARCHAR(200) NULL,
    StandingYear        INT NOT NULL,
    GoodId              INT NOT NULL,
    GoodCode            VARCHAR(40) NOT NULL,
    GoodName            NVARCHAR(200) NOT NULL,
    StandingPricePerTon DECIMAL(14,2) NOT NULL,
    ConvertedTons       DECIMAL(14,4) NOT NULL,
    ConvertedBags       INT NOT NULL,
    ConvertedValueBaht  DECIMAL(18,2) NOT NULL,
    ResidualBaht        DECIMAL(18,2) NOT NULL CONSTRAINT DF_FTC_ResidualBaht DEFAULT (0),
    ExecutionMode       VARCHAR(20) NOT NULL CONSTRAINT DF_FTC_ExecMode DEFAULT ('MANUAL'),
    ConvertedByUserId   INT NOT NULL,
    ConvertedByRole     VARCHAR(40) NOT NULL,
    ConvertedAt         DATETIME NOT NULL CONSTRAINT DF_FTC_ConvertedAt DEFAULT (DATEADD(HOUR, 7, GETUTCDATE())),
    Note                NVARCHAR(500) NULL,
    Status              VARCHAR(30) NOT NULL CONSTRAINT DF_FTC_Status DEFAULT ('ISSUED'),
    CONSTRAINT UQ_FertilizerTicketConversion_No UNIQUE (ConversionNo)
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_FertilizerTicketConversion_Cust'
    AND object_id = OBJECT_ID('wf.FertilizerTicketConversion')
)
BEGIN
  CREATE INDEX IX_FertilizerTicketConversion_Cust
    ON wf.FertilizerTicketConversion (CustId, StandingYear, ConvertedAt DESC);
END;

-- 4) FIFO Deduction Allocation Slices (supports Partial Deduction across entries)
IF OBJECT_ID('wf.FertilizerTicketConversionAllocation', 'U') IS NULL
BEGIN
  CREATE TABLE wf.FertilizerTicketConversionAllocation (
    Id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_FertilizerTicketConversionAllocation PRIMARY KEY,
    ConversionId    BIGINT NOT NULL CONSTRAINT FK_FTCA_Conversion FOREIGN KEY REFERENCES wf.FertilizerTicketConversion(Id),
    LedgerId        BIGINT NOT NULL CONSTRAINT FK_FTCA_Ledger FOREIGN KEY REFERENCES wf.RebateTransactionLedger(Id),
    DeductionOrder  INT NOT NULL,
    DeductedAmount  DECIMAL(18,2) NOT NULL,
    RemainingAfter  DECIMAL(18,2) NOT NULL,
    CreatedAt       DATETIME NOT NULL CONSTRAINT DF_FTCA_CreatedAt DEFAULT (DATEADD(HOUR, 7, GETUTCDATE()))
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_FertilizerTicketConversionAllocation_Conv'
    AND object_id = OBJECT_ID('wf.FertilizerTicketConversionAllocation')
)
BEGIN
  CREATE INDEX IX_FertilizerTicketConversionAllocation_Conv
    ON wf.FertilizerTicketConversionAllocation (ConversionId, DeductionOrder);
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_FertilizerTicketConversionAllocation_Ledger'
    AND object_id = OBJECT_ID('wf.FertilizerTicketConversionAllocation')
)
BEGIN
  CREATE INDEX IX_FertilizerTicketConversionAllocation_Ledger
    ON wf.FertilizerTicketConversionAllocation (LedgerId);
END;

-- 5) November 1st Maturity Conversion Alerts (idempotent yearly alert per customer)
IF OBJECT_ID('wf.RebateConversionAlert', 'U') IS NULL
BEGIN
  CREATE TABLE wf.RebateConversionAlert (
    Id                   BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_RebateConversionAlert PRIMARY KEY,
    AlertYear            INT NOT NULL,
    AlertDate            DATE NOT NULL,
    CustId               INT NOT NULL,
    CustCode             VARCHAR(30) NULL,
    CustName             NVARCHAR(200) NULL,
    MaturedBalance       DECIMAL(18,2) NOT NULL,
    EligibleLedgerCount  INT NOT NULL,
    Status               VARCHAR(30) NOT NULL CONSTRAINT DF_RCA_Status DEFAULT ('PENDING'),
    NotifiedAt           DATETIME NOT NULL CONSTRAINT DF_RCA_NotifiedAt DEFAULT (DATEADD(HOUR, 7, GETUTCDATE())),
    AcknowledgedByUserId INT NULL,
    AcknowledgedAt       DATETIME NULL,
    CONSTRAINT UQ_RebateConversionAlert_YearCust UNIQUE (AlertYear, CustId)
  );
END;
GO

-- 6) Policy, System Settings & RBAC Seeds (idempotent)
IF OBJECT_ID('wf.ApprovalPolicy', 'U') IS NOT NULL
BEGIN
  IF NOT EXISTS (SELECT 1 FROM wf.ApprovalPolicy WHERE CaseType = 'REBATE_OVER_LIMIT' AND IsActive = 1)
  BEGIN
    INSERT INTO wf.ApprovalPolicy (CaseType, MinAmount, MaxAmount, RequiredRole, EffectiveFrom, Note)
    VALUES ('REBATE_OVER_LIMIT', 200.01, 300.00, 'MANAGER', '2025-01-01', N'ขออนุมัติผู้จัดการเมื่อลดราคาจากราคากลางเกิน 200 ถึงสูงสุด 300 บาท/ตัน (Rebate Pool)');
  END;
END;
GO

IF OBJECT_ID('wf.SystemSetting', 'U') IS NOT NULL
BEGIN
  IF NOT EXISTS (SELECT 1 FROM wf.SystemSetting WHERE SettingKey = 'REBATE_STANDARD_LIMIT_PER_TON')
  BEGIN
    INSERT INTO wf.SystemSetting (SettingKey, SettingValue, Description)
    VALUES ('REBATE_STANDARD_LIMIT_PER_TON', '200', N'วงเงินส่วนลด Rebate Pool มาตรฐานที่ไม่ต้องขออนุมัติ (บาท/ตัน)');
  END;
  IF NOT EXISTS (SELECT 1 FROM wf.SystemSetting WHERE SettingKey = 'REBATE_MAX_LIMIT_PER_TON')
  BEGIN
    INSERT INTO wf.SystemSetting (SettingKey, SettingValue, Description)
    VALUES ('REBATE_MAX_LIMIT_PER_TON', '300', N'วงเงินส่วนลด Rebate Pool สูงสุดเมื่อได้รับอนุมัติจากผู้จัดการ (บาท/ตัน)');
  END;
  IF NOT EXISTS (SELECT 1 FROM wf.SystemSetting WHERE SettingKey = 'REBATE_CYCLE_MONTHS')
  BEGIN
    INSERT INTO wf.SystemSetting (SettingKey, SettingValue, Description)
    VALUES ('REBATE_CYCLE_MONTHS', '12', N'ระยะเวลารอบสะสม Rebate Pool ก่อนครบกำหนดแปลงตั๋วปุ๋ย (เดือน)');
  END;
END;
GO

IF OBJECT_ID('wf.RoleProfile', 'U') IS NOT NULL
BEGIN
  IF NOT EXISTS (SELECT 1 FROM wf.RoleProfile WHERE Code = 'REBATE_CONVERTER')
  BEGIN
    INSERT INTO wf.RoleProfile (Code, Name, BaseRole, DisabledActions, UpdatedBy)
    VALUES ('REBATE_CONVERTER', N'ผู้มีสิทธิ์แปลงตั๋วปุ๋ย Rebate Pool (1 พ.ย.)', 'ACCOUNTING', N'[]', 0);
  END;
END;
GO

IF OBJECT_ID('wf.RoleProfile', 'U') IS NOT NULL AND OBJECT_ID('wf.RolePermission', 'U') IS NOT NULL
BEGIN
  IF EXISTS (SELECT 1 FROM wf.RoleProfile WHERE Code = 'ACCOUNTING')
     AND NOT EXISTS (SELECT 1 FROM wf.RolePermission WHERE RoleCode = 'ACCOUNTING' AND PermissionCode = 'rebate.convert')
    INSERT INTO wf.RolePermission (RoleCode, PermissionCode) VALUES ('ACCOUNTING', 'rebate.convert');
  IF EXISTS (SELECT 1 FROM wf.RoleProfile WHERE Code = 'ADMIN')
     AND NOT EXISTS (SELECT 1 FROM wf.RolePermission WHERE RoleCode = 'ADMIN' AND PermissionCode = 'rebate.convert')
    INSERT INTO wf.RolePermission (RoleCode, PermissionCode) VALUES ('ADMIN', 'rebate.convert');
  IF EXISTS (SELECT 1 FROM wf.RoleProfile WHERE Code = 'REBATE_CONVERTER')
     AND NOT EXISTS (SELECT 1 FROM wf.RolePermission WHERE RoleCode = 'REBATE_CONVERTER' AND PermissionCode = 'rebate.convert')
    INSERT INTO wf.RolePermission (RoleCode, PermissionCode) VALUES ('REBATE_CONVERTER', 'rebate.convert');

  IF EXISTS (SELECT 1 FROM wf.RoleProfile WHERE Code = 'MANAGER')
     AND NOT EXISTS (SELECT 1 FROM wf.RolePermission WHERE RoleCode = 'MANAGER' AND PermissionCode = 'rebate.approve-over-limit')
    INSERT INTO wf.RolePermission (RoleCode, PermissionCode) VALUES ('MANAGER', 'rebate.approve-over-limit');
  IF EXISTS (SELECT 1 FROM wf.RoleProfile WHERE Code = 'C_LEVEL')
     AND NOT EXISTS (SELECT 1 FROM wf.RolePermission WHERE RoleCode = 'C_LEVEL' AND PermissionCode = 'rebate.approve-over-limit')
    INSERT INTO wf.RolePermission (RoleCode, PermissionCode) VALUES ('C_LEVEL', 'rebate.approve-over-limit');
  IF EXISTS (SELECT 1 FROM wf.RoleProfile WHERE Code = 'ADMIN')
     AND NOT EXISTS (SELECT 1 FROM wf.RolePermission WHERE RoleCode = 'ADMIN' AND PermissionCode = 'rebate.approve-over-limit')
    INSERT INTO wf.RolePermission (RoleCode, PermissionCode) VALUES ('ADMIN', 'rebate.approve-over-limit');
END;
GO

