-- ============================================================
-- wf_schema.sql  —  DDL สำหรับ schema wf (World Fert web app)
-- DB: dbwins_worldfert9 (SQL Server 2022)  |  ปรับ: 2026-06-06 (v3.0)
--
-- สถาปัตยกรรม: SQL Server เดียวเท่านั้น — schema wf สร้างใน DB เดียวกันกับ dbo
--   ไม่ใช้ PostgreSQL / Redis / Message Queue  (เน้นความเรียบง่าย)
--   wf กับ dbo อยู่ DB เดียวกัน → JOIN ข้าม schema ได้ตรง ไม่ต้อง sync/cache
--
-- กฎเหล็ก: เขียนได้เฉพาะ schema wf  |  dbo = READ-ONLY (ห้ามเขียนตารางบัญชี dbo เด็ดขาด)
--   การออกใบกำกับ/CN ทำผ่าน "ฟีเจอร์ Import ของ WINSpeed" → WINSpeed ลงบัญชีเอง (มติ D-03 แนวทาง B)
-- Collation: NVARCHAR (Thai_CI_AS / DB default) สำหรับข้อความไทย
-- ทศนิยม: qtyTon/price = DECIMAL(18,4) (ตรง dbo.SOInvDT.GoodQty2/GoodPrice2)
-- ราคา NET: JOIN ตรงไป dbo.EMSetPriceDT.GoodPriceNet (ICPriceHD/DT ว่าง)
-- หน่วย:    GoodUnitID=1002 = ตัน (ไม่มี conversion ตัน↔กระสอบ ใน dbo)
-- GL:       Dr 1037 ลูกหนี้-ค้างส่ง / Cr 1120 ขายสินค้า-เงินเชื่อ; ปุ๋ยยกเว้น VAT
-- CN/DN:    CN 109 ใช้ RefSOID, DN 110 ใช้ RefNo (RefSOID=NULL)
--
-- ข้าม schema: อ้าง dbo ด้วย JOIN/View ตรง (soft reference, ไม่สร้าง FK ไป dbo
--   เพราะ dbo จัดการโดย WINSpeed/READ-ONLY) — master ไม่ต้อง copy/cache
-- ⚠ อย่า execute จนกว่าจะยืนยันกับ owner (ใช้ login wf_owner)
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'wf')
    EXEC('CREATE SCHEMA wf');
GO

-- ============================================================
-- SECTION 1: Supplement Master (ข้อมูลเสริมที่ dbo ไม่มี — ไม่ใช่ cache)
-- ============================================================

-- 1a. wf.GoodExtra — ข้อมูลเสริมสินค้าที่ dbo ไม่เก็บ (BagPerTon)
CREATE TABLE wf.GoodExtra (
    GoodID          INT              NOT NULL,   -- soft ref → dbo.EMGood.GoodID
    BagPerTon       DECIMAL(10,4)    NOT NULL CONSTRAINT DF_GoodExtra_Bag DEFAULT 20.0,  -- 1 ตัน = 20 กระสอบ (50 กก.)
    WeightKgPerBag  DECIMAL(10,4)    NOT NULL CONSTRAINT DF_GoodExtra_Kg DEFAULT 50.0,
    Brand           NVARCHAR(50)     NULL,       -- รถเกษตร / ปุ๋ยเทพ
    Remark          NVARCHAR(500)    NULL,
    UpdatedAt       DATETIME2        NOT NULL CONSTRAINT DF_GoodExtra_Upd DEFAULT SYSDATETIME(),
    UpdatedBy       NVARCHAR(100)    NULL,
    CONSTRAINT PK_wf_GoodExtra PRIMARY KEY (GoodID)
);
GO

-- 1b. wf.CustomerCredit — Credit Master (WS ไม่มี: EMCust.CreditAmnt=0 ทุกราย)
CREATE TABLE wf.CustomerCredit (
    CustID          INT              NOT NULL,   -- soft ref → dbo.EMCust.CustID
    CreditLimit     DECIMAL(18,4)    NOT NULL CONSTRAINT DF_CustCredit_Lim DEFAULT 0,
    CreditDays      INT              NOT NULL CONSTRAINT DF_CustCredit_Days DEFAULT 0,
    OnHoldFlag      BIT              NOT NULL CONSTRAINT DF_CustCredit_Hold DEFAULT 0,
    Remark          NVARCHAR(500)    NULL,
    UpdatedAt       DATETIME2        NOT NULL CONSTRAINT DF_CustCredit_Upd DEFAULT SYSDATETIME(),
    CONSTRAINT PK_wf_CustomerCredit PRIMARY KEY (CustID)
);
GO

-- 1c. wf.PriceBook — ราคา NET รายเดือนต่อสูตร (อ้าง EMSetPriceDT เป็นฐาน)
CREATE TABLE wf.PriceBook (
    PriceBookID     INT IDENTITY(1,1) NOT NULL,
    GoodID          INT              NOT NULL,   -- soft ref → dbo.EMGood.GoodID
    Formula         NVARCHAR(50)     NULL,       -- สูตร เช่น 15-5-35
    YearMonth       CHAR(7)          NOT NULL,   -- 'YYYY-MM'
    NetPricePerTon  DECIMAL(18,4)    NOT NULL,   -- บาท/ตัน (เทียบ EMSetPriceDT.GoodPriceNet)
    DiscontinuedFlag BIT             NOT NULL CONSTRAINT DF_PriceBook_Disc DEFAULT 0,
    Version         INT              NOT NULL CONSTRAINT DF_PriceBook_Ver DEFAULT 1,
    CreatedAt       DATETIME2        NOT NULL CONSTRAINT DF_PriceBook_Cr DEFAULT SYSDATETIME(),
    CreatedBy       NVARCHAR(100)    NULL,
    CONSTRAINT PK_wf_PriceBook PRIMARY KEY (PriceBookID),
    CONSTRAINT UQ_wf_PriceBook UNIQUE (GoodID, YearMonth, Version)
);
GO

-- ============================================================
-- SECTION 2: Sales Order Domain
-- ============================================================

-- 2a. wf.SalesOrder — ใบสั่งขายในระบบใหม่ (State Machine)
CREATE TABLE wf.SalesOrder (
    SalesOrderID    INT IDENTITY(1,1) NOT NULL,
    SoNo            NVARCHAR(30)     NULL,        -- เลขเอกสาร (รับจาก/sync WS)
    CustomerID      INT              NOT NULL,    -- soft ref → dbo.EMCust.CustID
    SalesID         INT              NOT NULL,    -- soft ref → dbo.EMEmp.EmpID
    BranchID        SMALLINT         NOT NULL CONSTRAINT DF_SO_Brch DEFAULT 1,
    SaleAreaID      INT              NULL,        -- soft ref → dbo.EMSaleArea
    Status          VARCHAR(12)      NOT NULL CONSTRAINT DF_SO_Status DEFAULT 'DRAFT',
        -- DRAFT → CONFIRMED → PICKING → SHIPPED  (CANCELLED)
    QuotationNo     NVARCHAR(30)     NULL,
    AppQuoLimit     DECIMAL(18,4)    NULL,        -- ยอดวงเงินตามใบเสนอราคา
    TruckReg        NVARCHAR(50)     NULL,        -- ทะเบียนรถ (= SOHD.TransRegistration)
    WeighControlNo  NVARCHAR(30)     NULL,        -- ตั๋วคุม (= SOHD.AppvDocuNo 'AI...')
    TotalAmount     DECIMAL(18,4)    NOT NULL CONSTRAINT DF_SO_Total DEFAULT 0,
    VerifiedBy      NVARCHAR(100)    NULL,        -- Counter-Sales verification gate
    VerifiedAt      DATETIME2        NULL,
    -- mirror keys หลัง sync เข้า WS (soft ref, ไม่มี FK ข้าม schema)
    WsSOID          INT              NULL,        -- → dbo.SOHD.SOID
    WsSOInvID       INT              NULL,        -- → dbo.SOInvHD.SOInvID
    WsDocuNo        NVARCHAR(30)     NULL,        -- → dbo.SOInvHD.DocuNo
    SyncStatus      VARCHAR(8)       NOT NULL CONSTRAINT DF_SO_Sync DEFAULT 'NONE',  -- NONE / SYNCED
    CreatedAt       DATETIME2        NOT NULL CONSTRAINT DF_SO_Cr DEFAULT SYSDATETIME(),
    CreatedBy       NVARCHAR(100)    NULL,
    UpdatedAt       DATETIME2        NOT NULL CONSTRAINT DF_SO_Upd DEFAULT SYSDATETIME(),
    CONSTRAINT PK_wf_SalesOrder PRIMARY KEY (SalesOrderID)
);
GO

-- 2b. wf.SalesOrderLine — รายการสินค้า (+ ลำดับแม่-ลูก + ของแถม)
CREATE TABLE wf.SalesOrderLine (
    SalesOrderID    INT              NOT NULL,    -- FK → wf.SalesOrder
    LineNo          INT              NOT NULL,
    GoodID          INT              NULL,        -- soft ref → dbo.EMGood (NULL = misc/service)
    Formula         NVARCHAR(50)     NULL,
    QtyTon          DECIMAL(18,4)    NOT NULL,    -- ปริมาณ (ตัน)
    UnitPrice       DECIMAL(18,4)    NOT NULL CONSTRAINT DF_SOL_Price DEFAULT 0,  -- บาท/ตัน (0 = ของแถม)
    IsGiveaway      AS (CASE WHEN UnitPrice = 0 AND GoodID IS NOT NULL THEN 1 ELSE 0 END),
    MotherBaby      VARCHAR(6)       NULL,        -- MOTHER / BABY
    LoadSeq         INT              NULL,        -- ลำดับโหลด
    RebateAccrual   DECIMAL(18,4)    NOT NULL CONSTRAINT DF_SOL_Reb DEFAULT 0,
    LineAmount      AS CAST(QtyTon * UnitPrice AS DECIMAL(18,4)),
    CONSTRAINT PK_wf_SalesOrderLine PRIMARY KEY (SalesOrderID, LineNo),
    CONSTRAINT FK_wf_SOL_SO FOREIGN KEY (SalesOrderID) REFERENCES wf.SalesOrder(SalesOrderID)
);
GO

-- 2c. wf.SalesOrderAudit — บันทึกทุก transition (immutable)
CREATE TABLE wf.SalesOrderAudit (
    AuditID         BIGINT IDENTITY(1,1) NOT NULL,
    SalesOrderID    INT              NOT NULL,    -- FK → wf.SalesOrder
    Actor           NVARCHAR(100)    NOT NULL,
    Action          NVARCHAR(50)     NOT NULL,    -- CREATE/CONFIRM/UNLOCK/SHIP/CANCEL...
    BeforeJson      NVARCHAR(MAX)    NULL,
    AfterJson       NVARCHAR(MAX)    NULL,
    IP              NVARCHAR(45)     NULL,
    Timestamp       DATETIME2        NOT NULL CONSTRAINT DF_SOAudit_Ts DEFAULT SYSDATETIME(),
    CONSTRAINT PK_wf_SalesOrderAudit PRIMARY KEY (AuditID),
    CONSTRAINT FK_wf_SOAudit_SO FOREIGN KEY (SalesOrderID) REFERENCES wf.SalesOrder(SalesOrderID)
);
GO

-- 2d. wf.UnlockRequest — ขอปลดล็อก SO (Confirmed/Picking → Draft)
CREATE TABLE wf.UnlockRequest (
    UnlockID        INT IDENTITY(1,1) NOT NULL,
    SalesOrderID    INT              NOT NULL,    -- FK → wf.SalesOrder
    Reason          NVARCHAR(500)    NOT NULL,    -- ≥10 ตัวอักษร
    Status          VARCHAR(10)      NOT NULL CONSTRAINT DF_Unlock_St DEFAULT 'PENDING', -- PENDING/APPROVED/REJECTED
    RequesterID     NVARCHAR(100)    NOT NULL,
    ApproverID      NVARCHAR(100)    NULL,
    RequestedAt     DATETIME2        NOT NULL CONSTRAINT DF_Unlock_Req DEFAULT SYSDATETIME(),
    RespondedAt     DATETIME2        NULL,
    CONSTRAINT PK_wf_UnlockRequest PRIMARY KEY (UnlockID),
    CONSTRAINT FK_wf_Unlock_SO FOREIGN KEY (SalesOrderID) REFERENCES wf.SalesOrder(SalesOrderID)
);
GO

-- 2e. wf.WeighTicket — Gross/Tare/Net + เวลา (WS ไม่มีข้อมูลนี้)
CREATE TABLE wf.WeighTicket (
    WeighTicketID   INT IDENTITY(1,1) NOT NULL,
    SalesOrderID    INT              NOT NULL,    -- FK → wf.SalesOrder
    TruckReg        NVARCHAR(50)     NULL,
    GrossKg         DECIMAL(12,2)    NULL,
    TareKg          DECIMAL(12,2)    NULL,
    NetKg           AS (ISNULL(GrossKg,0) - ISNULL(TareKg,0)),
    WeighInAt       DATETIME2        NULL,
    WeighOutAt      DATETIME2        NULL,
    CONSTRAINT PK_wf_WeighTicket PRIMARY KEY (WeighTicketID),
    CONSTRAINT FK_wf_Weigh_SO FOREIGN KEY (SalesOrderID) REFERENCES wf.SalesOrder(SalesOrderID)
);
GO

-- ============================================================
-- SECTION 3: Rebate Domain (Accrual + FIFO + Claim)
-- ============================================================

-- 3a. wf.RebatePlan — แผนรีเบทต่อสูตร×ภาค
CREATE TABLE wf.RebatePlan (
    PlanID          INT IDENTITY(1,1) NOT NULL,
    PlanName        NVARCHAR(200)    NOT NULL,
    Formula         NVARCHAR(50)     NULL,        -- สูตร
    Region          NVARCHAR(30)     NULL,        -- ใต้/กลาง/เหนือ/ตะวันออก/ทุกร้าน
    NetPrice        DECIMAL(18,4)    NOT NULL,    -- ราคา NET ที่คืน (บาท/ตัน)
    ReturnType      VARCHAR(10)      NOT NULL,    -- REBATE (คืนรีเบท) / PRICEDIFF (คืนส่วนต่าง)
    ValidFrom       DATE             NOT NULL,
    ValidTo         DATE             NULL,
    AllocatedAmount DECIMAL(18,4)    NOT NULL CONSTRAINT DF_Plan_Alloc DEFAULT 0,
    Priority        INT              NOT NULL CONSTRAINT DF_Plan_Pri DEFAULT 100,  -- เลือกตอน overlap
    Status          VARCHAR(8)       NOT NULL CONSTRAINT DF_Plan_St DEFAULT 'DRAFT', -- DRAFT/ACTIVE/CLOSED
    CreatedAt       DATETIME2        NOT NULL CONSTRAINT DF_Plan_Cr DEFAULT SYSDATETIME(),
    CONSTRAINT PK_wf_RebatePlan PRIMARY KEY (PlanID)
);
GO

-- 3b. wf.RebatePool — จัดสรร Plan เป็น Pool ต่อ Sales (× สูตร × ภาค × เดือน)
CREATE TABLE wf.RebatePool (
    PoolID          INT IDENTITY(1,1) NOT NULL,
    PlanID          INT              NOT NULL,    -- FK → wf.RebatePlan
    SalesID         INT              NOT NULL,    -- soft ref → dbo.EMEmp.EmpID
    YearMonth       CHAR(7)          NOT NULL,    -- 'YYYY-MM'
    Allocated       DECIMAL(18,4)    NOT NULL CONSTRAINT DF_Pool_Alloc DEFAULT 0,
    Used            DECIMAL(18,4)    NOT NULL CONSTRAINT DF_Pool_Used DEFAULT 0,
    Remaining       AS (Allocated - Used),
    Frozen          DECIMAL(18,4)    NOT NULL CONSTRAINT DF_Pool_Frozen DEFAULT 0,
    CONSTRAINT PK_wf_RebatePool PRIMARY KEY (PoolID),
    CONSTRAINT FK_wf_Pool_Plan FOREIGN KEY (PlanID) REFERENCES wf.RebatePlan(PlanID)
);
GO

-- 3c. wf.RebateLedger — accrual ต่อบรรทัด, ตัด FIFO, trace กลับ SOLine/Plan
CREATE TABLE wf.RebateLedger (
    LedgerID        BIGINT IDENTITY(1,1) NOT NULL,
    PoolID          INT              NOT NULL,    -- FK → wf.RebatePool
    SalesOrderID    INT              NOT NULL,    -- FK → wf.SalesOrder
    LineNo          INT              NOT NULL,    -- ↔ wf.SalesOrderLine
    AccrualAmount   DECIMAL(18,4)    NOT NULL,    -- (ราคาขาย − ราคา NET) × ตัน
    FifoSeq         BIGINT           NOT NULL,    -- ลำดับ FIFO ระดับ Pool
    Type            VARCHAR(8)       NOT NULL CONSTRAINT DF_Ledg_Type DEFAULT 'ACCRUAL', -- ACCRUAL / CLAIM
    ReversedFlag    BIT              NOT NULL CONSTRAINT DF_Ledg_Rev DEFAULT 0,  -- unlock → reverse (ไม่ลบ)
    CreatedAt       DATETIME2        NOT NULL CONSTRAINT DF_Ledg_Cr DEFAULT SYSDATETIME(),
    CONSTRAINT PK_wf_RebateLedger PRIMARY KEY (LedgerID),
    CONSTRAINT FK_wf_Ledg_Pool FOREIGN KEY (PoolID) REFERENCES wf.RebatePool(PoolID),
    CONSTRAINT FK_wf_Ledg_SOL FOREIGN KEY (SalesOrderID, LineNo) REFERENCES wf.SalesOrderLine(SalesOrderID, LineNo)
);
GO

-- 3d. wf.RebateClaim — รวม ledger เป็น Claim (เช่น RBD69-001), 2 ประเภท
CREATE TABLE wf.RebateClaim (
    ClaimID         INT IDENTITY(1,1) NOT NULL,
    ClaimNo         NVARCHAR(30)     NULL,        -- เช่น RBD69-001
    CustomerID      INT              NOT NULL,    -- soft ref → dbo.EMCust
    SalesID         INT              NULL,
    RebateTotal     DECIMAL(18,4)    NOT NULL CONSTRAINT DF_Claim_Reb DEFAULT 0,  -- บล็อกคืนรีเบท
    PriceDiffTotal  DECIMAL(18,4)    NOT NULL CONSTRAINT DF_Claim_Diff DEFAULT 0, -- บล็อกคืนส่วนต่าง
    Status          VARCHAR(10)      NOT NULL CONSTRAINT DF_Claim_St DEFAULT 'DRAFT', -- DRAFT/SUBMITTED/APPROVED/PAID
    ApprovalLevel   INT              NOT NULL CONSTRAINT DF_Claim_Appv DEFAULT 0,    -- 0..4 (อนุมัติ 4 ชั้น)
    InvoiceRefs     NVARCHAR(MAX)    NULL,        -- JSON อ้างหลายอินวอยซ์ (I68-xxxxx)
    -- หลัง approve → สร้าง Credit Note DocuType=109 ใน WS (RefSOID→ต้นทาง)
    WsCreditNoteNo  NVARCHAR(30)     NULL,        -- → dbo.SOInvHD.DocuNo (Docutype=109)
    CreatedAt       DATETIME2        NOT NULL CONSTRAINT DF_Claim_Cr DEFAULT SYSDATETIME(),
    CONSTRAINT PK_wf_RebateClaim PRIMARY KEY (ClaimID)
);
GO

-- 3e. wf.RebateClaimLine — รายการ ledger ใน Claim (แยก returnType)
CREATE TABLE wf.RebateClaimLine (
    ClaimID         INT              NOT NULL,    -- FK → wf.RebateClaim
    LedgerID        BIGINT           NOT NULL,    -- FK → wf.RebateLedger
    Amount          DECIMAL(18,4)    NOT NULL,
    ReturnType      VARCHAR(10)      NOT NULL,    -- REBATE / PRICEDIFF
    CONSTRAINT PK_wf_RebateClaimLine PRIMARY KEY (ClaimID, LedgerID),
    CONSTRAINT FK_wf_CL_Claim FOREIGN KEY (ClaimID) REFERENCES wf.RebateClaim(ClaimID),
    CONSTRAINT FK_wf_CL_Ledg FOREIGN KEY (LedgerID) REFERENCES wf.RebateLedger(LedgerID)
);
GO

-- ============================================================
-- SECTION 4: Giveaway & Control Ticket Domain
-- ============================================================

-- 4a. wf.GiveawayBudget — งบของแถมต่อภาค→Sales→รายการ (เบิกเกินงบ=ติดลบได้ แต่เตือน)
CREATE TABLE wf.GiveawayBudget (
    BudgetID        INT IDENTITY(1,1) NOT NULL,
    Region          NVARCHAR(30)     NULL,
    SalesID         INT              NULL,        -- soft ref → dbo.EMEmp
    ItemCode        NVARCHAR(30)     NOT NULL,
    ItemName        NVARCHAR(150)    NOT NULL,    -- เสื้อยืด/กระเป๋า/กระสอบเปล่า/แบนเนอร์
    Brand           NVARCHAR(50)     NULL,        -- รถเกษตร / ปุ๋ยเทพ
    BudgetQty       DECIMAL(18,2)    NOT NULL CONSTRAINT DF_GivB_Bud DEFAULT 0,
    UsedQty         DECIMAL(18,2)    NOT NULL CONSTRAINT DF_GivB_Used DEFAULT 0,
    RemainingQty    AS (BudgetQty - UsedQty),     -- ติดลบได้
    YearMonth       CHAR(7)          NULL,
    CONSTRAINT PK_wf_GiveawayBudget PRIMARY KEY (BudgetID)
);
GO

-- 4b. wf.GiveawayIssue — การเบิกของแถมต่อ SO
CREATE TABLE wf.GiveawayIssue (
    IssueID         INT IDENTITY(1,1) NOT NULL,
    SalesOrderID    INT              NOT NULL,    -- FK → wf.SalesOrder
    BudgetID        INT              NOT NULL,    -- FK → wf.GiveawayBudget
    Qty             DECIMAL(18,2)    NOT NULL,
    OverBudgetFlag  BIT              NOT NULL CONSTRAINT DF_GivI_Over DEFAULT 0,  -- เตือนถ้าเกินงบ
    IssuedAt        DATETIME2        NOT NULL CONSTRAINT DF_GivI_At DEFAULT SYSDATETIME(),
    CONSTRAINT PK_wf_GiveawayIssue PRIMARY KEY (IssueID),
    CONSTRAINT FK_wf_GivI_SO FOREIGN KEY (SalesOrderID) REFERENCES wf.SalesOrder(SalesOrderID),
    CONSTRAINT FK_wf_GivI_Bud FOREIGN KEY (BudgetID) REFERENCES wf.GiveawayBudget(BudgetID)
);
GO

-- 4c. wf.ControlTicket — ชุดตั๋วคุม ผูกกับลูกค้า
CREATE TABLE wf.ControlTicket (
    ControlTicketID INT IDENTITY(1,1) NOT NULL,
    TicketSetNo     NVARCHAR(30)     NOT NULL,
    CustomerID      INT              NOT NULL,    -- soft ref → dbo.EMCust
    TotalQty        INT              NOT NULL CONSTRAINT DF_CT_Total DEFAULT 0,
    RemainingQty    INT              NOT NULL CONSTRAINT DF_CT_Rem DEFAULT 0,
    Status          VARCHAR(10)      NOT NULL CONSTRAINT DF_CT_St DEFAULT 'OPEN', -- OPEN/CLOSED
    CONSTRAINT PK_wf_ControlTicket PRIMARY KEY (ControlTicketID),
    CONSTRAINT UQ_wf_ControlTicket UNIQUE (TicketSetNo)
);
GO

-- 4d. wf.ControlTicketIssue — รับเฉพาะชุด / รับพร้อมใบสั่งจอง
CREATE TABLE wf.ControlTicketIssue (
    IssueID         INT IDENTITY(1,1) NOT NULL,
    ControlTicketID INT              NOT NULL,    -- FK → wf.ControlTicket
    SalesOrderID    INT              NULL,        -- FK → wf.SalesOrder (NULL = รับเฉพาะชุด)
    Qty             INT              NOT NULL,
    ReceiveMode     VARCHAR(12)      NOT NULL,    -- SET_ONLY / WITH_ORDER
    IssuedAt        DATETIME2        NOT NULL CONSTRAINT DF_CTI_At DEFAULT SYSDATETIME(),
    CONSTRAINT PK_wf_ControlTicketIssue PRIMARY KEY (IssueID),
    CONSTRAINT FK_wf_CTI_CT FOREIGN KEY (ControlTicketID) REFERENCES wf.ControlTicket(ControlTicketID),
    CONSTRAINT FK_wf_CTI_SO FOREIGN KEY (SalesOrderID) REFERENCES wf.SalesOrder(SalesOrderID)
);
GO

-- ============================================================
-- SECTION 5: Paper Trail & System
-- ============================================================

-- 5a. wf.PaperCopy — เอกสาร 4 สี + QR
CREATE TABLE wf.PaperCopy (
    CopyID          INT IDENTITY(1,1) NOT NULL,
    SalesOrderID    INT              NOT NULL,    -- FK → wf.SalesOrder
    Color           VARCHAR(8)       NOT NULL,    -- WHITE/BLUE/PINK/YELLOW/GREEN
    QrNonce         NVARCHAR(64)     NOT NULL,
    PdfPath         NVARCHAR(300)    NULL,
    CurrentHolderID NVARCHAR(100)    NULL,
    Status          VARCHAR(10)      NOT NULL CONSTRAINT DF_Paper_St DEFAULT 'PRINTED', -- PRINTED/IN_TRANSIT/SIGNED/FILED/LOST
    CONSTRAINT PK_wf_PaperCopy PRIMARY KEY (CopyID),
    CONSTRAINT FK_wf_Paper_SO FOREIGN KEY (SalesOrderID) REFERENCES wf.SalesOrder(SalesOrderID)
);
GO

-- 5b. wf.PaperScan — บันทึก scan QR
CREATE TABLE wf.PaperScan (
    ScanID          BIGINT IDENTITY(1,1) NOT NULL,
    CopyID          INT              NOT NULL,    -- FK → wf.PaperCopy
    ScannerID       NVARCHAR(100)    NOT NULL,
    Location        NVARCHAR(100)    NULL,
    ScannedAt       DATETIME2        NOT NULL CONSTRAINT DF_Scan_At DEFAULT SYSDATETIME(),
    Action          NVARCHAR(50)     NULL,
    CONSTRAINT PK_wf_PaperScan PRIMARY KEY (ScanID),
    CONSTRAINT FK_wf_Scan_Copy FOREIGN KEY (CopyID) REFERENCES wf.PaperCopy(CopyID)
);
GO

-- 5c. wf.AppUser — ผู้ใช้ + RBAC
CREATE TABLE wf.AppUser (
    UserID          INT IDENTITY(1,1) NOT NULL,
    Username        NVARCHAR(100)    NOT NULL,
    PasswordHash    NVARCHAR(200)    NOT NULL,    -- bcrypt cost 12
    Role            VARCHAR(20)      NOT NULL,    -- SALES/COUNTER_SALES/WAREHOUSE/WEIGHBRIDGE/APPROVER/ACCOUNTING/ADMIN
    BranchID        SMALLINT         NULL,
    EmpID           INT              NULL,        -- soft ref → dbo.EMEmp
    LineUserID      NVARCHAR(100)    NULL,        -- ผูก LINE intake (FR-016)
    Permissions     NVARCHAR(MAX)    NULL,        -- JSON
    Active          BIT              NOT NULL CONSTRAINT DF_User_Act DEFAULT 1,
    CreatedAt       DATETIME2        NOT NULL CONSTRAINT DF_User_Cr DEFAULT SYSDATETIME(),
    CONSTRAINT PK_wf_AppUser PRIMARY KEY (UserID),
    CONSTRAINT UQ_wf_AppUser UNIQUE (Username)
);
GO

-- ============================================================
-- SECTION 6: Indexes
-- ============================================================
CREATE INDEX IX_wf_SO_Cust       ON wf.SalesOrder(CustomerID, CreatedAt);
CREATE INDEX IX_wf_SO_Status     ON wf.SalesOrder(Status);
CREATE INDEX IX_wf_SO_Sync       ON wf.SalesOrder(SyncStatus, WsSOID);
CREATE INDEX IX_wf_SOL_Good      ON wf.SalesOrderLine(GoodID);
CREATE INDEX IX_wf_Pool_Sales    ON wf.RebatePool(SalesID, YearMonth);
CREATE INDEX IX_wf_Ledger_Fifo   ON wf.RebateLedger(PoolID, FifoSeq);
CREATE INDEX IX_wf_Ledger_SO     ON wf.RebateLedger(SalesOrderID, LineNo);
CREATE INDEX IX_wf_PriceBook_Key ON wf.PriceBook(GoodID, YearMonth);
CREATE INDEX IX_wf_Paper_SO      ON wf.PaperCopy(SalesOrderID, Status);
GO

-- ============================================================
-- NOTES (ยืนยันจากข้อมูลจริง — ดู out/workflow_tests.md)
-- ============================================================
-- 1. dbo = READ-ONLY: ทุก *ID ที่ชี้ไป dbo เป็น soft reference (ไม่มี FK ข้าม schema)
--    **ห้ามเขียนตารางบัญชีของ dbo (SOInvHD/SOInvDT/GLHD/GLDT) เด็ดขาด** (มติ D-03 แนวทาง B)
-- 2. GL: ยืนยันแล้ว DB ไม่มี trigger/SP post GL อัตโนมัติ (trigger บน SOInvHD/SOHD/GLHD = RI-check ล้วน)
--    → WINSpeed client app เป็นผู้ลงบัญชีเอง. ระบบใหม่ส่งข้อมูลเข้าผ่าน "ฟีเจอร์ Import ของ WINSpeed"
--    (Header+Detail; มี dbo.IEImportTemplate_wf อยู่แล้ว) แล้ว WINSpeed ออกใบกำกับ+GL เอง
--    (Dr 1037 ลูกหนี้-ค้างส่ง / Cr 1120 ขายสินค้า-เงินเชื่อ; ปุ๋ยยกเว้น VAT) — เราไม่ post GL เอง
-- 3. Rebate Claim → Credit Note (109): ส่ง import ให้ WINSpeed ออก CN (ไม่เขียน dbo ตรง)
--    เก็บ DocuNo/SOInvID ที่ได้กลับมาใน wf (WsDocuNo/WsSOInvID/WsCreditNoteNo) เพื่อ sync สถานะ (read-only)
-- 4. ราคา NET อ้าง dbo.EMSetPriceDT.GoodPriceNet (ICPriceHD/DT ว่าง)
-- 5. Credit: WS ไม่มีวงเงิน (EMCust.CreditAmnt=0) → ใช้ wf.CustomerCredit
-- 6. Stock: ICStock ว่าง → จัดการ inventory ใน wf (ไม่อยู่ใน scope DDL นี้)
-- 7. ของแถม: wf.SalesOrderLine.UnitPrice=0 (computed IsGiveaway) ↔ dbo SOInvDT.GoodPrice2=0
