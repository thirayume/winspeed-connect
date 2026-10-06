-- Migration 113: Native weighing linkage by typed SPID -> SOID (C1)
-- Links dbo.WGHD via wg.SPID = hd.SOID as source authority,
-- handles multiple weighing events, prioritizes completed weighing (Status = '3'),
-- and supports DocuType 103 and 104 references.

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

-- 2. Documents already visible in WINSpeed (deduplicated by DocuNo)
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
        ISNULL(wg_cnt.EventCount, 0) AS WeighEventCount,
        ROW_NUMBER() OVER(PARTITION BY hd.DocuNo, hd.DocuType ORDER BY hd.SOID DESC) as rn
    FROM dbo.SOHD hd
    LEFT JOIN wf.SalesOrderExt ext ON CONVERT(VARCHAR(50), ext.SOID) = CONVERT(VARCHAR(50), hd.SOID)
    OUTER APPLY (
        SELECT TOP 1 
            wg.Id AS WeighId,
            wg.DateIn, 
            wg.DateOut,
            wg.Status AS WeighStatus
        FROM dbo.WGHD wg WITH (NOLOCK)
        WHERE wg.SPID = hd.SOID
           OR (hd.DocuType = 104 AND EXISTS (
               SELECT 1 FROM dbo.SODT dt WITH (NOLOCK)
               WHERE dt.SOID = hd.SOID AND dt.RefSOID = wg.SPID
           ))
        ORDER BY 
            CASE 
                WHEN wg.Status = '3' AND wg.DateOut IS NOT NULL THEN 1
                WHEN wg.DateOut IS NOT NULL THEN 2
                WHEN wg.DateIn IS NOT NULL THEN 3
                ELSE 4
            END ASC,
            wg.Id DESC
    ) wg
    OUTER APPLY (
        SELECT COUNT(*) AS EventCount
        FROM dbo.WGHD wg_c WITH (NOLOCK)
        WHERE wg_c.SPID = hd.SOID
           OR (hd.DocuType = 104 AND EXISTS (
               SELECT 1 FROM dbo.SODT dt WITH (NOLOCK)
               WHERE dt.SOID = hd.SOID AND dt.RefSOID = wg_c.SPID
           ))
    ) wg_cnt
    WHERE hd.DocuType IN (103, 104)
) Dedup
WHERE rn = 1;
GO
