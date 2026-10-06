-- ============================================================================
-- 142_quotation_stored_procedure.sql
-- Native WINSpeed quotation writes (102 quote / 113 confirm) through wf procedures.
--
-- Background (R11 U-3):
--   The quotation route wrote dbo.SOHD / dbo.SOHDRemark directly and failed with
--   "INSERT permission was denied on the object 'SOHD'": the app login has no
--   INSERT on dbo.SOHD (bookings already go through wf.sp_ConfirmSalesOrder).
--
-- Design:
--   routes/quotation.js still computes every value exactly as before (customer
--   address, sale area, VAT group, document numbers, totals). These procedures
--   only perform the dbo writes with fixed column lists, so the native documents
--   stay identical to what WINSpeed expects. Numbers are allocated by the route
--   inside the same transaction (UPDLOCK/HOLDLOCK), then passed in.
--
-- Grants (production):
--   wf and dbo are both owned by dbo, so ownership chaining lets these
--   procedures write dbo.SOHD / SODT / SOHDRemark with only:
--     GRANT EXECUTE ON SCHEMA::wf TO [<app login user>];   -- already held by the app login
--   No INSERT/UPDATE grant on dbo.SOHD, dbo.SOHDRemark or dbo.SODT.RemaQty is needed.
--
-- SQL 2008 R2: CREATE stub + ALTER (no CREATE OR ALTER), no DECLARE initialisers,
-- no THROW, wf schema only, no dbo structure change.
-- ============================================================================

IF OBJECT_ID('wf.sp_CreateQuotation', 'P') IS NOT NULL DROP PROCEDURE wf.sp_CreateQuotation;
GO
IF OBJECT_ID('wf.sp_CancelQuotation', 'P') IS NOT NULL DROP PROCEDURE wf.sp_CancelQuotation;
GO

-- 1. 102 quotation header -----------------------------------------------------
IF OBJECT_ID('wf.sp_QuotationInsertNativeHeader', 'P') IS NULL
    EXEC('CREATE PROCEDURE wf.sp_QuotationInsertNativeHeader AS RETURN 0');
GO
ALTER PROCEDURE wf.sp_QuotationInsertNativeHeader
    @SOID INT,
    @SaleAreaID INT,
    @DeptID INT,
    @DocuNo NVARCHAR(30),
    @CustID INT,
    @CustName NVARCHAR(200),
    @DocuDate DATETIME,
    @ValidDays SMALLINT,
    @ExpireDate DATETIME,
    @ShipDate DATETIME,
    @CreditDays SMALLINT,
    @NetAmnt DECIMAL(18, 2),
    @TranspID INT,
    @Desc1 NVARCHAR(500),
    @Desc2 NVARCHAR(500),
    @TransRegistration NVARCHAR(30),
    @EmpID INT,
    @BrchID INT,
    @VATRate FLOAT,
    @VATType VARCHAR(1),
    @VATGroupID INT,
    @BillAddr1 NVARCHAR(255),
    @BillAddr2 NVARCHAR(255),
    @District NVARCHAR(100),
    @Amphur NVARCHAR(100),
    @Province NVARCHAR(100),
    @PostCode VARCHAR(20),
    @Tel NVARCHAR(100),
    @Fax NVARCHAR(100),
    @Remark NVARCHAR(255),
    @QuotStatus NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM dbo.SOHD WITH (UPDLOCK, HOLDLOCK) WHERE SOID = @SOID)
    BEGIN
        RAISERROR('SOID %d มีอยู่แล้วใน dbo.SOHD', 16, 1, @SOID);
        RETURN;
    END

    INSERT INTO dbo.SOHD (
        SOID, SaleAreaID, DeptID, DocuNo, CustID, CustName, DocuDate, ValidDays, ExpireDate, ShipDate,
        CreditDays, NetAmnt, TranspID, Desc1, Desc2, TransRegistration, AppvFlag, PkgStatus, clearflag,
        EmpID, BrchID, DocuType, OnHold, VatRate, VatType, VATGroupID, GoodType, ExchRate,
        ShipToAddr1, ShipToAddr2, District, Amphur, Province, Tel, PostCode, Fax,
        SumIncludeAmnt, SumExcludeAmnt, SumGoodAmnt, BaseDiscAmnt, BillDiscFormula, BillDiscAmnt,
        BillAftrDiscAmnt, TotaExcludeAmnt, TotaBaseAmnt, VATAmnt, CustPONo, CommissionAmnt, MiscChargAmnt,
        ResvAmnt1, ResvAmnt2, ResvAmnt3, ResvAmnt4, ShipToCode, ContactnameShip, ClearSO, MultiCurrency,
        DocuStatus, AlertFlag, QuotStatus, Refeflag, CouponFlag, BeginningFlag, Remark, StatusRemark
    )
    VALUES (
        @SOID, @SaleAreaID, @DeptID, @DocuNo, @CustID, @CustName, @DocuDate, @ValidDays, @ExpireDate, @ShipDate,
        @CreditDays, @NetAmnt, @TranspID, @Desc1, @Desc2, @TransRegistration, 'W', 'N', 'N',
        @EmpID, @BrchID, '102', 'N', @VATRate, @VATType, @VATGroupID, '1', 1,
        @BillAddr1, @BillAddr2, @District, @Amphur, @Province, @Tel, @PostCode, @Fax,
        0, 0, @NetAmnt, 0, '', 0,
        @NetAmnt, 0, 0, 0, '', 0, 0,
        0, 0, 0, 0, '', '', 'N', 'N',
        'N', 'N', @QuotStatus, 'N', 'N', 'N', @Remark, ''
    );
END
GO

-- 2. 102 quotation line -------------------------------------------------------
IF OBJECT_ID('wf.sp_QuotationInsertNativeLine', 'P') IS NULL
    EXEC('CREATE PROCEDURE wf.sp_QuotationInsertNativeLine AS RETURN 0');
GO
ALTER PROCEDURE wf.sp_QuotationInsertNativeLine
    @SOID INT,
    @ListNo SMALLINT,
    @GoodID INT,
    @GoodName NVARCHAR(255),
    @InveID INT,
    @LocaID INT,
    @GoodUnitID INT,
    @GoodQty2 DECIMAL(18, 3),
    @GoodPrice2 DECIMAL(18, 2),
    @GoodAmnt DECIMAL(18, 2),
    @ShipDate DATETIME,
    @VatType VARCHAR(1)
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO dbo.SODT (
        SOID, ListNo, GoodID, GoodName, InveID, LocaID,
        GoodUnitID1, GoodPrice1, GoodQty1, GoodUnitID2, GoodStockRate1, GoodQty2, GoodPrice2,
        GoodDiscAmnt, MiscChargAmnt, SumExcludeAmnt, GoodAmnt,
        GoodCompareQty, ShipDate, RemaBefoQty, ResvAmnt1, ResvAmnt2, MarkUpAmnt, CommisAmnt, AfterMarkupamnt,
        DocuType, LotFlag, SerialFlag, GoodType, VatType, StockFlag, GoodFlag,
        RemaQty, ReserveQty, FreeFlag, GoodStockRate2, GoodStockUnitID, GoodStockQty,
        GoodCost, GoodRemaQty1, GoodRemaQty2, POQty, RemaQtyPkg, Expireflag, Poststock,
        RemaGoodStockQty, remaamnt
    )
    VALUES (
        @SOID, @ListNo, @GoodID, @GoodName, @InveID, @LocaID,
        NULL, 0, 0, @GoodUnitID, 0, @GoodQty2, @GoodPrice2,
        0, 0, 0, @GoodAmnt,
        0, @ShipDate, 0, 0, 0, 0, 0, @GoodAmnt,
        '102', 'N', 'N', '1', @VatType, '0', 'G',
        @GoodQty2, 0, 'N', 1, @GoodUnitID, @GoodQty2,
        0, @GoodQty2, 0, @GoodQty2, @GoodQty2, 'N', 'N',
        0, @GoodAmnt
    );
END
GO

-- 3. header remark line -------------------------------------------------------
IF OBJECT_ID('wf.sp_QuotationInsertNativeRemark', 'P') IS NULL
    EXEC('CREATE PROCEDURE wf.sp_QuotationInsertNativeRemark AS RETURN 0');
GO
ALTER PROCEDURE wf.sp_QuotationInsertNativeRemark
    @SOID INT,
    @ListNo SMALLINT,
    @Remark NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO dbo.SOHDRemark (SOID, ListNo, Remark) VALUES (@SOID, @ListNo, @Remark);
END
GO

-- 4. confirm: approve the 102 quote and copy it into a 113 document -----------
IF OBJECT_ID('wf.sp_QuotationConfirmNative', 'P') IS NULL
    EXEC('CREATE PROCEDURE wf.sp_QuotationConfirmNative AS RETURN 0');
GO
ALTER PROCEDURE wf.sp_QuotationConfirmNative
    @QuoteSOID INT,
    @ConfirmSOID INT,
    @ConfirmNo NVARCHAR(30),
    @QuoteNo NVARCHAR(30),
    @AppvID INT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.SOHD WITH (UPDLOCK, HOLDLOCK) WHERE SOID = @QuoteSOID AND DocuType = '102')
    BEGIN
        RAISERROR('ไม่พบใบเสนอราคา 102 SOID %d', 16, 1, @QuoteSOID);
        RETURN;
    END
    IF EXISTS (SELECT 1 FROM dbo.SOHD WITH (UPDLOCK, HOLDLOCK) WHERE SOID = @ConfirmSOID)
    BEGIN
        RAISERROR('SOID %d มีอยู่แล้วใน dbo.SOHD', 16, 1, @ConfirmSOID);
        RETURN;
    END

    UPDATE dbo.SOHD
    SET AppvFlag = 'Y',
        DocuStatus = 'Y',
        RefNo = ISNULL(RefNo, ''),
        StatusRemark = ISNULL(StatusRemark, '')
    WHERE SOID = @QuoteSOID AND DocuType = '102';

    UPDATE dbo.SODT
    SET RemaQty = 0
    WHERE SOID = @QuoteSOID AND DocuType = '102';

    INSERT INTO dbo.SOHD (
        SOID, SaleAreaID, TranspID, DeptID, DocuNo, CustID, CustName, DocuDate, ValidDays, ExpireDate,
        ShipDate, CreditDays, NetAmnt, AppvFlag, PkgStatus, clearflag, EmpID, BrchID, DocuType, OnHold,
        VatRate, VatType, VATGroupID, GoodType, ExchRate, ShipToAddr1, ShipToAddr2, District, Amphur,
        Province, Tel, PostCode, Fax, SumIncludeAmnt, SumExcludeAmnt, SumGoodAmnt, BaseDiscAmnt,
        BillDiscFormula, BillDiscAmnt, BillAftrDiscAmnt, TotaExcludeAmnt, TotaBaseAmnt, VATAmnt, CustPONo,
        CommissionAmnt, MiscChargAmnt, ResvAmnt1, ResvAmnt2, ResvAmnt3, ResvAmnt4, ShipToCode,
        ContactnameShip, ClearSO, MultiCurrency, DocuStatus, AlertFlag, QuotStatus, Refeflag, CouponFlag,
        BeginningFlag, RefNo, RefDate, FromFlag, Remark, StatusRemark, Appvid
    )
    SELECT
        @ConfirmSOID, SaleAreaID, TranspID, DeptID, @ConfirmNo, CustID, CustName, DocuDate, ValidDays, ExpireDate,
        ShipDate, CreditDays, NetAmnt, 'Y', 'N', 'N', EmpID, BrchID, '113', OnHold,
        VatRate, VatType, VATGroupID, GoodType, ExchRate, ShipToAddr1, ShipToAddr2, District, Amphur,
        Province, Tel, PostCode, Fax, SumIncludeAmnt, SumExcludeAmnt, SumGoodAmnt, BaseDiscAmnt,
        BillDiscFormula, BillDiscAmnt, BillAftrDiscAmnt, TotaExcludeAmnt, TotaBaseAmnt, VATAmnt, CustPONo,
        CommissionAmnt, MiscChargAmnt, ResvAmnt1, ResvAmnt2, ResvAmnt3, ResvAmnt4, ShipToCode,
        ContactnameShip, ClearSO, MultiCurrency, 'N', AlertFlag, QuotStatus, Refeflag, CouponFlag,
        BeginningFlag, @QuoteNo, DocuDate, '102', Remark, StatusRemark, @AppvID
    FROM dbo.SOHD
    WHERE SOID = @QuoteSOID AND DocuType = '102';

    INSERT INTO dbo.SODT (
        SOID, RefSOID, ListNo, DocuType, Refno, RefListNo,
        GoodID, GoodName, InveID, LocaID,
        GoodUnitID1, GoodPrice1, GoodQty1, GoodUnitID2, GoodStockRate1, GoodQty2, GoodPrice2,
        GoodDiscAmnt, MiscChargAmnt, SumExcludeAmnt, GoodAmnt,
        GoodCompareQty, ShipDate, RemaBefoQty, ResvAmnt1, ResvAmnt2, MarkUpAmnt, CommisAmnt, AfterMarkupamnt,
        LotFlag, SerialFlag, GoodType, VatType, StockFlag, GoodFlag,
        RemaQty, ReserveQty, FreeFlag, GoodStockRate2, GoodStockUnitID, GoodStockQty,
        GoodCost, GoodRemaQty1, GoodRemaQty2, POQty, RemaQtyPkg, Expireflag, Poststock,
        RemaGoodStockQty, remaamnt
    )
    SELECT
        @ConfirmSOID, @QuoteSOID, ListNo, '113', @QuoteNo, ListNo,
        GoodID, GoodName, InveID, LocaID,
        GoodUnitID1, GoodPrice1, GoodQty1, GoodUnitID2, GoodStockRate1, GoodQty2, GoodPrice2,
        GoodDiscAmnt, MiscChargAmnt, SumExcludeAmnt, GoodAmnt,
        GoodCompareQty, ShipDate, RemaBefoQty, ResvAmnt1, ResvAmnt2, MarkUpAmnt, CommisAmnt, AfterMarkupamnt,
        LotFlag, SerialFlag, GoodType, VatType, StockFlag, GoodFlag,
        GoodQty2, ReserveQty, FreeFlag, GoodStockRate2, GoodStockUnitID, GoodStockQty,
        GoodCost, GoodRemaQty1, GoodRemaQty2, POQty, RemaQtyPkg, Expireflag, Poststock,
        RemaGoodStockQty, remaamnt
    FROM dbo.SODT
    WHERE SOID = @QuoteSOID AND DocuType = '102';

    INSERT INTO dbo.SOHDRemark (SOID, ListNo, Remark)
    SELECT @ConfirmSOID, ListNo, Remark
    FROM dbo.SOHDRemark
    WHERE SOID = @QuoteSOID;
END
GO

-- 5. cancel: mark the 102 quote (and its 113 confirm, if any) cancelled -------
IF OBJECT_ID('wf.sp_QuotationCancelNative', 'P') IS NULL
    EXEC('CREATE PROCEDURE wf.sp_QuotationCancelNative AS RETURN 0');
GO
ALTER PROCEDURE wf.sp_QuotationCancelNative
    @QuoteSOID INT,
    @ConfirmSOID INT = NULL,
    @Remark NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.SOHD
    SET DocuStatus = 'C',
        StatusRemark = @Remark
    WHERE SOID = @QuoteSOID AND DocuType = '102';

    UPDATE dbo.SOHD
    SET DocuStatus = 'C',
        StatusRemark = @Remark
    WHERE @ConfirmSOID IS NOT NULL AND SOID = @ConfirmSOID AND DocuType = '113';
END
GO

-- 6. validity: move ExpireDate / ValidDays on the 102 and 113 documents -------
IF OBJECT_ID('wf.sp_QuotationSetNativeValidity', 'P') IS NULL
    EXEC('CREATE PROCEDURE wf.sp_QuotationSetNativeValidity AS RETURN 0');
GO
ALTER PROCEDURE wf.sp_QuotationSetNativeValidity
    @QuoteSOID INT,
    @ConfirmSOID INT = NULL,
    @ValidUntil DATETIME
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.SOHD
    SET ExpireDate = @ValidUntil,
        ValidDays = CASE
            WHEN DATEDIFF(day, DocuDate, @ValidUntil) < 1 THEN 1
            WHEN DATEDIFF(day, DocuDate, @ValidUntil) > 32767 THEN 32767
            ELSE DATEDIFF(day, DocuDate, @ValidUntil)
        END
    WHERE SOID IN (@QuoteSOID, @ConfirmSOID)
      AND DocuType IN ('102', '113');
END
GO
