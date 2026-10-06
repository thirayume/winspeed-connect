-- Migration 114: SO-04 Control Ticket Trace, Expiry & Alerts + Optimized Native Weighing View
-- 1. Optimized wf.v_AllSalesOrders using pre-aggregated CTE for dbo.WGHD
-- 2. wf.ControlTicketOverlay: explicit expiry, UNKNOWN, reason master & policy snapshot
-- 3. wf.ControlTicketAlert: deduplicated near-expiry / expired alerts with lifecycle

-- ── 1. Create Control Ticket Overlay Table ──────────────────────────────────
IF OBJECT_ID('wf.ControlTicketOverlay', 'U') IS NULL
BEGIN
    CREATE TABLE wf.ControlTicketOverlay (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        DocuNo NVARCHAR(50) NOT NULL,
        DocuType INT NOT NULL DEFAULT 104,
        DocuId INT NOT NULL,
        GoodCode NVARCHAR(50) NULL,
        ExpiryDate DATE NULL,
        ExpiryType VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',
        PolicySnapshotId INT NULL,
        StrictOverrideFlag BIT NOT NULL DEFAULT 0,
        ReasonCode VARCHAR(50) NULL,
        ReasonText NVARCHAR(500) NULL,
        CreatedBy VARCHAR(50) NOT NULL DEFAULT 'SYSTEM',
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_wf_ControlTicketOverlay_DocuNo ON wf.ControlTicketOverlay(DocuNo);
    CREATE INDEX IX_wf_ControlTicketOverlay_DocuId ON wf.ControlTicketOverlay(DocuId);
END
GO

-- ── 2. Create Control Ticket Alert Table ────────────────────────────────────
IF OBJECT_ID('wf.ControlTicketAlert', 'U') IS NULL
BEGIN
    CREATE TABLE wf.ControlTicketAlert (
        AlertId INT IDENTITY(1,1) PRIMARY KEY,
        DocuNo NVARCHAR(50) NOT NULL,
        AlertType VARCHAR(30) NOT NULL,
        LeadDays INT NOT NULL DEFAULT 0,
        AlertDate DATE NOT NULL,
        ExpiryDate DATE NULL,
        Status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        DedupHash VARCHAR(64) NOT NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        ResolvedAt DATETIME2 NULL
    );
    CREATE INDEX IX_wf_ControlTicketAlert_Status ON wf.ControlTicketAlert(Status, AlertType);
    CREATE UNIQUE INDEX UX_wf_ControlTicketAlert_Dedup ON wf.ControlTicketAlert(DedupHash, Status);
END
GO

-- ── 3. High-Performance View: wf.v_AllSalesOrders ────────────────────────────
IF OBJECT_ID('wf.v_AllSalesOrders', 'V') IS NULL
    EXEC('CREATE VIEW wf.v_AllSalesOrders AS SELECT 1 AS dummy');
GO
ALTER VIEW wf.v_AllSalesOrders AS
-- 1. DRAFT from Web App
SELECT
    CAST(so.Id AS VARCHAR(50)) AS Id,
    so.WfRef,
    so.SoPrefix,
    so.CustId,
    so.CustName,
    so.TruckPlate,
    so.ControlTicketNo,
    so.DeliveryDate,
    so.RequestedAt,
    so.IsOwnTruck,
    so.NoTruckRequired,
    so.PSling,
    so.Remark,
    so.Status,
    so.SalesUserId,
    so.ImportFilePath,
    so.ImportedDocuNo,
    so.ImportedAt,
    so.CreatedAt,
    so.UpdatedAt,
    ISNULL(so.RebateDiscountAmt, 0) AS RebateDiscountAmt,
    CAST(0 AS BIT) AS IsLoaded,
    CAST(NULL AS DECIMAL(10,2)) AS WeighOutWeight,
    so.CreditDays,
    so.TruckRemark,
    so.BillRemark,
    so.TranspId,
    so.PickupDueDate,
    so.PickupDueType,
    so.ConfirmedAt,
    so.PickupPolicySnapshotId,
    CAST(NULL AS DATETIME2) AS ActualWeighInAt,
    CAST(NULL AS DATETIME2) AS ActualWeighOutAt,
    CAST(NULL AS NVARCHAR(2)) AS WeighStatus,
    CAST(NULL AS INT) AS WeighId,
    CAST(0 AS INT) AS WeighEventCount
FROM wf.SalesOrder so

UNION ALL

-- 2. Documents already visible in WINSpeed (deduplicated by DocuNo, DocuType)
SELECT
    Id,
    WfRef,
    SoPrefix,
    CustId,
    CustName,
    TruckPlate,
    ControlTicketNo,
    DeliveryDate,
    RequestedAt,
    IsOwnTruck,
    NoTruckRequired,
    PSling,
    Remark,
    Status,
    SalesUserId,
    ImportFilePath,
    ImportedDocuNo,
    ImportedAt,
    CreatedAt,
    UpdatedAt,
    RebateDiscountAmt,
    IsLoaded,
    WeighOutWeight,
    CreditDays,
    TruckRemark,
    BillRemark,
    TranspId,
    PickupDueDate,
    PickupDueType,
    ConfirmedAt,
    PickupPolicySnapshotId,
    ActualWeighInAt,
    ActualWeighOutAt,
    WeighStatus,
    WeighId,
    WeighEventCount
FROM (
    SELECT
        CAST(hd.SOID AS VARCHAR(50)) AS Id,
        ISNULL(ext.WfRef, hd.DocuNo) AS WfRef,
        ISNULL(ext.SoPrefix, CASE WHEN LEFT(hd.DocuNo, 2) = 'AI' THEN 'AI' WHEN LEFT(hd.DocuNo, 1) IN ('I', 'K') THEN LEFT(hd.DocuNo, 1) ELSE 'W' END) AS SoPrefix,
        hd.CustID AS CustId,
        hd.CustName,
        hd.TransRegistration AS TruckPlate,
        ext.ControlTicketNo,
        ext.DeliveryDate,
        ext.RequestedAt,
        ISNULL(ext.IsOwnTruck, 0) AS IsOwnTruck,
        ISNULL(ext.NoTruckRequired, 0) AS NoTruckRequired,
        ISNULL(ext.PSling, 0) AS PSling,
        hd.Remark,
        CASE
            WHEN hd.DocuStatus = 'C' THEN 'CANCELLED'
            WHEN EXISTS (
                SELECT 1
                FROM dbo.SOInvDT invdt WITH (NOLOCK)
                JOIN dbo.SOInvHD invhd WITH (NOLOCK) ON invhd.SOInvID = invdt.SOInvID
                WHERE invhd.DocuType IN (107, 202)
                  AND (CONVERT(VARCHAR(50), invdt.RefID) = CONVERT(VARCHAR(50), hd.SOID)
                       OR RTRIM(invhd.SONo) = RTRIM(hd.DocuNo))
            ) THEN 'SHIPPED'
            WHEN ext.WeighOutWeight IS NOT NULL THEN 'SHIPPED'
            WHEN ext.IsLoaded = 1 THEN 'LOADED'
            WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
            WHEN ext.IsUnlocked = 1 THEN 'DRAFT'
            WHEN hd.AppvFlag = 'W' AND hd.AppvDocuNo IS NULL THEN 'PENDING_APPROVAL'
            ELSE 'CONFIRMED'
        END AS Status,
        ext.SalesUserId,
        ext.ImportFilePath,
        hd.DocuNo AS ImportedDocuNo,
        ext.ImportedAt,
        ISNULL(ext.CreatedAt, hd.DocuDate) AS CreatedAt,
        ext.UpdatedAt,
        ISNULL(ext.RebateDiscountAmt, 0) AS RebateDiscountAmt,
        ISNULL(ext.IsLoaded, 0) AS IsLoaded,
        ext.WeighOutWeight,
        ISNULL(ext.CreditDays, hd.CreditDays) AS CreditDays,
        ISNULL(ext.TruckRemark, hd.Desc1) AS TruckRemark,
        ISNULL(ext.BillRemark, hd.Desc2) AS BillRemark,
        ISNULL(ext.TranspId, hd.TranspID) AS TranspId,
        ext.PickupDueDate,
        ext.PickupDueType,
        ext.ConfirmedAt,
        ext.PickupPolicySnapshotId,
        wg.DateIn AS ActualWeighInAt,
        wg.DateOut AS ActualWeighOutAt,
        wg.WeighStatus,
        wg.WeighId,
        ISNULL(wg.EventCount, 0) AS WeighEventCount,
        ROW_NUMBER() OVER(PARTITION BY hd.DocuNo, hd.DocuType ORDER BY hd.SOID DESC) as rn
    FROM dbo.SOHD hd
    LEFT JOIN wf.SalesOrderExt ext ON CONVERT(VARCHAR(50), ext.SOID) = CONVERT(VARCHAR(50), hd.SOID)
    LEFT JOIN (
        SELECT 
            wg.SPID,
            COUNT(*) AS EventCount,
            MAX(CASE 
                WHEN wg.Status = '3' AND wg.DateOut IS NOT NULL THEN wg.Id
                WHEN wg.DateOut IS NOT NULL THEN wg.Id
                ELSE wg.Id
            END) AS WeighId,
            MAX(wg.DateIn) AS DateIn,
            MAX(wg.DateOut) AS DateOut,
            MAX(wg.Status) AS WeighStatus
        FROM dbo.WGHD wg WITH (NOLOCK)
        WHERE wg.SPID IS NOT NULL
        GROUP BY wg.SPID
    ) wg ON wg.SPID = hd.SOID
    WHERE hd.DocuType IN (103, 104)
) Dedup
WHERE rn = 1;
GO
