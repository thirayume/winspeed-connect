-- 040_deduplicate_winspeed_so.sql

-- Deduplicate WINSpeed Sales Orders (DocuType 103, 104) sharing the same DocuNo.
-- Only the latest version (based on DocuType DESC, SOID DESC) will be returned.
CREATE OR ALTER VIEW wf.v_AllSalesOrders AS
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
    so.TranspId
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
    TranspId
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
        ROW_NUMBER() OVER(PARTITION BY hd.DocuNo ORDER BY hd.DocuType DESC, hd.SOID DESC) as rn
    FROM dbo.SOHD hd
    LEFT JOIN wf.SalesOrderExt ext ON CONVERT(VARCHAR(50), ext.SOID) = CONVERT(VARCHAR(50), hd.SOID)
    WHERE hd.DocuType IN (103, 104)
) Dedup
WHERE rn = 1;
GO
