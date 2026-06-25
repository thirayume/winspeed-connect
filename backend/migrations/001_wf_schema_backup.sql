-- ══════════════════════════════════════════════════════════════
-- WF Schema Migration 001
-- DB: dbwins_worldfert9  |  Login: wf_owner (full on wf schema)
-- ⚠ ห้ามแก้ไข dbo — DDL นี้ไม่มี DROP/ALTER บน dbo เด็ดขาด
-- Run: sqlcmd -S .\SQLEXPRESS -U wf_owner -P <pwd> -d dbwins_worldfert9 -i 001_wf_schema.sql
-- ══════════════════════════════════════════════════════════════

-- ── Schema ────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'wf')
  EXEC('CREATE SCHEMA wf')
GO

-- ── Sequence for WfRef ────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = 'WfRefSeq' AND schema_id = SCHEMA_ID('wf'))
  CREATE SEQUENCE wf.WfRefSeq START WITH 1 INCREMENT BY 1
GO

-- ── AppUser ───────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AppUser' AND schema_id = SCHEMA_ID('wf'))
CREATE TABLE wf.AppUser (
  Id            INT IDENTITY(1,1) PRIMARY KEY,
  Username      NVARCHAR(50)  NOT NULL UNIQUE,
  PasswordHash  NVARCHAR(255) NOT NULL,
  DisplayName   NVARCHAR(100) NOT NULL,
  Role          NVARCHAR(30)  NOT NULL
    CONSTRAINT chk_AppUser_Role CHECK (Role IN (
      'ADMIN','SALES','COUNTER_SALES','WAREHOUSE','ACCOUNTING','MANAGER','APPROVER')),
  EmpId         NVARCHAR(20)  NULL,
  IsActive      BIT NOT NULL DEFAULT 1,
  CreatedAt     DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
  UpdatedAt     DATETIME2 NOT NULL DEFAULT GETUTCDATE()
)
GO

-- ── GoodExtra — ข้อมูลเสริมสินค้า (กระสอบ/ตัน) ───────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'GoodExtra' AND schema_id = SCHEMA_ID('wf'))
CREATE TABLE wf.GoodExtra (
  Id              INT IDENTITY(1,1) PRIMARY KEY,
  GoodId          NVARCHAR(20) NOT NULL UNIQUE,
  BagPerTon       INT          NOT NULL DEFAULT 20,
  WeightKgPerBag  DECIMAL(6,2) NOT NULL DEFAULT 50.0,
  Note            NVARCHAR(200) NULL,
  UpdatedAt       DATETIME2    NOT NULL DEFAULT GETUTCDATE()
)
GO

-- ── SalesOrder (wf) ──────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SalesOrder' AND schema_id = SCHEMA_ID('wf'))
CREATE TABLE wf.SalesOrder (
  Id                INT IDENTITY(1,1) PRIMARY KEY,
  WfRef             NVARCHAR(30)  NOT NULL UNIQUE,
  SoPrefix          NVARCHAR(5)   NOT NULL CONSTRAINT chk_SO_Prefix CHECK (SoPrefix IN ('I','K','AI')),
  CustId            NVARCHAR(20)  NOT NULL,
  CustName          NVARCHAR(200) NOT NULL,
  TruckPlate        NVARCHAR(30)  NULL,
  ControlTicketNo   NVARCHAR(20)  NULL,
  DeliveryDate      DATE          NULL,
  Remark            NVARCHAR(500) NULL,
  Status            NVARCHAR(20)  NOT NULL DEFAULT 'DRAFT'
    CONSTRAINT chk_SO_Status CHECK (Status IN ('DRAFT','CONFIRMED','PICKING','SHIPPED','IMPORTED','CANCELLED')),
  SalesUserId       INT           NULL REFERENCES wf.AppUser(Id),
  ImportFilePath    NVARCHAR(500) NULL,
  ImportedDocuNo    NVARCHAR(20)  NULL,
  ImportedAt        DATETIME2     NULL,
  CreatedAt         DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
  UpdatedAt         DATETIME2     NOT NULL DEFAULT GETUTCDATE()
)
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_SalesOrder_Status' AND object_id=OBJECT_ID('wf.SalesOrder'))
  CREATE INDEX IX_SalesOrder_Status   ON wf.SalesOrder(Status)
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_SalesOrder_CustId' AND object_id=OBJECT_ID('wf.SalesOrder'))
  CREATE INDEX IX_SalesOrder_CustId   ON wf.SalesOrder(CustId)
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_SalesOrder_SalesUser' AND object_id=OBJECT_ID('wf.SalesOrder'))
  CREATE INDEX IX_SalesOrder_SalesUser ON wf.SalesOrder(SalesUserId)
GO

-- ── SalesOrderLine ────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SalesOrderLine' AND schema_id = SCHEMA_ID('wf'))
CREATE TABLE wf.SalesOrderLine (
  Id              INT IDENTITY(1,1) PRIMARY KEY,
  SoId            INT           NOT NULL REFERENCES wf.SalesOrder(Id),
  LineNum         INT           NOT NULL,
  GoodId          NVARCHAR(20)  NOT NULL,
  GoodCode        NVARCHAR(50)  NOT NULL,
  GoodName        NVARCHAR(200) NOT NULL,
  QtyTon          DECIMAL(12,3) NOT NULL,
  QtyBag          INT           NOT NULL,
  PricePerTon     DECIMAL(12,2) NOT NULL,
  NetPricePerTon  DECIMAL(12,2) NOT NULL DEFAULT 0,
  LineAmount      AS (QtyTon * PricePerTon),
  RebatePerTon    AS (PricePerTon - NetPricePerTon),
  RebateAmount    AS (QtyTon * (PricePerTon - NetPricePerTon)),
  IsGiveaway      BIT           NOT NULL DEFAULT 0,
  RebateBooked    BIT           NOT NULL DEFAULT 0,
  CreatedAt       DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
  CONSTRAINT UQ_SOLine UNIQUE (SoId, LineNum)
)
GO

-- ── SalesOrderAudit ───────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SalesOrderAudit' AND schema_id = SCHEMA_ID('wf'))
CREATE TABLE wf.SalesOrderAudit (
  Id          INT IDENTITY(1,1) PRIMARY KEY,
  SoId        INT           NOT NULL REFERENCES wf.SalesOrder(Id),
  UserId      INT           NOT NULL REFERENCES wf.AppUser(Id),
  Action      NVARCHAR(50)  NOT NULL,
  FromStatus  NVARCHAR(20)  NULL,
  ToStatus    NVARCHAR(20)  NULL,
  Note        NVARCHAR(500) NULL,
  IpAddress   NVARCHAR(45)  NULL,
  CreatedAt   DATETIME2     NOT NULL DEFAULT GETUTCDATE()
)
GO

-- ── RebatePool ────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'RebatePool' AND schema_id = SCHEMA_ID('wf'))
CREATE TABLE wf.RebatePool (
  Id            INT IDENTITY(1,1) PRIMARY KEY,
  SalesUserId   INT           NOT NULL REFERENCES wf.AppUser(Id),
  PeriodYear    INT           NOT NULL,
  PeriodMonth   INT           NOT NULL,
  AccruedAmt    DECIMAL(14,2) NOT NULL DEFAULT 0,
  ClaimedAmt    DECIMAL(14,2) NOT NULL DEFAULT 0,
  AllocatedAmt  DECIMAL(14,2) NOT NULL DEFAULT 0,
  CreatedAt     DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
  UpdatedAt     DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
  CONSTRAINT UQ_RebatePool UNIQUE (SalesUserId, PeriodYear, PeriodMonth)
)
GO

-- ── RebateLedger ─────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'RebateLedger' AND schema_id = SCHEMA_ID('wf'))
CREATE TABLE wf.RebateLedger (
  Id              INT IDENTITY(1,1) PRIMARY KEY,
  PoolId          INT           NOT NULL REFERENCES wf.RebatePool(Id),
  SoId            INT           NOT NULL REFERENCES wf.SalesOrder(Id),
  SoLineId        INT           NULL,
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
)
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_RebateLedger_Pool' AND object_id=OBJECT_ID('wf.RebateLedger'))
  CREATE INDEX IX_RebateLedger_Pool   ON wf.RebateLedger(PoolId)
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_RebateLedger_SoId' AND object_id=OBJECT_ID('wf.RebateLedger'))
  CREATE INDEX IX_RebateLedger_SoId   ON wf.RebateLedger(SoId)
GO

-- ── RebateClaim ──────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'RebateClaim' AND schema_id = SCHEMA_ID('wf'))
CREATE TABLE wf.RebateClaim (
  Id            INT IDENTITY(1,1) PRIMARY KEY,
  PoolId        INT           NOT NULL REFERENCES wf.RebatePool(Id),
  SalesUserId   INT           NOT NULL REFERENCES wf.AppUser(Id),
  CustId        NVARCHAR(20)  NULL,
  ClaimAmt      DECIMAL(12,2) NOT NULL,
  RemainingAmt  DECIMAL(12,2) NOT NULL,
  Status        NVARCHAR(20)  NOT NULL DEFAULT 'PENDING'
    CONSTRAINT chk_RC_Status CHECK (Status IN ('PENDING','APPROVED')),
  CnDocuNo      NVARCHAR(20)  NULL,
  Note          NVARCHAR(500) NULL,
  ApprovedAt    DATETIME2     NULL,
  ApprovedBy    INT           NULL REFERENCES wf.AppUser(Id),
  CreatedAt     DATETIME2     NOT NULL DEFAULT GETUTCDATE()
)
GO

-- ── GiveawayBudget + GiveawayIssue ───────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'GiveawayBudget' AND schema_id = SCHEMA_ID('wf'))
CREATE TABLE wf.GiveawayBudget (
  Id            INT IDENTITY(1,1) PRIMARY KEY,
  SalesUserId   INT           NOT NULL REFERENCES wf.AppUser(Id),
  PeriodYear    INT           NOT NULL,
  PeriodMonth   INT           NOT NULL,
  TotalBudget   DECIMAL(12,2) NOT NULL DEFAULT 0,
  UsedAmt       DECIMAL(12,2) NOT NULL DEFAULT 0,
  RemainingAmt  AS (TotalBudget - UsedAmt),
  UpdatedAt     DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
  CONSTRAINT UQ_GiveawayBudget UNIQUE (SalesUserId, PeriodYear, PeriodMonth)
)
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'GiveawayIssue' AND schema_id = SCHEMA_ID('wf'))
CREATE TABLE wf.GiveawayIssue (
  Id            INT IDENTITY(1,1) PRIMARY KEY,
  BudgetId      INT           NOT NULL REFERENCES wf.GiveawayBudget(Id),
  SoId          INT           NULL REFERENCES wf.SalesOrder(Id),
  CustId        NVARCHAR(20)  NOT NULL,
  GoodId        NVARCHAR(20)  NOT NULL,
  GoodName      NVARCHAR(200) NOT NULL,
  Qty           INT           NOT NULL,
  UnitCost      DECIMAL(10,2) NULL,
  TotalCost     DECIMAL(12,2) NULL,
  Note          NVARCHAR(300) NULL,
  CreatedAt     DATETIME2     NOT NULL DEFAULT GETUTCDATE()
)
GO

-- ── READ-ONLY Views on dbo ────────────────────────────────────
-- wf_reader มีสิทธิ์ SELECT บนทั้ง DB แล้ว
-- views นี้ช่วย expose เฉพาะ field ที่ app ต้องการ

CREATE OR ALTER VIEW wf.v_Customer AS
SELECT CustID, CustName, ContTel AS Tel, ContTel1 AS Mobile
FROM dbo.EMCust WITH (NOLOCK)
GO

CREATE OR ALTER VIEW wf.v_FertGood AS
SELECT g.GoodID, g.GoodCode, g.GoodName1 AS GoodName,
       ISNULL(gx.BagPerTon, 20) AS BagPerTon,
       ISNULL(gx.WeightKgPerBag, 50.0) AS WeightKgPerBag
FROM dbo.EMGood g WITH (NOLOCK)
LEFT JOIN wf.GoodExtra gx ON gx.GoodId = g.GoodID
WHERE g.StockFlag = 'Y' AND g.MainGoodUnitID = 1002
GO

CREATE OR ALTER VIEW wf.v_CurrentPrice AS
SELECT hd.CustID, dt.ListID AS GoodID,
       dt.GoodPriceNet, hd.BeginDate, hd.EndDate,
       dt.startgoodqty, dt.endgoodqty
FROM dbo.EMSetPriceHD hd WITH (NOLOCK)
JOIN dbo.EMSetPriceDT dt WITH (NOLOCK) ON dt.SetPriceID = hd.SetPriceID
WHERE CAST(GETDATE() AS DATE) BETWEEN hd.BeginDate AND hd.EndDate
GO

CREATE OR ALTER VIEW wf.v_ControlTicket AS
SELECT h.SOID, h.DocuNo, h.DocuDate, h.CustID,
       h.CustName, h.TransRegistration AS TruckPlate,
       h.AppvFlag, h.AppvDocuNo, h.AppvDate, h.Desc1, h.Desc2
FROM dbo.SOHD h WITH (NOLOCK)
WHERE h.DocuType = 103 AND h.DocuStatus = 'Y'
GO

-- ── Grants ────────────────────────────────────────────────────
-- wf_reader: อ่าน wf views/tables ได้
GRANT SELECT ON SCHEMA::wf TO wf_reader
GO
-- wf_owner: อ่าน/เขียน/DDL เต็มเฉพาะ schema wf (เขียน dbo ไม่ได้ — ไม่มี datawriter)
GRANT CONTROL ON SCHEMA::wf TO wf_owner
GO

PRINT '✓ WF schema migration 001 complete'
GO
