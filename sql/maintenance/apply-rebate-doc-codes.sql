-- =============================================================
-- apply-rebate-doc-codes.sql
--
-- ตั้งรหัสผู้ขอใช้รีเบท (wf.AppUser.RebateDocCode) ให้พนักงานขายที่มีเอกสารเดิมรองรับ
--
-- ⚠ ต้องรัน review-rebate-doc-codes.sql ก่อน แล้วให้ฝ่ายขายยืนยัน
-- ⚠ ไฟล์นี้บันทึกเป็น UTF-8 with BOM — ถ้าเปิดแล้วภาษาไทยเพี้ยน อย่ารัน
--
-- ที่มาของรหัส
--   เอกสารคืนรีเบทใน WINSpeed คือ dbo.SOInvHD Docutype 106
--   เลขที่รูปแบบ RB<รหัสผู้ขอ><ปี พ.ศ. 2 หลัก>-<ลำดับ> เช่น RBD68-049
--   EmpID ว่างทั้ง 16,195 ใบ — อักษรในเลขที่เอกสารเป็นร่องรอยเดียวที่บอกว่าใครขอ
--
--   จับคู่โดยดูว่าใบแต่ละใบออกให้ลูกค้าของพนักงานขายคนไหน แล้วเลือก
--   "ชุดอักษรหลัก" ของแต่ละคน = ชุดที่คนนั้นมีเอกสารมากที่สุด
--
--   หนึ่งลูกค้าไม่ได้มีพนักงานขายคนเดียวเสมอไป (305 รายมีคนเดียว · 112 ราย 2 คน ·
--   88 ราย 3 คน) จึงใช้ "คนที่ออกใบส่งของให้บ่อยที่สุด" เป็นเกณฑ์ ไม่ใช่ค่าที่แน่นอน
--
-- อักษรที่มีเจ้าของคนเดียว — คงอักษรเดิมไว้ เพื่อให้ลำดับเลขที่เอกสารเดินต่อได้
-- อักษรที่มีผู้อ้างสิทธิ์มากกว่าหนึ่งคน — เติมเลขต่อท้ายตามที่เจ้าของงานกำหนด
--   D ใช้ร่วมกันจริง (EMP-00037 855 ใบ · EMP-00034 609 ใบ) → D1 · D2
--   S เมื่อจัดชุดหลักแล้วเหลือผู้อ้างสิทธิ์คนเดียว → S1 (เว้น S2, S3 ไว้เผื่อ)
--   ทั้ง D1 D2 S1 จะเริ่มนับลำดับใหม่ที่ 001 เพราะเป็นรหัสใหม่
-- =============================================================
SET NOCOUNT ON;

IF COL_LENGTH('wf.AppUser','RebateDocCode') IS NULL
BEGIN
    RAISERROR('ยังไม่ได้รัน migration 079 — ไม่มีคอลัมน์ wf.AppUser.RebateDocCode', 16, 1);
    RETURN;
END;

-- อ้างพนักงานด้วย **รหัส** ไม่ใส่ชื่อในไฟล์ เพราะที่เก็บซอร์สนี้เป็นสาธารณะ
-- ชื่อจะถูกดึงจาก dbo.EMEmp ตอนแสดงผล ผู้รันจึงยังเห็นว่าใครได้รหัสอะไร
DECLARE @Plan TABLE (EmpCode VARCHAR(20), Code NVARCHAR(2), Docs INT, Note NVARCHAR(200));

INSERT INTO @Plan (EmpCode, Code, Docs, Note) VALUES
  ('EMP-00027', 'A',  1679, N'ชุด A มีเจ้าของคนเดียว — คงอักษรเดิม ลำดับเดินต่อได้'),
  ('EMP-00035', 'B',  3066, N'ชุด B มีเจ้าของคนเดียว — คงอักษรเดิม'),
  ('EMP-00021', 'O',   104, N'ชุด O มีเจ้าของคนเดียว — คงอักษรเดิม'),
  ('EMP-00033', 'P',  1941, N'ชุด P มีเจ้าของคนเดียว — คงอักษรเดิม'),
  ('EMP-00042', 'T',   652, N'ชุด T มีเจ้าของคนเดียว — คงอักษรเดิม'),
  ('EMP-00030', 'V',  1192, N'ชุด V มีเจ้าของคนเดียว — คงอักษรเดิม'),
  ('EMP-00036', 'Y',  1074, N'ชุด Y มีเจ้าของคนเดียว — คงอักษรเดิม'),
  ('EMP-00037', 'D1',  855, N'ชุด D ใช้ร่วมกัน — เลขที่เอกสารจะเริ่มนับใหม่'),
  ('EMP-00034', 'D2',  609, N'ชุด D ใช้ร่วมกัน — เลขที่เอกสารจะเริ่มนับใหม่'),
  ('EMP-00041', 'S1', 1069, N'ชุด S เหลือผู้อ้างสิทธิ์คนเดียว — เว้น S2 S3 ไว้เผื่อ');

-- ── ตรวจก่อนแก้ ─────────────────────────────────────────────────────────
-- 1. คนในแผนที่ยังไม่มีบัญชีในระบบ — รายงานไว้ แต่ไม่หยุด
--
--    เจตนา: การหยุดทั้งสคริปต์เพราะคนหนึ่งยังไม่ได้เปิดบัญชี จะทำให้อีกเก้าคน
--    ไม่ได้รหัสไปด้วย ซึ่งแย่กว่า · คนที่ตกค้างจะขึ้นในรายการท้ายไฟล์อยู่แล้ว
--    แยกให้ชัดว่า "ไม่มีบัญชี" หรือ "มีบัญชีแต่ถูกปิดใช้งาน" เพราะวิธีแก้คนละอย่าง
SELECT CASE WHEN u.Id IS NULL
            THEN N'ยังไม่มีบัญชีในระบบ — ต้องเปิดบัญชีก่อนจึงตั้งรหัสได้'
            ELSE N'บัญชีถูกปิดใช้งานอยู่ — ตรวจว่าลาออกจริง หรือถูกปิดโดยไม่ตั้งใจ'
       END AS [ข้อสังเกต],
       p.EmpCode AS [รหัสพนักงาน], emp.EmpName AS [ชื่อ], p.Code AS [รหัสที่วางไว้],
       p.Docs AS [เอกสารเดิม], u.Username AS [บัญชี]
FROM @Plan p
LEFT JOIN dbo.EMEmp emp ON emp.EmpCode = p.EmpCode
LEFT JOIN (
    SELECT u.Id, u.Username, e.EmpCode
    FROM wf.AppUser u JOIN dbo.EMEmp e ON CAST(e.EmpID AS NVARCHAR(20)) = u.EmpId
    WHERE u.IsActive = 0
) u ON u.EmpCode = p.EmpCode
WHERE NOT EXISTS (
    SELECT 1 FROM wf.AppUser a
    JOIN dbo.EMEmp e2 ON CAST(e2.EmpID AS NVARCHAR(20)) = a.EmpId
    WHERE e2.EmpCode = p.EmpCode AND a.IsActive = 1);

-- 2. รหัสต้องไม่ชนกับที่ตั้งไว้แล้วให้คนอื่น
IF EXISTS (
    SELECT 1
    FROM @Plan p
    JOIN wf.AppUser other ON other.RebateDocCode = p.Code
    WHERE NOT EXISTS (
        SELECT 1 FROM dbo.EMEmp e
        WHERE CAST(e.EmpID AS NVARCHAR(20)) = other.EmpId AND e.EmpCode = p.EmpCode))
BEGIN
    SELECT N'รหัสถูกใช้โดยคนอื่นแล้ว' AS Problem, p.Code, p.EmpCode AS PlannedFor, other.Username AS CurrentOwner
    FROM @Plan p
    JOIN wf.AppUser other ON other.RebateDocCode = p.Code
    WHERE NOT EXISTS (
        SELECT 1 FROM dbo.EMEmp e
        WHERE CAST(e.EmpID AS NVARCHAR(20)) = other.EmpId AND e.EmpCode = p.EmpCode);
    RAISERROR('รหัสในแผนชนกับที่ตั้งไว้แล้ว — แก้ที่หน้าจอก่อนแล้วค่อยรันซ้ำ', 16, 1);
    RETURN;
END;

-- ── ตั้งค่า ─────────────────────────────────────────────────────────────
UPDATE u
SET u.RebateDocCode = p.Code
FROM wf.AppUser u
JOIN dbo.EMEmp e ON CAST(e.EmpID AS NVARCHAR(20)) = u.EmpId
JOIN @Plan p     ON p.EmpCode = e.EmpCode
WHERE u.IsActive = 1
  AND (u.RebateDocCode IS NULL OR u.RebateDocCode <> p.Code);

SELECT N'ตั้งรหัสแล้ว' AS [ผล], u.Username, u.DisplayName, u.RebateDocCode AS [รหัส],
       p.Docs AS [เอกสารเดิม], p.Note AS [หมายเหตุ]
FROM wf.AppUser u
JOIN dbo.EMEmp e ON CAST(e.EmpID AS NVARCHAR(20)) = u.EmpId
JOIN @Plan p     ON p.EmpCode = e.EmpCode
ORDER BY u.RebateDocCode;

-- ── ที่ยังไม่มีรหัส ─────────────────────────────────────────────────────
-- ใช้กติกาใหม่: ตัวแรกของชื่อ + ตัวแรกของนามสกุล เป็นอักษรโรมัน
-- ตั้งจากหน้าจอ ข้อมูลหลัก → ผู้อนุมัติรายภาค → รหัสผู้ขอใช้รีเบท (ระบบเสนอให้ กดยืนยันเอง)
SELECT N'ยังไม่มีรหัส' AS [สถานะ], u.Username, u.DisplayName, u.Role
FROM wf.AppUser u
WHERE u.IsActive = 1 AND u.RebateDocCode IS NULL AND u.Role IN ('SALES','MANAGER')
ORDER BY u.Username;
