-- =============================================================
-- trace-document.sql   (อ่านอย่างเดียว · ไม่แก้ข้อมูลใด ๆ)
--
-- ตามรอยเอกสารหนึ่งใบว่าไปโผล่ที่ตารางไหนบ้าง ทั้ง schema dbo และ wf
-- แก้ค่า @DocuNo แล้วรันได้เลย
--
-- ⚠ ไฟล์นี้บันทึกเป็น UTF-8 with BOM — ถ้าเปิดแล้วภาษาไทยเพี้ยน อย่ารัน
--
-- ทำไมต้องแยกสองส่วน
--   dbo = ข้อมูลของ WINSpeed (ระบบเดิม) · wf = ข้อมูลที่แอปเราสร้างเอง
--   เอกสารที่คีย์ใน WINSpeed โดยตรงจะไม่มีร่องรอยใน wf เลย และกลับกัน
--   การแยกดูจึงบอกได้ทันทีว่าใบนี้เกิดจากทางไหน
--
-- ⚠ ข้อควรระวังเรื่องเลข ID ชนกัน
--   SOID · SOInvID · GLID · stockdetailid เป็นลำดับ "คนละชุด" ที่เดินแยกกัน
--   เลขเดียวกันจึงไปตรงกับเอกสารคนละใบคนละปีได้ ต้องเปิดดู DocuNo/DocuDate
--   ประกอบเสมอ ห้ามสรุปว่าเกี่ยวข้องกันเพราะเลขตรงกันเฉย ๆ
-- =============================================================
SET NOCOUNT ON;

DECLARE @DocuNo VARCHAR(25) = 'I69-02420';
DECLARE @SOID   INT = (SELECT TOP 1 SOID FROM dbo.SOHD WHERE DocuNo = @DocuNo);

PRINT '=================================================================';
PRINT ' ส่วนที่ 1 — schema dbo (WINSpeed)';
PRINT '=================================================================';

-- 1.1 หัวใบ + ลูกค้า + พนักงานขาย + เขตขาย
SELECT N'หัวใบสั่งขาย' AS [ส่วน],
       h.SOID, h.DocuNo, h.DocuType, h.DocuDate, h.ShipDate, h.ValidDays, h.CreditDays,
       h.CustID, c.CustCode, c.CustName,
       sa.SaleAreaCode, LEFT(sa.SaleAreaCode, 2) AS [ภาค], sa.SaleAreaName,
       h.EmpID, e.EmpCode, h.ContactName, h.TransRegistration,
       h.SumGoodAmnt, h.VATAmnt, h.NetAmnt,
       h.DocuStatus, h.AppvFlag, h.QuotStatus, h.OnHold,
       h.clearflag, h.CouponFlag, h.ClearSO, h.PkgStatus, h.RefSOID, h.RefNo
FROM dbo.SOHD h
LEFT JOIN dbo.EMCust c     ON c.CustID = h.CustID
LEFT JOIN dbo.EMSaleArea sa ON sa.SaleAreaID = c.SaleAreaID
LEFT JOIN dbo.EMEmp e      ON e.EmpID = h.EmpID
WHERE h.DocuNo = @DocuNo;

-- 1.2 บรรทัดสินค้า
SELECT N'บรรทัดสินค้า' AS [ส่วน],
       d.ListNo, d.GoodID, g.GoodCode, d.GoodName,
       d.GoodQty2 AS [จำนวน], d.GoodPrice2 AS [ราคาต่อหน่วย], d.GoodAmnt AS [เป็นเงิน],
       d.RemaQty AS [ค้างส่ง], d.ShipDate
FROM dbo.SODT d
LEFT JOIN dbo.EMGood g ON g.GoodID = d.GoodID
WHERE d.SOID = @SOID
ORDER BY d.ListNo;

-- 1.3 หมายเหตุท้ายใบ
SELECT N'หมายเหตุ' AS [ส่วน], ListNo, Remark FROM dbo.SOHDRemark WHERE SOID = @SOID;

-- 1.4 ใครสร้าง/แก้ และจากเครื่องไหน
SELECT N'ร่องรอยการแก้ไข' AS [ส่วน],
       audit_id, audit_datetime, audit_username, audit_action,
       audit_computername, audit_system, Version
FROM dbo.SMAudit WHERE audit_docuno = @DocuNo ORDER BY audit_datetime;

SELECT N'บันทึกเหตุการณ์' AS [ส่วน],
       eventid, docudate, docuno, username, totalamnt, docuid, systemid
FROM dbo.SMEvent WHERE docuno = @DocuNo;

-- 1.5 ตัวนับเลขที่เอกสาร — บอกว่าใบนี้เป็นใบล่าสุดหรือยัง
SELECT N'ตัวนับเลขที่' AS [ส่วน], RunCode, BrchID, LastNo, RunFormat,
       CASE WHEN LastNo = @DocuNo THEN N'ใบนี้คือใบล่าสุดที่ระบบออก' ELSE N'มีใบใหม่กว่าแล้ว' END AS [สถานะ]
FROM dbo.EMRunBrch WHERE RunCode IN ('103','104');

-- 1.6 เอกสารปลายน้ำ — ยังไม่มีถ้าใบยังไม่ถูกส่งของ
SELECT N'ใบส่งของที่ใช้เลขเดียวกัน (DocuType 104)' AS [ส่วน],
       SOID, DocuNo, DocuType, DocuDate, RefNo, NetAmnt
FROM dbo.SOHD WHERE DocuNo = @DocuNo AND DocuType = 104;

SELECT N'เอกสารที่อ้างใบนี้ผ่าน RefSOID' AS [ส่วน], SOID, DocuNo, DocuType, DocuDate
FROM dbo.SOHD WHERE RefSOID = @SOID;

SELECT N'คูปอง (เกิดตอนออกใบส่งของ)' AS [ส่วน], CouponID, CouponNo, GoodQty, RemaQty
FROM dbo.WFCoupon WHERE DocuID = @SOID;

-- 1.7 ตารางที่เลข ID ไปชนกัน — ต้องเปิดดูว่าเป็นคนละใบหรือไม่
SELECT N'⚠ เลข ID ชนกัน (คนละลำดับ)' AS [ส่วน], 'SOInvHD.SOInvID' AS [ที่ไหน],
       DocuNo, DocuDate, Docutype FROM dbo.SOInvHD WHERE SOInvID = @SOID
UNION ALL
SELECT N'⚠ เลข ID ชนกัน (คนละลำดับ)', 'GLHD.GLID',
       DocuNo, DocuDate, Docutype FROM dbo.GLHD WHERE GLID = @SOID
UNION ALL
SELECT DISTINCT N'⚠ เลข ID ชนกัน (คนละลำดับ)', 'ICStockDetail.DocuID',
       DocuNo, DocuDate, DocuType FROM dbo.ICStockDetail WHERE DocuID = @SOID;

PRINT '';
PRINT '=================================================================';
PRINT ' ส่วนที่ 2 — schema wf (ข้อมูลที่แอปสร้าง)';
PRINT '=================================================================';

-- ใบที่คีย์ใน WINSpeed โดยตรงจะไม่มีอะไรในส่วนนี้เลย ซึ่งถูกต้อง
SELECT N'ใบสั่งขายในแอป' AS [ส่วน], Id, DocuNo, Status, CustId, CreatedAt
FROM wf.SalesOrder WHERE DocuNo = @DocuNo OR CAST(Id AS VARCHAR(20)) = CAST(@SOID AS VARCHAR(20));

SELECT N'บรรทัดเสริมของใบ (Ext)' AS [ส่วน], * FROM wf.SalesOrderLineExt WHERE SOID = @SOID;

SELECT N'ใบเสนอราคา' AS [ส่วน], Id, DocuNo, Status FROM wf.Quotation WHERE DocuNo = @DocuNo;

SELECT N'ยอดรีเบทค้างรับ' AS [ส่วน], Id, SoId, CustId, GoodCode, QtyTon, RebateAmount, Status
FROM wf.RebateLedger WHERE SoId = @SOID;

SELECT N'บรรทัดใบขอเคลียร์ที่อ้างใบนี้' AS [ส่วน],
       LineId, ClaimId, GoodCode, QtyTon, SourceDocuNo
FROM wf.RebateClaimLine WHERE SourceSOID = @SOID OR SourceDocuNo = @DocuNo;

SELECT N'ยอดสะสมรีเบทจากใบนี้' AS [ส่วน],
       SourceDocuNo, SourceListNo, GoodCode, QtyTon, RemainingTonRebate
FROM wf.v_RebateAccrualRemaining WHERE SourceSOID = @SOID;

SELECT N'ใบชั่ง' AS [ส่วน], TicketNo, SoId, TruckPlate, DateIn, DateOut
FROM wf.WeighInbox WHERE SoId = @SOID;

SELECT N'บันทึกการเรียก API' AS [ส่วน], Id, Route, Method, StatusCode, CreatedAt
FROM wf.ApiAuditLog WHERE Payload LIKE '%' + @DocuNo + '%';
