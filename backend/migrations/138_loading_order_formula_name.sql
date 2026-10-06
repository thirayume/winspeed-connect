-- Migration 138: Loading order by formula name (R15 / Owner Q3)
-- SQL Server 2008 compatible. Forward-only.
-- Derives formula name from EMGood.GoodName1 (extracting N-N-N pattern, e.g. 0-0-60, 15-15-15)
-- Falling back to GoodName. Preserves <=100 char line splitting and code page 874.

IF OBJECT_ID('wf.fn_ExtractFormulaName', 'FN') IS NULL
    EXEC('CREATE FUNCTION wf.fn_ExtractFormulaName(@GoodName NVARCHAR(MAX)) RETURNS NVARCHAR(100) AS BEGIN RETURN NULL END');
GO

ALTER FUNCTION wf.fn_ExtractFormulaName(@GoodName NVARCHAR(MAX))
RETURNS NVARCHAR(100)
AS
BEGIN
    DECLARE @Name NVARCHAR(MAX);
    SET @Name = LTRIM(RTRIM(ISNULL(@GoodName, N'')));
    IF @Name = N'' RETURN N'';

    -- Look for whitespace-delimited token containing N-N-N (e.g. 15-15-15, 0-0-60, 8-24-24)
    -- Normalize spaces around string to make token search consistent
    DECLARE @Padded NVARCHAR(MAX), @Pos INT, @NextSpace INT, @Token NVARCHAR(100);
    SET @Padded = N' ' + @Name + N' ';
    SET @Pos = PATINDEX(N'% [0-9]%-%[0-9]%-%[0-9]% %', @Padded);
    
    WHILE @Pos > 0
    BEGIN
        SET @Pos = @Pos + 1;
        SET @NextSpace = CHARINDEX(N' ', @Padded, @Pos);
        SET @Token = SUBSTRING(@Padded, @Pos, @NextSpace - @Pos);
        
        IF @Token LIKE N'[0-9]%-[0-9]%-[0-9]%' AND @Token NOT LIKE N'%[^0-9-]%'
        BEGIN
            RETURN @Token;
        END;
        
        SET @Padded = SUBSTRING(@Padded, @NextSpace, LEN(@Padded));
        SET @Pos = PATINDEX(N'% [0-9]%-%[0-9]%-%[0-9]% %', @Padded);
    END;

    -- If no strict N-N-N token found, try standard pattern fallback
    IF PATINDEX(N'%[0-9]%-%[0-9]%-%[0-9]%', @Name) > 0
    BEGIN
        DECLARE @Start INT, @Space INT, @Formula NVARCHAR(100);
        SET @Start = PATINDEX(N'%[0-9]%-%[0-9]%-%[0-9]%', @Name);
        SET @Space = CHARINDEX(N' ', @Name + N' ', @Start);
        SET @Formula = RTRIM(SUBSTRING(@Name, @Start, @Space - @Start));
        IF NULLIF(@Formula, N'') IS NOT NULL
            RETURN @Formula;
    END;

    -- Fallback to product name
    RETURN LEFT(@Name, 100);
END;
GO

ALTER PROCEDURE wf.usp_WriteBookingDescription @SOID VARCHAR(50), @DraftId INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Bill NVARCHAR(MAX), @Trip NVARCHAR(MAX), @TruckLegacy NVARCHAR(MAX), @BillLegacy NVARCHAR(MAX),
            @Plate NVARCHAR(MAX), @Flags NVARCHAR(MAX), @Seq NVARCHAR(MAX), @Ticket NVARCHAR(20),
            @Rebate DECIMAL(18,2), @Full DECIMAL(18,2), @Row NVARCHAR(MAX);

    SELECT @Bill = h.Remark, @Plate = h.TransRegistration, @TruckLegacy = e.TruckRemark, @BillLegacy = e.BillRemark,
           @Trip = t.TripRemark, @Ticket = e.ControlTicketNo, @Rebate = e.RebateDiscountAmt, @Full = h.NetAmnt,
           @Flags = CASE WHEN e.PSling = 1 THEN N'ขึ้นพีสลิง ' ELSE N'' END +
                    CASE WHEN e.IsOwnTruck = 1 THEN N'ลูกค้าติดรถมาเอง ' ELSE N'' END +
                    CASE WHEN e.NoTruckRequired = 1 THEN N'ไม่ใช้รถบรรทุก ' ELSE N'' END
    FROM dbo.SOHD h
    JOIN wf.SalesOrderExt e ON e.SOID = CONVERT(VARCHAR(50), h.SOID)
    LEFT JOIN wf.SalesTrip t ON t.TripId = e.TripId
    WHERE h.SOID = @SOID;

    EXEC wf.usp_ValidateBookingNote @Bill;
    EXEC wf.usp_ValidateBookingNote @Trip;
    EXEC wf.usp_ValidateBookingNote @TruckLegacy;
    EXEC wf.usp_ValidateBookingNote @BillLegacy;

    DELETE dbo.SOHDRemark WHERE SOID = @SOID;

    EXEC wf.usp_AppendBookingText @SOID, @Plate;
    EXEC wf.usp_AppendBookingText @SOID, @Flags;
    EXEC wf.usp_AppendBookingText @SOID, @Trip;
    EXEC wf.usp_AppendBookingText @SOID, @TruckLegacy;

    -- R15 (Q3): Loading order by formula name e.g. 1.15-15-15 2.0-0-60
    SELECT @Seq = STUFF((
        SELECT N' ' + CONVERT(NVARCHAR(10), e.LoadSequence) + N'.' + wf.fn_ExtractFormulaName(COALESCE(g.GoodName1, d.GoodName, N'?'))
        FROM wf.SalesOrderLineExt e
        JOIN dbo.SODT d ON d.SOID = @SOID AND d.ListNo = e.ListNo
        LEFT JOIN dbo.EMGood g ON g.GoodID = d.GoodID
        WHERE e.SOID = @SOID AND e.LoadSequence IS NOT NULL
        ORDER BY e.LoadSequence, e.ListNo
        FOR XML PATH(''), TYPE
    ).value('.', 'NVARCHAR(MAX)'), 1, 1, N'');

    IF NULLIF(@Seq, N'') IS NOT NULL
    BEGIN
        SET @Seq = N'ขึ้นของตามลำดับ ' + @Seq;
        EXEC wf.usp_AppendBookingText @SOID, @Seq;
    END;

    EXEC wf.usp_AppendBookingText @SOID, @Bill;
    EXEC wf.usp_AppendBookingText @SOID, @BillLegacy;
    EXEC wf.usp_WriteControlTicketRemark @SOID, @DraftId, @Ticket;

    DECLARE gifts CURSOR LOCAL FAST_FORWARD FOR
        SELECT N'ของแถม ' + ISNULL(d.GoodName, N'')
        FROM dbo.SODT d
        JOIN wf.SalesOrderLineExt e ON e.SOID = CONVERT(VARCHAR(50), d.SOID) AND e.ListNo = d.ListNo
        WHERE d.SOID = @SOID AND e.IsGiveaway = 1
        ORDER BY d.ListNo;

    OPEN gifts;
    FETCH NEXT FROM gifts INTO @Row;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        EXEC wf.usp_AppendBookingText @SOID, @Row;
        FETCH NEXT FROM gifts INTO @Row;
    END;
    CLOSE gifts;
    DEALLOCATE gifts;

    IF @Rebate > 0
    BEGIN
        SET @Row = N'หักรีเบท = ' + CONVERT(NVARCHAR(40), CAST(@Rebate AS MONEY), 1) + N' บาท  คงเหลือชำระ = ' + CONVERT(NVARCHAR(40), CAST(@Full - @Rebate AS MONEY), 1) + N' บาท';
        EXEC wf.usp_AppendBookingText @SOID, @Row;
    END;
END;
GO
