-- Migration 184: ตั้งค่าวันยืนราคาสูงสุดสำหรับใบเสนอราคาที่มีสินค้ากลุ่ม "แม่ปุ๋ย"
-- พร้อม stored procedure สำหรับอัปเดตราคาต่อรายการและยอดรวมบน WinSpeed native quotation (102/113)
-- เมื่อมีการทบทวนราคาก่อนขยายอายุใบเสนอราคา (รองรับ app login ที่มีสิทธิ์เฉพาะ schema wf)

IF OBJECT_ID('wf.SystemSetting', 'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM wf.SystemSetting WHERE SettingKey = 'QUOTATION_MAE_PUI_MAX_VALID_DAYS')
        INSERT INTO wf.SystemSetting (SettingKey, SettingValue, Description)
        VALUES ('QUOTATION_MAE_PUI_MAX_VALID_DAYS', '3', N'จำนวนวันยืนราคาสูงสุดสำหรับใบเสนอราคาที่มีสินค้ากลุ่มแม่ปุ๋ย (วัน, ค่าเริ่มต้น 3 วัน) ใช้ทั้งตอนสร้างและตอนขอขยายเวลาต่อครั้ง');
END;
GO

IF OBJECT_ID('wf.sp_QuotationUpdateNativeLinePrice', 'P') IS NULL
    EXEC('CREATE PROCEDURE wf.sp_QuotationUpdateNativeLinePrice AS RETURN 0');
GO
ALTER PROCEDURE wf.sp_QuotationUpdateNativeLinePrice
    @QuoteSOID INT,
    @ConfirmSOID INT = NULL,
    @ListNo SMALLINT,
    @GoodID INT,
    @NewPrice DECIMAL(18, 2)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.SODT
    SET GoodPrice2 = @NewPrice,
        GoodAmnt = CAST(ISNULL(GoodQty2, 0) * @NewPrice AS DECIMAL(18, 2)),
        AfterMarkupamnt = CAST(ISNULL(GoodQty2, 0) * @NewPrice AS DECIMAL(18, 2)),
        remaamnt = CAST(ISNULL(GoodQty2, 0) * @NewPrice AS DECIMAL(18, 2))
    WHERE SOID IN (@QuoteSOID, @ConfirmSOID)
      AND DocuType IN ('102', '113')
      AND ListNo = @ListNo
      AND GoodID = @GoodID;
END
GO

IF OBJECT_ID('wf.sp_QuotationRecalcNativeTotal', 'P') IS NULL
    EXEC('CREATE PROCEDURE wf.sp_QuotationRecalcNativeTotal AS RETURN 0');
GO
ALTER PROCEDURE wf.sp_QuotationRecalcNativeTotal
    @QuoteSOID INT,
    @ConfirmSOID INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE h
    SET NetAmnt = ISNULL(t.SumAmnt, 0),
        SumGoodAmnt = ISNULL(t.SumAmnt, 0),
        BillAftrDiscAmnt = ISNULL(t.SumAmnt, 0)
    FROM dbo.SOHD h
    OUTER APPLY (
        SELECT SUM(ISNULL(d.GoodAmnt, 0)) AS SumAmnt
        FROM dbo.SODT d
        WHERE d.SOID = h.SOID
    ) t
    WHERE h.SOID IN (@QuoteSOID, @ConfirmSOID)
      AND h.DocuType IN ('102', '113');
END
GO

