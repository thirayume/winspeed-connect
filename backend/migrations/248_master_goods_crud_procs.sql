-- @transaction
-- ============================================================================
-- 248_master_goods_crud_procs.sql
-- Owner, 18 Nov 2026: Sale-App may create, change and delete the WinSpeed master rows it works with (goods,
-- goods groups, giveaway goods = goods of group 1005), complete and without duplicates.
--
-- Rules (docs/sale-app/handover/WINSPEED-MASTER-DATA-RULES.md):
-- * WinSpeed stays the one source: Sale-App keeps no copy of a good or a group, only app-only attributes in
--   wf.GoodExtra keyed by GoodID.
-- * Every write goes through these procedures inside the caller's transaction, with WinSpeed's own RI
--   triggers on (tI_/tU_/tD_EMGood, tD_EMGoodGroup, tI_EMGoodMultiUnit) and one wf.ChangeEvent per change.
-- * A new good copies every WinSpeed setting (type, VAT, accounts, flags) from a template good of the same
--   group, so it looks exactly like the goods WinSpeed users made; quantities and costs start at zero, and
--   it gets the one EMGoodMultiUnit row every good has (checked: 555 of 555 on UAT).
-- * GoodID and GoodGroupID are not identities; WinSpeed itself takes the next number. Here the next number
--   is taken under UPDLOCK/HOLDLOCK in the same transaction as the insert.
-- * No duplicates: a goods code, a group code and a group name are unique; an active good's name is unique
--   within its group.
-- * Delete only what nothing uses: WinSpeed's triggers refuse a good or group used in any document; these
--   procedures also refuse one any Sale-App table refers to. Otherwise set it inactive.
--
-- SQL Server 2008 R2, compatibility 80: no THROW / TRY_CAST / CONCAT / IIF; CREATE stub + ALTER.
-- ============================================================================
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

IF OBJECT_ID('wf.sp_MasterSaveGoodGroup', 'P') IS NULL
    EXEC('CREATE PROCEDURE wf.sp_MasterSaveGoodGroup AS RETURN 0');
GO
ALTER PROCEDURE wf.sp_MasterSaveGoodGroup
    @GoodGroupID   INT = NULL,          -- NULL: create
    @GoodGroupCode VARCHAR(25),
    @GoodGroupName NVARCHAR(255),
    @GoodGroupNameEng NVARCHAR(255) = NULL,
    @Remark        NVARCHAR(255) = NULL,
    @UserId        INT,
    @ActorUserId   INT,
    @SavedID       INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON; SET ARITHABORT ON; SET ANSI_WARNINGS ON;
    IF @@TRANCOUNT < 1 OR XACT_STATE() <> 1
    BEGIN RAISERROR('MASTER_TRANSACTION_REQUIRED', 16, 1); RETURN; END;
    SET @GoodGroupCode = LTRIM(RTRIM(ISNULL(@GoodGroupCode, '')));
    SET @GoodGroupName = LTRIM(RTRIM(ISNULL(@GoodGroupName, N'')));
    IF @GoodGroupCode = '' OR @GoodGroupName = N''
    BEGIN RAISERROR('MASTER_GROUP_CODE_NAME_REQUIRED', 16, 1); RETURN; END;
    IF EXISTS (SELECT 1 FROM dbo.EMGoodGroup WITH (UPDLOCK, HOLDLOCK)
               WHERE LTRIM(RTRIM(GoodGroupCode)) = @GoodGroupCode AND (@GoodGroupID IS NULL OR GoodGroupID <> @GoodGroupID))
    BEGIN RAISERROR('MASTER_GROUP_CODE_DUPLICATE', 16, 1); RETURN; END;
    IF EXISTS (SELECT 1 FROM dbo.EMGoodGroup WITH (UPDLOCK, HOLDLOCK)
               WHERE LTRIM(RTRIM(GoodGroupName)) = @GoodGroupName AND (@GoodGroupID IS NULL OR GoodGroupID <> @GoodGroupID))
    BEGIN RAISERROR('MASTER_GROUP_NAME_DUPLICATE', 16, 1); RETURN; END;

    DECLARE @before NVARCHAR(1000);
    IF @GoodGroupID IS NULL
    BEGIN
        SELECT @SavedID = ISNULL(MAX(GoodGroupID), 999) + 1 FROM dbo.EMGoodGroup WITH (UPDLOCK, HOLDLOCK);
        INSERT INTO dbo.EMGoodGroup (GoodGroupID, GoodGroupCode, GoodGroupName, GoodGroupNameEng, Remark)
        VALUES (@SavedID, @GoodGroupCode, @GoodGroupName, NULLIF(LTRIM(RTRIM(@GoodGroupNameEng)), N''), NULLIF(LTRIM(RTRIM(@Remark)), N''));
    END
    ELSE
    BEGIN
        SELECT @before = N'{"code":"' + REPLACE(RTRIM(GoodGroupCode), '"', '') + N'","name":"' + REPLACE(RTRIM(GoodGroupName), '"', '') + N'"}'
        FROM dbo.EMGoodGroup WITH (UPDLOCK, HOLDLOCK) WHERE GoodGroupID = @GoodGroupID;
        IF @before IS NULL BEGIN RAISERROR('MASTER_GROUP_NOT_FOUND', 16, 1); RETURN; END;
        UPDATE dbo.EMGoodGroup
        SET GoodGroupCode = @GoodGroupCode, GoodGroupName = @GoodGroupName,
            GoodGroupNameEng = NULLIF(LTRIM(RTRIM(@GoodGroupNameEng)), N''), Remark = NULLIF(LTRIM(RTRIM(@Remark)), N'')
        WHERE GoodGroupID = @GoodGroupID;
        SET @SavedID = @GoodGroupID;
    END;
    INSERT wf.ChangeEvent (EntityType, EntityId, Action, BeforeJson, AfterJson, ReasonCode, UserId, ActorUserId)
    VALUES ('WINSPEED_GOOD_GROUP', CONVERT(VARCHAR(20), @SavedID), CASE WHEN @before IS NULL THEN 'CREATE' ELSE 'UPDATE' END, @before,
            N'{"code":"' + REPLACE(@GoodGroupCode, '"', '') + N'","name":"' + REPLACE(@GoodGroupName, '"', '') + N'"}',
            'MASTER_DATA', CONVERT(VARCHAR(20), @UserId), CONVERT(VARCHAR(20), @ActorUserId));
END
GO

IF OBJECT_ID('wf.sp_MasterDeleteGoodGroup', 'P') IS NULL
    EXEC('CREATE PROCEDURE wf.sp_MasterDeleteGoodGroup AS RETURN 0');
GO
ALTER PROCEDURE wf.sp_MasterDeleteGoodGroup
    @GoodGroupID INT,
    @UserId      INT,
    @ActorUserId INT,
    @Affected    INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON; SET ARITHABORT ON; SET ANSI_WARNINGS ON;
    IF @@TRANCOUNT < 1 OR XACT_STATE() <> 1
    BEGIN RAISERROR('MASTER_TRANSACTION_REQUIRED', 16, 1); RETURN; END;
    DECLARE @before NVARCHAR(1000);
    SELECT @before = N'{"code":"' + REPLACE(RTRIM(GoodGroupCode), '"', '') + N'","name":"' + REPLACE(RTRIM(GoodGroupName), '"', '') + N'"}'
    FROM dbo.EMGoodGroup WITH (UPDLOCK, HOLDLOCK) WHERE GoodGroupID = @GoodGroupID;
    IF @before IS NULL BEGIN SET @Affected = 0; RETURN; END;
    IF EXISTS (SELECT 1 FROM dbo.EMGood WITH (UPDLOCK, HOLDLOCK) WHERE GoodGroupID = @GoodGroupID)
    BEGIN RAISERROR('MASTER_GROUP_HAS_GOODS', 16, 1); RETURN; END;
    -- tD_EMGoodGroup refuses a group that WinSpeed price, count, stock or set-up rows still use.
    DELETE FROM dbo.EMGoodGroup WHERE GoodGroupID = @GoodGroupID;
    SET @Affected = @@ROWCOUNT;
    INSERT wf.ChangeEvent (EntityType, EntityId, Action, BeforeJson, ReasonCode, UserId, ActorUserId)
    VALUES ('WINSPEED_GOOD_GROUP', CONVERT(VARCHAR(20), @GoodGroupID), 'DELETE', @before, 'MASTER_DATA',
            CONVERT(VARCHAR(20), @UserId), CONVERT(VARCHAR(20), @ActorUserId));
END
GO

IF OBJECT_ID('wf.sp_MasterCreateGood', 'P') IS NULL
    EXEC('CREATE PROCEDURE wf.sp_MasterCreateGood AS RETURN 0');
GO
ALTER PROCEDURE wf.sp_MasterCreateGood
    @GoodCode       VARCHAR(50),
    @GoodName       NVARCHAR(255),
    @GoodGroupID    INT,
    @MainGoodUnitID INT = NULL,          -- NULL: the template's main unit
    @TemplateGoodID INT = NULL,          -- NULL: the newest good of the same group
    @GoodWeight     MONEY = NULL,        -- kg per pack; NULL: the template's
    @UserId         INT,
    @ActorUserId    INT,
    @NewGoodID      INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON; SET ARITHABORT ON; SET ANSI_WARNINGS ON;
    IF @@TRANCOUNT < 1 OR XACT_STATE() <> 1
    BEGIN RAISERROR('MASTER_TRANSACTION_REQUIRED', 16, 1); RETURN; END;
    SET @GoodCode = LTRIM(RTRIM(ISNULL(@GoodCode, '')));
    SET @GoodName = LTRIM(RTRIM(ISNULL(@GoodName, N'')));
    IF @GoodCode = '' OR @GoodName = N''
    BEGIN RAISERROR('MASTER_GOOD_CODE_NAME_REQUIRED', 16, 1); RETURN; END;
    IF NOT EXISTS (SELECT 1 FROM dbo.EMGoodGroup WHERE GoodGroupID = @GoodGroupID)
    BEGIN RAISERROR('MASTER_GROUP_NOT_FOUND', 16, 1); RETURN; END;
    IF EXISTS (SELECT 1 FROM dbo.EMGood WITH (UPDLOCK, HOLDLOCK) WHERE LTRIM(RTRIM(GoodCode)) = @GoodCode)
    BEGIN RAISERROR('MASTER_GOOD_CODE_DUPLICATE', 16, 1); RETURN; END;
    IF EXISTS (SELECT 1 FROM dbo.EMGood WITH (UPDLOCK, HOLDLOCK)
               WHERE GoodGroupID = @GoodGroupID AND ISNULL(Inactive, 'A') = 'A' AND LTRIM(RTRIM(GoodName1)) = @GoodName)
    BEGIN RAISERROR('MASTER_GOOD_NAME_DUPLICATE', 16, 1); RETURN; END;

    IF @TemplateGoodID IS NULL
        SELECT @TemplateGoodID = MAX(GoodID) FROM dbo.EMGood WHERE GoodGroupID = @GoodGroupID AND ISNULL(Inactive, 'A') = 'A';
    IF @TemplateGoodID IS NULL OR NOT EXISTS (SELECT 1 FROM dbo.EMGood WHERE GoodID = @TemplateGoodID)
    BEGIN RAISERROR('MASTER_GOOD_TEMPLATE_REQUIRED', 16, 1); RETURN; END;

    DECLARE @templateUnit INT;
    SELECT @templateUnit = MainGoodUnitID FROM dbo.EMGood WHERE GoodID = @TemplateGoodID;
    SET @MainGoodUnitID = ISNULL(@MainGoodUnitID, @templateUnit);
    IF @MainGoodUnitID IS NULL OR NOT EXISTS (SELECT 1 FROM dbo.EMGoodUnit WHERE GoodUnitID = @MainGoodUnitID)
    BEGIN RAISERROR('MASTER_GOOD_UNIT_NOT_FOUND', 16, 1); RETURN; END;

    SELECT @NewGoodID = ISNULL(MAX(GoodID), 999) + 1 FROM dbo.EMGood WITH (UPDLOCK, HOLDLOCK);

    -- Copy every WinSpeed column of the template, then set what makes this good its own.
    SELECT * INTO #good FROM dbo.EMGood WHERE GoodID = @TemplateGoodID;
    UPDATE #good SET
        GoodID = @NewGoodID, GoodCode = @GoodCode, GoodName1 = @GoodName,
        GoodName2 = NULL, GoodNameEng1 = NULL, GoodNameEng2 = NULL, GoodBillName = NULL, GoodMarketName = NULL,
        GoodGroupID = @GoodGroupID,
        MainGoodUnitID = @MainGoodUnitID,
        SaleGoodUnitID = CASE WHEN SaleGoodUnitID IS NULL THEN NULL ELSE @MainGoodUnitID END,
        BuyGoodUnitID  = CASE WHEN BuyGoodUnitID  IS NULL THEN NULL ELSE @MainGoodUnitID END,
        SubGoodUnitID  = NULL, GoodUnitID1 = NULL, GoodUnitID2 = NULL, GoodCompareUnitID = NULL,
        GoodWeight = ISNULL(@GoodWeight, GoodWeight),
        RemaQty = 0, RemaCost = 0, RemaAmnt = 0, StockQty = 0, BackReceQty = 0, BackSendQty = 0, MarkQty = 0,
        SerialRunningNo = NULL, GoodSegCode = NULL,
        Inactive = 'A', InactiveDate = NULL;
    INSERT INTO dbo.EMGood SELECT * FROM #good;
    DROP TABLE #good;

    INSERT INTO dbo.EMGoodMultiUnit (GoodUnitID, GoodID, GoodUnitRate, SaleUnitFlag, MainUnitFlag, BuyUnitFlag)
    SELECT @MainGoodUnitID, @NewGoodID, 1, ISNULL(MAX(m.SaleUnitFlag), 'N'), 'Y', ISNULL(MAX(m.BuyUnitFlag), 'N')
    FROM dbo.EMGoodMultiUnit m
    WHERE m.GoodID = @TemplateGoodID AND m.MainUnitFlag = 'Y';

    INSERT wf.ChangeEvent (EntityType, EntityId, Action, AfterJson, ReasonCode, ReasonText, UserId, ActorUserId)
    VALUES ('WINSPEED_GOOD', CONVERT(VARCHAR(20), @NewGoodID), 'CREATE',
            N'{"code":"' + REPLACE(@GoodCode, '"', '') + N'","name":"' + REPLACE(@GoodName, '"', '') + N'","group":' + CONVERT(NVARCHAR(20), @GoodGroupID)
              + N',"unit":' + CONVERT(NVARCHAR(20), @MainGoodUnitID) + N',"template":' + CONVERT(NVARCHAR(20), @TemplateGoodID) + N'}',
            'MASTER_DATA', NULL, CONVERT(VARCHAR(20), @UserId), CONVERT(VARCHAR(20), @ActorUserId));
END
GO

IF OBJECT_ID('wf.sp_MasterUpdateGood', 'P') IS NULL
    EXEC('CREATE PROCEDURE wf.sp_MasterUpdateGood AS RETURN 0');
GO
ALTER PROCEDURE wf.sp_MasterUpdateGood
    @GoodID      INT,
    @GoodCode    VARCHAR(50),
    @GoodName    NVARCHAR(255),
    @GoodGroupID INT,
    @UserId      INT,
    @ActorUserId INT,
    @Affected    INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON; SET ARITHABORT ON; SET ANSI_WARNINGS ON;
    IF @@TRANCOUNT < 1 OR XACT_STATE() <> 1
    BEGIN RAISERROR('MASTER_TRANSACTION_REQUIRED', 16, 1); RETURN; END;
    SET @GoodCode = LTRIM(RTRIM(ISNULL(@GoodCode, '')));
    SET @GoodName = LTRIM(RTRIM(ISNULL(@GoodName, N'')));
    IF @GoodCode = '' OR @GoodName = N''
    BEGIN RAISERROR('MASTER_GOOD_CODE_NAME_REQUIRED', 16, 1); RETURN; END;
    DECLARE @before NVARCHAR(1000), @inactive CHAR(1);
    SELECT @before = N'{"code":"' + REPLACE(RTRIM(GoodCode), '"', '') + N'","name":"' + REPLACE(RTRIM(ISNULL(GoodName1, '')), '"', '')
                     + N'","group":' + ISNULL(CONVERT(NVARCHAR(20), GoodGroupID), N'null') + N'}',
           @inactive = ISNULL(Inactive, 'A')
    FROM dbo.EMGood WITH (UPDLOCK, HOLDLOCK) WHERE GoodID = @GoodID;
    IF @before IS NULL BEGIN SET @Affected = 0; RETURN; END;
    IF NOT EXISTS (SELECT 1 FROM dbo.EMGoodGroup WHERE GoodGroupID = @GoodGroupID)
    BEGIN RAISERROR('MASTER_GROUP_NOT_FOUND', 16, 1); RETURN; END;
    IF EXISTS (SELECT 1 FROM dbo.EMGood WITH (UPDLOCK, HOLDLOCK) WHERE LTRIM(RTRIM(GoodCode)) = @GoodCode AND GoodID <> @GoodID)
    BEGIN RAISERROR('MASTER_GOOD_CODE_DUPLICATE', 16, 1); RETURN; END;
    IF @inactive = 'A' AND EXISTS (SELECT 1 FROM dbo.EMGood WITH (UPDLOCK, HOLDLOCK)
               WHERE GoodGroupID = @GoodGroupID AND ISNULL(Inactive, 'A') = 'A' AND LTRIM(RTRIM(GoodName1)) = @GoodName AND GoodID <> @GoodID)
    BEGIN RAISERROR('MASTER_GOOD_NAME_DUPLICATE', 16, 1); RETURN; END;
    UPDATE dbo.EMGood SET GoodCode = @GoodCode, GoodName1 = @GoodName, GoodGroupID = @GoodGroupID WHERE GoodID = @GoodID;
    SET @Affected = @@ROWCOUNT;
    INSERT wf.ChangeEvent (EntityType, EntityId, Action, BeforeJson, AfterJson, ReasonCode, UserId, ActorUserId)
    VALUES ('WINSPEED_GOOD', CONVERT(VARCHAR(20), @GoodID), 'UPDATE', @before,
            N'{"code":"' + REPLACE(@GoodCode, '"', '') + N'","name":"' + REPLACE(@GoodName, '"', '') + N'","group":' + CONVERT(NVARCHAR(20), @GoodGroupID) + N'}',
            'MASTER_DATA', CONVERT(VARCHAR(20), @UserId), CONVERT(VARCHAR(20), @ActorUserId));
END
GO

IF OBJECT_ID('wf.sp_MasterSetGoodStatus', 'P') IS NULL
    EXEC('CREATE PROCEDURE wf.sp_MasterSetGoodStatus AS RETURN 0');
GO
ALTER PROCEDURE wf.sp_MasterSetGoodStatus
    @GoodID      INT,
    @Status      CHAR(1),                -- 'A' sell, 'I' stopped
    @UserId      INT,
    @ActorUserId INT,
    @Affected    INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON; SET ARITHABORT ON; SET ANSI_WARNINGS ON;
    IF @@TRANCOUNT < 1 OR XACT_STATE() <> 1
    BEGIN RAISERROR('MASTER_TRANSACTION_REQUIRED', 16, 1); RETURN; END;
    IF @Status NOT IN ('A', 'I') BEGIN RAISERROR('MASTER_GOOD_STATUS_INVALID', 16, 1); RETURN; END;
    DECLARE @was CHAR(1), @group INT, @name NVARCHAR(255);
    SELECT @was = ISNULL(Inactive, 'A'), @group = GoodGroupID, @name = LTRIM(RTRIM(GoodName1))
    FROM dbo.EMGood WITH (UPDLOCK, HOLDLOCK) WHERE GoodID = @GoodID;
    IF @was IS NULL BEGIN SET @Affected = 0; RETURN; END;
    IF @Status = 'A' AND @was <> 'A' AND EXISTS (SELECT 1 FROM dbo.EMGood WITH (UPDLOCK, HOLDLOCK)
               WHERE GoodGroupID = @group AND ISNULL(Inactive, 'A') = 'A' AND LTRIM(RTRIM(GoodName1)) = @name AND GoodID <> @GoodID)
    BEGIN RAISERROR('MASTER_GOOD_NAME_DUPLICATE', 16, 1); RETURN; END;
    UPDATE dbo.EMGood SET Inactive = @Status, InactiveDate = CASE WHEN @Status = 'I' THEN GETDATE() ELSE NULL END WHERE GoodID = @GoodID;
    SET @Affected = @@ROWCOUNT;
    IF @was <> @Status
        INSERT wf.ChangeEvent (EntityType, EntityId, Action, BeforeJson, AfterJson, ReasonCode, UserId, ActorUserId)
        VALUES ('WINSPEED_GOOD', CONVERT(VARCHAR(20), @GoodID), 'STATUS', N'{"inactive":"' + @was + N'"}', N'{"inactive":"' + @Status + N'"}',
                'MASTER_DATA', CONVERT(VARCHAR(20), @UserId), CONVERT(VARCHAR(20), @ActorUserId));
END
GO

IF OBJECT_ID('wf.sp_MasterDeleteGood', 'P') IS NULL
    EXEC('CREATE PROCEDURE wf.sp_MasterDeleteGood AS RETURN 0');
GO
ALTER PROCEDURE wf.sp_MasterDeleteGood
    @GoodID      INT,
    @UserId      INT,
    @ActorUserId INT,
    @Affected    INT OUTPUT,
    @UsedBy      NVARCHAR(200) OUTPUT     -- the first table that still uses the good, when refused
AS
BEGIN
    SET NOCOUNT ON; SET ARITHABORT ON; SET ANSI_WARNINGS ON;
    IF @@TRANCOUNT < 1 OR XACT_STATE() <> 1
    BEGIN RAISERROR('MASTER_TRANSACTION_REQUIRED', 16, 1); RETURN; END;
    SET @Affected = 0; SET @UsedBy = NULL;
    DECLARE @before NVARCHAR(1000);
    SELECT @before = N'{"code":"' + REPLACE(RTRIM(GoodCode), '"', '') + N'","name":"' + REPLACE(RTRIM(ISNULL(GoodName1, '')), '"', '')
                     + N'","group":' + ISNULL(CONVERT(NVARCHAR(20), GoodGroupID), N'null') + N'}'
    FROM dbo.EMGood WITH (UPDLOCK, HOLDLOCK) WHERE GoodID = @GoodID;
    IF @before IS NULL RETURN;

    -- WinSpeed documents most often holding a good (tD_EMGood checks about 80 tables in all).
    IF EXISTS (SELECT 1 FROM dbo.SODT WHERE GoodID = @GoodID) SET @UsedBy = N'dbo.SODT';
    ELSE IF EXISTS (SELECT 1 FROM dbo.SOInvDT WHERE GoodID = @GoodID) SET @UsedBy = N'dbo.SOInvDT';
    ELSE IF EXISTS (SELECT 1 FROM dbo.ICStockDT WHERE GoodID = @GoodID) SET @UsedBy = N'dbo.ICStockDT';
    ELSE IF EXISTS (SELECT 1 FROM dbo.EMSetPriceDT WHERE ListID = @GoodID) SET @UsedBy = N'dbo.EMSetPriceDT';
    ELSE IF EXISTS (SELECT 1 FROM dbo.WFCoupon WHERE GoodID = @GoodID) SET @UsedBy = N'dbo.WFCoupon';
    IF @UsedBy IS NOT NULL RETURN;

    -- Every Sale-App table that refers to a good by its id (wf.GoodExtra is the good's own extension).
    DECLARE @table SYSNAME, @column SYSNAME, @found INT, @sqlText NVARCHAR(600);
    DECLARE refs CURSOR LOCAL FAST_FORWARD FOR
        SELECT t.name, c.name FROM sys.columns c JOIN sys.tables t ON t.object_id = c.object_id
        WHERE t.schema_id = SCHEMA_ID('wf') AND c.name = 'GoodId' AND t.name <> 'GoodExtra' AND t.name NOT LIKE '%Backup%';
    OPEN refs; FETCH NEXT FROM refs INTO @table, @column;
    WHILE @@FETCH_STATUS = 0 AND @UsedBy IS NULL
    BEGIN
        SET @found = 0;
        SET @sqlText = N'SELECT @f = CASE WHEN EXISTS (SELECT 1 FROM wf.' + QUOTENAME(@table) + N' WHERE CONVERT(VARCHAR(50), '
                     + QUOTENAME(@column) + N') = CONVERT(VARCHAR(50), @g)) THEN 1 ELSE 0 END';
        EXEC sp_executesql @sqlText, N'@g INT, @f INT OUTPUT', @g = @GoodID, @f = @found OUTPUT;
        IF @found = 1 SET @UsedBy = N'wf.' + @table;
        FETCH NEXT FROM refs INTO @table, @column;
    END;
    CLOSE refs; DEALLOCATE refs;
    IF @UsedBy IS NOT NULL RETURN;

    DELETE FROM wf.GoodExtra WHERE GoodId = CONVERT(NVARCHAR(40), @GoodID);
    DELETE FROM dbo.EMGoodMultiUnit WHERE GoodID = @GoodID;
    DELETE FROM dbo.EMGood WHERE GoodID = @GoodID;   -- tD_EMGood refuses if any other WinSpeed row still uses it
    SET @Affected = @@ROWCOUNT;
    INSERT wf.ChangeEvent (EntityType, EntityId, Action, BeforeJson, ReasonCode, UserId, ActorUserId)
    VALUES ('WINSPEED_GOOD', CONVERT(VARCHAR(20), @GoodID), 'DELETE', @before, 'MASTER_DATA',
            CONVERT(VARCHAR(20), @UserId), CONVERT(VARCHAR(20), @ActorUserId));
END
GO

PRINT 'Migration 248: WinSpeed goods / goods group create-update-delete procedures ready';
GO
