const { wfQuery } = require('./db');

async function fixView() {
  await wfQuery(`
    ALTER VIEW wf.v_AllSalesOrders AS
    -- 1. DRAFT from Web App 
    SELECT 
        CAST(so.Id AS VARCHAR(50)) AS Id,
        so.WfRef,
        so.SoPrefix,
        CAST(so.CustId AS NVARCHAR(50)) AS CustId,
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
        so.UpdatedAt,
        CAST(0 AS BIT) AS IsLoaded,
        CAST(NULL AS DECIMAL(10,2)) AS WeighOutWeight
    FROM wf.SalesOrder so

    UNION ALL

    -- 2. CONFIRMED, PICKING, LOADED, SHIPPED from Winspeed
    SELECT
        CAST(hd.SOID AS VARCHAR(50)) AS Id,
        ISNULL(ext.WfRef, hd.DocuNo) AS WfRef,
        ISNULL(ext.SoPrefix, 'W') AS SoPrefix,
        CAST(hd.CustID AS NVARCHAR(50)) AS CustId,
        hd.CustName,
        hd.TransRegistration AS TruckPlate,
        ext.ControlTicketNo,
        ext.DeliveryDate,
        hd.Remark,
        CASE
            WHEN hd.DocuStatus = 'C' THEN 'CANCELLED'
            WHEN ext.IsUnlocked = 1 THEN 'DRAFT'
            WHEN hd.DocuStatus = 'Y' THEN 'SHIPPED'
            WHEN hd.clearflag = 'Y' THEN 'SHIPPED'
            WHEN ext.IsLoaded = 1 THEN 'LOADED'
            WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
            ELSE 'CONFIRMED'
        END AS Status,
        ext.SalesUserId,
        ext.ImportFilePath,
        hd.DocuNo AS ImportedDocuNo,
        ext.ImportedAt,
        ISNULL(ext.CreatedAt, hd.DocuDate) AS CreatedAt,
        ext.UpdatedAt,
        ISNULL(ext.IsLoaded, 0) AS IsLoaded,
        ext.WeighOutWeight
    FROM dbo.SOHD hd
    LEFT JOIN wf.SalesOrderExt ext ON ext.SOID = hd.SOID;
  `);
  console.log('View v_AllSalesOrders updated successfully');
}

fixView().catch(console.error);
