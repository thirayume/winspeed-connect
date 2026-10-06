-- Down migration 138: Revert loading order to GoodCode/GoodName and drop fn_ExtractFormulaName
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

    SELECT @Seq = STUFF((
        SELECT N' ' + CONVERT(NVARCHAR(10), e.LoadSequence) + N'.' + COALESCE(NULLIF(RTRIM(g.GoodCode), N''), d.GoodName, N'?')
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

IF OBJECT_ID('wf.fn_ExtractFormulaName', 'FN') IS NOT NULL
    DROP FUNCTION wf.fn_ExtractFormulaName;
GO
