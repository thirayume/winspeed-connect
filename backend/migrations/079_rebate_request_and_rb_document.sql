-- =============================================================
-- 079_rebate_request_and_rb_document.sql
--
-- ปิดช่องว่างสองเรื่องที่พบเมื่อตรวจเทียบกับเอกสารกระดาษจริง (6 ส.ค. 2569)
--
-- (1) รหัสผู้ขอใช้รีเบทบนเลขที่เอกสาร RB
--
--     เอกสารคืนรีเบทใน WINSpeed คือ dbo.SOInvHD Docutype 106 เลขที่รูปแบบ
--     RB<รหัสผู้ขอ><ปี พ.ศ. 2 หลัก>-<ลำดับ>  เช่น RBD68-049
--
--     ตรวจจากฐานจริง: 16,195 ใบ · **EmpID ว่างทั้งหมด**
--     WINSpeed ไม่ได้บันทึกว่าใครเป็นผู้ขอเลย — อักษรในเลขที่เอกสารเป็นร่องรอยเดียว
--     ที่บอกได้ว่าพนักงานขายคนไหนขอใช้ จึงต้องตั้งค่าให้ผูกกับบัญชีผู้ใช้ให้ชัด
--
--     ความสัมพันธ์ในอดีต (นับจากพนักงานขายประจำของลูกค้าในใบส่งของ · อ้างด้วยรหัส
--     พนักงาน ไม่ใส่ชื่อ เพราะที่เก็บซอร์สนี้เป็นสาธารณะ):
--       A→EMP-00027 1,679 · B→EMP-00035 3,066 · P→EMP-00033 1,941
--       T→EMP-00042 653 · V→EMP-00030 1,173 · Y→EMP-00036 1,074
--       D และ S คาบเกี่ยว 2-3 คน — **ไม่เดาให้** ต้องให้ผู้ดูแลยืนยันเอง
--     จึงไม่ seed ค่าใด ๆ แต่ทำ view หลักฐานไว้ให้ผู้ดูแลตัดสินใจ
--
-- (2) ใบขอเคลียร์ต้องบอกได้ว่า "เบิกของเดือนไหน" และผูกกับใบ RB ที่ออกจริง
--
--     รีเบทเบิกย้อนหลังตามเอกสารขออนุมัติ ใบ RB ในระบบเดิมจึงเขียนเดือนไว้ในหมายเหตุ
--     เช่น "ขออนุมัติเคลียร์รายการส่งเสริมการขาย เดือน กุมภาพันธ์ 2569"
--     ซึ่งเป็นข้อความอิสระ ค้นและกระทบยอดไม่ได้ · เก็บเป็นตัวเลขฝั่งเราแทน
-- =============================================================

-- 1. รหัสผู้ขอใช้รีเบท ผูกกับบัญชีผู้ใช้
--
-- 2 ตัวอักษรตามที่เจ้าของงานเสนอ — ของเดิมใช้ตัวเดียว แต่ตัวเดียวมีแค่ 26 ค่า
-- และเริ่มชนกันแล้ว (D กับ S ถูกใช้ทับกัน) สองตัวจึงรองรับพนักงานที่ชื่อขึ้นต้นซ้ำกันได้
IF COL_LENGTH('wf.AppUser','RebateDocCode') IS NULL
    ALTER TABLE wf.AppUser ADD RebateDocCode NVARCHAR(2) NULL;
GO

-- รหัสซ้ำกันไม่ได้ มิฉะนั้นเลขที่เอกสารสองคนจะชนกันและตรวจย้อนกลับไม่ได้ว่าใครขอ
-- filtered index เพราะบัญชีส่วนใหญ่ (บัญชี ผู้ดูแล คลัง) ไม่ต้องมีรหัสนี้
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_AppUser_RebateDocCode' AND object_id = OBJECT_ID('wf.AppUser'))
    CREATE UNIQUE INDEX UX_AppUser_RebateDocCode ON wf.AppUser (RebateDocCode)
        WHERE RebateDocCode IS NOT NULL;
GO

-- 2. งวดที่ขอเบิก + ร่องรอยใบ RB ที่ออกจริง
IF COL_LENGTH('wf.RebateClaim','PeriodYear') IS NULL
    ALTER TABLE wf.RebateClaim ADD PeriodYear INT NULL;
GO
IF COL_LENGTH('wf.RebateClaim','PeriodMonth') IS NULL
    ALTER TABLE wf.RebateClaim ADD PeriodMonth INT NULL;
GO
-- SOInvID ของใบ RB ใน WINSpeed เมื่อกระทบยอดเจอแล้ว · ว่าง = ยังไม่ออกใบ หรือยังหาไม่เจอ
IF COL_LENGTH('wf.RebateClaim','RbSOInvID') IS NULL
    ALTER TABLE wf.RebateClaim ADD RbSOInvID INT NULL;
GO
IF COL_LENGTH('wf.RebateClaim','RbDocDate') IS NULL
    ALTER TABLE wf.RebateClaim ADD RbDocDate DATE NULL;
GO
IF COL_LENGTH('wf.RebateClaim','RbMatchedAt') IS NULL
    ALTER TABLE wf.RebateClaim ADD RbMatchedAt DATETIME2 NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chk_RebateClaim_Period')
    ALTER TABLE wf.RebateClaim ADD CONSTRAINT chk_RebateClaim_Period
        CHECK (PeriodMonth IS NULL OR PeriodMonth BETWEEN 1 AND 12);
GO

-- 3. หลักฐานช่วยผู้ดูแลตั้งรหัสให้ถูกคน
--
-- ไม่ตั้งให้อัตโนมัติ เพราะ D และ S ในอดีตคาบเกี่ยวหลายคน การเดาแล้วผิด
-- จะทำให้เลขที่เอกสารชี้ไปผิดคนอย่างถาวร · แสดงตัวเลขให้คนตัดสินแทน
IF OBJECT_ID('wf.v_RebateDocCodeEvidence', 'V') IS NOT NULL DROP VIEW wf.v_RebateDocCodeEvidence;
GO
CREATE VIEW wf.v_RebateDocCodeEvidence
AS
WITH CustEmp AS (
    -- พนักงานขายประจำของลูกค้าแต่ละราย = คนที่ออกใบส่งของให้บ่อยที่สุด
    SELECT CustID, EmpID,
           ROW_NUMBER() OVER (PARTITION BY CustID ORDER BY COUNT(*) DESC, EmpID) AS rn
    FROM dbo.SOHD
    WHERE DocuType = 104 AND EmpID IS NOT NULL
    GROUP BY CustID, EmpID
)
SELECT
    SUBSTRING(h.DocuNo, 3, 1)                        AS SeriesCode,
    e.EmpID,
    e.EmpCode,
    e.EmpName,
    COUNT(*)                                         AS DocCount,
    MIN(h.DocuDate)                                  AS FirstDoc,
    MAX(h.DocuDate)                                  AS LastDoc,
    SUM(h.NetAmnt)                                   AS TotalAmnt
FROM dbo.SOInvHD h
JOIN CustEmp ce ON ce.CustID = h.CustID AND ce.rn = 1
JOIN dbo.EMEmp e ON e.EmpID = ce.EmpID
WHERE h.DocuNo LIKE 'RB%' AND h.Docutype = 106
GROUP BY SUBSTRING(h.DocuNo, 3, 1), e.EmpID, e.EmpCode, e.EmpName;
GO

-- 4. กระทบยอด: ใบขอเคลียร์ในแอป ↔ ใบ RB ใน WINSpeed
--
-- ตอบสองคำถามที่ผู้ตรวจถามเสมอ: ใบที่อนุมัติแล้วออกใบ RB ครบหรือยัง
-- และใบ RB ที่ออกไปมีใบขอเคลียร์รองรับหรือไม่
IF OBJECT_ID('wf.v_RebateRbReconciliation', 'V') IS NOT NULL DROP VIEW wf.v_RebateRbReconciliation;
GO
CREATE VIEW wf.v_RebateRbReconciliation
AS
-- ฝั่งแอป: ใบขอเคลียร์ที่อนุมัติครบแล้ว
SELECT
    'CLAIM'                                          AS Side,
    c.Id                                             AS ClaimId,
    c.CnDocuNo                                       AS RbDocuNo,
    c.CustId,
    c.ClaimAmt                                       AS AppAmt,
    rb.NetAmnt                                       AS WinAmt,
    CAST(rb.DocuDate AS DATE)                        AS RbDocDate,
    c.PeriodYear, c.PeriodMonth,
    c.Status,
    CASE
        WHEN c.CnDocuNo IS NULL OR LTRIM(RTRIM(c.CnDocuNo)) = '' THEN N'ยังไม่ระบุเลขที่ใบคืนรีเบท'
        WHEN rb.SOInvID IS NULL                                  THEN N'ไม่พบใบนี้ใน WINSpeed'
        WHEN ABS(rb.NetAmnt - c.ClaimAmt) > 0.01                 THEN N'ยอดไม่ตรงกับ WINSpeed'
        ELSE N'ตรงกัน'
    END                                              AS MatchStatus
FROM wf.RebateClaim c
LEFT JOIN dbo.SOInvHD rb
       ON rb.DocuNo = c.CnDocuNo AND rb.Docutype = 106
WHERE c.Status = 'APPROVED'

UNION ALL

-- ฝั่ง WINSpeed: ใบ RB ที่ไม่มีใบขอเคลียร์ในแอปรองรับ
SELECT
    'WINSPEED'                                       AS Side,
    NULL                                             AS ClaimId,
    rb.DocuNo                                        AS RbDocuNo,
    CAST(rb.CustID AS NVARCHAR(20))                  AS CustId,
    NULL                                             AS AppAmt,
    rb.NetAmnt                                       AS WinAmt,
    CAST(rb.DocuDate AS DATE)                        AS RbDocDate,
    NULL, NULL,
    NULL                                             AS Status,
    N'ไม่มีใบขอเคลียร์ในแอป'                          AS MatchStatus
FROM dbo.SOInvHD rb
WHERE rb.Docutype = 106
  AND rb.DocuNo LIKE 'RB%'
  AND NOT EXISTS (SELECT 1 FROM wf.RebateClaim c WHERE c.CnDocuNo = rb.DocuNo);
GO

PRINT '✓ WF migration 079 complete (rebate requester code + claim period + RB reconciliation)'
GO
