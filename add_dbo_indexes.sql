USE dbwins_worldfert9;
GO

-- 1. EMCust
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.EMCust') AND name = 'IX_EMCust_CustName')
BEGIN
    CREATE NONCLUSTERED INDEX IX_EMCust_CustName ON dbo.EMCust(CustName);
END
GO

-- 2. EMGood
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.EMGood') AND name = 'IX_EMGood_GoodName1')
BEGIN
    CREATE NONCLUSTERED INDEX IX_EMGood_GoodName1 ON dbo.EMGood(GoodName1);
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.EMGood') AND name = 'IX_EMGood_StockFlag_Unit')
BEGIN
    CREATE NONCLUSTERED INDEX IX_EMGood_StockFlag_Unit ON dbo.EMGood(StockFlag, MainGoodUnitID);
END
GO

-- 3. EMEmp
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.EMEmp') AND name = 'IX_EMEmp_EmpName')
BEGIN
    CREATE NONCLUSTERED INDEX IX_EMEmp_EmpName ON dbo.EMEmp(EmpName);
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.EMEmp') AND name = 'IX_EMEmp_EmpCode')
BEGIN
    CREATE NONCLUSTERED INDEX IX_EMEmp_EmpCode ON dbo.EMEmp(EmpCode);
END
GO

-- 4. EMSetPriceHD
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.EMSetPriceHD') AND name = 'IX_EMSetPriceHD_CustID')
BEGIN
    CREATE NONCLUSTERED INDEX IX_EMSetPriceHD_CustID ON dbo.EMSetPriceHD(CustID);
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.EMSetPriceHD') AND name = 'IX_EMSetPriceHD_Dates')
BEGIN
    CREATE NONCLUSTERED INDEX IX_EMSetPriceHD_Dates ON dbo.EMSetPriceHD(BeginDate, EndDate);
END
GO

-- 5. EMSetPriceDT
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.EMSetPriceDT') AND name = 'IX_EMSetPriceDT_ListID')
BEGIN
    CREATE NONCLUSTERED INDEX IX_EMSetPriceDT_ListID ON dbo.EMSetPriceDT(ListID);
END
GO

PRINT 'dbo indexes created successfully.';
