-- ══════════════════════════════════════════════════════════════
-- WF Migration 002 — Giveaway (qty model จาก xls) + Quotation + PaperTrail
-- ⚠ ทุก object อยู่ใน schema wf เท่านั้น — ไม่แตะ dbo
-- Run: sqlcmd -S .\SQLEXPRESS -U wf_owner -P <pwd> -d dbwins_worldfert9 -i 002_*.sql
-- ══════════════════════════════════════════════════════════════

-- ── ลบ giveaway model เดิม (baht-based, test-only ของ session นี้) ──
-- GiveawayIssue อ้าง GiveawayBudget → ลบ child ก่อน
IF OBJECT_ID('wf.GiveawayIssue','U') IS NOT NULL DROP TABLE wf.GiveawayIssue
GO
IF OBJECT_ID('wf.GiveawayBudget','U') IS NOT NULL DROP TABLE wf.GiveawayBudget
GO

-- ── GiveawayItem — แคตตาล็อกของแถม (ตรา × รายการ) ─────────────
IF OBJECT_ID('wf.GiveawayItem','U') IS NULL
CREATE TABLE wf.GiveawayItem (
  Id        INT IDENTITY(1,1) PRIMARY KEY,
  Brand     NVARCHAR(50)  NOT NULL,   -- รถเกษตร / ปุ๋ยเทพ
  ItemName  NVARCHAR(100) NOT NULL,   -- "16-8-8" / "เสื้อยืดแขนยาว" / "แบนเนอร์ รถเกษตร"
  ItemType  NVARCHAR(20)  NOT NULL    -- BAG / SHIRT / BANNER / OTHER
    CONSTRAINT chk_GItem_Type CHECK (ItemType IN ('BAG','SHIRT','BANNER','OTHER')),
  CreatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
  CONSTRAINT UQ_GItem UNIQUE (Brand, ItemName)
)
GO

-- ── GiveawayBudget — งบ "จำนวนชิ้น" ต่อ พนักงาน(ภาค) × ตรา × รายการ ──
IF OBJECT_ID('wf.GiveawayBudget','U') IS NULL
CREATE TABLE wf.GiveawayBudget (
  Id          INT IDENTITY(1,1) PRIMARY KEY,
  SalesUserId INT           NULL REFERENCES wf.AppUser(Id),
  EmpId       NVARCHAR(20)  NULL,        -- EMEmp.EmpID (resolve จาก EmpCode ใน xls)
  EmpCode     NVARCHAR(20)  NULL,        -- EMP-xxxxx
  Region      NVARCHAR(60)  NOT NULL,    -- ภาคเหนือ
  PeriodYear  INT           NOT NULL,    -- 2569
  Brand       NVARCHAR(50)  NOT NULL,
  ItemName    NVARCHAR(100) NOT NULL,
  BudgetQty   DECIMAL(12,2) NOT NULL DEFAULT 0,
  CreatedAt   DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
  UpdatedAt   DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
  CONSTRAINT UQ_GBudget UNIQUE (Region, PeriodYear, Brand, ItemName)
)
GO
CREATE INDEX IX_GBudget_Emp ON wf.GiveawayBudget(EmpId, PeriodYear)
GO

-- ── GiveawayWithdrawal — log การเบิก (รายเดือน) ───────────────
IF OBJECT_ID('wf.GiveawayWithdrawal','U') IS NULL
CREATE TABLE wf.GiveawayWithdrawal (
  Id          INT IDENTITY(1,1) PRIMARY KEY,
  SalesUserId INT           NULL REFERENCES wf.AppUser(Id),
  EmpId       NVARCHAR(20)  NULL,
  EmpCode     NVARCHAR(20)  NULL,
  Region      NVARCHAR(60)  NOT NULL,
  PeriodYear  INT           NOT NULL,
  IssueMonth  INT           NULL,        -- 1-12 (จาก Feb-69 → 2)
  Brand       NVARCHAR(50)  NOT NULL,
  ItemName    NVARCHAR(100) NOT NULL,
  Qty         DECIMAL(12,2) NOT NULL,
  CustId      NVARCHAR(20)  NULL,
  SoId        INT           NULL REFERENCES wf.SalesOrder(Id),
  Note        NVARCHAR(300) NULL,
  Source      NVARCHAR(20)  NOT NULL DEFAULT 'APP'   -- IMPORT (จาก xls) / APP (กรอกใหม่)
    CONSTRAINT chk_GWd_Source CHECK (Source IN ('IMPORT','APP')),
  CreatedAt   DATETIME2 NOT NULL DEFAULT GETUTCDATE()
)
GO
CREATE INDEX IX_GWd_Region ON wf.GiveawayWithdrawal(Region, PeriodYear, Brand, ItemName)
GO

-- ── View: งบ + เบิก + คงเหลือ (รวม withdrawal) ────────────────
CREATE OR ALTER VIEW wf.v_GiveawayBudgetStatus AS
SELECT b.Id, b.SalesUserId, b.EmpId, b.EmpCode, b.Region, b.PeriodYear,
       b.Brand, b.ItemName, b.BudgetQty,
       ISNULL(w.Withdrawn, 0)                AS WithdrawnQty,
       b.BudgetQty - ISNULL(w.Withdrawn, 0)  AS RemainingQty
FROM wf.GiveawayBudget b
OUTER APPLY (
  SELECT SUM(Qty) AS Withdrawn FROM wf.GiveawayWithdrawal w
  WHERE w.Region = b.Region AND w.PeriodYear = b.PeriodYear
    AND w.Brand = b.Brand AND w.ItemName = b.ItemName
) w
GO

-- ══════════════════════════════════════════════════════════════
-- Quotation (ใบเสนอราคา)
-- ══════════════════════════════════════════════════════════════
IF OBJECT_ID('wf.Quotation','U') IS NULL
CREATE TABLE wf.Quotation (
  Id           INT IDENTITY(1,1) PRIMARY KEY,
  QuoteNo      NVARCHAR(30)  NOT NULL UNIQUE,
  CustId       NVARCHAR(20)  NOT NULL,
  CustName     NVARCHAR(200) NOT NULL,
  ValidUntil   DATE          NULL,
  Status       NVARCHAR(20)  NOT NULL DEFAULT 'DRAFT'
    CONSTRAINT chk_Quote_Status CHECK (Status IN ('DRAFT','SENT','ACCEPTED','CONVERTED','EXPIRED','CANCELLED')),
  SalesUserId  INT           NULL REFERENCES wf.AppUser(Id),
  ConvertedSoId INT          NULL REFERENCES wf.SalesOrder(Id),
  Remark       NVARCHAR(500) NULL,
  CreatedAt    DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
  UpdatedAt    DATETIME2 NOT NULL DEFAULT GETUTCDATE()
)
GO

IF OBJECT_ID('wf.QuotationLine','U') IS NULL
CREATE TABLE wf.QuotationLine (
  Id             INT IDENTITY(1,1) PRIMARY KEY,
  QuoteId        INT           NOT NULL REFERENCES wf.Quotation(Id),
  LineNum        INT           NOT NULL,
  GoodId         NVARCHAR(20)  NOT NULL,
  GoodCode       NVARCHAR(50)  NOT NULL,
  GoodName       NVARCHAR(200) NOT NULL,
  QtyTon         DECIMAL(12,3) NOT NULL,
  PricePerTon    DECIMAL(12,2) NOT NULL,
  NetPricePerTon DECIMAL(12,2) NOT NULL DEFAULT 0,
  LineAmount     AS (QtyTon * PricePerTon),
  CONSTRAINT UQ_QuoteLine UNIQUE (QuoteId, LineNum)
)
GO
CREATE SEQUENCE wf.QuoteRefSeq AS INT START WITH 1 INCREMENT BY 1
GO

-- ══════════════════════════════════════════════════════════════
-- Paper Trail — ติดตามสำเนาเอกสาร 4 สี (เสริมจาก SO status)
-- ══════════════════════════════════════════════════════════════
IF OBJECT_ID('wf.PaperTrail','U') IS NULL
CREATE TABLE wf.PaperTrail (
  Id         INT IDENTITY(1,1) PRIMARY KEY,
  SoId       INT           NOT NULL REFERENCES wf.SalesOrder(Id),
  Stage      NVARCHAR(20)  NOT NULL,   -- ตรงกับ SO Status (snapshot ความเคลื่อนไหวกระดาษ)
  CopyColor  NVARCHAR(20)  NULL,       -- ขาว/ฟ้า/ชมพู/เหลือง
  HolderUserId INT         NULL REFERENCES wf.AppUser(Id),
  Note       NVARCHAR(300) NULL,
  CreatedAt  DATETIME2 NOT NULL DEFAULT GETUTCDATE()
)
GO
CREATE INDEX IX_PaperTrail_So ON wf.PaperTrail(SoId)
GO

-- ── Grants (ให้ wf_reader อ่าน object ใหม่; wf_owner มี CONTROL อยู่แล้ว) ──
GRANT SELECT ON SCHEMA::wf TO wf_reader
GO

PRINT '✓ WF migration 002 complete (Giveaway qty model + Quotation + PaperTrail)'
GO
