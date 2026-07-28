-- =============================================================
-- 062_appuser_role_full_rbac.sql
-- ขยาย CHECK constraint ของ wf.AppUser.Role ให้ครบทุกบทบาทที่โค้ดใช้จริง
--
-- ปัญหาเดิม: chk_AppUser_Role อนุญาตเพียง 7 ค่า แต่โค้ดนิยามไว้ 9 ค่า
--   WSSale-App/src/types/index.ts  -> type UserRole มี 9 ค่า
--   backend/middleware/auth.js     -> REBATE_ALL_ROLES อ้าง C_LEVEL
--   backend/routes/*.js            -> requireRole(... 'C_LEVEL') กว่า 50 จุด
--   backend/seed_admin.js          -> กำหนด role = 'C_LEVEL' ให้พนักงาน EmpGroupID 2000
--
-- ผลกระทบที่เกิดขึ้นจริงถ้าไม่แก้:
--   1. seed_admin.js จะล้มตอน provision ลูกค้าใหม่ ทันทีที่เจอพนักงานกลุ่ม 2000
--      เพราะ INSERT ค่า C_LEVEL ชนกับ constraint
--   2. ไม่มีผู้ใช้คนใดถือบทบาท WEIGHBRIDGE ได้ ทั้งที่ SOP-03 และคู่มือ WF-UG-WB-001
--      มอบงานชั่งออกให้บทบาทนี้ และ nav ก็อ้างถึงใน roles: [...]
--
-- ไม่ลดสิทธิ์ของใคร เป็นการ "ขยาย" ชุดค่าที่ยอมรับเท่านั้น ข้อมูลเดิมจึงผ่านทั้งหมด
-- Safe to re-run (idempotent)
-- =============================================================

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chk_AppUser_Role')
  ALTER TABLE wf.AppUser DROP CONSTRAINT chk_AppUser_Role;
GO

ALTER TABLE wf.AppUser WITH CHECK ADD CONSTRAINT chk_AppUser_Role CHECK (Role IN (
  'ADMIN',
  'C_LEVEL',
  'MANAGER',
  'APPROVER',
  'ACCOUNTING',
  'SALES',
  'COUNTER_SALES',
  'WAREHOUSE',
  'WEIGHBRIDGE'
));
GO

-- ยืนยันว่าแถวเดิมทั้งหมดยังผ่าน constraint ใหม่ (is_not_trusted = 0 แปลว่าตรวจแล้วผ่าน)
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chk_AppUser_Role' AND is_not_trusted = 1)
  RAISERROR('chk_AppUser_Role ไม่ถูกตรวจสอบกับข้อมูลเดิม — มีแถวที่ Role ไม่อยู่ในรายการ', 16, 1);
GO
