-- ล้างข้อมูลที่ E2E สร้างขึ้น ออกจาก SQL Server หลังจบการทดสอบทุกครั้ง
--
-- ขอบเขต: ลบเฉพาะรายการที่เกิดจากการรันเทสต์ ระบุด้วยทะเบียนรถที่ helpers.runSuffix() สร้าง
--          คือขึ้นต้นด้วย 'UAT-' (uat-full-loop.spec.ts) และ 'CMP-' (comprehensive-sales.spec.ts)
-- คงไว้:   บัญชี e2e_* และ master data ทั้งหมด เพราะเป็น fixture ที่ seed ใหม่ทุกรอบ
--          และการลบผู้ใช้จะทำให้ audit ที่อ้างถึงผู้ใช้เหล่านั้นติด foreign key
--
-- ชื่อคอลัมน์ทุกตัวตรวจกับ sys.columns ของฐานข้อมูลจริงแล้ว
-- ลำดับการลบไล่จากตารางลูกไปตารางแม่เพื่อไม่ให้ติด foreign key

SET NOCOUNT ON;

DECLARE @SoIds TABLE (Id VARCHAR(50) PRIMARY KEY);
INSERT INTO @SoIds (Id)
SELECT CAST(Id AS VARCHAR(50)) FROM wf.SalesOrder
WHERE TruckPlate LIKE 'UAT-%' OR TruckPlate LIKE 'CMP-%';

DECLARE @SoCount INT = (SELECT COUNT(*) FROM @SoIds);

-- เอกสารจ่ายของ (PaperScan อ้าง PaperCopy ด้วย PaperCopyId)
DELETE FROM wf.PaperScan
WHERE PaperCopyId IN (SELECT Id FROM wf.PaperCopy WHERE CAST(SoId AS VARCHAR(50)) IN (SELECT Id FROM @SoIds));
DELETE FROM wf.PaperCopy WHERE CAST(SoId AS VARCHAR(50)) IN (SELECT Id FROM @SoIds);

-- หลักฐานการชั่ง
DELETE FROM wf.WeighTicketItemLog WHERE CAST(SoId AS VARCHAR(50)) IN (SELECT Id FROM @SoIds);
DELETE FROM wf.WeighTicket        WHERE CAST(SoId AS VARCHAR(50)) IN (SELECT Id FROM @SoIds);
DELETE FROM wf.WeighInbox         WHERE Plate LIKE 'UAT-%' OR Plate LIKE 'CMP-%';

-- รีเบท คำขอปลดล็อก และ audit
DELETE FROM wf.RebateLedger     WHERE CAST(SoId AS VARCHAR(50)) IN (SELECT Id FROM @SoIds);
DELETE FROM wf.UnlockRequest    WHERE CAST(SoId AS VARCHAR(50)) IN (SELECT Id FROM @SoIds);
DELETE FROM wf.SalesOrderAudit  WHERE CAST(SoId AS VARCHAR(50)) IN (SELECT Id FROM @SoIds);

-- คิวส่งออก
DELETE FROM wf.OutboxEvent WHERE CAST(AggregateId AS VARCHAR(50)) IN (SELECT Id FROM @SoIds);

-- ส่วนขยายฝั่ง WINSpeed
DELETE FROM wf.SalesOrderLineExt WHERE CAST(SOID AS VARCHAR(50)) IN (SELECT Id FROM @SoIds);
DELETE FROM wf.SalesOrderExt     WHERE CAST(SOID AS VARCHAR(50)) IN (SELECT Id FROM @SoIds);

-- ใบสั่งขาย
DELETE FROM wf.SalesOrderLine WHERE CAST(SoId AS VARCHAR(50)) IN (SELECT Id FROM @SoIds);
DELETE FROM wf.SalesOrder     WHERE CAST(Id AS VARCHAR(50))   IN (SELECT Id FROM @SoIds);

-- ใบเสนอราคาที่ผู้ใช้ทดสอบสร้าง
DECLARE @E2EUsers TABLE (Id INT PRIMARY KEY);
INSERT INTO @E2EUsers (Id) SELECT Id FROM wf.AppUser WHERE Username LIKE 'e2e[_]%';

DELETE FROM wf.QuotationLine     WHERE QuoteId IN (SELECT Id FROM wf.Quotation WHERE SalesUserId IN (SELECT Id FROM @E2EUsers));
DELETE FROM wf.QuotationSourceSO WHERE QuoteId IN (SELECT Id FROM wf.Quotation WHERE SalesUserId IN (SELECT Id FROM @E2EUsers));
DELETE FROM wf.Quotation         WHERE SalesUserId IN (SELECT Id FROM @E2EUsers);

-- เอกสารที่ sp_ConfirmSalesOrder เขียนลง WINSpeed ระหว่างเทสต์
-- ระบุด้วยทะเบียนรถโดยตรง จึงไม่ต้องพึ่ง SalesOrderExt ที่ถูกลบไปแล้ว
DECLARE @TestSoid TABLE (SOID VARCHAR(50) PRIMARY KEY);
INSERT INTO @TestSoid (SOID)
SELECT DISTINCT CAST(SOID AS VARCHAR(50)) FROM dbo.SOHD
WHERE TransRegistration LIKE 'UAT-%' OR TransRegistration LIKE 'CMP-%';

DELETE FROM dbo.SODT WHERE CAST(SOID AS VARCHAR(50)) IN (SELECT SOID FROM @TestSoid);
DELETE FROM dbo.SOHD WHERE CAST(SOID AS VARCHAR(50)) IN (SELECT SOID FROM @TestSoid);

PRINT CONCAT('E2E cleanup: removed test data for ', @SoCount, ' sales order(s) and ',
             (SELECT COUNT(*) FROM @TestSoid), ' WINSpeed document(s); e2e_* users retained as fixtures.');
