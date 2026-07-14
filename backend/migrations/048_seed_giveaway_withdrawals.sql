-- 048_seed_giveaway_withdrawals.sql
-- Seed GiveawayWithdrawal from Excel (Historical Data)

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00035' AND Brand=N'รถเกษตร' AND ItemName=N'16-8-8' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00035', N'ภาคเหนือ', 2026, N'รถเกษตร', N'16-8-8', 100, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'sales1';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'รถเกษตร' AND ItemName=N'16-8-8')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'รถเกษตร', N'16-8-8', CASE WHEN N'16-8-8' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'16-8-8' LIKE N'%แบนเนอร์%' OR N'16-8-8' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'16-8-8' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00035' AND Brand=N'รถเกษตร' AND ItemName=N'20-8-8' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00035', N'ภาคเหนือ', 2026, N'รถเกษตร', N'20-8-8', 100, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'sales1';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'รถเกษตร' AND ItemName=N'20-8-8')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'รถเกษตร', N'20-8-8', CASE WHEN N'20-8-8' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'20-8-8' LIKE N'%แบนเนอร์%' OR N'20-8-8' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'20-8-8' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00035' AND Brand=N'รถเกษตร' AND ItemName=N'เสื้อยืดแขนยาว' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00035', N'ภาคเหนือ', 2026, N'รถเกษตร', N'เสื้อยืดแขนยาว', 1375, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'sales1';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'รถเกษตร' AND ItemName=N'เสื้อยืดแขนยาว')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'รถเกษตร', N'เสื้อยืดแขนยาว', CASE WHEN N'เสื้อยืดแขนยาว' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'เสื้อยืดแขนยาว' LIKE N'%แบนเนอร์%' OR N'เสื้อยืดแขนยาว' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'เสื้อยืดแขนยาว' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00035' AND Brand=N'รถเกษตร' AND ItemName=N'15-3-3' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00035', N'ภาคเหนือ', 2026, N'รถเกษตร', N'15-3-3', 100, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'sales1';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00035' AND Brand=N'รถเกษตร' AND ItemName=N'15-3-3' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00035', N'ภาคเหนือ', 2026, N'รถเกษตร', N'15-3-3', 0
  FROM wf.AppUser WHERE Username = 'sales1';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'รถเกษตร' AND ItemName=N'15-3-3')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'รถเกษตร', N'15-3-3', CASE WHEN N'15-3-3' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'15-3-3' LIKE N'%แบนเนอร์%' OR N'15-3-3' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'15-3-3' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00035' AND Brand=N'รถเกษตร' AND ItemName=N'18-4-5' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00035', N'ภาคเหนือ', 2026, N'รถเกษตร', N'18-4-5', 300, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'sales1';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00035' AND Brand=N'รถเกษตร' AND ItemName=N'18-4-5' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00035', N'ภาคเหนือ', 2026, N'รถเกษตร', N'18-4-5', 0
  FROM wf.AppUser WHERE Username = 'sales1';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'รถเกษตร' AND ItemName=N'18-4-5')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'รถเกษตร', N'18-4-5', CASE WHEN N'18-4-5' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'18-4-5' LIKE N'%แบนเนอร์%' OR N'18-4-5' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'18-4-5' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00035' AND Brand=N'รถเกษตร' AND ItemName=N'18-8-8' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00035', N'ภาคเหนือ', 2026, N'รถเกษตร', N'18-8-8', 300, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'sales1';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00035' AND Brand=N'รถเกษตร' AND ItemName=N'18-8-8' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00035', N'ภาคเหนือ', 2026, N'รถเกษตร', N'18-8-8', 0
  FROM wf.AppUser WHERE Username = 'sales1';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'รถเกษตร' AND ItemName=N'18-8-8')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'รถเกษตร', N'18-8-8', CASE WHEN N'18-8-8' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'18-8-8' LIKE N'%แบนเนอร์%' OR N'18-8-8' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'18-8-8' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00035' AND Brand=N'รถเกษตร' AND ItemName=N'40-0-0' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00035', N'ภาคเหนือ', 2026, N'รถเกษตร', N'40-0-0', 100, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'sales1';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00035' AND Brand=N'รถเกษตร' AND ItemName=N'40-0-0' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00035', N'ภาคเหนือ', 2026, N'รถเกษตร', N'40-0-0', 0
  FROM wf.AppUser WHERE Username = 'sales1';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'รถเกษตร' AND ItemName=N'40-0-0')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'รถเกษตร', N'40-0-0', CASE WHEN N'40-0-0' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'40-0-0' LIKE N'%แบนเนอร์%' OR N'40-0-0' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'40-0-0' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00035' AND Brand=N'รถเกษตร' AND ItemName=N'แบนเนอร์ รถเกษตร' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00035', N'ภาคเหนือ', 2026, N'รถเกษตร', N'แบนเนอร์ รถเกษตร', 2, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'sales1';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00035' AND Brand=N'รถเกษตร' AND ItemName=N'แบนเนอร์ รถเกษตร' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00035', N'ภาคเหนือ', 2026, N'รถเกษตร', N'แบนเนอร์ รถเกษตร', 0
  FROM wf.AppUser WHERE Username = 'sales1';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'รถเกษตร' AND ItemName=N'แบนเนอร์ รถเกษตร')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'รถเกษตร', N'แบนเนอร์ รถเกษตร', CASE WHEN N'แบนเนอร์ รถเกษตร' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'แบนเนอร์ รถเกษตร' LIKE N'%แบนเนอร์%' OR N'แบนเนอร์ รถเกษตร' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'แบนเนอร์ รถเกษตร' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00035' AND Brand=N'25235' AND ItemName=N'รถเกษตร' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00035', N'ภาคเหนือ', 2026, N'25235', N'รถเกษตร', 325, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'sales1';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'25235' AND ItemName=N'รถเกษตร')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'25235', N'รถเกษตร', CASE WHEN N'รถเกษตร' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'รถเกษตร' LIKE N'%แบนเนอร์%' OR N'รถเกษตร' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'รถเกษตร' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00035' AND Brand=N'25263' AND ItemName=N'รถเกษตร' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00035', N'ภาคเหนือ', 2026, N'25263', N'รถเกษตร', 630, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'sales1';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'25263' AND ItemName=N'รถเกษตร')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'25263', N'รถเกษตร', CASE WHEN N'รถเกษตร' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'รถเกษตร' LIKE N'%แบนเนอร์%' OR N'รถเกษตร' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'รถเกษตร' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00035' AND Brand=N'25294' AND ItemName=N'รถเกษตร' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00035', N'ภาคเหนือ', 2026, N'25294', N'รถเกษตร', 100, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'sales1';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'25294' AND ItemName=N'รถเกษตร')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'25294', N'รถเกษตร', CASE WHEN N'รถเกษตร' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'รถเกษตร' LIKE N'%แบนเนอร์%' OR N'รถเกษตร' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'รถเกษตร' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00034' AND Brand=N'รถเกษตร' AND ItemName=N'เสื้อยืดแขนยาว' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00034', N'ภาคกลาง', 2026, N'รถเกษตร', N'เสื้อยืดแขนยาว', 402, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'bass';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'รถเกษตร' AND ItemName=N'เสื้อยืดแขนยาว')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'รถเกษตร', N'เสื้อยืดแขนยาว', CASE WHEN N'เสื้อยืดแขนยาว' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'เสื้อยืดแขนยาว' LIKE N'%แบนเนอร์%' OR N'เสื้อยืดแขนยาว' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'เสื้อยืดแขนยาว' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00034' AND Brand=N'รถเกษตร' AND ItemName=N'แบนเนอร์ตรารถเกษตร' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00034', N'ภาคกลาง', 2026, N'รถเกษตร', N'แบนเนอร์ตรารถเกษตร', 6, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'bass';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00034' AND Brand=N'รถเกษตร' AND ItemName=N'แบนเนอร์ตรารถเกษตร' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00034', N'ภาคกลาง', 2026, N'รถเกษตร', N'แบนเนอร์ตรารถเกษตร', 0
  FROM wf.AppUser WHERE Username = 'bass';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'รถเกษตร' AND ItemName=N'แบนเนอร์ตรารถเกษตร')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'รถเกษตร', N'แบนเนอร์ตรารถเกษตร', CASE WHEN N'แบนเนอร์ตรารถเกษตร' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'แบนเนอร์ตรารถเกษตร' LIKE N'%แบนเนอร์%' OR N'แบนเนอร์ตรารถเกษตร' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'แบนเนอร์ตรารถเกษตร' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00034' AND Brand=N'รถเกษตร' AND ItemName=N'18-4-5' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00034', N'ภาคกลาง', 2026, N'รถเกษตร', N'18-4-5', 100, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'bass';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00034' AND Brand=N'รถเกษตร' AND ItemName=N'18-4-5' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00034', N'ภาคกลาง', 2026, N'รถเกษตร', N'18-4-5', 0
  FROM wf.AppUser WHERE Username = 'bass';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'รถเกษตร' AND ItemName=N'18-4-5')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'รถเกษตร', N'18-4-5', CASE WHEN N'18-4-5' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'18-4-5' LIKE N'%แบนเนอร์%' OR N'18-4-5' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'18-4-5' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00034' AND Brand=N'25235' AND ItemName=N'รถเกษตร' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00034', N'ภาคกลาง', 2026, N'25235', N'รถเกษตร', 100, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'bass';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'25235' AND ItemName=N'รถเกษตร')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'25235', N'รถเกษตร', CASE WHEN N'รถเกษตร' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'รถเกษตร' LIKE N'%แบนเนอร์%' OR N'รถเกษตร' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'รถเกษตร' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00034' AND Brand=N'25263' AND ItemName=N'รถเกษตร' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00034', N'ภาคกลาง', 2026, N'25263', N'รถเกษตร', 196, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'bass';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'25263' AND ItemName=N'รถเกษตร')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'25263', N'รถเกษตร', CASE WHEN N'รถเกษตร' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'รถเกษตร' LIKE N'%แบนเนอร์%' OR N'รถเกษตร' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'รถเกษตร' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00034' AND Brand=N'25294' AND ItemName=N'รถเกษตร' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00034', N'ภาคกลาง', 2026, N'25294', N'รถเกษตร', 100, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'bass';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'25294' AND ItemName=N'รถเกษตร')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'25294', N'รถเกษตร', CASE WHEN N'รถเกษตร' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'รถเกษตร' LIKE N'%แบนเนอร์%' OR N'รถเกษตร' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'รถเกษตร' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00027' AND Brand=N'รถเกษตร' AND ItemName=N'เสื้อยืดแขนยาว' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00027', N'ภาคตะวันออก', 2026, N'รถเกษตร', N'เสื้อยืดแขนยาว', 150, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'arm';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'รถเกษตร' AND ItemName=N'เสื้อยืดแขนยาว')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'รถเกษตร', N'เสื้อยืดแขนยาว', CASE WHEN N'เสื้อยืดแขนยาว' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'เสื้อยืดแขนยาว' LIKE N'%แบนเนอร์%' OR N'เสื้อยืดแขนยาว' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'เสื้อยืดแขนยาว' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00027' AND Brand=N'25263' AND ItemName=N'รถเกษตร' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00027', N'ภาคตะวันออก', 2026, N'25263', N'รถเกษตร', 150, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'arm';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'25263' AND ItemName=N'รถเกษตร')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'25263', N'รถเกษตร', CASE WHEN N'รถเกษตร' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'รถเกษตร' LIKE N'%แบนเนอร์%' OR N'รถเกษตร' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'รถเกษตร' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00036' AND Brand=N'รถเกษตร' AND ItemName=N'16-8-8' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00036', N'ภาคอีสานกลาง', 2026, N'รถเกษตร', N'16-8-8', 100, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'manas';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'รถเกษตร' AND ItemName=N'16-8-8')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'รถเกษตร', N'16-8-8', CASE WHEN N'16-8-8' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'16-8-8' LIKE N'%แบนเนอร์%' OR N'16-8-8' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'16-8-8' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00036' AND Brand=N'รถเกษตร' AND ItemName=N'18-4-5' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00036', N'ภาคอีสานกลาง', 2026, N'รถเกษตร', N'18-4-5', 200, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'manas';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'รถเกษตร' AND ItemName=N'18-4-5')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'รถเกษตร', N'18-4-5', CASE WHEN N'18-4-5' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'18-4-5' LIKE N'%แบนเนอร์%' OR N'18-4-5' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'18-4-5' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00036' AND Brand=N'รถเกษตร' AND ItemName=N'เสื้อยืดแขนยาว' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00036', N'ภาคอีสานกลาง', 2026, N'รถเกษตร', N'เสื้อยืดแขนยาว', 1020, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'manas';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'รถเกษตร' AND ItemName=N'เสื้อยืดแขนยาว')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'รถเกษตร', N'เสื้อยืดแขนยาว', CASE WHEN N'เสื้อยืดแขนยาว' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'เสื้อยืดแขนยาว' LIKE N'%แบนเนอร์%' OR N'เสื้อยืดแขนยาว' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'เสื้อยืดแขนยาว' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00036' AND Brand=N'รถเกษตร' AND ItemName=N'แบนเนอร์ตรารถเกษตร' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00036', N'ภาคอีสานกลาง', 2026, N'รถเกษตร', N'แบนเนอร์ตรารถเกษตร', 1, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'manas';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00036' AND Brand=N'รถเกษตร' AND ItemName=N'แบนเนอร์ตรารถเกษตร' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00036', N'ภาคอีสานกลาง', 2026, N'รถเกษตร', N'แบนเนอร์ตรารถเกษตร', 0
  FROM wf.AppUser WHERE Username = 'manas';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'รถเกษตร' AND ItemName=N'แบนเนอร์ตรารถเกษตร')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'รถเกษตร', N'แบนเนอร์ตรารถเกษตร', CASE WHEN N'แบนเนอร์ตรารถเกษตร' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'แบนเนอร์ตรารถเกษตร' LIKE N'%แบนเนอร์%' OR N'แบนเนอร์ตรารถเกษตร' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'แบนเนอร์ตรารถเกษตร' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00036' AND Brand=N'25235' AND ItemName=N'รถเกษตร' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00036', N'ภาคอีสานกลาง', 2026, N'25235', N'รถเกษตร', 490, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'manas';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'25235' AND ItemName=N'รถเกษตร')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'25235', N'รถเกษตร', CASE WHEN N'รถเกษตร' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'รถเกษตร' LIKE N'%แบนเนอร์%' OR N'รถเกษตร' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'รถเกษตร' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00036' AND Brand=N'25263' AND ItemName=N'รถเกษตร' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00036', N'ภาคอีสานกลาง', 2026, N'25263', N'รถเกษตร', 100, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'manas';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'25263' AND ItemName=N'รถเกษตร')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'25263', N'รถเกษตร', CASE WHEN N'รถเกษตร' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'รถเกษตร' LIKE N'%แบนเนอร์%' OR N'รถเกษตร' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'รถเกษตร' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00036' AND Brand=N'25294' AND ItemName=N'รถเกษตร' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00036', N'ภาคอีสานกลาง', 2026, N'25294', N'รถเกษตร', 30, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'manas';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'25294' AND ItemName=N'รถเกษตร')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'25294', N'รถเกษตร', CASE WHEN N'รถเกษตร' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'รถเกษตร' LIKE N'%แบนเนอร์%' OR N'รถเกษตร' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'รถเกษตร' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00037' AND Brand=N'รถเกษตร' AND ItemName=N'เสื้อยืดแขนยาว' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00037', N'ภาคใต้', 2026, N'รถเกษตร', N'เสื้อยืดแขนยาว', 180, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'ann';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'รถเกษตร' AND ItemName=N'เสื้อยืดแขนยาว')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'รถเกษตร', N'เสื้อยืดแขนยาว', CASE WHEN N'เสื้อยืดแขนยาว' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'เสื้อยืดแขนยาว' LIKE N'%แบนเนอร์%' OR N'เสื้อยืดแขนยาว' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'เสื้อยืดแขนยาว' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00037' AND Brand=N'25235' AND ItemName=N'รถเกษตร' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00037', N'ภาคใต้', 2026, N'25235', N'รถเกษตร', 60, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'ann';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'25235' AND ItemName=N'รถเกษตร')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'25235', N'รถเกษตร', CASE WHEN N'รถเกษตร' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'รถเกษตร' LIKE N'%แบนเนอร์%' OR N'รถเกษตร' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'รถเกษตร' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00037' AND Brand=N'244409' AND ItemName=N'รถเกษตร' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00037', N'ภาคใต้', 2026, N'244409', N'รถเกษตร', 90, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'ann';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'244409' AND ItemName=N'รถเกษตร')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'244409', N'รถเกษตร', CASE WHEN N'รถเกษตร' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'รถเกษตร' LIKE N'%แบนเนอร์%' OR N'รถเกษตร' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'รถเกษตร' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00037' AND Brand=N'25294' AND ItemName=N'รถเกษตร' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00037', N'ภาคใต้', 2026, N'25294', N'รถเกษตร', 30, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'ann';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'25294' AND ItemName=N'รถเกษตร')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'25294', N'รถเกษตร', CASE WHEN N'รถเกษตร' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'รถเกษตร' LIKE N'%แบนเนอร์%' OR N'รถเกษตร' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'รถเกษตร' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00041' AND Brand=N'รถเกษตร' AND ItemName=N'เสื้อยืดแขนยาว' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00041', N'ภาคอีสานบน', 2026, N'รถเกษตร', N'เสื้อยืดแขนยาว', 1379, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'um';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'รถเกษตร' AND ItemName=N'เสื้อยืดแขนยาว')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'รถเกษตร', N'เสื้อยืดแขนยาว', CASE WHEN N'เสื้อยืดแขนยาว' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'เสื้อยืดแขนยาว' LIKE N'%แบนเนอร์%' OR N'เสื้อยืดแขนยาว' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'เสื้อยืดแขนยาว' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00041' AND Brand=N'รถเกษตร' AND ItemName=N'กระเป๋าใบใหญ่' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00041', N'ภาคอีสานบน', 2026, N'รถเกษตร', N'กระเป๋าใบใหญ่', 100, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'um';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00041' AND Brand=N'รถเกษตร' AND ItemName=N'กระเป๋าใบใหญ่' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00041', N'ภาคอีสานบน', 2026, N'รถเกษตร', N'กระเป๋าใบใหญ่', 0
  FROM wf.AppUser WHERE Username = 'um';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'รถเกษตร' AND ItemName=N'กระเป๋าใบใหญ่')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'รถเกษตร', N'กระเป๋าใบใหญ่', CASE WHEN N'กระเป๋าใบใหญ่' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'กระเป๋าใบใหญ่' LIKE N'%แบนเนอร์%' OR N'กระเป๋าใบใหญ่' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'กระเป๋าใบใหญ่' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00041' AND Brand=N'รถเกษตร' AND ItemName=N'โบว์ชัวส์ ยางพารา' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00041', N'ภาคอีสานบน', 2026, N'รถเกษตร', N'โบว์ชัวส์ ยางพารา', 1500, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'um';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00041' AND Brand=N'รถเกษตร' AND ItemName=N'โบว์ชัวส์ ยางพารา' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00041', N'ภาคอีสานบน', 2026, N'รถเกษตร', N'โบว์ชัวส์ ยางพารา', 0
  FROM wf.AppUser WHERE Username = 'um';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'รถเกษตร' AND ItemName=N'โบว์ชัวส์ ยางพารา')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'รถเกษตร', N'โบว์ชัวส์ ยางพารา', CASE WHEN N'โบว์ชัวส์ ยางพารา' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'โบว์ชัวส์ ยางพารา' LIKE N'%แบนเนอร์%' OR N'โบว์ชัวส์ ยางพารา' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'โบว์ชัวส์ ยางพารา' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00041' AND Brand=N'25235' AND ItemName=N'รถเกษตร' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00041', N'ภาคอีสานบน', 2026, N'25235', N'รถเกษตร', 183, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'um';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'25235' AND ItemName=N'รถเกษตร')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'25235', N'รถเกษตร', CASE WHEN N'รถเกษตร' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'รถเกษตร' LIKE N'%แบนเนอร์%' OR N'รถเกษตร' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'รถเกษตร' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00041' AND Brand=N'244409' AND ItemName=N'รถเกษตร' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00041', N'ภาคอีสานบน', 2026, N'244409', N'รถเกษตร', 100, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'um';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'244409' AND ItemName=N'รถเกษตร')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'244409', N'รถเกษตร', CASE WHEN N'รถเกษตร' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'รถเกษตร' LIKE N'%แบนเนอร์%' OR N'รถเกษตร' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'รถเกษตร' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00041' AND Brand=N'25294' AND ItemName=N'รถเกษตร' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00041', N'ภาคอีสานบน', 2026, N'25294', N'รถเกษตร', 474, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'um';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'25294' AND ItemName=N'รถเกษตร')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'25294', N'รถเกษตร', CASE WHEN N'รถเกษตร' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'รถเกษตร' LIKE N'%แบนเนอร์%' OR N'รถเกษตร' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'รถเกษตร' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00042' AND Brand=N'รถเกษตร' AND ItemName=N'16-8-8' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00042', N'ภาคอีสานล่าง', 2026, N'รถเกษตร', N'16-8-8', 1800, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'ton';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'รถเกษตร' AND ItemName=N'16-8-8')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'รถเกษตร', N'16-8-8', CASE WHEN N'16-8-8' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'16-8-8' LIKE N'%แบนเนอร์%' OR N'16-8-8' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'16-8-8' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00042' AND Brand=N'รถเกษตร' AND ItemName=N'18-4-5' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00042', N'ภาคอีสานล่าง', 2026, N'รถเกษตร', N'18-4-5', 800, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'ton';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'รถเกษตร' AND ItemName=N'18-4-5')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'รถเกษตร', N'18-4-5', CASE WHEN N'18-4-5' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'18-4-5' LIKE N'%แบนเนอร์%' OR N'18-4-5' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'18-4-5' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00042' AND Brand=N'รถเกษตร' AND ItemName=N'29-5-18' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00042', N'ภาคอีสานล่าง', 2026, N'รถเกษตร', N'29-5-18', 400, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'ton';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'รถเกษตร' AND ItemName=N'29-5-18')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'รถเกษตร', N'29-5-18', CASE WHEN N'29-5-18' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'29-5-18' LIKE N'%แบนเนอร์%' OR N'29-5-18' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'29-5-18' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00042' AND Brand=N'รถเกษตร' AND ItemName=N'เสื้อยืดแขนยาว' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00042', N'ภาคอีสานล่าง', 2026, N'รถเกษตร', N'เสื้อยืดแขนยาว', 3412.5, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'ton';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'รถเกษตร' AND ItemName=N'เสื้อยืดแขนยาว')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'รถเกษตร', N'เสื้อยืดแขนยาว', CASE WHEN N'เสื้อยืดแขนยาว' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'เสื้อยืดแขนยาว' LIKE N'%แบนเนอร์%' OR N'เสื้อยืดแขนยาว' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'เสื้อยืดแขนยาว' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00042' AND Brand=N'รถเกษตร' AND ItemName=N'15-3-3' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00042', N'ภาคอีสานล่าง', 2026, N'รถเกษตร', N'15-3-3', 500, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'ton';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00042' AND Brand=N'รถเกษตร' AND ItemName=N'15-3-3' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00042', N'ภาคอีสานล่าง', 2026, N'รถเกษตร', N'15-3-3', 0
  FROM wf.AppUser WHERE Username = 'ton';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'รถเกษตร' AND ItemName=N'15-3-3')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'รถเกษตร', N'15-3-3', CASE WHEN N'15-3-3' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'15-3-3' LIKE N'%แบนเนอร์%' OR N'15-3-3' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'15-3-3' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00042' AND Brand=N'รถเกษตร' AND ItemName=N'15-7-18' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00042', N'ภาคอีสานล่าง', 2026, N'รถเกษตร', N'15-7-18', 200, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'ton';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00042' AND Brand=N'รถเกษตร' AND ItemName=N'15-7-18' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00042', N'ภาคอีสานล่าง', 2026, N'รถเกษตร', N'15-7-18', 0
  FROM wf.AppUser WHERE Username = 'ton';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'รถเกษตร' AND ItemName=N'15-7-18')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'รถเกษตร', N'15-7-18', CASE WHEN N'15-7-18' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'15-7-18' LIKE N'%แบนเนอร์%' OR N'15-7-18' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'15-7-18' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00042' AND Brand=N'รถเกษตร' AND ItemName=N'แบนเนอร์ตรารถเกษตร' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00042', N'ภาคอีสานล่าง', 2026, N'รถเกษตร', N'แบนเนอร์ตรารถเกษตร', 3, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'ton';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00042' AND Brand=N'รถเกษตร' AND ItemName=N'แบนเนอร์ตรารถเกษตร' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00042', N'ภาคอีสานล่าง', 2026, N'รถเกษตร', N'แบนเนอร์ตรารถเกษตร', 0
  FROM wf.AppUser WHERE Username = 'ton';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'รถเกษตร' AND ItemName=N'แบนเนอร์ตรารถเกษตร')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'รถเกษตร', N'แบนเนอร์ตรารถเกษตร', CASE WHEN N'แบนเนอร์ตรารถเกษตร' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'แบนเนอร์ตรารถเกษตร' LIKE N'%แบนเนอร์%' OR N'แบนเนอร์ตรารถเกษตร' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'แบนเนอร์ตรารถเกษตร' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00042' AND Brand=N'25235' AND ItemName=N'รถเกษตร' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00042', N'ภาคอีสานล่าง', 2026, N'25235', N'รถเกษตร', 440, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'ton';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'25235' AND ItemName=N'รถเกษตร')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'25235', N'รถเกษตร', CASE WHEN N'รถเกษตร' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'รถเกษตร' LIKE N'%แบนเนอร์%' OR N'รถเกษตร' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'รถเกษตร' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00042' AND Brand=N'25263' AND ItemName=N'รถเกษตร' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00042', N'ภาคอีสานล่าง', 2026, N'25263', N'รถเกษตร', 300, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'ton';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'25263' AND ItemName=N'รถเกษตร')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'25263', N'รถเกษตร', CASE WHEN N'รถเกษตร' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'รถเกษตร' LIKE N'%แบนเนอร์%' OR N'รถเกษตร' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'รถเกษตร' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00042' AND Brand=N'25294' AND ItemName=N'รถเกษตร' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00042', N'ภาคอีสานล่าง', 2026, N'25294', N'รถเกษตร', 200, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'ton';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'25294' AND ItemName=N'รถเกษตร')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'25294', N'รถเกษตร', CASE WHEN N'รถเกษตร' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'รถเกษตร' LIKE N'%แบนเนอร์%' OR N'รถเกษตร' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'รถเกษตร' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00053' AND Brand=N'ปุ๋ยเทพ' AND ItemName=N'13-3-23' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00053', N'ภาคปุ๋ยเทพ 1', 2026, N'ปุ๋ยเทพ', N'13-3-23', 2000, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'na';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'ปุ๋ยเทพ' AND ItemName=N'13-3-23')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'ปุ๋ยเทพ', N'13-3-23', CASE WHEN N'13-3-23' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'13-3-23' LIKE N'%แบนเนอร์%' OR N'13-3-23' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'13-3-23' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00053' AND Brand=N'ปุ๋ยเทพ' AND ItemName=N'เสื้อยืดแขนยาว' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00053', N'ภาคปุ๋ยเทพ 1', 2026, N'ปุ๋ยเทพ', N'เสื้อยืดแขนยาว', 500, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'na';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'ปุ๋ยเทพ' AND ItemName=N'เสื้อยืดแขนยาว')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'ปุ๋ยเทพ', N'เสื้อยืดแขนยาว', CASE WHEN N'เสื้อยืดแขนยาว' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'เสื้อยืดแขนยาว' LIKE N'%แบนเนอร์%' OR N'เสื้อยืดแขนยาว' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'เสื้อยืดแขนยาว' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00053' AND Brand=N'ปุ๋ยเทพ' AND ItemName=N'แบนเนอร์ ปุ๋ยเทพ' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00053', N'ภาคปุ๋ยเทพ 1', 2026, N'ปุ๋ยเทพ', N'แบนเนอร์ ปุ๋ยเทพ', 11, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'na';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00053' AND Brand=N'ปุ๋ยเทพ' AND ItemName=N'แบนเนอร์ ปุ๋ยเทพ' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00053', N'ภาคปุ๋ยเทพ 1', 2026, N'ปุ๋ยเทพ', N'แบนเนอร์ ปุ๋ยเทพ', 0
  FROM wf.AppUser WHERE Username = 'na';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'ปุ๋ยเทพ' AND ItemName=N'แบนเนอร์ ปุ๋ยเทพ')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'ปุ๋ยเทพ', N'แบนเนอร์ ปุ๋ยเทพ', CASE WHEN N'แบนเนอร์ ปุ๋ยเทพ' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'แบนเนอร์ ปุ๋ยเทพ' LIKE N'%แบนเนอร์%' OR N'แบนเนอร์ ปุ๋ยเทพ' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'แบนเนอร์ ปุ๋ยเทพ' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00053' AND Brand=N'25263' AND ItemName=N'ปุ๋ยเทพ' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00053', N'ภาคปุ๋ยเทพ 1', 2026, N'25263', N'ปุ๋ยเทพ', 900, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'na';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'25263' AND ItemName=N'ปุ๋ยเทพ')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'25263', N'ปุ๋ยเทพ', CASE WHEN N'ปุ๋ยเทพ' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'ปุ๋ยเทพ' LIKE N'%แบนเนอร์%' OR N'ปุ๋ยเทพ' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'ปุ๋ยเทพ' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00053' AND Brand=N'25294' AND ItemName=N'ปุ๋ยเทพ' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00053', N'ภาคปุ๋ยเทพ 1', 2026, N'25294', N'ปุ๋ยเทพ', 1100, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'na';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'25294' AND ItemName=N'ปุ๋ยเทพ')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'25294', N'ปุ๋ยเทพ', CASE WHEN N'ปุ๋ยเทพ' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'ปุ๋ยเทพ' LIKE N'%แบนเนอร์%' OR N'ปุ๋ยเทพ' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'ปุ๋ยเทพ' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00024' AND Brand=N'ปุ๋ยเทพ' AND ItemName=N'13-3-23' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00024', N'ภาคปุ๋ยเทพ 2', 2026, N'ปุ๋ยเทพ', N'13-3-23', 100, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'don';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'ปุ๋ยเทพ' AND ItemName=N'13-3-23')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'ปุ๋ยเทพ', N'13-3-23', CASE WHEN N'13-3-23' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'13-3-23' LIKE N'%แบนเนอร์%' OR N'13-3-23' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'13-3-23' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00024' AND Brand=N'ปุ๋ยเทพ' AND ItemName=N'20-8-8' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00024', N'ภาคปุ๋ยเทพ 2', 2026, N'ปุ๋ยเทพ', N'20-8-8', 100, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'don';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'ปุ๋ยเทพ' AND ItemName=N'20-8-8')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'ปุ๋ยเทพ', N'20-8-8', CASE WHEN N'20-8-8' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'20-8-8' LIKE N'%แบนเนอร์%' OR N'20-8-8' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'20-8-8' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00024' AND Brand=N'ปุ๋ยเทพ' AND ItemName=N'เสื้อยืดแขนยาว' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00024', N'ภาคปุ๋ยเทพ 2', 2026, N'ปุ๋ยเทพ', N'เสื้อยืดแขนยาว', 180, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'don';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'ปุ๋ยเทพ' AND ItemName=N'เสื้อยืดแขนยาว')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'ปุ๋ยเทพ', N'เสื้อยืดแขนยาว', CASE WHEN N'เสื้อยืดแขนยาว' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'เสื้อยืดแขนยาว' LIKE N'%แบนเนอร์%' OR N'เสื้อยืดแขนยาว' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'เสื้อยืดแขนยาว' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00024' AND Brand=N'ปุ๋ยเทพ' AND ItemName=N'แบนเนอร์ ปุ๋ยเทพ' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00024', N'ภาคปุ๋ยเทพ 2', 2026, N'ปุ๋ยเทพ', N'แบนเนอร์ ปุ๋ยเทพ', 2, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'don';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayBudget WHERE EmpCode='EMP-00024' AND Brand=N'ปุ๋ยเทพ' AND ItemName=N'แบนเนอร์ ปุ๋ยเทพ' AND PeriodYear=2569)
  INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
  SELECT Id, EmpId, 'EMP-00024', N'ภาคปุ๋ยเทพ 2', 2026, N'ปุ๋ยเทพ', N'แบนเนอร์ ปุ๋ยเทพ', 0
  FROM wf.AppUser WHERE Username = 'don';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'ปุ๋ยเทพ' AND ItemName=N'แบนเนอร์ ปุ๋ยเทพ')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'ปุ๋ยเทพ', N'แบนเนอร์ ปุ๋ยเทพ', CASE WHEN N'แบนเนอร์ ปุ๋ยเทพ' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'แบนเนอร์ ปุ๋ยเทพ' LIKE N'%แบนเนอร์%' OR N'แบนเนอร์ ปุ๋ยเทพ' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'แบนเนอร์ ปุ๋ยเทพ' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00024' AND Brand=N'244409' AND ItemName=N'ปุ๋ยเทพ' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00024', N'ภาคปุ๋ยเทพ 2', 2026, N'244409', N'ปุ๋ยเทพ', 20, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'don';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'244409' AND ItemName=N'ปุ๋ยเทพ')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'244409', N'ปุ๋ยเทพ', CASE WHEN N'ปุ๋ยเทพ' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'ปุ๋ยเทพ' LIKE N'%แบนเนอร์%' OR N'ปุ๋ยเทพ' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'ปุ๋ยเทพ' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

IF NOT EXISTS (SELECT 1 FROM wf.GiveawayWithdrawal WHERE EmpCode='EMP-00024' AND Brand=N'25294' AND ItemName=N'ปุ๋ยเทพ' AND PeriodYear=2569 AND Source='IMPORT')
  INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, Qty, Source, Note)
  SELECT Id, EmpId, 'EMP-00024', N'ภาคปุ๋ยเทพ 2', 2026, N'25294', N'ปุ๋ยเทพ', 100, 'IMPORT', N'ยอดเบิกยกมา (จาก Excel)'
  FROM wf.AppUser WHERE Username = 'don';
IF NOT EXISTS (SELECT 1 FROM wf.GiveawayItem WHERE Brand=N'25294' AND ItemName=N'ปุ๋ยเทพ')
  INSERT INTO wf.GiveawayItem (Brand, ItemName, ItemType) VALUES (N'25294', N'ปุ๋ยเทพ', CASE WHEN N'ปุ๋ยเทพ' LIKE N'%เสื้อ%' THEN 'SHIRT' WHEN N'ปุ๋ยเทพ' LIKE N'%แบนเนอร์%' OR N'ปุ๋ยเทพ' LIKE N'%ป้าย%' THEN 'BANNER' WHEN N'ปุ๋ยเทพ' LIKE '%-%' THEN 'BAG' ELSE 'OTHER' END);

GO
