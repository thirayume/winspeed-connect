-- ============================================================================
-- 145_k_book_counters.sql
-- R12 item 9 — K bills (บัญชี 2) use WINSpeed's own K/D/N counters.
--
-- Where WINSpeed keeps each series (measured 2026-10-05/06, local copy):
--   dbo.EMRunBrch                      the ACTIVE book per RunCode (e.g. 103 I, couponno C)
--   dbo.EMRunChar (RunCode, ListNo,    BOTH books per RunCode: ListNo 1 = I / C / J (account 1),
--                  Prefix)             ListNo 2 = K / D / N (account 2)
--   Staff switch the active book many times a day in "กำหนดเลขที่เอกสาร" (w_emrun,
--   SMAudit system 1 / screen 74). While a book is active in EMRunBrch its EMRunChar
--   row is stale. So the location of a prefix can change at any moment.
--
-- K-F1  wf.sp_AdvanceDocuCounter: advance the row that currently holds the prefix,
--       locking the RunCode's rows in BOTH tables first, forward-only, format-guarded,
--       never writing a number into a row of another prefix.
-- K-F2  wf.usp_AllocateCouponNo: same rule for coupon numbers (was: D fixed in
--       EMRunBrch, C fixed in EMRunChar — the reverse of today).
--
-- The app login has no UPDATE on dbo.EMRunChar; wf and dbo are both owned by dbo,
-- so these procedures write through ownership chaining with EXECUTE on wf only.
-- The app never switches the active book.
--
-- SQL 2008 R2: CREATE stub + ALTER, no TRY_CAST, wf objects only, no dbo structure change.
-- ============================================================================

IF OBJECT_ID('wf.sp_AdvanceDocuCounter', 'P') IS NULL
    EXEC('CREATE PROCEDURE wf.sp_AdvanceDocuCounter AS RETURN 0');
GO
ALTER PROCEDURE wf.sp_AdvanceDocuCounter
    @RunCode  VARCHAR(30),
    @DocuNo   VARCHAR(30),
    @BrchID   INT = 1,
    @Updated  INT OUTPUT,
    @Location VARCHAR(20) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET @Updated = 0;
    SET @Location = NULL;

    DECLARE @Prefix CHAR(1);
    SET @Prefix = LEFT(@DocuNo, 1);
    IF @Prefix NOT LIKE '[A-Z]' OR LEN(@DocuNo) < 6
    BEGIN
        RAISERROR('wf.sp_AdvanceDocuCounter: เลขที่เอกสาร %s ไม่ถูกต้อง', 16, 1, @DocuNo);
        RETURN;
    END

    -- Lock the RunCode's rows in both tables before deciding where the prefix lives
    DECLARE @BrFormat VARCHAR(30), @BrLast VARCHAR(30), @ChPrefix VARCHAR(30), @ChLast VARCHAR(30);
    SELECT @BrFormat = RTRIM(RunFormat), @BrLast = RTRIM(LastNo)
    FROM dbo.EMRunBrch WITH (UPDLOCK, HOLDLOCK)
    WHERE RunCode = @RunCode AND BrchID = @BrchID;

    SELECT TOP 1 @ChPrefix = RTRIM(Prefix), @ChLast = RTRIM(Lastno)
    FROM dbo.EMRunChar WITH (UPDLOCK, HOLDLOCK)
    WHERE RunCode = @RunCode AND BrchID = @BrchID AND LEFT(Prefix, 1) = @Prefix
    ORDER BY ListNo;

    IF LEFT(@BrFormat, 1) = @Prefix
    BEGIN
        -- active book: the EMRunChar row of this prefix is stale and is never touched
        SET @Location = 'EMRunBrch';
        IF @BrLast IS NULL OR @BrLast = ''
           OR (LEFT(@BrLast, 1) = @Prefix AND LEN(@BrLast) = LEN(@DocuNo) AND @BrLast < @DocuNo)
        BEGIN
            UPDATE dbo.EMRunBrch SET LastNo = @DocuNo
            WHERE RunCode = @RunCode AND BrchID = @BrchID AND LEFT(RunFormat, 1) = @Prefix;
            SET @Updated = @@ROWCOUNT;
        END
    END
    ELSE IF @ChPrefix IS NOT NULL
    BEGIN
        SET @Location = 'EMRunChar';
        IF @ChLast IS NULL OR @ChLast = ''
           OR (LEFT(@ChLast, 1) = @Prefix AND LEN(@ChLast) = LEN(@DocuNo) AND @ChLast < @DocuNo)
        BEGIN
            UPDATE dbo.EMRunChar SET Lastno = @DocuNo
            WHERE RunCode = @RunCode AND BrchID = @BrchID AND Prefix = @ChPrefix;
            SET @Updated = @@ROWCOUNT;
        END
    END
END
GO

-- K-F2: coupon numbers follow the same per-prefix rule ------------------------
IF OBJECT_ID('wf.usp_AllocateCouponNo', 'P') IS NULL
    EXEC('CREATE PROCEDURE wf.usp_AllocateCouponNo AS RETURN 0');
GO
ALTER PROCEDURE wf.usp_AllocateCouponNo
    @Series    CHAR(1),        -- 'C' (account 1, I bills) or 'D' (account 2, K bills)
    @DocuDate  DATETIME,
    @BrchID    VARCHAR(20),
    @CouponNo  VARCHAR(25) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    IF @Series NOT IN ('C', 'D')
    BEGIN
        RAISERROR('wf.usp_AllocateCouponNo: เล่มตั๋ว %s ไม่ถูกต้อง — รองรับเฉพาะ C กับ D', 16, 1, @Series);
        RETURN;
    END

    DECLARE @YY CHAR(2), @Prefix VARCHAR(3), @FromCounter INT, @FromData INT, @Next INT, @Guard INT;
    SET @YY = RIGHT(CONVERT(VARCHAR(4), YEAR(@DocuDate) + 543), 2);
    SET @Prefix = @Series + @YY;
    SET @FromCounter = 0; SET @FromData = 0; SET @Guard = 0;

    -- Lock both tables' couponno rows, then read the row that holds this series
    DECLARE @BrFormat VARCHAR(30), @BrLast VARCHAR(30), @ChPrefix VARCHAR(30), @ChLast VARCHAR(30), @InBrch BIT;
    SELECT @BrFormat = RTRIM(RunFormat), @BrLast = RTRIM(LastNo)
    FROM dbo.EMRunBrch WITH (UPDLOCK, HOLDLOCK)
    WHERE RunCode = 'couponno' AND BrchID = @BrchID;
    SELECT TOP 1 @ChPrefix = RTRIM(Prefix), @ChLast = RTRIM(Lastno)
    FROM dbo.EMRunChar WITH (UPDLOCK, HOLDLOCK)
    WHERE RunCode = 'couponno' AND BrchID = @BrchID AND LEFT(Prefix, 1) = @Series
    ORDER BY ListNo;

    SET @InBrch = CASE WHEN LEFT(@BrFormat, 1) = @Series THEN 1 ELSE 0 END;
    DECLARE @Last VARCHAR(30);
    SET @Last = CASE WHEN @InBrch = 1 THEN @BrLast ELSE @ChLast END;
    IF LEFT(@Last, 3) = @Prefix AND ISNUMERIC(SUBSTRING(@Last, 4, 5)) = 1
        SET @FromCounter = CONVERT(INT, SUBSTRING(@Last, 4, 5));

    -- Highest number already issued in this series and year (counter may lag)
    SELECT @FromData = ISNULL(MAX(CONVERT(INT, SUBSTRING(CouponNo, 4, 5))), 0)
    FROM dbo.WFCoupon WITH (UPDLOCK, HOLDLOCK)
    WHERE CouponNo LIKE @Prefix + '[0-9][0-9][0-9][0-9][0-9]';

    SET @Next = (CASE WHEN @FromCounter > @FromData THEN @FromCounter ELSE @FromData END) + 1;

    WHILE @Guard < 1000
    BEGIN
        SET @Guard = @Guard + 1;
        SET @CouponNo = @Prefix + RIGHT('00000' + CONVERT(VARCHAR(5), @Next), 5);
        IF NOT EXISTS (SELECT 1 FROM dbo.WFCoupon WHERE CouponNo = @CouponNo) BREAK;
        SET @Next = @Next + 1;
    END

    IF @Guard >= 1000 OR @Next > 99999
    BEGIN
        RAISERROR('wf.usp_AllocateCouponNo: หาเลขว่างในเล่ม %s ไม่ได้', 16, 1, @Prefix);
        RETURN;
    END

    -- Advance the row that holds this series (forward-only; never the other prefix)
    IF @InBrch = 1
        UPDATE dbo.EMRunBrch SET LastNo = @CouponNo
        WHERE RunCode = 'couponno' AND BrchID = @BrchID AND LEFT(RunFormat, 1) = @Series
          AND (LastNo IS NULL OR RTRIM(LastNo) = '' OR (LEFT(LastNo, 1) = @Series AND RTRIM(LastNo) < @CouponNo));
    ELSE IF @ChPrefix IS NOT NULL
        UPDATE dbo.EMRunChar SET Lastno = @CouponNo
        WHERE RunCode = 'couponno' AND BrchID = @BrchID AND Prefix = @ChPrefix
          AND (Lastno IS NULL OR RTRIM(Lastno) = '' OR (LEFT(Lastno, 1) = @Series AND RTRIM(Lastno) < @CouponNo));
END
GO
