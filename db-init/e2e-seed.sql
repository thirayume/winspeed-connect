-- E2E Test Data Seed
-- Creates test users for all roles.
-- PasswordHash ด้านล่างคือ bcrypt ของรหัสตั้งต้น — ไม่เขียนรหัสจริงไว้ในไฟล์นี้
-- เพราะที่เก็บซอร์สนี้เป็นสาธารณะ · ค่าจริงอยู่ใน backend/.env (E2E_PASSWORD)

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
SET NOCOUNT ON;

-- Confirmed SO rows require an EmpId that exists in native WINSpeed EMEmp.
DECLARE @E2EEmpId NVARCHAR(20);
SELECT TOP (1) @E2EEmpId = CONVERT(NVARCHAR(20), EmpID)
FROM dbo.EMEmp WITH (NOLOCK)
WHERE EmpID IS NOT NULL
ORDER BY EmpID;
IF @E2EEmpId IS NULL
BEGIN
  RAISERROR('E2E seed requires at least one dbo.EMEmp row', 16, 1);
  RETURN;
END;

-- Upsert stable fixtures; deleting users would break audit/FK references from prior evidence runs.
MERGE wf.AppUser AS target
USING (VALUES
  ('e2e_admin',    'E2E Admin',     'ADMIN'),
  ('e2e_sales',    'E2E Sales',     'SALES'),
  ('e2e_counter',  'E2E Counter',   'COUNTER_SALES'),
  ('e2e_warehouse','E2E Warehouse', 'WAREHOUSE'),
  ('e2e_manager',  'E2E Manager',   'MANAGER'),
  ('e2e_approver', 'E2E Approver',  'APPROVER'),
  -- ACCOUNTING มีคู่มือและ SOP อยู่แล้ว แต่ไม่เคยมีบัญชีทดสอบ จึงทดสอบสิทธิ์
  -- และถ่ายภาพหน้าจอไม่ได้เลย
  --
  -- ต้องครบทั้ง 9 บทบาทตาม type UserRole ใน WSSale-App/src/types/index.ts
  -- ไม่งั้นบทบาทที่ขาดจะทดสอบสิทธิ์ไม่ได้และไม่มีภาพหน้าจอในคู่มือ
  -- (C_LEVEL และ WEIGHBRIDGE ใช้ได้หลัง migration 062 ขยาย chk_AppUser_Role แล้ว)
  ('e2e_accounting','E2E Accounting','ACCOUNTING'),
  ('e2e_weighbridge','E2E Weighbridge','WEIGHBRIDGE'),
  ('e2e_clevel',   'E2E C-Level',   'C_LEVEL')
) AS source (Username, DisplayName, Role)
ON target.Username = source.Username
-- MustChangePassword = 0 เสมอสำหรับบัญชีทดสอบ
--
-- ตั้งแต่ v1.6.0 เซิร์ฟเวอร์บล็อกคำสั่งเขียนของบัญชีที่ธงนี้เป็น 1 (D6-02)
-- บัญชีชุดนี้ใช้รหัสผ่านร่วมกันโดยเจตนา และ audit-duplicate-passwords.js --fix
-- จะตั้งธงให้ทุกครั้งที่รัน ถ้าไม่ล้างกลับตรงนี้ ชุด E2E จะล้มทั้งชุดตั้งแต่
-- ขั้นสร้างใบสั่งขาย โดยที่ไม่มีอะไรผิดในโค้ดที่กำลังทดสอบ
--
-- ปลอดภัยเพราะบัญชีเหล่านี้ไม่ควรมีอยู่บน production อยู่แล้ว —
-- ล้างด้วย sql/maintenance/cleanup-e2e-users.sql
WHEN MATCHED THEN UPDATE SET
  PasswordHash = '$2b$10$Vx2BFiZ9eALMWjJfAM.cb.dza0KWsB3D9JLRYyhw9Cu6fZfbThFwm',
  DisplayName = source.DisplayName,
  Role = source.Role,
  EmpId = @E2EEmpId,
  MustChangePassword = 0
WHEN NOT MATCHED THEN INSERT (Username, PasswordHash, DisplayName, Role, EmpId, MustChangePassword)
VALUES (source.Username, '$2b$10$Vx2BFiZ9eALMWjJfAM.cb.dza0KWsB3D9JLRYyhw9Cu6fZfbThFwm', source.DisplayName, source.Role, @E2EEmpId, 0);
