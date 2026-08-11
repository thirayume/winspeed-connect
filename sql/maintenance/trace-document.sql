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
-- ⚠ ข้อควรระวังเรื่องเลข ID ชนกัน (วัดจากฐานจริง 11 ส.ค. 2569)
--   SOID · SOInvID · GLID ไม่ใช่ IDENTITY และ **ไม่ได้ unique ข้ามตาราง**
--   แต่ละตารางมีเลขของตัวเองที่ช่วงทับกันเป็นปกติ:
--       SOHD.SOID        132,260 – 274,001   (125,182 แถว)
--       SOInvHD.SOInvID    1,000 – 331,002   (304,537 แถว)
--       GLHD.GLID          1,000 – 478,001   (412,933 แถว)
--   **120,652 จาก 125,182 SOID (96.4%) มีเลขเดียวกันอยู่ใน SOInvID ด้วย**
--   การชนกันจึงเป็นเรื่องปกติ ไม่ใช่ความผิดปกติ และไม่ได้แปลว่าเอกสารเกี่ยวข้องกัน
--   ต้องดู DocuNo และ DocuDate ประกอบเสมอ
--
-- ⚠ RunCode ใน EMRunBrch ไม่ใช่ DocuType
--   RunCode 103 = ชุดเลข I (Iyy-00000) · RunCode 104 = ชุดเลข K (Kyy-00000)
--   ทั้งสองชุดมีเอกสารทั้ง DocuType 103 และ 104 ปนกัน — ไม่ได้แบ่งตามชนิดเอกสาร
--   จึงต้องเทียบกับชุดเลขที่ตรงกับตัวอักษรนำหน้าของใบที่กำลังตามเท่านั้น
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

-- 1.5 ตัวนับเลขที่เอกสาร — เทียบเฉพาะชุดเลขที่ตรงกับตัวอักษรนำหน้าของใบนี้
--
-- RunCode ไม่ใช่ DocuType · RunFormat บอกรูปแบบเลขของชุดนั้น เช่น Iyy-00000
-- ต้องเทียบ "คำนำหน้าทั้งคำ" ไม่ใช่ตัวอักษรแรก มิฉะนั้น I จะไปตรงกับ IS · IQ · IB ด้วย
--   คำนำหน้าของ RunFormat = ตัวอักษรก่อน y ตัวแรก   (Iyy-00000 → I · ISyymm → IS)
--   คำนำหน้าของ DocuNo    = ตัวอักษรก่อนตัวเลขตัวแรก (I69-02420 → I)
DECLARE @Prefix VARCHAR(10) =
    LEFT(@DocuNo, NULLIF(PATINDEX('%[0-9]%', @DocuNo), 0) - 1);

SELECT N'ตัวนับเลขที่' AS [ส่วน], RunCode, BrchID, LastNo, RunFormat,
       CASE WHEN LastNo = @DocuNo THEN N'ใบนี้คือใบล่าสุดของชุดนี้'
            ELSE N'ชุดเดียวกัน แต่มีใบใหม่กว่าแล้ว: ' + LastNo
       END AS [สถานะ]
FROM dbo.EMRunBrch
WHERE RunFormat IS NOT NULL
  AND PATINDEX('%y%', RunFormat) > 1
  AND LEFT(RunFormat, PATINDEX('%y%', RunFormat) - 1) = @Prefix;

-- 1.6 เอกสารปลายน้ำ — ยังไม่มีถ้าใบยังไม่ถูกส่งของ
SELECT N'ใบส่งของที่ใช้เลขเดียวกัน (DocuType 104)' AS [ส่วน],
       SOID, DocuNo, DocuType, DocuDate, RefNo, NetAmnt
FROM dbo.SOHD WHERE DocuNo = @DocuNo AND DocuType = 104;

SELECT N'เอกสารที่อ้างใบนี้ผ่าน RefSOID' AS [ส่วน], SOID, DocuNo, DocuType, DocuDate
FROM dbo.SOHD WHERE RefSOID = @SOID;

SELECT N'คูปอง (เกิดตอนออกใบส่งของ)' AS [ส่วน], CouponID, CouponNo, GoodQty, RemaQty
FROM dbo.WFCoupon WHERE DocuID = @SOID;

-- 1.7 ตารางอื่นที่บังเอิญมีเลข ID เดียวกัน
--
-- ส่วนนี้ **ไม่ใช่เอกสารที่เกี่ยวข้อง** — แสดงไว้เพื่อกันคนอ่านไปเจอเองแล้วเข้าใจผิด
-- คอลัมน์ [ผลตัดสิน] คำนวณจากวันที่: ถ้าเป็นเอกสารคนละใบ จะบอกว่าไม่เกี่ยวข้อง
SELECT N'เลข ID ชนกัน' AS [ส่วน], x.[ที่ไหน], x.DocuNo, x.DocuDate, x.Docutype,
       CASE WHEN x.DocuNo = @DocuNo THEN N'⚠ เลขเอกสารตรงกันด้วย — ต้องตรวจ'
            ELSE N'ไม่เกี่ยวข้อง (คนละใบ ต่างกัน '
                 + CAST(ABS(DATEDIFF(DAY, x.DocuDate,
                     (SELECT DocuDate FROM dbo.SOHD WHERE SOID = @SOID))) AS VARCHAR(10)) + N' วัน)'
       END AS [ผลตัดสิน]
FROM (
    SELECT 'SOInvHD.SOInvID' AS [ที่ไหน], DocuNo, DocuDate, Docutype
    FROM dbo.SOInvHD WHERE SOInvID = @SOID
    UNION ALL
    SELECT 'GLHD.GLID', DocuNo, DocuDate, Docutype FROM dbo.GLHD WHERE GLID = @SOID
    UNION ALL
    SELECT DISTINCT 'ICStockDetail.DocuID', DocuNo, DocuDate, DocuType
    FROM dbo.ICStockDetail WHERE DocuID = @SOID
) x;

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
