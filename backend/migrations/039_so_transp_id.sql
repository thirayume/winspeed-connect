-- =============================================================
-- 039_so_transp_id.sql
-- Add explicit TranspId support to SalesOrder
-- =============================================================

IF COL_LENGTH('wf.SalesOrder', 'TranspId') IS NULL
  ALTER TABLE wf.SalesOrder ADD TranspId INT NULL;
GO
IF COL_LENGTH('wf.SalesOrder', 'CreditDays') IS NULL
  ALTER TABLE wf.SalesOrder ADD CreditDays INT NULL;
GO
IF COL_LENGTH('wf.SalesOrder', 'TruckRemark') IS NULL
  ALTER TABLE wf.SalesOrder ADD TruckRemark NVARCHAR(500) NULL;
GO
IF COL_LENGTH('wf.SalesOrder', 'BillRemark') IS NULL
  ALTER TABLE wf.SalesOrder ADD BillRemark NVARCHAR(500) NULL;
GO
IF COL_LENGTH('wf.SalesOrder', 'RequestedAt') IS NULL
  ALTER TABLE wf.SalesOrder ADD RequestedAt DATETIME2 NULL;
GO
IF COL_LENGTH('wf.SalesOrder', 'IsOwnTruck') IS NULL
  ALTER TABLE wf.SalesOrder ADD IsOwnTruck BIT NOT NULL CONSTRAINT DF_SalesOrder_IsOwnTruck DEFAULT (0);
GO
IF COL_LENGTH('wf.SalesOrder', 'NoTruckRequired') IS NULL
  ALTER TABLE wf.SalesOrder ADD NoTruckRequired BIT NOT NULL CONSTRAINT DF_SalesOrder_NoTruckRequired DEFAULT (0);
GO
IF COL_LENGTH('wf.SalesOrder', 'PSling') IS NULL
  ALTER TABLE wf.SalesOrder ADD PSling BIT NOT NULL CONSTRAINT DF_SalesOrder_PSling DEFAULT (0);
GO
IF COL_LENGTH('wf.SalesOrderExt', 'TranspId') IS NULL
  ALTER TABLE wf.SalesOrderExt ADD TranspId INT NULL;
GO
IF COL_LENGTH('wf.SalesOrderExt', 'CreditDays') IS NULL
  ALTER TABLE wf.SalesOrderExt ADD CreditDays INT NULL;
GO
IF COL_LENGTH('wf.SalesOrderExt', 'TruckRemark') IS NULL
  ALTER TABLE wf.SalesOrderExt ADD TruckRemark NVARCHAR(500) NULL;
GO
IF COL_LENGTH('wf.SalesOrderExt', 'BillRemark') IS NULL
  ALTER TABLE wf.SalesOrderExt ADD BillRemark NVARCHAR(500) NULL;
GO
IF COL_LENGTH('wf.SalesOrderExt', 'RequestedAt') IS NULL
  ALTER TABLE wf.SalesOrderExt ADD RequestedAt DATETIME2 NULL;
GO
IF COL_LENGTH('wf.SalesOrderExt', 'IsOwnTruck') IS NULL
  ALTER TABLE wf.SalesOrderExt ADD IsOwnTruck BIT NOT NULL CONSTRAINT DF_SalesOrderExt_IsOwnTruck DEFAULT (0);
GO
IF COL_LENGTH('wf.SalesOrderExt', 'NoTruckRequired') IS NULL
  ALTER TABLE wf.SalesOrderExt ADD NoTruckRequired BIT NOT NULL CONSTRAINT DF_SalesOrderExt_NoTruckRequired DEFAULT (0);
GO
IF COL_LENGTH('wf.SalesOrderExt', 'PSling') IS NULL
  ALTER TABLE wf.SalesOrderExt ADD PSling BIT NOT NULL CONSTRAINT DF_SalesOrderExt_PSling DEFAULT (0);
GO
IF COL_LENGTH('wf.SalesOrderExt', 'IsUnlocked') IS NULL
  ALTER TABLE wf.SalesOrderExt ADD IsUnlocked BIT NOT NULL CONSTRAINT DF_SalesOrderExt_IsUnlocked DEFAULT (0);
GO
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
IF COL_LENGTH('wf.SalesOrderLine', 'GiveawayApprovalStatus') IS NULL
  ALTER TABLE wf.SalesOrderLine ADD GiveawayApprovalStatus NVARCHAR(20) NULL;
GO
IF COL_LENGTH('wf.SalesOrderLine', 'GiveawayApprovedBy') IS NULL
  ALTER TABLE wf.SalesOrderLine ADD GiveawayApprovedBy INT NULL;
GO
IF COL_LENGTH('wf.SalesOrderLine', 'GiveawayApprovedAt') IS NULL
  ALTER TABLE wf.SalesOrderLine ADD GiveawayApprovedAt DATETIME2 NULL;
GO
IF COL_LENGTH('wf.SalesOrderLine', 'GiveawayApprovalNote') IS NULL
  ALTER TABLE wf.SalesOrderLine ADD GiveawayApprovalNote NVARCHAR(300) NULL;
GO
IF COL_LENGTH('wf.SalesOrderLineExt', 'GiveawayApprovalStatus') IS NULL
  ALTER TABLE wf.SalesOrderLineExt ADD GiveawayApprovalStatus NVARCHAR(20) NULL;
GO
IF COL_LENGTH('wf.SalesOrderLineExt', 'GiveawayApprovedBy') IS NULL
  ALTER TABLE wf.SalesOrderLineExt ADD GiveawayApprovedBy INT NULL;
GO
IF COL_LENGTH('wf.SalesOrderLineExt', 'GiveawayApprovedAt') IS NULL
  ALTER TABLE wf.SalesOrderLineExt ADD GiveawayApprovedAt DATETIME2 NULL;
GO
IF COL_LENGTH('wf.SalesOrderLineExt', 'GiveawayApprovalNote') IS NULL
  ALTER TABLE wf.SalesOrderLineExt ADD GiveawayApprovalNote NVARCHAR(300) NULL;
GO

-- Refresh view to include TranspId
CREATE OR ALTER VIEW wf.v_AllSalesOrders AS
-- 1. DRAFT from Web App
SELECT
    CAST(so.Id AS VARCHAR(50)) AS Id,
    so.WfRef,
    so.SoPrefix,
    so.CustId,
    so.CustName,
    so.TruckPlate,
    so.ControlTicketNo,
    so.DeliveryDate,
    so.RequestedAt,
    so.IsOwnTruck,
    so.NoTruckRequired,
    so.PSling,
    so.Remark,
    so.Status,
    so.SalesUserId,
    so.ImportFilePath,
    so.ImportedDocuNo,
    so.ImportedAt,
    so.CreatedAt,
    so.UpdatedAt,
    ISNULL(so.RebateDiscountAmt, 0) AS RebateDiscountAmt,
    CAST(0 AS BIT) AS IsLoaded,
    CAST(NULL AS DECIMAL(10,2)) AS WeighOutWeight,
    so.CreditDays,
    so.TruckRemark,
    so.BillRemark,
    so.TranspId
FROM wf.SalesOrder so

UNION ALL

-- 2. Documents already visible in WINSpeed.
SELECT
    CAST(hd.SOID AS VARCHAR(50)) AS Id,
    ISNULL(ext.WfRef, hd.DocuNo) AS WfRef,
    ISNULL(ext.SoPrefix, CASE WHEN LEFT(hd.DocuNo, 2) = 'AI' THEN 'AI' WHEN LEFT(hd.DocuNo, 1) IN ('I', 'K') THEN LEFT(hd.DocuNo, 1) ELSE 'W' END) AS SoPrefix,
    hd.CustID AS CustId,
    hd.CustName,
    hd.TransRegistration AS TruckPlate,
    ext.ControlTicketNo,
    ext.DeliveryDate,
    ext.RequestedAt,
    ISNULL(ext.IsOwnTruck, 0) AS IsOwnTruck,
    ISNULL(ext.NoTruckRequired, 0) AS NoTruckRequired,
    ISNULL(ext.PSling, 0) AS PSling,
    hd.Remark,
    CASE
        WHEN hd.DocuStatus = 'C' THEN 'CANCELLED'
        WHEN EXISTS (
            SELECT 1
            FROM dbo.SOInvDT invdt WITH (NOLOCK)
            JOIN dbo.SOInvHD invhd WITH (NOLOCK) ON invhd.SOInvID = invdt.SOInvID
            WHERE invhd.DocuType IN (107, 202)
              AND (CONVERT(VARCHAR(50), invdt.RefID) = CONVERT(VARCHAR(50), hd.SOID)
                   OR RTRIM(invhd.SONo) = RTRIM(hd.DocuNo))
        ) THEN 'SHIPPED'
        WHEN ext.WeighOutWeight IS NOT NULL THEN 'SHIPPED'
        WHEN ext.IsLoaded = 1 THEN 'LOADED'
        WHEN hd.PkgStatus = 'Y' THEN 'PICKING'
        WHEN ext.IsUnlocked = 1 THEN 'DRAFT'
        ELSE 'CONFIRMED'
    END AS Status,
    ext.SalesUserId,
    ext.ImportFilePath,
    hd.DocuNo AS ImportedDocuNo,
    ext.ImportedAt,
    ISNULL(ext.CreatedAt, hd.DocuDate) AS CreatedAt,
    ext.UpdatedAt,
    ISNULL(ext.RebateDiscountAmt, 0) AS RebateDiscountAmt,
    ISNULL(ext.IsLoaded, 0) AS IsLoaded,
    ext.WeighOutWeight,
    ISNULL(ext.CreditDays, hd.CreditDays) AS CreditDays,
    ISNULL(ext.TruckRemark, hd.Desc1) AS TruckRemark,
    ISNULL(ext.BillRemark, hd.Desc2) AS BillRemark,
    ISNULL(ext.TranspId, hd.TranspID) AS TranspId
FROM dbo.SOHD hd
LEFT JOIN wf.SalesOrderExt ext ON CONVERT(VARCHAR(50), ext.SOID) = CONVERT(VARCHAR(50), hd.SOID)
WHERE hd.DocuType IN (103, 104);
GO

-- Refresh sp_ConfirmSalesOrder to map TranspId
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
                @SaleAreaID INT, @TranspID INT, @ShipDate DATE, @ExplicitTranspId INT;

        SELECT @WfRef = WfRef, @SoPrefix = SoPrefix, @CustId = CustId, @CustName = CustName,
               @TruckPlate = TruckPlate, @ControlTicketNo = ControlTicketNo, @DeliveryDate = DeliveryDate,
               @RequestedAt = RequestedAt, @IsOwnTruck = IsOwnTruck, @NoTruckRequired = NoTruckRequired, @PSling = PSling,
               @Remark = Remark, @SalesUserId = SalesUserId, @CreatedAt = CreatedAt, @RebateDiscountAmt = RebateDiscountAmt,
               @CreditDays = CreditDays, @TruckRemark = TruckRemark, @BillRemark = BillRemark, @ExplicitTranspId = TranspId
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

        IF @ExplicitTranspId IS NOT NULL
        BEGIN
            SET @TranspID = @ExplicitTranspId;
        END
        ELSE
        BEGIN
            SELECT TOP 1 @TranspID = s.TranspID
            FROM dbo.EMShipto s WITH (NOLOCK)
            WHERE s.CustID = @CustId AND s.TranspID IS NOT NULL
            ORDER BY CASE WHEN CONVERT(VARCHAR(10), ISNULL(s.IsDefault, 0)) IN ('1', 'Y', 'y') THEN 0 ELSE 1 END, s.ListNo;
            
            IF @TranspID IS NULL SELECT TOP 1 @TranspID = TranspID FROM dbo.EMTransp WITH (NOLOCK) ORDER BY TranspID;
        END

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
            CreditDays, TruckRemark, BillRemark, TranspId
        )
        VALUES (
            @NewSoid, @WfRef, @SoPrefix, @SalesUserId, @ControlTicketNo, @DeliveryDate,
            @RequestedAt, ISNULL(@IsOwnTruck, 0), ISNULL(@NoTruckRequired, 0), ISNULL(@PSling, 0),
            @ImportFilePath, @CreatedAt, GETUTCDATE(), ISNULL(@RebateDiscountAmt, 0),
            @CreditDays, @TruckRemark, @BillRemark, @TranspID
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
