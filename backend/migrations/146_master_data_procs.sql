-- ============================================================================
-- 146_master_data_procs.sql
-- R12 items 14–16 (O-2): customer / goods / price writes through wf procedures.
--
-- Background: the app login (least privilege) has no UPDATE on dbo.EMCust / dbo.EMGood /
-- dbo.EMSetPriceHD / dbo.EMSetPriceDT and no INSERT on the price tables, so the master
-- data screens failed with "permission denied" (UAT O-2). Bookings already write dbo
-- through wf procedures (ownership chaining); master data now does the same.
--
-- The routes keep the R11 role guards (ADMIN / C_LEVEL) and validation; these
-- procedures repeat the essential checks so a direct EXEC cannot bypass them.
--
-- Grants (production): wf and dbo are both owned by dbo, so EXECUTE on schema wf is
-- enough; no UPDATE/INSERT grant on dbo.EMCust, dbo.EMGood or dbo.EMSetPrice* is needed.
--
-- SQL 2008 R2: CREATE stub + ALTER, no THROW / TRY_CAST, wf objects only.
-- ============================================================================

IF OBJECT_ID('wf.sp_MasterUpdateCustomer', 'P') IS NULL
    EXEC('CREATE PROCEDURE wf.sp_MasterUpdateCustomer AS RETURN 0');
GO
ALTER PROCEDURE wf.sp_MasterUpdateCustomer
    @CustID   VARCHAR(20),
    @CustName NVARCHAR(255) = NULL,
    @Tel      NVARCHAR(50) = NULL,
    @Mobile   NVARCHAR(50) = NULL,
    @Affected INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    IF @CustName IS NOT NULL AND LTRIM(RTRIM(@CustName)) = ''
    BEGIN
        RAISERROR('ชื่อลูกค้าต้องไม่ว่าง', 16, 1);
        RETURN;
    END
    UPDATE dbo.EMCust
    SET CustName = COALESCE(@CustName, CustName),
        ContTel  = COALESCE(@Tel, ContTel),
        ContTel1 = COALESCE(@Mobile, ContTel1)
    WHERE CustID = @CustID;
    SET @Affected = @@ROWCOUNT;
END
GO

IF OBJECT_ID('wf.sp_MasterSetCustomerInactive', 'P') IS NULL
    EXEC('CREATE PROCEDURE wf.sp_MasterSetCustomerInactive AS RETURN 0');
GO
ALTER PROCEDURE wf.sp_MasterSetCustomerInactive
    @CustID   VARCHAR(20),
    @Affected INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.EMCust SET Inactive = 'I', InactiveDate = GETDATE() WHERE CustID = @CustID;
    SET @Affected = @@ROWCOUNT;
END
GO

IF OBJECT_ID('wf.sp_MasterUpdateGoodName', 'P') IS NULL
    EXEC('CREATE PROCEDURE wf.sp_MasterUpdateGoodName AS RETURN 0');
GO
ALTER PROCEDURE wf.sp_MasterUpdateGoodName
    @GoodID   VARCHAR(20),
    @GoodName NVARCHAR(255),
    @Affected INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    IF @GoodName IS NULL OR LTRIM(RTRIM(@GoodName)) = ''
    BEGIN
        RAISERROR('ชื่อสินค้าต้องไม่ว่าง', 16, 1);
        RETURN;
    END
    UPDATE dbo.EMGood SET GoodName1 = @GoodName WHERE GoodID = @GoodID;
    SET @Affected = @@ROWCOUNT;
END
GO

IF OBJECT_ID('wf.sp_MasterSetGoodInactive', 'P') IS NULL
    EXEC('CREATE PROCEDURE wf.sp_MasterSetGoodInactive AS RETURN 0');
GO
ALTER PROCEDURE wf.sp_MasterSetGoodInactive
    @GoodID   VARCHAR(20),
    @Affected INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.EMGood SET Inactive = 'I', InactiveDate = GETDATE() WHERE GoodID = @GoodID;
    SET @Affected = @@ROWCOUNT;
END
GO

IF OBJECT_ID('wf.sp_MasterUpdatePrice', 'P') IS NULL
    EXEC('CREATE PROCEDURE wf.sp_MasterUpdatePrice AS RETURN 0');
GO
ALTER PROCEDURE wf.sp_MasterUpdatePrice
    @SetPriceID   INT,
    @ListNo       INT,
    @GoodPriceNet DECIMAL(18, 4),
    @BeginDate    DATE = NULL,
    @EndDate      DATE = NULL,
    @Affected     INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @GoodPriceNet IS NULL OR @GoodPriceNet <= 0
    BEGIN
        RAISERROR('ราคาต้องมากกว่า 0', 16, 1);
        RETURN;
    END
    IF @BeginDate IS NOT NULL AND @EndDate IS NOT NULL AND @BeginDate > @EndDate
    BEGIN
        RAISERROR('วันเริ่มต้องไม่เกินวันสิ้นสุด', 16, 1);
        RETURN;
    END
    BEGIN TRANSACTION;
    UPDATE dbo.EMSetPriceDT SET GoodPriceNet = @GoodPriceNet
    WHERE SetPriceID = @SetPriceID AND ListNo = @ListNo;
    SET @Affected = @@ROWCOUNT;
    IF @Affected > 0 AND (@BeginDate IS NOT NULL OR @EndDate IS NOT NULL)
        UPDATE dbo.EMSetPriceHD
        SET BeginDate = COALESCE(@BeginDate, BeginDate),
            EndDate   = COALESCE(@EndDate, EndDate)
        WHERE SetPriceID = @SetPriceID;
    COMMIT TRANSACTION;
END
GO

-- New price document (HD + one DT line). SetPriceID and DocuNo WEB-yyyymmdd-NNNN are
-- allocated here under UPDLOCK/HOLDLOCK, so two requests can no longer take the same MAX+1.
IF OBJECT_ID('wf.sp_MasterCreatePrice', 'P') IS NULL
    EXEC('CREATE PROCEDURE wf.sp_MasterCreatePrice AS RETURN 0');
GO
ALTER PROCEDURE wf.sp_MasterCreatePrice
    @GoodID        INT,
    @CustID        VARCHAR(20) = NULL,
    @GoodPriceNet  DECIMAL(18, 4),
    @BeginDate     DATE,
    @EndDate       DATE,
    @StartQty      DECIMAL(18, 4) = 1,
    @EndQty        DECIMAL(18, 4) = 999999,
    @NewSetPriceID INT OUTPUT,
    @DocuNo        VARCHAR(50) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @GoodID IS NULL OR NOT EXISTS (SELECT 1 FROM dbo.EMGood WITH (NOLOCK) WHERE GoodID = @GoodID)
    BEGIN
        RAISERROR('ไม่พบรหัสสินค้า %d', 16, 1, @GoodID);
        RETURN;
    END
    IF @GoodPriceNet IS NULL OR @GoodPriceNet <= 0
    BEGIN
        RAISERROR('ราคาต้องมากกว่า 0', 16, 1);
        RETURN;
    END
    IF @BeginDate IS NULL OR @EndDate IS NULL OR @BeginDate > @EndDate
    BEGIN
        RAISERROR('ต้องระบุวันเริ่มและวันสิ้นสุด และวันเริ่มต้องไม่เกินวันสิ้นสุด', 16, 1);
        RETURN;
    END

    BEGIN TRANSACTION;
    SELECT @NewSetPriceID = ISNULL(MAX(SetPriceID), 1000) + 1 FROM dbo.EMSetPriceHD WITH (UPDLOCK, HOLDLOCK);

    DECLARE @Prefix VARCHAR(20), @Seq INT;
    SET @Prefix = 'WEB-' + CONVERT(VARCHAR(8), GETDATE(), 112) + '-';
    SELECT @Seq = ISNULL(MAX(CASE WHEN ISNUMERIC(RIGHT(DocuNo, 4)) = 1 THEN CONVERT(INT, RIGHT(DocuNo, 4)) ELSE 0 END), 0) + 1
    FROM dbo.EMSetPriceHD WITH (UPDLOCK, HOLDLOCK)
    WHERE DocuNo LIKE @Prefix + '%';
    SET @DocuNo = @Prefix + RIGHT('0000' + CONVERT(VARCHAR(4), @Seq), 4);

    INSERT INTO dbo.EMSetPriceHD (
        SetPriceID, DocuType, BrchID, DocuNo, DocuDate, BeginDate, EndDate, CustID,
        SetPriceFlag, CustFlag, GoodFlag, DocuFlag, PromotionFlag, GoldenTimeFlag, ChangedDate
    ) VALUES (
        @NewSetPriceID, 133, 1, @DocuNo, CAST(GETDATE() AS DATE), @BeginDate, @EndDate, @CustID,
        'Y', 'A', 'C', 'Y', 'N', 'N', GETDATE()
    );
    INSERT INTO dbo.EMSetPriceDT (
        SetPriceID, ListNo, ListID, GoodPriceNet, startgoodqty, endgoodqty, ListFlag, EditFlag
    ) VALUES (
        @NewSetPriceID, 1, @GoodID, @GoodPriceNet, ISNULL(@StartQty, 1), ISNULL(@EndQty, 999999), 'A', 'N'
    );
    COMMIT TRANSACTION;
END
GO
