-- =============================================================
-- trace-document.sql   (อ่านอย่างเดียว · ไม่แก้ข้อมูลใด ๆ)
--
-- ตามรอยเอกสารหนึ่งใบว่าไปโผล่ที่ตารางไหนบ้าง ทั้ง schema dbo และ wf
-- แก้ค่า @DocuNo ที่บรรทัดเดียวแล้วรันได้เลย
--
-- ⚠ ไฟล์นี้บันทึกเป็น UTF-8 with BOM — ถ้าเปิดแล้วภาษาไทยเพี้ยน อย่ารัน
--
-- ทำไมต้องแยกสองส่วน
--   dbo = ข้อมูลของ WINSpeed (ระบบเดิม) · wf = ข้อมูลที่แอปเราสร้างเอง
--   เอกสารที่คีย์ใน WINSpeed โดยตรงจะไม่มีร่องรอยใน wf เลย และกลับกัน
--   การแยกดูจึงบอกได้ทันทีว่าใบนี้เกิดจากทางไหน
--
-- ⚠⚠ หนึ่ง DocuNo มีได้ถึงสองแถวใน SOHD และ **ส่วนใหญ่เป็นคนละเอกสารกัน**
--   DocuNo ไม่ unique ในตาราง SOHD — unique แค่ระดับ (DocuNo, DocuType)
--   มี 61,319 DocuNo ที่ปรากฏทั้ง 103 และ 104 แต่วัดจากฐานจริง 11 ส.ค. 2569:
--       ลูกค้าตรงกัน      29,387 คู่ (48%)
--       **ลูกค้าคนละราย   31,932 คู่ (52%)**
--       พนักงานคนละคน    27,239 คู่
--       ใบ 104 เก่ากว่าใบ 103   155 คู่ (เป็นไปไม่ได้ถ้าเป็นใบเดียวกัน)
--   ทั้งชุด I และชุด K ให้ผลเหมือนกัน (~48%) = ระดับที่คาดได้จากการชนกันโดยบังเอิญ
--
--   สรุป: **ห้ามถือว่าแถว 103 กับ 104 ที่เลขเดียวกันเป็นใบเดียวกัน**
--   ต้องยืนยันด้วย CustID/EmpID/วันที่ทุกครั้ง · สคริปต์นี้ตัดสินให้ในคอลัมน์ [ความสัมพันธ์]
--
-- ⚠ เลข ID ชนกันข้ามตาราง เป็นเรื่องปกติของฐานนี้
--   SOID · SOInvID · GLID ไม่ใช่ IDENTITY และไม่ได้ unique ข้ามตาราง
--       SOHD.SOID        132,260 – 274,001   (125,182 แถว)
--       SOInvHD.SOInvID    1,000 – 331,002   (304,537 แถว)
--       GLHD.GLID          1,000 – 478,001   (412,933 แถว)
--   120,652 จาก 125,182 SOID (96.4%) มีเลขเดียวกันอยู่ใน SOInvID ด้วย
--   เลขตรงกันจึงไม่ได้แปลว่าเอกสารเกี่ยวข้องกัน ต้องดู DocuNo/DocuDate ประกอบ
--
-- ⚠ RunCode ใน EMRunBrch ไม่ใช่ DocuType
--   RunCode 103 = ชุดเลข I (Iyy-00000) · RunCode 104 = ชุดเลข K (Kyy-00000)
--   ทั้งสองชุดมีเอกสารทั้ง DocuType 103 และ 104 ปนกัน — ไม่ได้แบ่งตามชนิดเอกสาร
-- =============================================================
SET NOCOUNT ON;

DECLARE @DocuNo VARCHAR(25) = 'I69-02418';

-- ตั้ง 1 เมื่อต้องการดูฝั่งแอปด้วย · ค่าปริยาย 0 = ดูเฉพาะ dbo (WINSpeed)
-- แยกสวิตช์ไว้เพราะการตามรอยส่วนใหญ่สนใจแค่ฝั่ง WINSpeed และส่วนที่ 2 ใช้เวลานานกว่า
DECLARE @IncludeWf BIT = 0;

-- ยึดใบสั่งขายเป็นหลัก · ถ้าไม่มีจึงค่อยใช้ใบส่งของ — ไม่ใช้ TOP 1 ลอย ๆ
-- เพราะ TOP 1 ที่ไม่มี ORDER BY จะเลือกแถวไหนก็ได้เมื่อ DocuNo ซ้ำสองชนิด
DECLARE @SOID INT = (
    SELECT TOP 1 SOID FROM dbo.SOHD WHERE DocuNo = @DocuNo
    ORDER BY CASE DocuType WHEN 103 THEN 0 WHEN 104 THEN 1 ELSE 2 END, SOID);

IF @SOID IS NULL
BEGIN
    SELECT N'ไม่พบเอกสารเลขที่นี้ใน dbo.SOHD' AS [ผล], @DocuNo AS [ที่ค้น];
    RETURN;
END;

PRINT '=================================================================';
PRINT ' ส่วนที่ 1 — schema dbo (WINSpeed)';
PRINT '=================================================================';

-- 1.0 ทุกแถวที่ใช้เลขที่นี้ + ตัดสินว่าเป็นใบเดียวกันหรือคนละใบ
--
-- ตัดสินจากลูกค้าเป็นหลัก เพราะเลขที่เอกสารชนกันได้แต่ลูกค้าไม่ควรเปลี่ยน
-- ถ้าลูกค้าคนละราย = คนละเอกสารแน่นอน ไม่ใช่ใบเดียวกันคนละขั้นตอน
SELECT N'แถวทั้งหมดที่ใช้เลขที่นี้' AS [ส่วน],
       h.SOID, h.DocuNo, h.DocuType,
       CASE h.DocuType WHEN 103 THEN N'ใบสั่งขาย' WHEN 104 THEN N'ใบส่งของ/ใบกำกับ'
                       ELSE CAST(h.DocuType AS VARCHAR(10)) END AS [ชนิด],
       h.DocuDate, h.CustID, c.CustName, h.EmpID, h.NetAmnt, h.DocuStatus,
       CASE WHEN h.SOID = @SOID THEN N'← ใบที่สคริปต์นี้ตามอยู่'
            WHEN h.CustID = (SELECT CustID FROM dbo.SOHD WHERE SOID = @SOID)
              THEN N'ลูกค้าเดียวกัน — น่าจะเป็นใบเดียวกันคนละขั้นตอน'
            ELSE N'⚠ ลูกค้าคนละราย — คนละเอกสาร เลขที่บังเอิญชนกัน'
       END AS [ความสัมพันธ์]
FROM dbo.SOHD h
LEFT JOIN dbo.EMCust c ON c.CustID = h.CustID
WHERE h.DocuNo = @DocuNo ORDER BY h.DocuType;

-- 1.1 หัวใบ + ลูกค้า + พนักงานขาย + เขตขาย
SELECT N'หัวใบ' AS [ส่วน],
       h.SOID, h.DocuNo, h.DocuType, h.DocuDate, h.ShipDate, h.ValidDays, h.CreditDays,
       h.CustID, c.CustCode, c.CustName,
       sa.SaleAreaCode, LEFT(sa.SaleAreaCode, 2) AS [ภาค], sa.SaleAreaName,
       h.EmpID, e.EmpCode, h.ContactName, h.TransRegistration,
       h.SumGoodAmnt, h.VATAmnt, h.NetAmnt,
       h.DocuStatus, h.AppvFlag, h.QuotStatus, h.OnHold,
       h.clearflag, h.CouponFlag, h.ClearSO, h.PkgStatus, h.RefSOID, h.RefNo
FROM dbo.SOHD h
LEFT JOIN dbo.EMCust c      ON c.CustID = h.CustID
LEFT JOIN dbo.EMSaleArea sa ON sa.SaleAreaID = c.SaleAreaID
LEFT JOIN dbo.EMEmp e       ON e.EmpID = h.EmpID
WHERE h.SOID = @SOID;

-- 1.2 บรรทัดสินค้า
--
-- ⚠ GoodQty2 เป็นจำนวนตาม "หน่วยของสินค้านั้น" ไม่ใช่ตันเสมอไป
--   สินค้าที่ชื่อขึ้นต้นว่า "กระสอบ" นับเป็นกระสอบ (50 กก.) การอ่านเป็นตันจะเพี้ยน 20 เท่า
SELECT N'บรรทัดสินค้า' AS [ส่วน],
       d.ListNo, d.GoodID, g.GoodCode, d.GoodName,
       d.GoodQty2 AS [จำนวน], u.GoodUnitName AS [หน่วย],
       d.GoodPrice2 AS [ราคาต่อหน่วย], d.GoodAmnt AS [เป็นเงิน],
       d.RemaQty AS [ค้างส่ง], d.ShipDate
FROM dbo.SODT d
LEFT JOIN dbo.EMGood g     ON g.GoodID = d.GoodID
LEFT JOIN dbo.EMGoodUnit u ON u.GoodUnitID = d.GoodUnitID2
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

-- 1.5 ตัวนับเลขที่เอกสาร — เฉพาะชุดเลขที่ใบนี้สังกัด
--
-- ต้องเทียบ "คำนำหน้าทั้งคำ" ไม่ใช่ตัวอักษรแรก มิฉะนั้น I จะไปตรงกับ IS · IQ · IB ด้วย
--   คำนำหน้าของ RunFormat = ตัวอักษรก่อน y ตัวแรก   (Iyy-00000 → I · ISyymm → IS)
--   คำนำหน้าของ DocuNo    = ตัวอักษรก่อนตัวเลขตัวแรก (I69-02420 → I)
DECLARE @Prefix VARCHAR(10) = LEFT(@DocuNo, NULLIF(PATINDEX('%[0-9]%', @DocuNo), 0) - 1);

SELECT N'ตัวนับเลขที่' AS [ส่วน], RunCode, BrchID, LastNo, RunFormat,
       CASE WHEN LastNo = @DocuNo THEN N'ใบนี้คือใบล่าสุดของชุดนี้'
            ELSE N'ชุดเดียวกัน แต่มีใบใหม่กว่าแล้ว: ' + LastNo END AS [สถานะ]
FROM dbo.EMRunBrch
WHERE RunFormat IS NOT NULL
  AND PATINDEX('%y%', RunFormat) > 1
  AND LEFT(RunFormat, PATINDEX('%y%', RunFormat) - 1) = @Prefix;

-- 1.6 เอกสารปลายน้ำ
SELECT N'เอกสารที่อ้างใบนี้ผ่าน RefSOID' AS [ส่วน], SOID, DocuNo, DocuType, DocuDate
FROM dbo.SOHD WHERE RefSOID = @SOID;

SELECT N'คูปอง (เกิดตอนออกใบส่งของ)' AS [ส่วน],
       c.CouponID, c.CouponNo, c.RefListno, c.GoodName, c.GoodQty, c.RemaQty, c.GoodPrice
FROM dbo.WFCoupon c
WHERE c.DocuID IN (SELECT SOID FROM dbo.SOHD WHERE DocuNo = @DocuNo);

SELECT N'ใบคืนรีเบทของลูกค้ารายนี้ (ช่วง ±60 วัน)' AS [ส่วน],
       i.DocuNo, i.DocuDate, i.Docutype, i.NetAmnt
FROM dbo.SOInvHD i
WHERE i.Docutype = 106 AND i.DocuNo LIKE 'RB%'
  AND i.CustID = (SELECT CustID FROM dbo.SOHD WHERE SOID = @SOID)
  AND i.DocuDate BETWEEN DATEADD(DAY, -60, (SELECT DocuDate FROM dbo.SOHD WHERE SOID = @SOID))
                     AND DATEADD(DAY,  60, (SELECT DocuDate FROM dbo.SOHD WHERE SOID = @SOID));

-- 1.7 ตารางอื่นที่บังเอิญมีเลข ID เดียวกัน
--
-- ส่วนนี้ **ไม่ใช่เอกสารที่เกี่ยวข้อง** — แสดงไว้เพื่อกันคนอ่านไปเจอเองแล้วเข้าใจผิด
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

-- ครอบด้วย sp_executesql เพราะ SQL Server ตรวจชื่อตารางตอนคอมไพล์ทั้ง batch
-- ถ้าฐานที่รันอยู่ยังไม่ได้ติดตั้ง schema wf ทั้งไฟล์จะพังตั้งแต่ส่วนที่ 1
IF @IncludeWf = 0
BEGIN
    SELECT N'ข้ามส่วนที่ 2 ตามค่า @IncludeWf = 0' AS [ผล],
           N'ตั้ง @IncludeWf = 1 ที่ต้นไฟล์ถ้าต้องการดูฝั่งแอปด้วย' AS [วิธีเปิด];
END
ELSE IF OBJECT_ID('wf.SalesOrder') IS NULL
BEGIN
    SELECT N'ฐานนี้ไม่มี schema wf — ข้ามส่วนที่ 2' AS [ผล],
           N'ปกติแปลว่ากำลังต่อฐานที่ยังไม่ได้ติดตั้งแอป หรือต่อผิดเครื่อง' AS [ความหมาย];
END
ELSE
EXEC sp_executesql N'
-- ใบที่คีย์ใน WINSpeed โดยตรงจะไม่มีอะไรในส่วนนี้เลย ซึ่งถูกต้อง
--
-- ⚠ wf.SalesOrder ไม่มีคอลัมน์ DocuNo · เก็บเลขที่ WINSpeed ไว้ที่ ImportedDocuNo
--   และ Id เป็นเลขของแอปเอง คนละความหมายกับ SOID ของ WINSpeed ห้ามเอามาเทียบกัน
SELECT N''ใบสั่งขายในแอป'' AS [ส่วน],
       Id, WfRef, ImportedDocuNo, SoPrefix, CustId, CustName, TruckPlate, Status, CreatedAt
FROM wf.SalesOrder WHERE ImportedDocuNo = @DocuNo OR WfRef = @DocuNo;

-- SOID ที่นี่เป็น VARCHAR ต้องแปลงก่อนเทียบ
SELECT N''บรรทัดเสริมของใบ'' AS [ส่วน], SOID, ListNo, NetPricePerTon, IsGiveaway, RebateBooked
FROM wf.SalesOrderLineExt WHERE SOID = CAST(@SOID AS VARCHAR(50));

-- ใบเสนอราคาใช้ QuoteNo ไม่ใช่ DocuNo · ผูกกับใบสั่งขายผ่าน ConvertedSoId
SELECT N''ใบเสนอราคาที่แปลงเป็นใบนี้'' AS [ส่วน], q.Id, q.QuoteNo, q.CustId, q.Status, q.ConvertedSoId
FROM wf.Quotation q
WHERE q.ConvertedSoId IN (SELECT Id FROM wf.SalesOrder WHERE ImportedDocuNo = @DocuNo OR WfRef = @DocuNo);

-- SoId ของ RebateLedger เก็บ SOID ของ WINSpeed (ดู migration 078)
SELECT N''ยอดรีเบทค้างรับ'' AS [ส่วน], Id, SoId, CustId, GoodCode, QtyTon, RebateAmount, Status
FROM wf.RebateLedger WHERE SoId = @SOID;

SELECT N''บรรทัดใบขอเคลียร์ที่ตัดจากใบนี้'' AS [ส่วน],
       LineId, ClaimId, GoodCode, QtyTon, SourceSOID, SourceListNo, SourceDocuNo
FROM wf.RebateClaimLine WHERE SourceSOID = @SOID OR SourceDocuNo = @DocuNo;

SELECT N''ยอดสะสมรีเบทจากใบนี้'' AS [ส่วน],
       SourceDocuNo, SourceListNo, GoodCode, QtyTon, RemainingTonRebate
FROM wf.v_RebateAccrualRemaining WHERE SourceSOID = @SOID;

-- ⚠ wf.WeighInbox ไม่มีคอลัมน์ SoId — ผูกกับใบสั่งขายได้ทางทะเบียนรถเท่านั้น
--   จึงเป็นการจับคู่แบบ "น่าจะใช่" ไม่ใช่ความสัมพันธ์ที่ระบบบันทึกไว้
SELECT N''ใบชั่งที่ทะเบียนรถตรงกัน (ไม่ใช่ความสัมพันธ์ที่ระบบผูกไว้)'' AS [ส่วน],
       w.Id, w.Sequence, w.Plate, w.CustName, w.WeightIn, w.WeightOut, w.DateIn, w.DateOut, w.Status
FROM wf.WeighInbox w
WHERE w.Plate = (SELECT TransRegistration FROM dbo.SOHD WHERE SOID = @SOID)
  AND NULLIF(LTRIM(RTRIM(w.Plate)), '''') IS NOT NULL;

-- ⚠ ApiAuditLog ใช้ Path ไม่ใช่ Route และไม่ได้เก็บ payload — ค้นได้แค่จาก URL
SELECT N''การเรียก API ที่มีเลขนี้อยู่ใน URL'' AS [ส่วน],
       Id, Method, Path, StatusCode, ActorUserId, CreatedAt
FROM wf.ApiAuditLog WHERE Path LIKE ''%'' + @DocuNo + ''%'';',
N'@DocuNo VARCHAR(25), @SOID INT', @DocuNo = @DocuNo, @SOID = @SOID;
