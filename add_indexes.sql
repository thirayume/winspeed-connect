-- ==============================================================================
-- SQL PERFORMANCE TUNING: ADDING MISSING INDEXES
-- ==============================================================================
-- สาเหตุที่หน้าเว็บค้างและแจ้งเตือน "Query timeout expired" (500 Internal Server Error) 
-- เกิดจากฐานข้อมูลมีข้อมูลเยอะขึ้นกะทันหัน (เกือบหมื่นรายการ) แต่ตาราง wf.SalesOrderLine 
-- อาจจะยังไม่ได้ทำ Index ที่ Foreign Key ทำให้ Prisma (Backend) ค้นหาข้อมูลช้ามากจน Timeout
-- 
-- สคริปต์นี้จะช่วยสร้าง Index เพื่อเพิ่มความเร็วในการอ่านข้อมูลให้หน้าเว็บครับ
-- ==============================================================================

BEGIN TRANSACTION;

-- 1. สร้าง Index สำหรับค้นหารายการสินค้าตาม SoId (สำคัญมากสำหรับ Join)
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_SalesOrderLine_SoId' AND object_id = OBJECT_ID('wf.SalesOrderLine'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_SalesOrderLine_SoId ON wf.SalesOrderLine(SoId);
END

-- 2. สร้าง Index สำหรับค้นหาสถานะ (Status) และวันที่ (CreatedAt)
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_SalesOrder_Status' AND object_id = OBJECT_ID('wf.SalesOrder'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_SalesOrder_Status ON wf.SalesOrder(Status);
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_SalesOrder_CreatedAt' AND object_id = OBJECT_ID('wf.SalesOrder'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_SalesOrder_CreatedAt ON wf.SalesOrder(CreatedAt DESC);
END

-- 3. สร้าง Index สำหรับการค้นหาสินค้าขายดี
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_SalesOrderLine_GoodId' AND object_id = OBJECT_ID('wf.SalesOrderLine'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_SalesOrderLine_GoodId ON wf.SalesOrderLine(GoodId);
END

COMMIT;
