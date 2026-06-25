-- ══════════════════════════════════════════════════════════════
-- WF Logins + Permissions (run as sysadmin / Windows Auth)
-- ⚠ ไม่มีคำสั่งใดแตะ dbo (data/structure) — สร้าง login + user เท่านั้น
--
-- Permission model (เพื่อบังคับ iron rule "dbo = READ-ONLY"):
--   wf_reader : db_datareader  → อ่านได้ทั้ง DB, เขียนไม่ได้เลย
--   wf_owner  : db_datareader + CONTROL ON SCHEMA::wf
--               → อ่าน dbo ได้, อ่าน/เขียน wf ได้, แต่ "เขียน dbo ไม่ได้"
-- ══════════════════════════════════════════════════════════════

USE master;
GO

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'wf_reader')
  CREATE LOGIN wf_reader WITH PASSWORD = 'ChangeMe_Strong#2026', CHECK_POLICY = OFF;
GO

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'wf_owner')
  CREATE LOGIN wf_owner WITH PASSWORD = 'WfOwner_Strong#2026', CHECK_POLICY = OFF;
GO

USE dbwins_worldfert9;
GO

-- wf_reader user
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'wf_reader')
  CREATE USER wf_reader FOR LOGIN wf_reader;
GO
ALTER ROLE db_datareader ADD MEMBER wf_reader;
GO

-- wf_owner user
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'wf_owner')
  CREATE USER wf_owner FOR LOGIN wf_owner;
GO
-- อ่าน dbo (master data) ได้ — แต่ "เขียน dbo ไม่ได้" (ไม่ใส่ db_datawriter)
ALTER ROLE db_datareader ADD MEMBER wf_owner;
GO

PRINT '✓ Logins + users created (wf_reader, wf_owner)';
GO
