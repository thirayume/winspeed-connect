-- ==========================================
-- migration_2025_ext.sql
-- นำข้อมูลจาก wf.SalesOrder ที่เป็นของเก่า (มี ImportedDocuNo)
-- ไปใส่ใน wf.SalesOrderExt แล้วลบทิ้งจาก wf.SalesOrder
-- เพื่อไม่ให้ซ้ำซ้อนกับ dbo.SOHD
-- ==========================================

BEGIN TRANSACTION;

-- 1. Insert into SalesOrderExt
INSERT INTO wf.SalesOrderExt (
    SOID, WfRef, SoPrefix, SalesUserId, ControlTicketNo, DeliveryDate,
    ImportFilePath, ImportedDocuNo, ImportedAt, CreatedAt, UpdatedAt
)
SELECT 
    so.ImportedDocuNo, -- ใช้ SOID ของ Winspeed เป็น PK
    so.WfRef, 
    so.SoPrefix, 
    so.SalesUserId, 
    so.ControlTicketNo,
    so.DeliveryDate,
    so.ImportFilePath, 
    so.ImportedDocuNo, 
    so.ImportedAt, 
    so.CreatedAt, 
    so.UpdatedAt
FROM wf.SalesOrder so
WHERE so.ImportedDocuNo IS NOT NULL
  AND so.ImportedDocuNo NOT IN (SELECT SOID FROM wf.SalesOrderExt);

-- 2. Insert into SalesOrderLineExt
INSERT INTO wf.SalesOrderLineExt (
    SOID, ListNo, NetPricePerTon, IsGiveaway, RebateBooked
)
SELECT 
    so.ImportedDocuNo, 
    sol.LineNum, 
    sol.NetPricePerTon, 
    sol.IsGiveaway, 
    sol.RebateBooked
FROM wf.SalesOrderLine sol
JOIN wf.SalesOrder so ON so.Id = sol.SoId
WHERE so.ImportedDocuNo IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM wf.SalesOrderLineExt 
      WHERE SOID = so.ImportedDocuNo AND ListNo = sol.LineNum
  );

-- 3. Delete from wf.SalesOrder
-- ลบทิ้งเพื่อไม่ให้รกและป้องกัน Data Duplication
DELETE FROM wf.SalesOrderLine
WHERE SoId IN (SELECT Id FROM wf.SalesOrder WHERE ImportedDocuNo IS NOT NULL);

DELETE FROM wf.SalesOrder
WHERE ImportedDocuNo IS NOT NULL;

COMMIT;
