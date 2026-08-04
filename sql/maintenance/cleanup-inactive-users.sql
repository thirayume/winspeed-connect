-- =============================================================
-- cleanup-inactive-users.sql — จัดการบัญชีที่ปิดใช้งานแล้วแต่รหัสผ่านยังใช้ร่วมกับคนอื่น
--
-- ปัญหาที่แก้ (D6-02 ส่วนที่ยังค้าง)
--   audit-duplicate-passwords.js --fix กรอง IsActive = 1 จึงตั้งธง MustChangePassword
--   ให้เฉพาะบัญชีที่ยังใช้งานอยู่ 51 บัญชี เหลือบัญชี SALES ที่ปิดใช้งานแล้วอีก 20 บัญชี
--   ที่ยัง **ถือรหัสผ่านตัวเดียวกับเพื่อนร่วมงานอีก 40 คนที่ยังทำงานอยู่**
--
--   ตราบใดที่รหัสยังเหมือนกัน การปิด IsActive ไม่ได้ตัดความเสี่ยง เพราะถ้าบัญชีใด
--   ถูกเปิดใช้อีกครั้ง (พนักงานกลับเข้าทำงาน หรือเปิดผิด) มันจะกลับมาพร้อมรหัสที่
--   ใครก็ตามในกลุ่ม 61 คนเดารู้ได้ทันที และ audit trail จะชี้ชื่อคนผิดตัว
--
-- ⚠ สคริปต์นี้ **ไม่ลบบัญชี** โดยเจตนา
--   มี 33 foreign key ชี้มาที่ wf.AppUser การลบพนักงานที่เคยออกใบสั่งขายหรือเคยอนุมัติ
--   จะทำลายหลักฐานย้อนหลัง ซึ่งเป็นสิ่งเดียวกับที่งาน ISO ต้องการรักษาไว้
--   สิ่งที่ทำคือ **ตัดรหัสผ่านทิ้ง** ให้เข้าระบบไม่ได้ ในขณะที่ชื่อยังอ้างอิงได้เหมือนเดิม
--
-- วิธีใช้: รันขั้นที่ 1 ดูรายชื่อก่อน แล้วจึงรันขั้นที่ 2
-- =============================================================

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- ── ขั้นที่ 1 · ภาพรวมของปัญหา (อ่านอย่างเดียว) ────────────────────────

SELECT N'บัญชีทั้งหมด' AS รายการ, COUNT(*) AS จำนวน FROM wf.AppUser
UNION ALL SELECT N'ใช้งานอยู่',   COUNT(*) FROM wf.AppUser WHERE IsActive = 1
UNION ALL SELECT N'ปิดใช้งาน',    COUNT(*) FROM wf.AppUser WHERE IsActive = 0
UNION ALL SELECT N'รหัสผ่านซ้ำกับบัญชีอื่น', COUNT(*) FROM wf.AppUser
          WHERE PasswordHash IN (SELECT PasswordHash FROM wf.AppUser
                                 GROUP BY PasswordHash HAVING COUNT(*) > 1)
UNION ALL SELECT N'ตั้งธงบังคับเปลี่ยนแล้ว', COUNT(*) FROM wf.AppUser WHERE MustChangePassword = 1;

-- กลุ่มรหัสผ่านที่ใช้ร่วมกัน — ตัวเลขนี้คือขนาดของช่องโหว่
SELECT COUNT(*) AS จำนวนบัญชีในกลุ่ม,
       SUM(CASE WHEN IsActive = 1 THEN 1 ELSE 0 END) AS ยังใช้งาน,
       SUM(CASE WHEN IsActive = 0 THEN 1 ELSE 0 END) AS ปิดใช้งาน,
       MIN(Username) AS ตัวอย่างบัญชี
FROM wf.AppUser
GROUP BY PasswordHash
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC;

-- บัญชีที่ปิดใช้งาน แต่ยังถือรหัสผ่านร่วมกับคนที่ยังทำงานอยู่ — กลุ่มเป้าหมายของสคริปต์นี้
SELECT u.Username, u.DisplayName, u.Role, u.EmpId, u.MustChangePassword,
       (SELECT COUNT(*) FROM wf.AppUser p
        WHERE p.PasswordHash = u.PasswordHash AND p.IsActive = 1) AS คนที่ยังทำงานและใช้รหัสเดียวกัน
FROM wf.AppUser u
WHERE u.IsActive = 0
  AND u.PasswordHash IN (SELECT PasswordHash FROM wf.AppUser
                         GROUP BY PasswordHash HAVING COUNT(*) > 1)
ORDER BY u.Username;
GO

-- ── ขั้นที่ 2 · ตัดรหัสผ่านของบัญชีที่ปิดใช้งานทิ้ง ──────────────────────
--
-- ค่าใหม่เป็นข้อความที่ไม่ใช่ผลลัพธ์ของฟังก์ชันแฮชใด จึงไม่มีรหัสผ่านใดตรงได้
-- และไม่ซ้ำกันแต่ละบัญชี ทำให้หลุดออกจากกลุ่ม "รหัสผ่านซ้ำ" ทันที
--
-- ตั้ง MustChangePassword = 1 ไว้ด้วย เผื่อวันหนึ่งบัญชีถูกเปิดใช้อีกครั้ง
-- ผู้ดูแลจะเห็นทันทีว่าต้องตั้งรหัสใหม่ให้ ไม่ใช่ปล่อยผ่าน

UPDATE wf.AppUser
SET PasswordHash       = CONCAT(N'disabled-inactive-', CONVERT(NVARCHAR(36), NEWID())),
    MustChangePassword = 1,
    UpdatedAt          = GETUTCDATE()
WHERE IsActive = 0
  AND PasswordHash NOT LIKE N'disabled-%'
  AND PasswordHash IN (SELECT PasswordHash FROM wf.AppUser
                       GROUP BY PasswordHash HAVING COUNT(*) > 1);

SELECT N'ตัดรหัสผ่านของบัญชีที่ปิดใช้งาน' AS ผลลัพธ์, @@ROWCOUNT AS จำนวนบัญชี;
GO

-- ── ขั้นที่ 3 · ตรวจผล ─────────────────────────────────────────────────

SELECT N'บัญชีปิดใช้งานที่รหัสยังซ้ำ' AS ตรวจสอบ, COUNT(*) AS จำนวน
FROM wf.AppUser
WHERE IsActive = 0
  AND PasswordHash IN (SELECT PasswordHash FROM wf.AppUser
                       GROUP BY PasswordHash HAVING COUNT(*) > 1);
-- ต้องได้ 0

SELECT N'บัญชีที่ยังใช้งานและรหัสยังซ้ำ' AS ตรวจสอบ, COUNT(*) AS จำนวน
FROM wf.AppUser
WHERE IsActive = 1
  AND PasswordHash IN (SELECT PasswordHash FROM wf.AppUser
                       GROUP BY PasswordHash HAVING COUNT(*) > 1);
-- ยังไม่เป็น 0 จนกว่าผู้ใช้จริงจะเปลี่ยนรหัสด้วยตนเอง — ติดตามด้วยคิวรีข้างล่าง
GO

-- ── ขั้นที่ 4 · ติดตามความคืบหน้าการเปลี่ยนรหัสของผู้ใช้จริง ──────────────
--
-- ใช้รันซ้ำเป็นระยะ เพื่อรายงานต่อผู้ตรวจว่าเหลืออีกกี่คน

SELECT u.Role,
       COUNT(*)                                             AS ทั้งหมด,
       SUM(CASE WHEN u.MustChangePassword = 1 THEN 1 ELSE 0 END) AS ยังไม่เปลี่ยน,
       SUM(CASE WHEN u.MustChangePassword = 0 THEN 1 ELSE 0 END) AS เปลี่ยนแล้ว
FROM wf.AppUser u
WHERE u.IsActive = 1
GROUP BY u.Role
ORDER BY ยังไม่เปลี่ยน DESC;
GO
