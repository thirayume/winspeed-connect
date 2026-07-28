-- =============================================================
-- 063_create_rebate_region_tables.sql
-- สร้างตารางภูมิภาคการขาย (wf.SaleRegion) และตารางผูกผู้ใช้กับพื้นที่การขาย (wf.UserSaleArea)
-- สำหรับรองรับการอนุมัติ Rebate 4 ชั้นตามภูมิภาค (Region 01 - 06 & 99 ไม่ระบุ)
-- Safe to re-run (idempotent)
-- =============================================================

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'SaleRegion' AND schema_id = SCHEMA_ID('wf'))
BEGIN
    CREATE TABLE wf.SaleRegion (
        RegionCode VARCHAR(10) NOT NULL PRIMARY KEY,
        RegionName NVARCHAR(100) NOT NULL,
        CreatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
    );
END;
GO

-- Seed ภูมิภาคมาตรฐานทั้ง 6 ภาค + 1 ภาคไม่ระบุ
MERGE wf.SaleRegion AS target
USING (VALUES 
    ('01', N'กรุงเทพและปริมณฑล'),
    ('02', N'ภาคกลาง-ตะวันตก'),
    ('03', N'ภาคตะวันออกเฉียงเหนือ'),
    ('04', N'ภาคเหนือ'),
    ('05', N'ภาคใต้'),
    ('06', N'ภาคตะวันออก'),
    ('99', N'ไม่ระบุ')
) AS source (RegionCode, RegionName)
ON (target.RegionCode = source.RegionCode)
WHEN MATCHED THEN
    UPDATE SET target.RegionName = source.RegionName
WHEN NOT MATCHED THEN
    INSERT (RegionCode, RegionName)
    VALUES (source.RegionCode, source.RegionName);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'UserSaleArea' AND schema_id = SCHEMA_ID('wf'))
BEGIN
    CREATE TABLE wf.UserSaleArea (
        Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        UserId INT NOT NULL,
        SaleAreaId INT NULL,
        RegionCode VARCHAR(10) NOT NULL,
        IsPrimary BIT NOT NULL DEFAULT 1,
        CreatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        CONSTRAINT FK_UserSaleArea_AppUser FOREIGN KEY (UserId) REFERENCES wf.AppUser(Id) ON DELETE CASCADE,
        CONSTRAINT FK_UserSaleArea_SaleRegion FOREIGN KEY (RegionCode) REFERENCES wf.SaleRegion(RegionCode)
    );

    CREATE INDEX IX_UserSaleArea_UserId ON wf.UserSaleArea(UserId);
    CREATE INDEX IX_UserSaleArea_RegionCode ON wf.UserSaleArea(RegionCode);
END;
GO
