-- ══════════════════════════════════════════════════════════════
-- WF Schema Migration 002 (Refactor to Single Source of Truth)
-- ══════════════════════════════════════════════════════════════

BEGIN TRANSACTION;

-- 1. Drop existing FKs
DECLARE @sql NVARCHAR(MAX) = '';

-- Dynamically drop all foreign keys referencing wf.SalesOrder
SELECT @sql += 'ALTER TABLE ' + OBJECT_SCHEMA_NAME(parent_object_id) + '.' + OBJECT_NAME(parent_object_id) 
    + ' DROP CONSTRAINT ' + name + ';'
FROM sys.foreign_keys 
WHERE referenced_object_id = OBJECT_ID('wf.SalesOrder');

EXEC sp_executesql @sql;

IF OBJECT_ID('wf.GiveawayIssue', 'U') IS NOT NULL DROP TABLE wf.GiveawayIssue;
IF OBJECT_ID('wf.RebateLedger', 'U') IS NOT NULL DROP TABLE wf.RebateLedger;
IF OBJECT_ID('wf.SalesOrderAudit', 'U') IS NOT NULL DROP TABLE wf.SalesOrderAudit;
IF OBJECT_ID('wf.SalesOrderLine', 'U') IS NOT NULL DROP TABLE wf.SalesOrderLine;
IF OBJECT_ID('wf.SalesOrder', 'U') IS NOT NULL DROP TABLE wf.SalesOrder;

-- 2. Create Extension Tables
CREATE TABLE wf.SalesOrderExt (
  SOID              NVARCHAR(50)  PRIMARY KEY,
  WfRef             NVARCHAR(30)  NOT NULL UNIQUE,
  SoPrefix          NVARCHAR(5)   NOT NULL DEFAULT 'I',
  SalesUserId       INT           NULL REFERENCES wf.AppUser(Id),
  ControlTicketNo   NVARCHAR(20)  NULL,
  DeliveryDate      DATE          NULL,
  ImportFilePath    NVARCHAR(500) NULL,
  CreatedAt         DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
  UpdatedAt         DATETIME2     NOT NULL DEFAULT GETUTCDATE()
);

CREATE TABLE wf.SalesOrderLineExt (
  SOID              NVARCHAR(50)  NOT NULL,
  ListNo            INT           NOT NULL,
  NetPricePerTon    DECIMAL(12,2) NOT NULL DEFAULT 0,
  IsGiveaway        BIT           NOT NULL DEFAULT 0,
  RebateBooked      BIT           NOT NULL DEFAULT 0,
  CreatedAt         DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
  PRIMARY KEY (SOID, ListNo)
);

-- 3. Recreate RebateLedger linking to SOID
CREATE TABLE wf.RebateLedger (
  Id              INT IDENTITY(1,1) PRIMARY KEY,
  PoolId          INT           NOT NULL REFERENCES wf.RebatePool(Id),
  SOID            NVARCHAR(50)  NOT NULL,
  ListNo          INT           NULL,
  CustId          NVARCHAR(20)  NOT NULL,
  GoodId          NVARCHAR(20)  NOT NULL,
  GoodCode        NVARCHAR(50)  NOT NULL,
  QtyTon          DECIMAL(12,3) NOT NULL,
  PricePerTon     DECIMAL(12,2) NOT NULL,
  NetPricePerTon  DECIMAL(12,2) NOT NULL,
  RebatePerTon    DECIMAL(10,2) NOT NULL,
  RebateAmount    DECIMAL(12,2) NOT NULL,
  RemainingAmt    DECIMAL(12,2) NOT NULL,
  Status          NVARCHAR(20)  NOT NULL DEFAULT 'PENDING'
    CONSTRAINT chk_RL_Status CHECK (Status IN ('PENDING','CLAIMED','REVERSED')),
  ReversedFlag    BIT           NOT NULL DEFAULT 0,
  ReversedAt      DATETIME2     NULL,
  ReversedNote    NVARCHAR(300) NULL,
  CreatedAt       DATETIME2     NOT NULL DEFAULT GETUTCDATE()
);
CREATE INDEX IX_RebateLedger_Pool ON wf.RebateLedger(PoolId);
CREATE INDEX IX_RebateLedger_SOID ON wf.RebateLedger(SOID);

-- 4. Recreate SalesOrderAudit linking to SOID
CREATE TABLE wf.SalesOrderAudit (
  Id          INT IDENTITY(1,1) PRIMARY KEY,
  SOID        NVARCHAR(50)  NOT NULL,
  UserId      INT           NOT NULL REFERENCES wf.AppUser(Id),
  Action      NVARCHAR(50)  NOT NULL,
  FromStatus  NVARCHAR(20)  NULL,
  ToStatus    NVARCHAR(20)  NULL,
  Note        NVARCHAR(500) NULL,
  IpAddress   NVARCHAR(45)  NULL,
  CreatedAt   DATETIME2     NOT NULL DEFAULT GETUTCDATE()
);

-- 5. Recreate GiveawayIssue
CREATE TABLE wf.GiveawayIssue (
  Id            INT IDENTITY(1,1) PRIMARY KEY,
  BudgetId      INT           NOT NULL REFERENCES wf.GiveawayBudget(Id),
  SOID          NVARCHAR(50)  NULL,
  CustId        NVARCHAR(20)  NOT NULL,
  GoodId        NVARCHAR(20)  NOT NULL,
  GoodName      NVARCHAR(200) NOT NULL,
  Qty           INT           NOT NULL,
  UnitCost      DECIMAL(10,2) NULL,
  TotalCost     DECIMAL(12,2) NULL,
  Note          NVARCHAR(300) NULL,
  CreatedAt     DATETIME2     NOT NULL DEFAULT GETUTCDATE()
);

COMMIT;
