-- 012_seed_giveaway_budget.sql
-- Seed GiveawayBudget from Excel: สรุปเบิกเสื้อ-กระเป๋า รายภาค ปี 2026
-- Safe to re-run: uses IF NOT EXISTS guards

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00035' AND Brand=N'รถเกษตร' AND ItemName=N'16-8-8' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00035', N'ภาคเหนือ', 2026, N'รถเกษตร', N'16-8-8', 3000
  FROM wf.AppUser WHERE Username = 'sales1';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00035' AND Brand=N'รถเกษตร' AND ItemName=N'20-8-8' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00035', N'ภาคเหนือ', 2026, N'รถเกษตร', N'20-8-8', 3000
  FROM wf.AppUser WHERE Username = 'sales1';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00035' AND Brand=N'รถเกษตร' AND ItemName=N'30-0-0' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00035', N'ภาคเหนือ', 2026, N'รถเกษตร', N'30-0-0', 3000
  FROM wf.AppUser WHERE Username = 'sales1';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00035' AND Brand=N'รถเกษตร' AND ItemName=N'เสื้อยืดแขนยาว' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00035', N'ภาคเหนือ', 2026, N'รถเกษตร', N'เสื้อยืดแขนยาว', 4000
  FROM wf.AppUser WHERE Username = 'sales1';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00034' AND Brand=N'รถเกษตร' AND ItemName=N'13-3-21' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00034', N'ภาคกลาง', 2026, N'รถเกษตร', N'13-3-21', 3000
  FROM wf.AppUser WHERE Username = 'bass';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00034' AND Brand=N'รถเกษตร' AND ItemName=N'18-8-8' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00034', N'ภาคกลาง', 2026, N'รถเกษตร', N'18-8-8', 3000
  FROM wf.AppUser WHERE Username = 'bass';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00034' AND Brand=N'รถเกษตร' AND ItemName=N'20-8-8' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00034', N'ภาคกลาง', 2026, N'รถเกษตร', N'20-8-8', 3000
  FROM wf.AppUser WHERE Username = 'bass';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00034' AND Brand=N'รถเกษตร' AND ItemName=N'30-0-0' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00034', N'ภาคกลาง', 2026, N'รถเกษตร', N'30-0-0', 3000
  FROM wf.AppUser WHERE Username = 'bass';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00034' AND Brand=N'รถเกษตร' AND ItemName=N'40-0-0' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00034', N'ภาคกลาง', 2026, N'รถเกษตร', N'40-0-0', 3000
  FROM wf.AppUser WHERE Username = 'bass';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00034' AND Brand=N'รถเกษตร' AND ItemName=N'เสื้อยืดแขนยาว' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00034', N'ภาคกลาง', 2026, N'รถเกษตร', N'เสื้อยืดแขนยาว', 5000
  FROM wf.AppUser WHERE Username = 'bass';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00027' AND Brand=N'ปุ๋ยเทพ' AND ItemName=N'13-3-23' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00027', N'ภาคตะวันออก', 2026, N'ปุ๋ยเทพ', N'13-3-23', 3000
  FROM wf.AppUser WHERE Username = 'arm';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00027' AND Brand=N'รถเกษตร' AND ItemName=N'14-7-35' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00027', N'ภาคตะวันออก', 2026, N'รถเกษตร', N'14-7-35', 1000
  FROM wf.AppUser WHERE Username = 'arm';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00027' AND Brand=N'รถเกษตร' AND ItemName=N'18-4-5' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00027', N'ภาคตะวันออก', 2026, N'รถเกษตร', N'18-4-5', 3000
  FROM wf.AppUser WHERE Username = 'arm';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00027' AND Brand=N'ปุ๋ยเทพ' AND ItemName=N'20-5-3' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00027', N'ภาคตะวันออก', 2026, N'ปุ๋ยเทพ', N'20-5-3', 3000
  FROM wf.AppUser WHERE Username = 'arm';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00027' AND Brand=N'ปุ๋ยเทพ' AND ItemName=N'20-8-8' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00027', N'ภาคตะวันออก', 2026, N'ปุ๋ยเทพ', N'20-8-8', 1000
  FROM wf.AppUser WHERE Username = 'arm';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00027' AND Brand=N'รถเกษตร' AND ItemName=N'30-0-0' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00027', N'ภาคตะวันออก', 2026, N'รถเกษตร', N'30-0-0', 1000
  FROM wf.AppUser WHERE Username = 'arm';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00027' AND Brand=N'รถเกษตร' AND ItemName=N'เสื้อยืดแขนยาว' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00027', N'ภาคตะวันออก', 2026, N'รถเกษตร', N'เสื้อยืดแขนยาว', 4000
  FROM wf.AppUser WHERE Username = 'arm';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00036' AND Brand=N'รถเกษตร' AND ItemName=N'15-3-3' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00036', N'ภาคอีสานกลาง', 2026, N'รถเกษตร', N'15-3-3', 2000
  FROM wf.AppUser WHERE Username = 'sales2';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00036' AND Brand=N'รถเกษตร' AND ItemName=N'15-7-18' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00036', N'ภาคอีสานกลาง', 2026, N'รถเกษตร', N'15-7-18', 3000
  FROM wf.AppUser WHERE Username = 'sales2';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00036' AND Brand=N'รถเกษตร' AND ItemName=N'16-8-8' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00036', N'ภาคอีสานกลาง', 2026, N'รถเกษตร', N'16-8-8', 3000
  FROM wf.AppUser WHERE Username = 'sales2';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00036' AND Brand=N'รถเกษตร' AND ItemName=N'18-4-5' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00036', N'ภาคอีสานกลาง', 2026, N'รถเกษตร', N'18-4-5', 2000
  FROM wf.AppUser WHERE Username = 'sales2';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00036' AND Brand=N'ปุ๋ยเทพ' AND ItemName=N'20-8-8' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00036', N'ภาคอีสานกลาง', 2026, N'ปุ๋ยเทพ', N'20-8-8', 3000
  FROM wf.AppUser WHERE Username = 'sales2';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00036' AND Brand=N'รถเกษตร' AND ItemName=N'22-6-4' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00036', N'ภาคอีสานกลาง', 2026, N'รถเกษตร', N'22-6-4', 3000
  FROM wf.AppUser WHERE Username = 'sales2';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00036' AND Brand=N'รถเกษตร' AND ItemName=N'เสื้อยืดแขนยาว' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00036', N'ภาคอีสานกลาง', 2026, N'รถเกษตร', N'เสื้อยืดแขนยาว', 12000
  FROM wf.AppUser WHERE Username = 'sales2';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00037' AND Brand=N'รถเกษตร' AND ItemName=N'14-7-35' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00037', N'ภาคใต้', 2026, N'รถเกษตร', N'14-7-35', 3000
  FROM wf.AppUser WHERE Username = 'ann';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00037' AND Brand=N'รถเกษตร' AND ItemName=N'15-5-20' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00037', N'ภาคใต้', 2026, N'รถเกษตร', N'15-5-20', 3000
  FROM wf.AppUser WHERE Username = 'ann';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00037' AND Brand=N'รถเกษตร' AND ItemName=N'15-10-30' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00037', N'ภาคใต้', 2026, N'รถเกษตร', N'15-10-30', 3000
  FROM wf.AppUser WHERE Username = 'ann';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00037' AND Brand=N'รถเกษตร' AND ItemName=N'เสื้อยืดแขนยาว' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00037', N'ภาคใต้', 2026, N'รถเกษตร', N'เสื้อยืดแขนยาว', 3270
  FROM wf.AppUser WHERE Username = 'ann';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00041' AND Brand=N'รถเกษตร' AND ItemName=N'15-3-3' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00041', N'ภาคอีสานบน', 2026, N'รถเกษตร', N'15-3-3', 1000
  FROM wf.AppUser WHERE Username = 'um';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00041' AND Brand=N'รถเกษตร' AND ItemName=N'15-7-18' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00041', N'ภาคอีสานบน', 2026, N'รถเกษตร', N'15-7-18', 1000
  FROM wf.AppUser WHERE Username = 'um';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00041' AND Brand=N'รถเกษตร' AND ItemName=N'20-5-5' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00041', N'ภาคอีสานบน', 2026, N'รถเกษตร', N'20-5-5', 1000
  FROM wf.AppUser WHERE Username = 'um';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00041' AND Brand=N'รถเกษตร' AND ItemName=N'29-5-18' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00041', N'ภาคอีสานบน', 2026, N'รถเกษตร', N'29-5-18', 2000
  FROM wf.AppUser WHERE Username = 'um';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00041' AND Brand=N'รถเกษตร' AND ItemName=N'เสื้อยืดแขนยาว' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00041', N'ภาคอีสานบน', 2026, N'รถเกษตร', N'เสื้อยืดแขนยาว', 7000
  FROM wf.AppUser WHERE Username = 'um';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00042' AND Brand=N'รถเกษตร' AND ItemName=N'13-3-21' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00042', N'ภาคอีสานล่าง', 2026, N'รถเกษตร', N'13-3-21', 3000
  FROM wf.AppUser WHERE Username = 'ton';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00042' AND Brand=N'รถเกษตร' AND ItemName=N'16-8-8' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00042', N'ภาคอีสานล่าง', 2026, N'รถเกษตร', N'16-8-8', 2000
  FROM wf.AppUser WHERE Username = 'ton';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00042' AND Brand=N'รถเกษตร' AND ItemName=N'18-4-5' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00042', N'ภาคอีสานล่าง', 2026, N'รถเกษตร', N'18-4-5', 3000
  FROM wf.AppUser WHERE Username = 'ton';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00042' AND Brand=N'รถเกษตร' AND ItemName=N'19-6-6' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00042', N'ภาคอีสานล่าง', 2026, N'รถเกษตร', N'19-6-6', 3000
  FROM wf.AppUser WHERE Username = 'ton';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00042' AND Brand=N'รถเกษตร' AND ItemName=N'20-5-5' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00042', N'ภาคอีสานล่าง', 2026, N'รถเกษตร', N'20-5-5', 3000
  FROM wf.AppUser WHERE Username = 'ton';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00042' AND Brand=N'รถเกษตร' AND ItemName=N'29-5-18' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00042', N'ภาคอีสานล่าง', 2026, N'รถเกษตร', N'29-5-18', 1000
  FROM wf.AppUser WHERE Username = 'ton';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00042' AND Brand=N'รถเกษตร' AND ItemName=N'เสื้อยืดแขนยาว' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00042', N'ภาคอีสานล่าง', 2026, N'รถเกษตร', N'เสื้อยืดแขนยาว', 12500
  FROM wf.AppUser WHERE Username = 'ton';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00053' AND Brand=N'ปุ๋ยเทพ' AND ItemName=N'13-3-23' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00053', N'ภาคปุ๋ยเทพ 1', 2026, N'ปุ๋ยเทพ', N'13-3-23', 3000
  FROM wf.AppUser WHERE Username = 'na';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00053' AND Brand=N'ปุ๋ยเทพ' AND ItemName=N'15-5-25' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00053', N'ภาคปุ๋ยเทพ 1', 2026, N'ปุ๋ยเทพ', N'15-5-25', 3000
  FROM wf.AppUser WHERE Username = 'na';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00053' AND Brand=N'ปุ๋ยเทพ' AND ItemName=N'20-5-3' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00053', N'ภาคปุ๋ยเทพ 1', 2026, N'ปุ๋ยเทพ', N'20-5-3', 3000
  FROM wf.AppUser WHERE Username = 'na';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00053' AND Brand=N'ปุ๋ยเทพ' AND ItemName=N'เสื้อยืดแขนยาว' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00053', N'ภาคปุ๋ยเทพ 1', 2026, N'ปุ๋ยเทพ', N'เสื้อยืดแขนยาว', 3000
  FROM wf.AppUser WHERE Username = 'na';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00024' AND Brand=N'ปุ๋ยเทพ' AND ItemName=N'13-3-23' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00024', N'ภาคปุ๋ยเทพ 2', 2026, N'ปุ๋ยเทพ', N'13-3-23', 2818
  FROM wf.AppUser WHERE Username = 'don';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00024' AND Brand=N'ปุ๋ยเทพ' AND ItemName=N'15-5-25' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00024', N'ภาคปุ๋ยเทพ 2', 2026, N'ปุ๋ยเทพ', N'15-5-25', 3000
  FROM wf.AppUser WHERE Username = 'don';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00024' AND Brand=N'ปุ๋ยเทพ' AND ItemName=N'15-10-30' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00024', N'ภาคปุ๋ยเทพ 2', 2026, N'ปุ๋ยเทพ', N'15-10-30', 3000
  FROM wf.AppUser WHERE Username = 'don';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00024' AND Brand=N'ปุ๋ยเทพ' AND ItemName=N'20-5-3' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00024', N'ภาคปุ๋ยเทพ 2', 2026, N'ปุ๋ยเทพ', N'20-5-3', 2000
  FROM wf.AppUser WHERE Username = 'don';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00024' AND Brand=N'ปุ๋ยเทพ' AND ItemName=N'20-8-8' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00024', N'ภาคปุ๋ยเทพ 2', 2026, N'ปุ๋ยเทพ', N'20-8-8', 3000
  FROM wf.AppUser WHERE Username = 'don';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00024' AND Brand=N'ปุ๋ยเทพ' AND ItemName=N'เสื้อยืดแขนยาว' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00024', N'ภาคปุ๋ยเทพ 2', 2026, N'ปุ๋ยเทพ', N'เสื้อยืดแขนยาว', 4000
  FROM wf.AppUser WHERE Username = 'don';

GO
-- Verify
SELECT a.Username, a.DisplayName, g.Region, g.Brand, g.ItemName, g.BudgetQty
FROM wf.GiveawayBudget g
JOIN wf.AppUser a ON a.Id = g.SalesUserId
WHERE g.PeriodYear = 2569
ORDER BY g.Region, a.Username, g.Brand, g.ItemName;
GO
