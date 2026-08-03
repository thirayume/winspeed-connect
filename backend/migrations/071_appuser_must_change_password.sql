-- =============================================================
-- 071_appuser_must_change_password.sql
--
-- ธงบอกว่าบัญชีนี้ยังใช้รหัสผ่านตั้งต้นที่ซ้ำกับบัญชีอื่น (D6-02)
--
-- ปัญหาที่ธงนี้แก้: เมื่อผู้ใช้หลายคนใช้รหัสผ่านเดียวกัน ชื่อผู้ทำรายการใน
-- audit trail ไม่ได้พิสูจน์ว่าใครทำจริง — ใครก็เข้าแทนกันได้ หลักฐานการอนุมัติ
-- ทุกชั้นจึงอ่อนลงทั้งระบบ
--
-- คอลัมน์นี้ถูกอ้างถึงโดย backend/routes/auth.js และหน้าจอเตือนใน App.tsx
-- เดิม backend/scripts/audit-duplicate-passwords.js สร้างคอลัมน์เองด้วย ALTER
-- ตอนรัน --fix ซึ่งทำให้ฐานที่ยังไม่เคยรันสคริปต์นั้นไม่มีคอลัมน์ และ login
-- จะพังทันทีที่ deploy ใหม่ จึงย้ายมาอยู่ในบัญชี migration ให้ทุกฐานได้เหมือนกัน
--
-- ค่าเริ่มต้นเป็น 0 = ไม่บังคับเปลี่ยน การตั้งค่าเป็น 1 ให้บัญชีที่รหัสซ้ำ
-- ยังเป็นหน้าที่ของ audit-duplicate-passwords.js เพราะต้องอ่าน PasswordHash
-- มาเทียบกันก่อน ไม่ใช่สิ่งที่ migration ควรตัดสิน
--
-- Safe to re-run (idempotent)
-- =============================================================

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'wf' AND TABLE_NAME = 'AppUser' AND COLUMN_NAME = 'MustChangePassword'
)
BEGIN
    ALTER TABLE wf.AppUser ADD MustChangePassword BIT NOT NULL
        CONSTRAINT DF_AppUser_MustChangePassword DEFAULT 0;
    PRINT 'เพิ่มคอลัมน์ wf.AppUser.MustChangePassword';
END
ELSE
    PRINT 'มีคอลัมน์ wf.AppUser.MustChangePassword อยู่แล้ว — ข้าม';
GO
