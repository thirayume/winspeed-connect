-- ดูว่าตารางสินค้าเก็บชื่อสินค้าไว้ที่คอลัมน์ไหน (อาจเป็น GoodName2, GoodBillName หรืออื่นๆ)
SELECT TOP 1 * FROM dbo.EMGood;

-- ดูคอลัมน์ใน SalesOrder (อาจเป็น Id, SOID, Status)
SELECT TOP 1 * FROM wf.SalesOrder;

-- ดูคอลัมน์ใน SalesOrderLine (อาจเป็น SoId, GoodId, QtyTon)
SELECT TOP 1 * FROM wf.SalesOrderLine;


SELECT 
    g.GoodName1 AS GoodName,
    line.GoodId, 
    SUM(line.QtyTon) AS TotalQtyTon,
    COUNT(DISTINCT so.Id) AS TransactionCount
FROM wf.SalesOrder so
JOIN wf.SalesOrderLine line ON so.Id = line.SoId
JOIN dbo.EMGood g ON g.GoodID = line.GoodId
WHERE so.Status NOT IN ('CANCELLED', 'DRAFT') 
GROUP BY line.GoodId, g.GoodName1
ORDER BY TotalQtyTon DESC;

