-- =============================================================
-- 011_seed_sales_users_giveaway.sql
-- Create 8 missing sales AppUsers (password: Sales@2026)
-- Safe to re-run: uses IF NOT EXISTS guards
--
-- NOTE: การ seed GiveawayBudget ย้ายไปอยู่ที่ 012_seed_giveaway_budget.sql
--       (schema ใหม่ใช้ Region/Brand/ItemName/BudgetQty ไม่ใช่ TotalBudget/UsedAmt)
--       section เดิมถูกลบออกเพราะอ้างคอลัมน์ที่เลิกใช้แล้ว → migrate รัน clean
-- =============================================================

-- ── 1. AppUsers ───────────────────────────────────────────────
-- Nickname-based usernames from Excel display names
-- Existing: sales1 = ชูชาติ (EMP-00035)
-- Renamed:  sales2 → manas = มนัส (EMP-00036)

-- rename sales2 → manas (idempotent)
IF EXISTS (SELECT 1 FROM wf.AppUser WHERE Username = 'sales2')
  UPDATE wf.AppUser SET Username = 'manas', DisplayName = N'มนัส (พนักงานขาย)' WHERE Username = 'sales2';
GO

-- link surachai APPROVER EmpId (only if chai doesn't already hold it)
IF NOT EXISTS (SELECT 1 FROM wf.AppUser WHERE EmpId = '1018' AND Username <> 'surachai')
  UPDATE wf.AppUser SET EmpId = '1018' WHERE Username = 'surachai';
GO

-- สุรชัย (SALES) — EMP-00019
IF NOT EXISTS (SELECT 1 FROM wf.AppUser WHERE Username = 'chai')
INSERT INTO wf.AppUser (Username, PasswordHash, DisplayName, Role, EmpId, IsActive)
VALUES ('chai', '$2b$12$oes4OIRs60AC.r5MmgzMdeZkJelanWV2RI8ncpQ66dutFyGbrc6Ei',
        N'สุรชัย (ช้าย)', 'SALES', '1018', 1);
GO

IF NOT EXISTS (SELECT 1 FROM wf.AppUser WHERE Username = 'bass')
INSERT INTO wf.AppUser (Username, PasswordHash, DisplayName, Role, EmpId, IsActive)
VALUES ('bass', '$2b$12$oes4OIRs60AC.r5MmgzMdeZkJelanWV2RI8ncpQ66dutFyGbrc6Ei',
        'เดโช จินดาจำนง (เบส)', 'SALES', '3001', 1);
GO

IF NOT EXISTS (SELECT 1 FROM wf.AppUser WHERE Username = 'arm')
INSERT INTO wf.AppUser (Username, PasswordHash, DisplayName, Role, EmpId, IsActive)
VALUES ('arm', '$2b$12$oes4OIRs60AC.r5MmgzMdeZkJelanWV2RI8ncpQ66dutFyGbrc6Ei',
        'ศรายุทธ จันทร์ป้อง (อาร์ม)', 'SALES', '1026', 1);
GO

IF NOT EXISTS (SELECT 1 FROM wf.AppUser WHERE Username = 'ann')
INSERT INTO wf.AppUser (Username, PasswordHash, DisplayName, Role, EmpId, IsActive)
VALUES ('ann', '$2b$12$oes4OIRs60AC.r5MmgzMdeZkJelanWV2RI8ncpQ66dutFyGbrc6Ei',
        'สมะแอน มูหำหมัด (แอน)', 'SALES', '5000', 1);
GO

IF NOT EXISTS (SELECT 1 FROM wf.AppUser WHERE Username = 'um')
INSERT INTO wf.AppUser (Username, PasswordHash, DisplayName, Role, EmpId, IsActive)
VALUES ('um', '$2b$12$oes4OIRs60AC.r5MmgzMdeZkJelanWV2RI8ncpQ66dutFyGbrc6Ei',
        'ชัยชนะ เนาะวราช (อุ้ม)', 'SALES', '7002', 1);
GO

IF NOT EXISTS (SELECT 1 FROM wf.AppUser WHERE Username = 'ton')
INSERT INTO wf.AppUser (Username, PasswordHash, DisplayName, Role, EmpId, IsActive)
VALUES ('ton', '$2b$12$oes4OIRs60AC.r5MmgzMdeZkJelanWV2RI8ncpQ66dutFyGbrc6Ei',
        'ต้นฉัตร เสนาวัตร (ต้น)', 'SALES', '7004', 1);
GO

IF NOT EXISTS (SELECT 1 FROM wf.AppUser WHERE Username = 'na')
INSERT INTO wf.AppUser (Username, PasswordHash, DisplayName, Role, EmpId, IsActive)
VALUES ('na', '$2b$12$oes4OIRs60AC.r5MmgzMdeZkJelanWV2RI8ncpQ66dutFyGbrc6Ei',
        'ชนะชัย สิมมา (นะ)', 'SALES', '8010', 1);
GO

IF NOT EXISTS (SELECT 1 FROM wf.AppUser WHERE Username = 'don')
INSERT INTO wf.AppUser (Username, PasswordHash, DisplayName, Role, EmpId, IsActive)
VALUES ('don', '$2b$12$oes4OIRs60AC.r5MmgzMdeZkJelanWV2RI8ncpQ66dutFyGbrc6Ei',
        'บุญฤทธิ์ ทองจันทร์ (ดอน)', 'SALES', '1023', 1);
GO

IF NOT EXISTS (SELECT 1 FROM wf.AppUser WHERE Username = 'oh')
INSERT INTO wf.AppUser (Username, PasswordHash, DisplayName, Role, EmpId, IsActive)
VALUES ('oh', '$2b$12$oes4OIRs60AC.r5MmgzMdeZkJelanWV2RI8ncpQ66dutFyGbrc6Ei',
        'จักพงษ์ เณรจิตย์ (โอ๋)', 'SALES', '1020', 1);
GO
