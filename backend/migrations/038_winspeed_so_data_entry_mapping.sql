-- =============================================================
-- 038_winspeed_so_data_entry_mapping.sql
-- Tighten app-created SOHD/SODT rows to match WINSpeed SO Data Entry.
--
-- Findings from local WINSpeed test I69-KORAT-1:
--   - SOHD.TranspID drives the "ขนส่งโดย" display.
--   - SOHD.CheckAll='Y' is required when every SODT.CheckFlag is checked.
--   - SODT.MasterQty / ChildQty are independent split quantities, not bags.
--   - Header totals/defaults should be populated, not left NULL.
-- =============================================================

IF COL_LENGTH('wf.SalesOrderLine', 'MasterQty') IS NULL
  ALTER TABLE wf.SalesOrderLine ADD MasterQty DECIMAL(12,3) NULL;
GO
IF COL_LENGTH('wf.SalesOrderLine', 'ChildQty') IS NULL
  ALTER TABLE wf.SalesOrderLine ADD ChildQty DECIMAL(12,3) NULL;
GO
IF COL_LENGTH('wf.SalesOrderLineExt', 'MasterQty') IS NULL
  ALTER TABLE wf.SalesOrderLineExt ADD MasterQty DECIMAL(12,3) NULL;
GO
IF COL_LENGTH('wf.SalesOrderLineExt', 'ChildQty') IS NULL
  ALTER TABLE wf.SalesOrderLineExt ADD ChildQty DECIMAL(12,3) NULL;
GO

CREATE OR ALTER VIEW wf.v_AllSalesOrderLines AS
SELECT
    CAST(sol.SoId AS VARCHAR(50)) AS SoId,
    sol.LineNum,
    sol.GoodId,
    sol.GoodCode,
    sol.GoodName,
    sol.QtyTon,
    sol.QtyBag,
    sol.PricePerTon,
    sol.NetPricePerTon,
    sol.IsGiveaway,
    sol.RebateBooked,
    sol.RefControlTicketNo,
    sol.IsControlTicketDrawn,
    sol.LoadSequence,
    sol.GiveawayApprovalStatus,
    sol.GiveawayApprovedBy,
    sol.GiveawayApprovedAt,
    sol.GiveawayApprovalNote,
    au.DisplayName AS GiveawayApprovedByName,
    sol.CreatedAt,
    ISNULL(sol.MasterQty, sol.QtyTon) AS MasterQty,
    ISNULL(sol.ChildQty, 0) AS ChildQty
FROM wf.SalesOrderLine sol
JOIN wf.SalesOrder so ON so.Id = sol.SoId
LEFT JOIN wf.AppUser au ON au.Id = sol.GiveawayApprovedBy
WHERE so.Status = 'DRAFT'

UNION ALL

SELECT
    CAST(dt.SOID AS VARCHAR(50)) AS SoId,
    dt.ListNo AS LineNum,
    dt.GoodID AS GoodId,
    g.GoodCode,
    COALESCE(dt.GoodName, g.GoodName1) AS GoodName,
    dt.GoodQty2 AS QtyTon,
    CAST(dt.GoodQty2 * 20 AS INT) AS QtyBag,
    dt.GoodPrice2 AS PricePerTon,
    ISNULL(ext.NetPricePerTon, dt.GoodPrice2) AS NetPricePerTon,
    ISNULL(ext.IsGiveaway, CASE WHEN dt.FreeFlag = 'Y' THEN 1 ELSE 0 END) AS IsGiveaway,
    ISNULL(ext.RebateBooked, 0) AS RebateBooked,
    ext.RefControlTicketNo,
    ISNULL(ext.IsControlTicketDrawn, 0) AS IsControlTicketDrawn,
    ext.LoadSequence,
    ext.GiveawayApprovalStatus,
    ext.GiveawayApprovedBy,
    ext.GiveawayApprovedAt,
    ext.GiveawayApprovalNote,
    au.DisplayName AS GiveawayApprovedByName,
    hd.DocuDate AS CreatedAt,
    ISNULL(ext.MasterQty, dt.MasterQty) AS MasterQty,
    ISNULL(ext.ChildQty, dt.ChildQty) AS ChildQty
FROM dbo.SODT dt
JOIN dbo.SOHD hd ON hd.SOID = dt.SOID
JOIN dbo.EMGood g ON g.GoodID = dt.GoodID
LEFT JOIN wf.SalesOrderLineExt ext ON ext.SOID = dt.SOID AND ext.ListNo = dt.ListNo
LEFT JOIN wf.AppUser au ON au.Id = ext.GiveawayApprovedBy;
GO

CREATE OR ALTER PROCEDURE wf.sp_ConfirmSalesOrder
    @SoId INT,
    @NewSoid VARCHAR(50) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @WfRef NVARCHAR(30), @SoPrefix NVARCHAR(5), @CustId NVARCHAR(20), @CustName NVARCHAR(200),
                @TruckPlate NVARCHAR(30), @ControlTicketNo NVARCHAR(20), @DeliveryDate DATE,
                @RequestedAt DATETIME2, @IsOwnTruck BIT, @NoTruckRequired BIT, @PSling BIT,
                @Remark NVARCHAR(500), @SalesUserId INT, @CreatedAt DATETIME2, @DocuNo NVARCHAR(30),
                @EmpID INT, @TotalAmnt DECIMAL(18,2), @ImportFilePath NVARCHAR(500), @RebateDiscountAmt DECIMAL(12,2),
                @MaxSoid INT, @CreditDays INT, @TruckRemark NVARCHAR(500), @BillRemark NVARCHAR(500),
                @SaleAreaID INT, @TranspID INT, @ShipDate DATE;

        SELECT @WfRef = WfRef, @SoPrefix = SoPrefix, @CustId = CustId, @CustName = CustName,
               @TruckPlate = TruckPlate, @ControlTicketNo = ControlTicketNo, @DeliveryDate = DeliveryDate,
               @RequestedAt = RequestedAt, @IsOwnTruck = IsOwnTruck, @NoTruckRequired = NoTruckRequired, @PSling = PSling,
               @Remark = Remark, @SalesUserId = SalesUserId, @CreatedAt = CreatedAt, @RebateDiscountAmt = RebateDiscountAmt,
               @CreditDays = CreditDays, @TruckRemark = TruckRemark, @BillRemark = BillRemark
        FROM wf.SalesOrder
        WHERE Id = @SoId AND Status = 'DRAFT';

        IF @WfRef IS NULL
        BEGIN
            RAISERROR('SalesOrder draft not found', 16, 1);
            ROLLBACK TRANSACTION;
            RETURN;
        END

        SELECT TOP 1 @EmpID = CASE WHEN ISNUMERIC(EmpId) = 1 THEN CAST(EmpId AS INT) ELSE NULL END
        FROM wf.AppUser
        WHERE Id = @SalesUserId;
        IF @EmpID IS NULL SET @EmpID = 1000;

        SELECT
            @SaleAreaID = c.SaleAreaID,
            @CreditDays = ISNULL(@CreditDays, 30)
        FROM dbo.EMCust c WITH (NOLOCK)
        WHERE c.CustID = @CustId;

        SELECT TOP 1 @TranspID = s.TranspID
        FROM dbo.EMShipto s WITH (NOLOCK)
        WHERE s.CustID = @CustId AND s.TranspID IS NOT NULL
        ORDER BY CASE WHEN CONVERT(VARCHAR(10), ISNULL(s.IsDefault, 0)) IN ('1', 'Y', 'y') THEN 0 ELSE 1 END, s.ListNo;
        IF @TranspID IS NULL SELECT TOP 1 @TranspID = TranspID FROM dbo.EMTransp WITH (NOLOCK) ORDER BY TranspID;

        SELECT @MaxSoid = ISNULL(MAX(CASE WHEN ISNUMERIC(CONVERT(VARCHAR(50), SOID)) = 1 THEN CAST(SOID AS INT) ELSE 0 END), 1000)
        FROM dbo.SOHD;
        SET @NewSoid = CAST(@MaxSoid + 1 AS VARCHAR(50));
        SET @DocuNo = @WfRef;
        SET @ImportFilePath = NULL;
        SET @ShipDate = ISNULL(@DeliveryDate, CAST(GETDATE() AS DATE));

        SELECT @TotalAmnt = SUM(QtyTon * PricePerTon)
        FROM wf.SalesOrderLine
        WHERE SoId = @SoId;
        SET @TotalAmnt = ISNULL(@TotalAmnt, 0) - ISNULL(@RebateDiscountAmt, 0);

        INSERT INTO dbo.SOHD (
            SOID, SaleAreaID, TranspID, DeptID,
            DocuNo, CustID, CustName, DocuDate, ValidDays, NetAmnt,
            AppvFlag, PkgStatus, clearflag, EmpID, BrchID,
            DocuType, OnHold, VatRate, VatType, VATGroupID, GoodType, ExchRate,
            ShipToAddr1, ShipToAddr2, District, Amphur, Province, Tel, PostCode, Fax,
            ShipDate, CreditDays,
            SumIncludeAmnt, SumExcludeAmnt, SumGoodAmnt, BaseDiscAmnt, BillDiscFormula, BillDiscAmnt,
            BillAftrDiscAmnt, TotaExcludeAmnt, TotaBaseAmnt, VATAmnt,
            CustPONo, CommissionAmnt, MiscChargAmnt,
            ResvAmnt1, ResvAmnt2, ResvAmnt3, ResvAmnt4, ShipToCode, ContactnameShip,
            ClearSO, MultiCurrency, DocuStatus, AlertFlag, CheckAll,
            TransRegistration, Remark, Desc1, Desc2
        )
        VALUES (
            @NewSoid, @SaleAreaID, @TranspID, 1000,
            @DocuNo, @CustId, @CustName, CAST(GETDATE() AS DATE), 30, @TotalAmnt,
            'W', 'N', 'N', @EmpID, '1',
            '103', 'N', 0, '3', 2, '1', 1,
            '', '', '', '', '', '', '', '',
            @ShipDate, @CreditDays,
            0, 0, @TotalAmnt, 0, '', 0,
            @TotalAmnt, 0, 0, 0,
            '', 0, 0,
            0, 0, 0, 0, '', '',
            'N', 'N', 'N', 'N', 'Y',
            @TruckPlate, @Remark, @TruckRemark, @BillRemark
        );

        INSERT INTO dbo.SODT (
            SOID, ListNo, GoodID, GoodName, InveID, LocaID,
            GoodUnitID1, GoodPrice1, GoodQty1, GoodUnitID2, GoodStockRate1, GoodQty2, GoodPrice2,
            GoodDiscAmnt, MiscChargAmnt, SumExcludeAmnt, GoodAmnt,
            GoodCompareQty, ShipDate, RemaBefoQty, ResvAmnt1, ResvAmnt2, MarkUpAmnt, CommisAmnt, AfterMarkupamnt,
            DocuType, LotFlag, SerialFlag, GoodType, VatType, StockFlag, GoodFlag,
            RemaQty, ReserveQty, FreeFlag, GoodStockRate2, GoodStockUnitID, GoodStockQty,
            GoodCost, GoodRemaQty1, GoodRemaQty2, POQty, RemaQtyPkg, Expireflag, Poststock,
            RemaGoodStockQty, remaamnt, CheckFlag, MasterQty, ChildQty
        )
        SELECT
            @NewSoid, sol.LineNum, sol.GoodId, COALESCE(NULLIF(sol.GoodName, ''), g.GoodName1), 1000, 1000,
            NULL, 0, 0, COALESCE(g.MainGoodUnitID, 1002), 0, sol.QtyTon, sol.PricePerTon,
            0, 0, 0, sol.QtyTon * sol.PricePerTon,
            0, @ShipDate, 0, 0, 0, 0, 0, sol.QtyTon * sol.PricePerTon,
            '103', 'N', 'N', '1', COALESCE(g.VatType, '3'), '-1', 'G',
            sol.QtyTon, 0, CASE WHEN sol.IsGiveaway = 1 THEN 'Y' ELSE 'N' END, 1, COALESCE(g.MainGoodUnitID, 1002), sol.QtyTon,
            0, sol.QtyTon, 0, sol.QtyTon, sol.QtyTon, 'N', 'N',
            0, sol.QtyTon * sol.PricePerTon, 'Y',
            ISNULL(sol.MasterQty, sol.QtyTon), ISNULL(sol.ChildQty, 0)
        FROM wf.SalesOrderLine sol
        LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = sol.GoodId
        WHERE sol.SoId = @SoId;

        INSERT INTO dbo.SODTRemark (SOID, ListNo, RefListNo, Remark)
        SELECT @NewSoid, sol.LineNum, sol.LineNum, COALESCE(NULLIF(sol.GoodName, ''), g.GoodName1)
        FROM wf.SalesOrderLine sol
        LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = sol.GoodId
        WHERE sol.SoId = @SoId
          AND COALESCE(NULLIF(sol.GoodName, ''), g.GoodName1) IS NOT NULL;

        INSERT INTO dbo.SOHDRemark (SOID, ListNo, Remark)
        SELECT @NewSoid,
               ROW_NUMBER() OVER(ORDER BY sol.LineNum) + 3 AS ListNo,
               COALESCE(NULLIF(sol.GoodName, ''), g.GoodName1)
        FROM wf.SalesOrderLine sol
        LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = sol.GoodId
        WHERE sol.SoId = @SoId AND sol.IsGiveaway = 1;

        INSERT INTO wf.SalesOrderExt (
            SOID, WfRef, SoPrefix, SalesUserId, ControlTicketNo, DeliveryDate,
            RequestedAt, IsOwnTruck, NoTruckRequired, PSling,
            ImportFilePath, CreatedAt, UpdatedAt, RebateDiscountAmt,
            CreditDays, TruckRemark, BillRemark
        )
        VALUES (
            @NewSoid, @WfRef, @SoPrefix, @SalesUserId, @ControlTicketNo, @DeliveryDate,
            @RequestedAt, ISNULL(@IsOwnTruck, 0), ISNULL(@NoTruckRequired, 0), ISNULL(@PSling, 0),
            @ImportFilePath, @CreatedAt, GETUTCDATE(), ISNULL(@RebateDiscountAmt, 0),
            @CreditDays, @TruckRemark, @BillRemark
        );

        INSERT INTO wf.SalesOrderLineExt (
            SOID, ListNo, NetPricePerTon, IsGiveaway, RebateBooked, LoadSequence, RefControlTicketNo, IsControlTicketDrawn,
            GiveawayApprovalStatus, GiveawayApprovedBy, GiveawayApprovedAt, GiveawayApprovalNote, MasterQty, ChildQty
        )
        SELECT
            @NewSoid, LineNum, NetPricePerTon, IsGiveaway, RebateBooked, LoadSequence, RefControlTicketNo, IsControlTicketDrawn,
            GiveawayApprovalStatus, GiveawayApprovedBy, GiveawayApprovedAt, GiveawayApprovalNote,
            ISNULL(MasterQty, QtyTon), ISNULL(ChildQty, 0)
        FROM wf.SalesOrderLine
        WHERE SoId = @SoId;

        DELETE FROM wf.SalesOrderLine WHERE SoId = @SoId;
        DELETE FROM wf.SalesOrder WHERE Id = @SoId;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END
GO

PRINT 'WF migration 038 complete (WINSpeed SO Data Entry mapping)'
GO
