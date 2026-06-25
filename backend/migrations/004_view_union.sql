-- ==========================================
-- 004_view_union.sql
-- สร้าง View เพื่อรวมข้อมูลเอกสารระหว่าง wf.SalesOrder (DRAFT)
-- และ dbo.SOHD + wf.SalesOrderExt (CONFIRMED ขึ้นไป)
-- ให้เป็นผืนเดียวกัน (Single Source of Truth)
-- ==========================================

CREATE OR ALTER VIEW wf.v_AllSalesOrders AS
-- 1. DRAFT from Web App (ยังไม่เข้า Winspeed)
SELECT 
    CAST(so.Id AS VARCHAR(50)) AS Id,
    so.WfRef,
    so.SoPrefix,
    so.CustId,
    so.CustName,
    so.TruckPlate,
    so.ControlTicketNo,
    so.DeliveryDate,
    so.Remark,
    so.Status,
    so.SalesUserId,
    so.ImportFilePath,
    so.ImportedDocuNo,
    so.ImportedAt,
    so.CreatedAt,
    so.UpdatedAt
FROM wf.SalesOrder so

UNION ALL

-- 2. CONFIRMED, PICKING, SHIPPED from Winspeed (Single Source of Truth)
SELECT
    hd.SOID AS Id,
    ISNULL(ext.WfRef, hd.DocuNo) AS WfRef,
    ISNULL(ext.SoPrefix, 'W') AS SoPrefix,
    hd.CustID AS CustId,
    hd.CustName,
    hd.TransRegistration AS TruckPlate,
    ext.ControlTicketNo,
    ext.DeliveryDate,
    hd.Remark,
    CASE 
        WHEN hd.DocuStatus = 'C' THEN 'CANCELLED'
        WHEN hd.clearflag = 'Y' THEN 'SHIPPED'
        WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
        ELSE 'CONFIRMED'
    END AS Status,
    ext.SalesUserId,
    ext.ImportFilePath,
    hd.DocuNo AS ImportedDocuNo,
    ext.ImportedAt,
    ISNULL(ext.CreatedAt, hd.DocuDate) AS CreatedAt,
    ext.UpdatedAt -- SOHD doesn't have an easily usable LastUpdate
FROM dbo.SOHD hd
LEFT JOIN wf.SalesOrderExt ext ON ext.SOID = hd.SOID
WHERE EXISTS (SELECT 1 FROM dbo.SODT dt WHERE dt.SOID = hd.SOID)
GO

CREATE OR ALTER VIEW wf.v_AllSalesOrderLines AS
-- 1. DRAFT lines
SELECT 
    CAST(sol.SoId AS VARCHAR(50)) AS SoId,
    sol.LineNum,
    sol.GoodId,
    sol.GoodCode,
    sol.GoodName,
    sol.QtyTon,
    sol.QtyBag,
    sol.PricePerTon,
    sol.NetPricePerTon,
    sol.IsGiveaway,
    sol.RebateBooked,
    sol.CreatedAt
FROM wf.SalesOrderLine sol

UNION ALL

-- 2. Lines from Winspeed
SELECT
    dt.SOID AS SoId,
    dt.ListNo AS LineNum,
    dt.GoodID AS GoodId,
    g.GoodCode,
    g.GoodName1 AS GoodName,
    dt.GoodQty2 AS QtyTon,
    CAST(dt.GoodQty2 * 20 AS INT) AS QtyBag,
    dt.GoodPrice2 AS PricePerTon,
    ISNULL(ext.NetPricePerTon, dt.GoodPrice2) AS NetPricePerTon,
    ISNULL(ext.IsGiveaway, 0) AS IsGiveaway,
    ISNULL(ext.RebateBooked, 0) AS RebateBooked,
    hd.DocuDate AS CreatedAt
FROM dbo.SODT dt
JOIN dbo.SOHD hd ON hd.SOID = dt.SOID
JOIN dbo.EMGood g ON g.GoodID = dt.GoodID
LEFT JOIN wf.SalesOrderLineExt ext ON ext.SOID = dt.SOID AND ext.ListNo = dt.ListNo
GO
