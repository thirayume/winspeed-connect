-- Migration 186: Two-way WinSpeed Pricelist Sync, Costlist Tables & Granular Pricing/Cost Permissions
-- Compatible with SQL Server 2008 R2+ (no CREATE OR ALTER, THROW, TRY_CAST, CONCAT)

-- 1. Extend wf.PriceBook & wf.PriceBookLine & wf.PriceBookSpecialPrice for WinSpeed linkage
IF OBJECT_ID('wf.PriceBook', 'U') IS NOT NULL
BEGIN
    IF COL_LENGTH('wf.PriceBook', 'SourceSetPriceIds') IS NULL
        ALTER TABLE wf.PriceBook ADD SourceSetPriceIds NVARCHAR(200) NULL;
    IF COL_LENGTH('wf.PriceBook', 'WinSpeedSyncAt') IS NULL
        ALTER TABLE wf.PriceBook ADD WinSpeedSyncAt DATETIME2 NULL;
    IF COL_LENGTH('wf.PriceBook', 'LastSyncedBy') IS NULL
        ALTER TABLE wf.PriceBook ADD LastSyncedBy INT NULL;
END;
GO

IF OBJECT_ID('wf.PriceBookLine', 'U') IS NOT NULL
BEGIN
    IF COL_LENGTH('wf.PriceBookLine', 'GoodCode') IS NULL
        ALTER TABLE wf.PriceBookLine ADD GoodCode NVARCHAR(50) NULL;
    IF COL_LENGTH('wf.PriceBookLine', 'GoodGroupId') IS NULL
        ALTER TABLE wf.PriceBookLine ADD GoodGroupId INT NULL;
    IF COL_LENGTH('wf.PriceBookLine', 'GoodGroupName') IS NULL
        ALTER TABLE wf.PriceBookLine ADD GoodGroupName NVARCHAR(100) NULL;
    IF COL_LENGTH('wf.PriceBookLine', 'WinSpeedSetPriceId') IS NULL
        ALTER TABLE wf.PriceBookLine ADD WinSpeedSetPriceId INT NULL;
    IF COL_LENGTH('wf.PriceBookLine', 'WinSpeedListNo') IS NULL
        ALTER TABLE wf.PriceBookLine ADD WinSpeedListNo SMALLINT NULL;
    IF COL_LENGTH('wf.PriceBookLine', 'UpdatedAt') IS NULL
        ALTER TABLE wf.PriceBookLine ADD UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_PriceBookLine_UpdatedAt DEFAULT GETUTCDATE();
END;
GO

IF OBJECT_ID('wf.PriceBookSpecialPrice', 'U') IS NOT NULL
BEGIN
    IF COL_LENGTH('wf.PriceBookSpecialPrice', 'WinSpeedSetPriceId') IS NULL
        ALTER TABLE wf.PriceBookSpecialPrice ADD WinSpeedSetPriceId INT NULL;
END;
GO

-- Backfill GoodCode / GoodGroup metadata on existing PriceBookLine rows
IF OBJECT_ID('wf.PriceBookLine', 'U') IS NOT NULL AND OBJECT_ID('dbo.EMGood', 'U') IS NOT NULL
BEGIN
    UPDATE l
    SET l.GoodCode = COALESCE(l.GoodCode, g.GoodCode),
        l.GoodGroupId = COALESCE(l.GoodGroupId, g.GoodGroupID),
        l.GoodGroupName = COALESCE(l.GoodGroupName, gg.GoodGroupName)
    FROM wf.PriceBookLine l
    JOIN dbo.EMGood g ON CAST(g.GoodID AS NVARCHAR(20)) = l.GoodId
    LEFT JOIN dbo.EMGoodGroup gg ON gg.GoodGroupID = g.GoodGroupID
    WHERE l.GoodCode IS NULL OR l.GoodGroupId IS NULL;
END;
GO

-- 2. Costlist Tables (wf.CostBook, wf.CostBookLine, wf.CostBookAudit)
IF OBJECT_ID('wf.CostBook', 'U') IS NULL
BEGIN
    CREATE TABLE wf.CostBook (
        Id             INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        Name           NVARCHAR(120) NOT NULL,
        EffectiveMonth CHAR(7) NOT NULL,
        EffectiveFrom  DATE NULL,
        EffectiveTo    DATE NULL,
        Status         VARCHAR(20) NOT NULL CONSTRAINT DF_CostBook_Status DEFAULT 'DRAFT',
        Note           NVARCHAR(500) NULL,
        CreatedBy      INT NULL,
        CreatedAt      DATETIME2 NOT NULL CONSTRAINT DF_CostBook_CreatedAt DEFAULT GETUTCDATE(),
        ApprovedBy     INT NULL,
        ApprovedAt     DATETIME2 NULL,
        ActivatedBy    INT NULL,
        ActivatedAt    DATETIME2 NULL,
        UpdatedAt      DATETIME2 NOT NULL CONSTRAINT DF_CostBook_UpdatedAt DEFAULT GETUTCDATE()
    );
    CREATE INDEX IX_CostBook_Status_Dates ON wf.CostBook (Status, EffectiveFrom, EffectiveTo);
END;
GO

IF OBJECT_ID('wf.CostBookLine', 'U') IS NULL
BEGIN
    CREATE TABLE wf.CostBookLine (
        Id            INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        CostBookId    INT NOT NULL,
        GoodId        NVARCHAR(20) NOT NULL,
        GoodCode      NVARCHAR(50) NULL,
        GoodName      NVARCHAR(200) NULL,
        GoodGroupId   INT NULL,
        GoodGroupName NVARCHAR(100) NULL,
        Unit          NVARCHAR(30) NULL,
        CostPrice     DECIMAL(12, 2) NULL,
        Note          NVARCHAR(255) NULL,
        UpdatedAt     DATETIME2 NOT NULL CONSTRAINT DF_CostBookLine_UpdatedAt DEFAULT GETUTCDATE(),
        CONSTRAINT FK_CostBookLine_Book FOREIGN KEY (CostBookId) REFERENCES wf.CostBook(Id) ON DELETE CASCADE,
        CONSTRAINT UQ_CostBookLine_BookGood UNIQUE (CostBookId, GoodId)
    );
END;
GO

IF OBJECT_ID('wf.CostBookAudit', 'U') IS NULL
BEGIN
    CREATE TABLE wf.CostBookAudit (
        Id         INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        CostBookId INT NOT NULL,
        Action     VARCHAR(40) NOT NULL,
        FromStatus VARCHAR(20) NULL,
        ToStatus   VARCHAR(20) NULL,
        ByUser     INT NULL,
        Note       NVARCHAR(500) NULL,
        At         DATETIME2 NOT NULL CONSTRAINT DF_CostBookAudit_At DEFAULT GETUTCDATE(),
        CONSTRAINT FK_CostBookAudit_Book FOREIGN KEY (CostBookId) REFERENCES wf.CostBook(Id) ON DELETE CASCADE
    );
END;
GO

-- 3. Seed Granular Master / Pricing / Cost Permissions into wf.RolePermission
IF OBJECT_ID('wf.RoleProfile', 'U') IS NOT NULL AND OBJECT_ID('wf.RolePermission', 'U') IS NOT NULL
BEGIN
    -- master.manage for ADMIN, C_LEVEL
    IF EXISTS (SELECT 1 FROM wf.RoleProfile WHERE Code = 'ADMIN')
       AND NOT EXISTS (SELECT 1 FROM wf.RolePermission WHERE RoleCode = 'ADMIN' AND PermissionCode = 'master.manage')
        INSERT INTO wf.RolePermission (RoleCode, PermissionCode) VALUES ('ADMIN', 'master.manage');
    IF EXISTS (SELECT 1 FROM wf.RoleProfile WHERE Code = 'C_LEVEL')
       AND NOT EXISTS (SELECT 1 FROM wf.RolePermission WHERE RoleCode = 'C_LEVEL' AND PermissionCode = 'master.manage')
        INSERT INTO wf.RolePermission (RoleCode, PermissionCode) VALUES ('C_LEVEL', 'master.manage');

    -- pricing & cost permissions for ADMIN, C_LEVEL, MANAGER, ACCOUNTING
    DECLARE @pRole VARCHAR(30), @pPerm VARCHAR(50);
    DECLARE @SeedRoles TABLE (RoleCode VARCHAR(30));
    INSERT INTO @SeedRoles (RoleCode) VALUES ('ADMIN'), ('C_LEVEL'), ('MANAGER'), ('ACCOUNTING');

    DECLARE @SeedPerms TABLE (PermissionCode VARCHAR(50));
    INSERT INTO @SeedPerms (PermissionCode) VALUES ('pricing.view'), ('pricing.manage'), ('cost.view'), ('cost.manage');

    INSERT INTO wf.RolePermission (RoleCode, PermissionCode)
    SELECT r.RoleCode, p.PermissionCode
    FROM @SeedRoles r
    CROSS JOIN @SeedPerms p
    WHERE EXISTS (SELECT 1 FROM wf.RoleProfile rp WHERE rp.Code = r.RoleCode)
      AND NOT EXISTS (SELECT 1 FROM wf.RolePermission cur WHERE cur.RoleCode = r.RoleCode AND cur.PermissionCode = p.PermissionCode);
END;
GO

-- 4. Ownership-chained WinSpeed PriceBook Sync Procedures
IF OBJECT_ID('wf.sp_PriceBookSyncHeaderDatesToWinSpeed', 'P') IS NULL
    EXEC('CREATE PROCEDURE wf.sp_PriceBookSyncHeaderDatesToWinSpeed AS RETURN 0');
GO
ALTER PROCEDURE wf.sp_PriceBookSyncHeaderDatesToWinSpeed
    @SetPriceID INT,
    @BeginDate  DATE,
    @EndDate    DATE,
    @Remark1    VARCHAR(255) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @BeginDate IS NULL OR @EndDate IS NULL OR @BeginDate > @EndDate
    BEGIN
        RAISERROR('วันเริ่มต้องไม่เกินวันสิ้นสุด', 16, 1);
        RETURN;
    END

    UPDATE dbo.EMSetPriceHD
    SET BeginDate = @BeginDate,
        EndDate = @EndDate,
        Remark1 = COALESCE(@Remark1, Remark1),
        ChangedDate = GETDATE()
    WHERE SetPriceID = @SetPriceID;
END
GO

IF OBJECT_ID('wf.sp_PriceBookCreateWinSpeedSet', 'P') IS NULL
    EXEC('CREATE PROCEDURE wf.sp_PriceBookCreateWinSpeedSet AS RETURN 0');
GO
ALTER PROCEDURE wf.sp_PriceBookCreateWinSpeedSet
    @BeginDate      DATE,
    @EndDate        DATE,
    @CustID         INT = NULL,
    @Remark1        VARCHAR(255) = NULL,
    @NewSetPriceID  INT OUTPUT,
    @DocuNo         VARCHAR(25) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @BeginDate IS NULL OR @EndDate IS NULL OR @BeginDate > @EndDate
    BEGIN
        RAISERROR('ต้องระบุวันเริ่มและวันสิ้นสุด และวันเริ่มต้องไม่เกินวันสิ้นสุด', 16, 1);
        RETURN;
    END

    BEGIN TRANSACTION;
    SELECT @NewSetPriceID = ISNULL(MAX(SetPriceID), 3000) + 1 FROM dbo.EMSetPriceHD WITH (UPDLOCK, HOLDLOCK);

    DECLARE @BeYear VARCHAR(2), @Month2 VARCHAR(2), @Prefix VARCHAR(12), @Seq INT;
    SET @BeYear = RIGHT(CONVERT(VARCHAR(4), YEAR(@BeginDate) + 543), 2);
    SET @Month2 = RIGHT('0' + CONVERT(VARCHAR(2), MONTH(@BeginDate)), 2);
    SET @Prefix = 'SPL' + @BeYear + @Month2 + '-';

    SELECT @Seq = ISNULL(MAX(CASE WHEN ISNUMERIC(RIGHT(DocuNo, 5)) = 1 THEN CONVERT(INT, RIGHT(DocuNo, 5)) ELSE 0 END), 0) + 1
    FROM dbo.EMSetPriceHD WITH (UPDLOCK, HOLDLOCK)
    WHERE DocuNo LIKE @Prefix + '%';

    SET @DocuNo = @Prefix + RIGHT('00000' + CONVERT(VARCHAR(5), @Seq), 5);

    INSERT INTO dbo.EMSetPriceHD (
        SetPriceID, DocuType, BrchID, DocuNo, DocuDate, BeginDate, EndDate, CustID,
        SetPriceFlag, CustFlag, GoodFlag, DocuFlag, PromotionFlag, GoldenTimeFlag, PriceOption, Remark1, ChangedDate
    ) VALUES (
        @NewSetPriceID, 751, 1, @DocuNo, CAST(GETDATE() AS DATE), @BeginDate, @EndDate, @CustID,
        'Y', 'A', 'C', 'Y', 'N', 'N', '1', @Remark1, GETDATE()
    );
    COMMIT TRANSACTION;
END
GO

IF OBJECT_ID('wf.sp_PriceBookUpsertWinSpeedLine', 'P') IS NULL
    EXEC('CREATE PROCEDURE wf.sp_PriceBookUpsertWinSpeedLine AS RETURN 0');
GO
ALTER PROCEDURE wf.sp_PriceBookUpsertWinSpeedLine
    @SetPriceID    INT,
    @GoodID        INT,
    @GoodPriceNet  DECIMAL(18, 4),
    @BeginDate     DATE = NULL,
    @EndDate       DATE = NULL,
    @Remark        VARCHAR(255) = NULL,
    @ListNo        SMALLINT = NULL OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @GoodPriceNet IS NULL OR @GoodPriceNet <= 0
    BEGIN
        RAISERROR('ราคาขายต้องมากกว่า 0', 16, 1);
        RETURN;
    END

    IF @BeginDate IS NOT NULL AND @EndDate IS NOT NULL AND @BeginDate > @EndDate
    BEGIN
        RAISERROR('วันเริ่มต้องไม่เกินวันสิ้นสุด', 16, 1);
        RETURN;
    END

    DECLARE @UnitID INT;
    SELECT TOP 1 @UnitID = ISNULL(MainGoodUnitID, 1002)
    FROM dbo.EMGood WITH (NOLOCK)
    WHERE GoodID = @GoodID;
    IF @UnitID IS NULL SET @UnitID = 1002;

    BEGIN TRANSACTION;
    DECLARE @FoundListNo SMALLINT;
    IF @ListNo IS NOT NULL
    BEGIN
        SELECT TOP 1 @FoundListNo = ListNo
        FROM dbo.EMSetPriceDT WITH (UPDLOCK, HOLDLOCK)
        WHERE SetPriceID = @SetPriceID AND ListNo = @ListNo;
    END
    IF @FoundListNo IS NULL
    BEGIN
        SELECT TOP 1 @FoundListNo = ListNo
        FROM dbo.EMSetPriceDT WITH (UPDLOCK, HOLDLOCK)
        WHERE SetPriceID = @SetPriceID AND ListID = @GoodID
        ORDER BY ListNo;
    END

    IF @FoundListNo IS NOT NULL
    BEGIN
        UPDATE dbo.EMSetPriceDT
        SET ListID = @GoodID,
            GoodUnitID = ISNULL(GoodUnitID, @UnitID),
            GoodPrice = @GoodPriceNet,
            GoodPriceNet = @GoodPriceNet,
            PriceBaseAmnt = @GoodPriceNet,
            Remark = COALESCE(@Remark, Remark)
        WHERE SetPriceID = @SetPriceID AND ListNo = @FoundListNo;
        SET @ListNo = @FoundListNo;
    END
    ELSE
    BEGIN
        SELECT @FoundListNo = ISNULL(MAX(ListNo), 0) + 1
        FROM dbo.EMSetPriceDT WITH (UPDLOCK, HOLDLOCK)
        WHERE SetPriceID = @SetPriceID;

        INSERT INTO dbo.EMSetPriceDT (
            SetPriceID, ListNo, ListID, GoodUnitID, ListFlag, EditFlag,
            GoodPrice, GoodDiscAmnt, GoodPriceNet, PriceBaseAmnt,
            startgoodqty, endgoodqty, Remark
        ) VALUES (
            @SetPriceID, @FoundListNo, @GoodID, @UnitID, 'Y', 'Y',
            @GoodPriceNet, 0, @GoodPriceNet, @GoodPriceNet,
            1, 9999999, @Remark
        );
        SET @ListNo = @FoundListNo;
    END

    UPDATE dbo.EMSetPriceHD
    SET BeginDate = COALESCE(@BeginDate, BeginDate),
        EndDate = COALESCE(@EndDate, EndDate),
        ChangedDate = GETDATE()
    WHERE SetPriceID = @SetPriceID;

    COMMIT TRANSACTION;
END
GO

IF OBJECT_ID('wf.sp_PriceBookDeleteWinSpeedLine', 'P') IS NULL
    EXEC('CREATE PROCEDURE wf.sp_PriceBookDeleteWinSpeedLine AS RETURN 0');
GO
ALTER PROCEDURE wf.sp_PriceBookDeleteWinSpeedLine
    @SetPriceID INT,
    @ListNo     SMALLINT = NULL,
    @GoodID     INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRANSACTION;
    IF @ListNo IS NOT NULL
    BEGIN
        DELETE FROM dbo.EMSetPriceDT WHERE SetPriceID = @SetPriceID AND ListNo = @ListNo;
    END
    ELSE IF @GoodID IS NOT NULL
    BEGIN
        DELETE FROM dbo.EMSetPriceDT WHERE SetPriceID = @SetPriceID AND ListID = @GoodID;
    END
    UPDATE dbo.EMSetPriceHD SET ChangedDate = GETDATE() WHERE SetPriceID = @SetPriceID;
    COMMIT TRANSACTION;
END
GO

IF OBJECT_ID('wf.sp_PriceBookUpsertSpecialWinSpeedPrice', 'P') IS NULL
    EXEC('CREATE PROCEDURE wf.sp_PriceBookUpsertSpecialWinSpeedPrice AS RETURN 0');
GO
ALTER PROCEDURE wf.sp_PriceBookUpsertSpecialWinSpeedPrice
    @CustID         INT,
    @GoodID         INT,
    @ApprovedPrice  DECIMAL(18, 4),
    @BeginDate      DATE,
    @EndDate        DATE,
    @Remark         VARCHAR(255) = NULL,
    @SetPriceID     INT = NULL OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @CustID IS NULL OR @GoodID IS NULL OR @ApprovedPrice IS NULL OR @ApprovedPrice <= 0
    BEGIN
        RAISERROR('ข้อมูลลูกค้า สินค้า และราคาอนุมัติต้องถูกต้อง', 16, 1);
        RETURN;
    END

    IF @BeginDate IS NULL OR @EndDate IS NULL OR @BeginDate > @EndDate
    BEGIN
        RAISERROR('ต้องระบุช่วงวันที่เริ่มต้น-สิ้นสุดที่ถูกต้อง', 16, 1);
        RETURN;
    END

    DECLARE @DocuNo VARCHAR(25);
    IF @SetPriceID IS NULL OR NOT EXISTS (SELECT 1 FROM dbo.EMSetPriceHD WITH (NOLOCK) WHERE SetPriceID = @SetPriceID AND CustID = @CustID)
    BEGIN
        -- Reuse any existing special price header for same CustID + exact date span if found
        SELECT TOP 1 @SetPriceID = SetPriceID
        FROM dbo.EMSetPriceHD WITH (NOLOCK)
        WHERE CustID = @CustID
          AND CAST(BeginDate AS DATE) = @BeginDate
          AND CAST(EndDate AS DATE) = @EndDate
        ORDER BY SetPriceID DESC;
    END

    IF @SetPriceID IS NULL
    BEGIN
        EXEC wf.sp_PriceBookCreateWinSpeedSet
            @BeginDate = @BeginDate,
            @EndDate = @EndDate,
            @CustID = @CustID,
            @Remark1 = @Remark,
            @NewSetPriceID = @SetPriceID OUTPUT,
            @DocuNo = @DocuNo OUTPUT;
    END

    DECLARE @OutListNo SMALLINT;
    SET @OutListNo = NULL;
    EXEC wf.sp_PriceBookUpsertWinSpeedLine
        @SetPriceID = @SetPriceID,
        @GoodID = @GoodID,
        @GoodPriceNet = @ApprovedPrice,
        @BeginDate = @BeginDate,
        @EndDate = @EndDate,
        @Remark = @Remark,
        @ListNo = @OutListNo OUTPUT;
END
GO

