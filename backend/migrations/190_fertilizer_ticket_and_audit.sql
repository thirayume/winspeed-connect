-- =============================================================================
-- Migration 190: Fertilizer Ticket (ตั๋วปุ๋ย), Ticket Redemption History,
--                & Rebate Audit/Override Log
-- Compatible with SQL Server 2008 R2+ (R740-SRV Production) and 2022 (UAT)
-- =============================================================================

-- 1) Fertilizer Ticket — issued to customer after FIFO Rebate conversion
--    Default validity is 90 days; the converter may select an expiry date. Tracks remaining tonnage for
--    partial redemption across orders. Supports extension workflow.
IF OBJECT_ID('wf.FertilizerTicket', 'U') IS NULL
BEGIN
  CREATE TABLE wf.FertilizerTicket (
    Id                     BIGINT IDENTITY(1,1) NOT NULL
      CONSTRAINT PK_FertilizerTicket PRIMARY KEY,
    TicketNo               VARCHAR(40)    NOT NULL,
    ConversionId           BIGINT         NULL
      CONSTRAINT FK_FT_Conversion FOREIGN KEY
        REFERENCES wf.FertilizerTicketConversion(Id),
    CustId                 INT            NOT NULL,
    CustCode               VARCHAR(30)    NULL,
    CustName               NVARCHAR(200)  NULL,
    GoodId                 INT            NOT NULL,
    GoodCode               VARCHAR(40)    NOT NULL,
    GoodName               NVARCHAR(200)  NOT NULL,
    Oct31ReferencePrice    DECIMAL(14,2)  NOT NULL,
    ConvertedRebateAmount  DECIMAL(18,2)  NOT NULL,
    IssuedTonnage          DECIMAL(14,4)  NOT NULL,
    RemainingTonnage       DECIMAL(14,4)  NOT NULL,
    IssuedDate             DATE           NOT NULL,
    ExpiryDate             DATE           NOT NULL,
    ExtendedExpiryDate     DATE           NULL,
    Status                 VARCHAR(30)    NOT NULL
      CONSTRAINT DF_FT_Status DEFAULT ('ACTIVE'),
    CreatedByUserId        INT            NULL,
    CreatedAt              DATETIME       NOT NULL
      CONSTRAINT DF_FT_CreatedAt DEFAULT (DATEADD(HOUR, 7, GETUTCDATE())),
    UpdatedAt              DATETIME       NOT NULL
      CONSTRAINT DF_FT_UpdatedAt DEFAULT (DATEADD(HOUR, 7, GETUTCDATE())),
    CONSTRAINT UQ_FertilizerTicket_TicketNo UNIQUE (TicketNo)
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_FertilizerTicket_Cust'
    AND object_id = OBJECT_ID('wf.FertilizerTicket')
)
BEGIN
  CREATE INDEX IX_FertilizerTicket_Cust
    ON wf.FertilizerTicket (CustId, Status, ExpiryDate ASC);
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_FertilizerTicket_Expiry'
    AND object_id = OBJECT_ID('wf.FertilizerTicket')
)
BEGIN
  CREATE INDEX IX_FertilizerTicket_Expiry
    ON wf.FertilizerTicket (ExpiryDate, Status)
    INCLUDE (ExtendedExpiryDate, RemainingTonnage, CustId);
END;
GO

-- 2) Ticket Redemption History — tracks each partial/full use of a ticket
IF OBJECT_ID('wf.TicketRedemptionHistory', 'U') IS NULL
BEGIN
  CREATE TABLE wf.TicketRedemptionHistory (
    Id                BIGINT IDENTITY(1,1) NOT NULL
      CONSTRAINT PK_TicketRedemptionHistory PRIMARY KEY,
    TicketId          BIGINT         NOT NULL
      CONSTRAINT FK_TRH_Ticket FOREIGN KEY
        REFERENCES wf.FertilizerTicket(Id),
    SoId              BIGINT         NULL,
    DocNo             NVARCHAR(40)   NULL,
    RedemptionOrder   INT            NOT NULL,
    RedeemedTonnage   DECIMAL(14,4)  NOT NULL,
    RemainingBefore   DECIMAL(14,4)  NOT NULL,
    RemainingAfter    DECIMAL(14,4)  NOT NULL,
    RedeemedByUserId  INT            NULL,
    RedeemedAt        DATETIME       NOT NULL
      CONSTRAINT DF_TRH_RedeemedAt DEFAULT (DATEADD(HOUR, 7, GETUTCDATE())),
    Note              NVARCHAR(500)  NULL
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_TicketRedemptionHistory_Ticket'
    AND object_id = OBJECT_ID('wf.TicketRedemptionHistory')
)
BEGIN
  CREATE INDEX IX_TicketRedemptionHistory_Ticket
    ON wf.TicketRedemptionHistory (TicketId, RedemptionOrder);
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_TicketRedemptionHistory_So'
    AND object_id = OBJECT_ID('wf.TicketRedemptionHistory')
)
BEGIN
  CREATE INDEX IX_TicketRedemptionHistory_So
    ON wf.TicketRedemptionHistory (SoId);
END;
GO

-- 3) Immutable Audit & Override Log — Executive override, Aging bypass, Ticket extension
IF OBJECT_ID('wf.RebateAuditAndOverrideLog', 'U') IS NULL
BEGIN
  CREATE TABLE wf.RebateAuditAndOverrideLog (
    Id                BIGINT IDENTITY(1,1) NOT NULL
      CONSTRAINT PK_RebateAuditAndOverrideLog PRIMARY KEY,
    AuditType         VARCHAR(40)    NOT NULL,
    EntityType        VARCHAR(40)    NOT NULL,
    EntityId          BIGINT         NULL,
    CustId            INT            NULL,
    ActionPerformed   VARCHAR(60)    NOT NULL,
    Reason            NVARCHAR(1000) NOT NULL,
    DetailsBefore     NVARCHAR(MAX)  NULL,
    DetailsAfter      NVARCHAR(MAX)  NULL,
    PerformedByUserId INT            NOT NULL,
    PerformedByRole   VARCHAR(40)    NULL,
    ApprovedByUserId  INT            NULL,
    ApprovedByRole    VARCHAR(40)    NULL,
    PerformedAt       DATETIME       NOT NULL
      CONSTRAINT DF_RAOL_PerformedAt DEFAULT (DATEADD(HOUR, 7, GETUTCDATE()))
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_RebateAuditAndOverrideLog_Entity'
    AND object_id = OBJECT_ID('wf.RebateAuditAndOverrideLog')
)
BEGIN
  CREATE INDEX IX_RebateAuditAndOverrideLog_Entity
    ON wf.RebateAuditAndOverrideLog (EntityType, EntityId, PerformedAt DESC);
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_RebateAuditAndOverrideLog_Cust'
    AND object_id = OBJECT_ID('wf.RebateAuditAndOverrideLog')
)
BEGIN
  CREATE INDEX IX_RebateAuditAndOverrideLog_Cust
    ON wf.RebateAuditAndOverrideLog (CustId, PerformedAt DESC);
END;
GO

-- 4) RBAC permission seeds for Ticket operations
IF OBJECT_ID('wf.RoleProfile', 'U') IS NOT NULL AND OBJECT_ID('wf.RolePermission', 'U') IS NOT NULL
BEGIN
  -- rebate.ticket-redeem: Redeem fertilizer tickets against orders
  IF EXISTS (SELECT 1 FROM wf.RoleProfile WHERE Code = 'COUNTER_SALES')
     AND NOT EXISTS (SELECT 1 FROM wf.RolePermission WHERE RoleCode = 'COUNTER_SALES' AND PermissionCode = 'rebate.ticket-redeem')
    INSERT INTO wf.RolePermission (RoleCode, PermissionCode) VALUES ('COUNTER_SALES', 'rebate.ticket-redeem');
  IF EXISTS (SELECT 1 FROM wf.RoleProfile WHERE Code = 'SALES')
     AND NOT EXISTS (SELECT 1 FROM wf.RolePermission WHERE RoleCode = 'SALES' AND PermissionCode = 'rebate.ticket-redeem')
    INSERT INTO wf.RolePermission (RoleCode, PermissionCode) VALUES ('SALES', 'rebate.ticket-redeem');
  IF EXISTS (SELECT 1 FROM wf.RoleProfile WHERE Code = 'ACCOUNTING')
     AND NOT EXISTS (SELECT 1 FROM wf.RolePermission WHERE RoleCode = 'ACCOUNTING' AND PermissionCode = 'rebate.ticket-redeem')
    INSERT INTO wf.RolePermission (RoleCode, PermissionCode) VALUES ('ACCOUNTING', 'rebate.ticket-redeem');
  IF EXISTS (SELECT 1 FROM wf.RoleProfile WHERE Code = 'ADMIN')
     AND NOT EXISTS (SELECT 1 FROM wf.RolePermission WHERE RoleCode = 'ADMIN' AND PermissionCode = 'rebate.ticket-redeem')
    INSERT INTO wf.RolePermission (RoleCode, PermissionCode) VALUES ('ADMIN', 'rebate.ticket-redeem');

  -- rebate.ticket-extend: Extend expired fertilizer tickets (Executive override)
  IF EXISTS (SELECT 1 FROM wf.RoleProfile WHERE Code = 'C_LEVEL')
     AND NOT EXISTS (SELECT 1 FROM wf.RolePermission WHERE RoleCode = 'C_LEVEL' AND PermissionCode = 'rebate.ticket-extend')
    INSERT INTO wf.RolePermission (RoleCode, PermissionCode) VALUES ('C_LEVEL', 'rebate.ticket-extend');
  IF EXISTS (SELECT 1 FROM wf.RoleProfile WHERE Code = 'ADMIN')
     AND NOT EXISTS (SELECT 1 FROM wf.RolePermission WHERE RoleCode = 'ADMIN' AND PermissionCode = 'rebate.ticket-extend')
    INSERT INTO wf.RolePermission (RoleCode, PermissionCode) VALUES ('ADMIN', 'rebate.ticket-extend');

  -- rebate.aging-override: Override aging block for conversion/redemption
  IF EXISTS (SELECT 1 FROM wf.RoleProfile WHERE Code = 'C_LEVEL')
     AND NOT EXISTS (SELECT 1 FROM wf.RolePermission WHERE RoleCode = 'C_LEVEL' AND PermissionCode = 'rebate.aging-override')
    INSERT INTO wf.RolePermission (RoleCode, PermissionCode) VALUES ('C_LEVEL', 'rebate.aging-override');
  IF EXISTS (SELECT 1 FROM wf.RoleProfile WHERE Code = 'MANAGER')
     AND NOT EXISTS (SELECT 1 FROM wf.RolePermission WHERE RoleCode = 'MANAGER' AND PermissionCode = 'rebate.aging-override')
    INSERT INTO wf.RolePermission (RoleCode, PermissionCode) VALUES ('MANAGER', 'rebate.aging-override');
  IF EXISTS (SELECT 1 FROM wf.RoleProfile WHERE Code = 'ADMIN')
     AND NOT EXISTS (SELECT 1 FROM wf.RolePermission WHERE RoleCode = 'ADMIN' AND PermissionCode = 'rebate.aging-override')
    INSERT INTO wf.RolePermission (RoleCode, PermissionCode) VALUES ('ADMIN', 'rebate.aging-override');
END;
GO

-- 5) System settings for Ticket validity
IF OBJECT_ID('wf.SystemSetting', 'U') IS NOT NULL
BEGIN
  IF NOT EXISTS (SELECT 1 FROM wf.SystemSetting WHERE SettingKey = 'TICKET_VALIDITY_DAYS')
  BEGIN
    INSERT INTO wf.SystemSetting (SettingKey, SettingValue, Description)
    VALUES ('TICKET_VALIDITY_DAYS', '90', N'จำนวนวันอายุการใช้งานตั๋วปุ๋ย (นับจากวันออก)');
  END;
  IF NOT EXISTS (SELECT 1 FROM wf.SystemSetting WHERE SettingKey = 'TICKET_EXPIRY_WARNING_DAYS')
  BEGIN
    INSERT INTO wf.SystemSetting (SettingKey, SettingValue, Description)
    VALUES ('TICKET_EXPIRY_WARNING_DAYS', '15', N'จำนวนวันก่อนหมดอายุตั๋วปุ๋ยที่จะแจ้งเตือน');
  END;
  IF NOT EXISTS (SELECT 1 FROM wf.SystemSetting WHERE SettingKey = 'CREDIT_AGING_REBATE_LIMIT_DAYS')
  BEGIN
    INSERT INTO wf.SystemSetting (SettingKey, SettingValue, Description)
    VALUES ('CREDIT_AGING_REBATE_LIMIT_DAYS', '60', N'จำนวนวันอายุหนี้สูงสุดที่อนุญาตให้แปลง/ใช้ตั๋วปุ๋ย');
  END;
END;
GO

