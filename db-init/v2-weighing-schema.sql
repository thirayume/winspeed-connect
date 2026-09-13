-- Test-only compatibility schema captured from localhost sys.columns/indexes on 2026-09-06.
-- The supplied backup does not contain these tables. Not a vendor schema certification.
SET XACT_ABORT ON;
IF DB_NAME() <> N'dbwins_worldfert9_test_v2'
BEGIN RAISERROR('V2 weighing bootstrap requires isolated test database',16,1); RETURN; END;
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.WGHD','U') IS NULL
CREATE TABLE dbo.[WGHD] (
 [Id] int IDENTITY(1,1) NOT NULL,
 [TruckInNum] int NULL,
 [TruckOutNum] int NULL,
 [DateReg] datetime NULL DEFAULT (getdate()),
 [CarNo] nvarchar(20) COLLATE Thai_CI_AS NULL,
 [TotalTon] decimal(8,2) NULL,
 [TotalKasob] decimal(8,2) NULL,
 [SPID] int NULL,
 [CVID] int NULL,
 [CVCode] nvarchar(50) COLLATE Thai_CI_AS NULL,
 [CVName] nvarchar(255) COLLATE Thai_CI_AS NULL,
 [DocuNo] nvarchar(25) COLLATE Thai_CI_AS NULL,
 [WGType] nvarchar(2) COLLATE Thai_CI_AS NULL,
 [isMulti] bit NULL,
 [EMDriverId] int NULL,
 [MoveBill] nvarchar(50) COLLATE Thai_CI_AS NULL,
 [DateIn] datetime NULL,
 [WeightIn] int NULL,
 [DateOut] datetime NULL,
 [WeightOut] int NULL,
 [WeightNet] int NULL,
 [WeightAVG] decimal(8,2) NULL,
 [TONNet] decimal(8,2) NULL,
 [KGNet] int NULL,
 [KasobNet] int NULL,
 [Status] nvarchar(2) COLLATE Thai_CI_AS NULL,
 [QStatus] nvarchar(10) COLLATE Thai_CI_AS NULL,
 [LocationName] nvarchar(200) COLLATE Thai_CI_AS NULL,
 [UpdateDate] datetime NULL,
 [UpdateBy] nvarchar(50) COLLATE Thai_CI_AS NULL,
 [isNOQ] bit NULL DEFAULT ((0)),
 CONSTRAINT [PK_WGHD] PRIMARY KEY CLUSTERED ([Id])
);
IF OBJECT_ID('dbo.WGDT','U') IS NULL
CREATE TABLE dbo.[WGDT] (
 [Id] int IDENTITY(1,1) NOT NULL,
 [WGHDId] int NULL,
 [SPID] int NULL,
 [ListNo] int NULL,
 [GoodID] int NULL,
 [GoodName] nvarchar(255) COLLATE Thai_CI_AS NULL,
 [GoodUnitID2] int NULL,
 [GoodUnitName] nvarchar(255) COLLATE Thai_CI_AS NULL,
 [GoodQty2] decimal(8,2) NULL,
 [Qty1] decimal(8,2) NULL,
 [Qty2] decimal(8,2) NULL,
 [GoodWeight] decimal(8,2) NULL,
 [WeightUnitID] int NULL,
 [GoodUnitNameWeight] nvarchar(255) COLLATE Thai_CI_AS NULL,
 [GoodTon] decimal(8,2) NULL,
 [GoodTon1] decimal(8,2) NULL,
 [GoodTon2] decimal(8,2) NULL,
 [GoodKasob] decimal(8,2) NULL,
 [GoodKasob1] decimal(8,2) NULL,
 [GoodKasob2] decimal(8,2) NULL DEFAULT ((0)),
 [GoodKG] decimal(8,2) NULL,
 [STOCode] nvarchar(10) COLLATE Thai_CI_AS NULL,
 [STOCode2] nvarchar(10) COLLATE Thai_CI_AS NULL,
 [Place1] nvarchar(150) COLLATE Thai_CI_AS NULL,
 [Place2] nvarchar(150) COLLATE Thai_CI_AS NULL,
 [RefNo] nvarchar(50) COLLATE Thai_CI_AS NULL,
 [CouponNo] nvarchar(25) COLLATE Thai_CI_AS NULL,
 CONSTRAINT [PK_WGDT] PRIMARY KEY CLUSTERED ([Id])
);
IF OBJECT_ID('dbo.WGDTReport','U') IS NULL
CREATE TABLE dbo.[WGDTReport] (
 [Id] int IDENTITY(1,1) NOT NULL,
 [WGDTId] int NULL,
 [WGHDId] int NULL,
 [DateReg] datetime NULL,
 [CarNo] nvarchar(50) COLLATE Thai_CI_AS NULL,
 [MoveBill] nvarchar(10) COLLATE Thai_CI_AS NULL,
 [CVCode] nvarchar(50) COLLATE Thai_CI_AS NULL,
 [CVName] nvarchar(255) COLLATE Thai_CI_AS NULL,
 [DocuNo] nvarchar(50) COLLATE Thai_CI_AS NULL,
 [WGType] nvarchar(50) COLLATE Thai_CI_AS NULL,
 [DateIn] datetime NULL,
 [DateOut] datetime NULL,
 [GoodID] int NULL,
 [GoodName] nvarchar(255) COLLATE Thai_CI_AS NULL,
 [GoodWeight] decimal(8,2) NULL,
 [GoodKasobNet] decimal(8,2) NULL,
 [GoodTonNet] decimal(8,2) NULL,
 [STOCode] nvarchar(10) COLLATE Thai_CI_AS NULL,
 [STOName] nvarchar(150) COLLATE Thai_CI_AS NULL,
 [CouponNo] nvarchar(25) COLLATE Thai_CI_AS NULL,
 CONSTRAINT [PK_WGDTReport] PRIMARY KEY CLUSTERED ([Id])
);
COMMIT;
