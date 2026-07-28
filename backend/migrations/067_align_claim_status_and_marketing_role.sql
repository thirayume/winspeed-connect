-- =============================================================
-- 067_align_claim_status_and_marketing_role.sql
-- ปรับ CHECK constraint สองตัวให้ตรงกับค่าที่โค้ดใช้จริง
--
-- ปัญหาที่ 1 — wf.RebateClaim.chk_RC_Status
--   constraint เดิมรับเพียง 'PENDING' และ 'APPROVED'
--   แต่ routes/rebate.js เดินสถานะ 4 ชั้นด้วยค่า TIER2_PENDING, TIER3_PENDING,
--   TIER4_PENDING, REJECTED, CN_ISSUED และ DRAFT
--   ผลคือการยื่นเคลมทุกใบล้มทันทีที่ INSERT เพราะชนกับ constraint
--   (ตรวจแล้วว่า constraint ยังเปิดบังคับใช้อยู่ ไม่ได้ถูก disable)
--
--   คง 'PENDING' ไว้ด้วยเพราะเป็นค่าของใบเคลมที่สร้างก่อนระบบ 4 ชั้น
--   การถอดออกจะทำให้ข้อมูลเดิมผิด constraint ทันที
--
-- ปัญหาที่ 2 — wf.AppUser.chk_AppUser_Role
--   ชั้นที่ 3 ของการอนุมัติคือผู้จัดการฝ่ายตลาด แต่ยังไม่มีบทบาท MARKETING
--   ให้แต่งตั้ง จึงเดินถึงชั้น 3 ไม่ได้
--
-- ทั้งสองข้อเป็นการ "ขยาย" ค่าที่ยอมรับ ไม่ลดสิทธิ์และไม่ทำให้ข้อมูลเดิมผิด
-- Safe to re-run (idempotent)
-- =============================================================

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chk_RC_Status')
  ALTER TABLE wf.RebateClaim DROP CONSTRAINT chk_RC_Status;
GO

ALTER TABLE wf.RebateClaim WITH CHECK ADD CONSTRAINT chk_RC_Status CHECK (Status IN (
  'DRAFT',            -- ร่าง ยังไม่ยื่น
  'PENDING',          -- ใบเดิมก่อนมีระบบ 4 ชั้น
  'TIER2_PENDING',    -- รอผู้จัดการภาค
  'TIER3_PENDING',    -- รอผู้จัดการฝ่ายตลาด
  'TIER4_PENDING',    -- รอกรรมการบริหาร
  'APPROVED',         -- อนุมัติครบทุกชั้น
  'REJECTED',         -- ถูกตีกลับ
  'CN_ISSUED'         -- ออกใบลดหนี้แล้ว
));
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chk_AppUser_Role')
  ALTER TABLE wf.AppUser DROP CONSTRAINT chk_AppUser_Role;
GO

ALTER TABLE wf.AppUser WITH CHECK ADD CONSTRAINT chk_AppUser_Role CHECK (Role IN (
  'ADMIN',
  'C_LEVEL',
  'MANAGER',
  'MARKETING',        -- ผู้จัดการฝ่ายตลาด — ผู้อนุมัติชั้นที่ 3
  'APPROVER',
  'ACCOUNTING',
  'SALES',
  'COUNTER_SALES',
  'WAREHOUSE',
  'WEIGHBRIDGE'
));
GO

-- ถ้าข้อมูลเดิมแถวใดไม่ผ่าน constraint ใหม่ SQL Server จะทำเครื่องหมาย not trusted ไว้
-- ต้องหยุดทันที ไม่ปล่อยให้ migration ผ่านแบบครึ่ง ๆ กลาง ๆ
IF EXISTS (SELECT 1 FROM sys.check_constraints
           WHERE name IN ('chk_RC_Status', 'chk_AppUser_Role') AND is_not_trusted = 1)
  RAISERROR('มีข้อมูลเดิมที่ไม่ผ่าน constraint ใหม่ — ตรวจ wf.RebateClaim.Status และ wf.AppUser.Role', 16, 1);
GO
