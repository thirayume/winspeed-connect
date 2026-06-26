-- =============================================================
-- 011_seed_sales_users_giveaway.sql
-- 1. Create 8 missing sales AppUsers (password: Sales@2026)
-- 2. Seed GiveawayBudget monthly for all 10 sales users (annual / 12)
-- Safe to re-run: uses IF NOT EXISTS guards
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

-- ── 2. GiveawayBudget (annual / 12 per month, year 2026) ──────
-- Annual budgets from Excel:
--   sales1  (ชูชาติ)  EMP-00035 = 13,000  → 1,083.33/mo
--   bass    (เดโช)    EMP-00034 = 20,000  → 1,666.67/mo
--   arm     (ศรายุทธ) EMP-00027 = 16,000  → 1,333.33/mo
--   sales2  (มนัส)    EMP-00036 = 28,000  → 2,333.33/mo
--   ann     (สมะแอน)  EMP-00037 = 12,270  → 1,022.50/mo
--   um      (ชัยชนะ)  EMP-00041 = 12,000  → 1,000.00/mo
--   ton     (ต้นฉัตร) EMP-00042 = 27,500  → 2,291.67/mo
--   na      (ชนะชัย)  EMP-00053 = 12,000  → 1,000.00/mo
--   don     (บุญฤทธิ์) EMP-00024 = 17,818 → 1,484.83/mo
--   oh      (จักพงษ์) EMP-00021 = 0       → 0.00/mo

DECLARE @year INT = 2026;

-- Seed per-user per-month (month 1-12)
WITH Months AS (
    SELECT v FROM (VALUES(1),(2),(3),(4),(5),(6),(7),(8),(9),(10),(11),(12)) t(v)
),
Users AS (
    SELECT Username, MonthlyBudget FROM (VALUES
        ('sales1', CAST(13000.00/12 AS DECIMAL(12,2))),
        ('bass',   CAST(20000.00/12 AS DECIMAL(12,2))),
        ('arm',    CAST(16000.00/12 AS DECIMAL(12,2))),
        ('sales2', CAST(28000.00/12 AS DECIMAL(12,2))),
        ('ann',    CAST(12270.00/12 AS DECIMAL(12,2))),
        ('um',     CAST(12000.00/12 AS DECIMAL(12,2))),
        ('ton',    CAST(27500.00/12 AS DECIMAL(12,2))),
        ('na',     CAST(12000.00/12 AS DECIMAL(12,2))),
        ('don',    CAST(17818.00/12 AS DECIMAL(12,2))),
        ('oh',     CAST(0.00       AS DECIMAL(12,2)))
    ) t(Username, MonthlyBudget)
)
INSERT INTO wf.GiveawayBudget (SalesUserId, PeriodYear, PeriodMonth, TotalBudget, UsedAmt)
SELECT
    u.Id,
    @year,
    m.v,
    usr.MonthlyBudget,
    0.00
FROM Users usr
JOIN wf.AppUser u ON u.Username = usr.Username
CROSS JOIN Months m
WHERE NOT EXISTS (
    SELECT 1 FROM wf.GiveawayBudget gb
    WHERE gb.SalesUserId = u.Id
      AND gb.PeriodYear  = @year
      AND gb.PeriodMonth = m.v
);
GO

-- ── Verify ────────────────────────────────────────────────────
SELECT
    a.Username,
    a.DisplayName,
    SUM(gb.TotalBudget) AS AnnualBudget,
    COUNT(*)            AS Months
FROM wf.GiveawayBudget gb
JOIN wf.AppUser a ON a.Id = gb.SalesUserId
WHERE gb.PeriodYear = 2026
GROUP BY a.Username, a.DisplayName
ORDER BY AnnualBudget DESC;
GO
