-- ล้างข้อมูลที่ E2E สร้างขึ้น ออกจาก SQL Server หลังจบการทดสอบทุกครั้ง
--
-- ขอบเขต: ลบเฉพาะรายการที่เกิดจากการรันเทสต์ ระบุด้วยทะเบียนรถที่ helpers.runSuffix() สร้าง
--          คือขึ้นต้นด้วย 'UAT-' (uat-full-loop.spec.ts) และ 'CMP-' (comprehensive-sales.spec.ts)
-- คงไว้:   บัญชี e2e_* และ master data ทั้งหมด เพราะเป็น fixture ที่ seed ใหม่ทุกรอบ
--          และการลบผู้ใช้จะทำให้ audit ที่อ้างถึงผู้ใช้เหล่านั้นติด foreign key
--
-- ชื่อคอลัมน์ทุกตัวตรวจกับ sys.columns ของฐานข้อมูลจริงแล้ว
-- ลำดับการลบไล่จากตารางลูกไปตารางแม่เพื่อไม่ให้ติด foreign key

-- sqlcmd ตั้ง QUOTED_IDENTIFIER OFF โดยปริยาย ซึ่งทำให้ DELETE บนตารางที่มี
-- indexed view หรือ index บนคอลัมน์คำนวณล้มเหลว จึงต้องเปิดไว้ก่อนเสมอ
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

DECLARE @SoIds TABLE (Id VARCHAR(50) PRIMARY KEY);
-- รวมทั้งใบสั่งขายที่ยังอยู่ และใบชั่งที่กำพร้าจากรอบก่อน (ใบสั่งขายถูกลบไปแล้ว
-- แต่ใบชั่งยังค้าง) การอิงใบสั่งขายอย่างเดียวจะเก็บไม่หมด
INSERT INTO @SoIds (Id)
SELECT CAST(Id AS VARCHAR(50)) FROM wf.SalesOrder
WHERE TruckPlate LIKE 'UAT-%' OR TruckPlate LIKE 'CMP-%'
UNION
SELECT CAST(SoId AS VARCHAR(50)) FROM wf.WeighTicket
WHERE TruckPlate LIKE 'UAT-%' OR TruckPlate LIKE 'CMP-%';

DECLARE @SoCount INT = (SELECT COUNT(*) FROM @SoIds);

-- เอกสารจ่ายของ (PaperScan อ้าง PaperCopy ด้วย PaperCopyId)
DELETE FROM wf.PaperScan
WHERE PaperCopyId IN (SELECT Id FROM wf.PaperCopy WHERE CAST(SoId AS VARCHAR(50)) IN (SELECT Id FROM @SoIds));
DELETE FROM wf.PaperCopy WHERE CAST(SoId AS VARCHAR(50)) IN (SELECT Id FROM @SoIds);

-- หลักฐานการชั่ง (เผื่อทะเบียนรถตรงๆ ด้วย กันใบที่กำพร้าไปแล้ว)
DELETE FROM wf.WeighTicketItemLog WHERE CAST(SoId AS VARCHAR(50)) IN (SELECT Id FROM @SoIds);
DELETE FROM wf.WeighTicket
WHERE CAST(SoId AS VARCHAR(50)) IN (SELECT Id FROM @SoIds)
   OR TruckPlate LIKE 'UAT-%' OR TruckPlate LIKE 'CMP-%';
DELETE FROM wf.WeighInbox WHERE Plate LIKE 'UAT-%' OR Plate LIKE 'CMP-%';

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

-- ตั้งใจ *ไม่* ลบเอกสารใน dbo.SOHD / dbo.SODT ที่ sp_ConfirmSalesOrder สร้าง
--
-- เหตุผล: dbo เป็นของ WINSpeed ตามกฎเหล็กของระบบ แอปมีสิทธิ์เขียนเฉพาะ flow ที่อนุมัติ
-- และเคยลองลบแล้วทำให้การ confirm รอบถัดไปตอบ 500 (เอกสารค้างสถานะ DRAFT)
-- เพราะเอกสารเหล่านั้นยังถูกอ้างจากที่อื่นในฝั่ง WINSpeed
--
-- เอกสารทดสอบใน dbo ระบุได้จาก TransRegistration ขึ้นต้น 'UAT-' / 'CMP-'
-- ให้ DBA เก็บกวาดเป็นรอบต่างหากพร้อมตรวจความสัมพันธ์ ไม่ใช่ลบจาก teardown ของเทสต์
DECLARE @DboTestDocs INT = (
  SELECT COUNT(*) FROM dbo.SOHD
  WHERE TransRegistration LIKE 'UAT-%' OR TransRegistration LIKE 'CMP-%');

PRINT CONCAT('E2E cleanup: removed test data for ', @SoCount, ' sales order(s); ',
             @DboTestDocs, ' WINSpeed test document(s) left for DBA review; e2e_* users retained as fixtures.');
