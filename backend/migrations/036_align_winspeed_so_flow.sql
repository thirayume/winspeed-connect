-- =============================================================
-- 036_align_winspeed_so_flow.sql
-- Align app-confirmed SO documents with the observed WINSpeed WF flow.
--
-- Local WF findings from 2026-07-02 TEST documents:
--   - SO Data Entry / booking rows are dbo.SOHD.DocuType = 103.
--   - Confirmed delivery/order rows created by WINSpeed WF menus are DocuType = 104.
--   - App confirmation should create a 103 document and leave 104/invoice/accounting
--     ownership to WINSpeed WF custom menus. Keep this migration last when 033 is re-run.
-- =============================================================

IF COL_LENGTH('wf.SalesOrderExt', 'RequestedAt') IS NULL
  ALTER TABLE wf.SalesOrderExt ADD RequestedAt DATETIME2 NULL;
GO
IF COL_LENGTH('wf.SalesOrderExt', 'IsOwnTruck') IS NULL
  ALTER TABLE wf.SalesOrderExt ADD IsOwnTruck BIT NOT NULL CONSTRAINT DF_SalesOrderExt_IsOwnTruck_036 DEFAULT 0;
GO
IF COL_LENGTH('wf.SalesOrderExt', 'NoTruckRequired') IS NULL
  ALTER TABLE wf.SalesOrderExt ADD NoTruckRequired BIT NOT NULL CONSTRAINT DF_SalesOrderExt_NoTruckRequired_036 DEFAULT 0;
GO
IF COL_LENGTH('wf.SalesOrderExt', 'PSling') IS NULL
  ALTER TABLE wf.SalesOrderExt ADD PSling BIT NOT NULL CONSTRAINT DF_SalesOrderExt_PSling_036 DEFAULT 0;
GO

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
    CAST(NULL AS DECIMAL(10,2)) AS WeighOutWeight
FROM wf.SalesOrder so

UNION ALL

-- 2. Documents already visible in WINSpeed.
-- Do not treat DocuStatus='Y' as shipped: WF also uses it for approved/control-ticket states.
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
    ext.WeighOutWeight
FROM dbo.SOHD hd
LEFT JOIN wf.SalesOrderExt ext ON CONVERT(VARCHAR(50), ext.SOID) = CONVERT(VARCHAR(50), hd.SOID)
WHERE hd.DocuType IN (103, 104);
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
                @MaxSoid INT;

        SELECT @WfRef = WfRef, @SoPrefix = SoPrefix, @CustId = CustId, @CustName = CustName,
               @TruckPlate = TruckPlate, @ControlTicketNo = ControlTicketNo, @DeliveryDate = DeliveryDate,
               @RequestedAt = RequestedAt, @IsOwnTruck = IsOwnTruck, @NoTruckRequired = NoTruckRequired, @PSling = PSling,
               @Remark = Remark, @SalesUserId = SalesUserId, @CreatedAt = CreatedAt, @RebateDiscountAmt = RebateDiscountAmt
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

        SELECT @MaxSoid = ISNULL(MAX(CASE WHEN ISNUMERIC(CONVERT(VARCHAR(50), SOID)) = 1 THEN CAST(SOID AS INT) ELSE 0 END), 1000)
        FROM dbo.SOHD;
        SET @NewSoid = CAST(@MaxSoid + 1 AS VARCHAR(50));
        SET @DocuNo = @WfRef;
        SET @ImportFilePath = NULL;

        SELECT @TotalAmnt = SUM(QtyTon * PricePerTon)
        FROM wf.SalesOrderLine
        WHERE SoId = @SoId;
        SET @TotalAmnt = ISNULL(@TotalAmnt, 0) - ISNULL(@RebateDiscountAmt, 0);

        INSERT INTO dbo.SOHD (
            SOID, DocuNo, CustID, CustName, DocuDate, NetAmnt, AppvFlag, PkgStatus, clearflag, EmpID, BrchID,
            DocuType, OnHold, VatRate, VatType, GoodType, ExchRate, ClearSO, MultiCurrency, DocuStatus, AlertFlag,
            TransRegistration, Remark
        )
        VALUES (
            @NewSoid, @DocuNo, @CustId, @CustName, CAST(GETDATE() AS DATE), @TotalAmnt, 'W', 'N', 'N', @EmpID, '1',
            '103', 'N', 0, '3', '1', 1, 'N', 'N', 'N', 'N',
            @TruckPlate, @Remark
        );

        INSERT INTO dbo.SODT (
            SOID, ListNo, GoodID, GoodName, InveID, LocaID,
            GoodUnitID1, GoodPrice1, GoodQty1, GoodUnitID2, GoodStockRate1, GoodQty2, GoodPrice2,
            GoodDiscAmnt, MiscChargAmnt, SumExcludeAmnt, GoodAmnt,
            DocuType, LotFlag, SerialFlag, GoodType, VatType, StockFlag, GoodFlag,
            RemaQty, ReserveQty, FreeFlag, GoodStockRate2, GoodStockUnitID, GoodStockQty,
            GoodCost, GoodRemaQty1, GoodRemaQty2, POQty, RemaQtyPkg, Expireflag, Poststock,
            RemaGoodStockQty, remaamnt, CheckFlag, MasterQty, ChildQty
        )
        SELECT
            @NewSoid, sol.LineNum, sol.GoodId, COALESCE(NULLIF(sol.GoodName, ''), g.GoodName1), 1000, 1000,
            NULL, 0, 0, COALESCE(g.MainGoodUnitID, 1002), 0, sol.QtyTon, sol.PricePerTon,
            0, 0, 0, sol.QtyTon * sol.PricePerTon,
            '103', 'N', 'N', '1', COALESCE(g.VatType, '3'), '-1', 'G',
            sol.QtyTon, 0, CASE WHEN sol.IsGiveaway = 1 THEN 'Y' ELSE 'N' END, 1, COALESCE(g.MainGoodUnitID, 1002), sol.QtyTon,
            0, sol.QtyTon, sol.QtyTon, sol.QtyTon, sol.QtyTon, 'N', 'N',
            sol.QtyTon, sol.QtyTon * sol.PricePerTon, 'Y', sol.QtyTon, sol.QtyBag
        FROM wf.SalesOrderLine sol
        LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = sol.GoodId
        WHERE sol.SoId = @SoId;

        INSERT INTO dbo.SODTRemark (SOID, ListNo, RefListNo, Remark)
        SELECT @NewSoid, sol.LineNum, sol.LineNum, COALESCE(NULLIF(sol.GoodName, ''), g.GoodName1)
        FROM wf.SalesOrderLine sol
        LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = sol.GoodId
        WHERE sol.SoId = @SoId
          AND COALESCE(NULLIF(sol.GoodName, ''), g.GoodName1) IS NOT NULL;

        INSERT INTO wf.SalesOrderExt (
            SOID, WfRef, SoPrefix, SalesUserId, ControlTicketNo, DeliveryDate,
            RequestedAt, IsOwnTruck, NoTruckRequired, PSling,
            ImportFilePath, CreatedAt, UpdatedAt, RebateDiscountAmt
        )
        VALUES (
            @NewSoid, @WfRef, @SoPrefix, @SalesUserId, @ControlTicketNo, @DeliveryDate,
            @RequestedAt, ISNULL(@IsOwnTruck, 0), ISNULL(@NoTruckRequired, 0), ISNULL(@PSling, 0),
            @ImportFilePath, @CreatedAt, GETUTCDATE(), ISNULL(@RebateDiscountAmt, 0)
        );

        INSERT INTO wf.SalesOrderLineExt (
            SOID, ListNo, NetPricePerTon, IsGiveaway, RebateBooked, RefControlTicketNo, IsControlTicketDrawn,
            GiveawayApprovalStatus, GiveawayApprovedBy, GiveawayApprovedAt, GiveawayApprovalNote
        )
        SELECT
            @NewSoid, LineNum, NetPricePerTon, IsGiveaway, RebateBooked, RefControlTicketNo, IsControlTicketDrawn,
            GiveawayApprovalStatus, GiveawayApprovedBy, GiveawayApprovedAt, GiveawayApprovalNote
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

PRINT 'WF migration 036 complete (WINSpeed SO flow aligned to DocuType 103/104)'
GO
