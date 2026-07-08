-- =============================================================
-- 033_giveaway_line_approval.sql
-- Giveaway per-line manager approval in wf workflow.
-- Safe to re-run (idempotent)
-- =============================================================

IF COL_LENGTH('wf.SalesOrderLine','GiveawayApprovalStatus') IS NULL
  ALTER TABLE wf.SalesOrderLine ADD GiveawayApprovalStatus NVARCHAR(20) NULL;
GO
IF COL_LENGTH('wf.SalesOrderLine','GiveawayApprovedBy') IS NULL
  ALTER TABLE wf.SalesOrderLine ADD GiveawayApprovedBy INT NULL;
GO
IF COL_LENGTH('wf.SalesOrderLine','GiveawayApprovedAt') IS NULL
  ALTER TABLE wf.SalesOrderLine ADD GiveawayApprovedAt DATETIME2 NULL;
GO
IF COL_LENGTH('wf.SalesOrderLine','GiveawayApprovalNote') IS NULL
  ALTER TABLE wf.SalesOrderLine ADD GiveawayApprovalNote NVARCHAR(300) NULL;
GO

IF COL_LENGTH('wf.SalesOrderLineExt','GiveawayApprovalStatus') IS NULL
  ALTER TABLE wf.SalesOrderLineExt ADD GiveawayApprovalStatus NVARCHAR(20) NULL;
GO
IF COL_LENGTH('wf.SalesOrderLineExt','GiveawayApprovedBy') IS NULL
  ALTER TABLE wf.SalesOrderLineExt ADD GiveawayApprovedBy INT NULL;
GO
IF COL_LENGTH('wf.SalesOrderLineExt','GiveawayApprovedAt') IS NULL
  ALTER TABLE wf.SalesOrderLineExt ADD GiveawayApprovedAt DATETIME2 NULL;
GO
IF COL_LENGTH('wf.SalesOrderLineExt','GiveawayApprovalNote') IS NULL
  ALTER TABLE wf.SalesOrderLineExt ADD GiveawayApprovalNote NVARCHAR(300) NULL;
GO

UPDATE wf.SalesOrderLine
SET GiveawayApprovalStatus = CASE WHEN IsGiveaway = 1 THEN 'PENDING' ELSE NULL END
WHERE GiveawayApprovalStatus IS NULL;
GO

UPDATE wf.SalesOrderLineExt
SET GiveawayApprovalStatus = CASE WHEN IsGiveaway = 1 THEN 'PENDING' ELSE NULL END
WHERE GiveawayApprovalStatus IS NULL;
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
    CAST(NULL AS INT) AS LoadSequence,
    sol.GiveawayApprovalStatus,
    sol.GiveawayApprovedBy,
    sol.GiveawayApprovedAt,
    sol.GiveawayApprovalNote,
    au.DisplayName AS GiveawayApprovedByName,
    sol.CreatedAt
FROM wf.SalesOrderLine sol
JOIN wf.SalesOrder so ON so.Id = sol.SoId
LEFT JOIN wf.AppUser au ON au.Id = sol.GiveawayApprovedBy
WHERE so.Status = 'DRAFT'

UNION ALL

SELECT
    dt.SOID AS SoId,
    dt.ListNo AS LineNum,
    dt.GoodID AS GoodId,
    g.GoodCode,
    g.GoodName1 AS GoodName,
    dt.GoodQty2 AS QtyTon,
    CAST(dt.GoodQty2 * 20 AS INT) AS QtyBag,
    dt.GoodPrice2 AS PricePerTon,
    ISNULL(ext.NetPricePerTon, dt.GoodPrice2) AS NetPricePerTon,
    ISNULL(ext.IsGiveaway, 0) AS IsGiveaway,
    ISNULL(ext.RebateBooked, 0) AS RebateBooked,
    ext.RefControlTicketNo,
    ISNULL(ext.IsControlTicketDrawn, 0) AS IsControlTicketDrawn,
    ext.LoadSequence,
    ext.GiveawayApprovalStatus,
    ext.GiveawayApprovedBy,
    ext.GiveawayApprovedAt,
    ext.GiveawayApprovalNote,
    au.DisplayName AS GiveawayApprovedByName,
    hd.DocuDate AS CreatedAt
FROM dbo.SODT dt
JOIN dbo.SOHD hd ON hd.SOID = dt.SOID
JOIN dbo.EMGood g ON g.GoodID = dt.GoodID
LEFT JOIN wf.SalesOrderLineExt ext ON ext.SOID = dt.SOID AND ext.ListNo = dt.ListNo
LEFT JOIN wf.AppUser au ON au.Id = ext.GiveawayApprovedBy
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
                @EmpID INT, @TotalAmnt DECIMAL(18,2), @ImportFilePath NVARCHAR(500), @RebateDiscountAmt DECIMAL(12,2);

        SELECT @WfRef = WfRef, @SoPrefix = SoPrefix, @CustId = CustId, @CustName = CustName,
               @TruckPlate = TruckPlate, @ControlTicketNo = ControlTicketNo, @DeliveryDate = DeliveryDate,
               @RequestedAt = RequestedAt, @IsOwnTruck = IsOwnTruck, @NoTruckRequired = NoTruckRequired, @PSling = PSling,
               @Remark = Remark, @SalesUserId = SalesUserId, @CreatedAt = CreatedAt, @RebateDiscountAmt = RebateDiscountAmt
        FROM wf.SalesOrder WHERE Id = @SoId;

        IF @WfRef IS NULL
        BEGIN
            RAISERROR('SalesOrder not found', 16, 1);
            ROLLBACK TRANSACTION;
            RETURN;
        END

        SELECT TOP 1 @EmpID = TRY_CAST(EmpId AS INT) FROM wf.AppUser WHERE Id = @SalesUserId;
        IF @EmpID IS NULL SET @EmpID = 1000;

        SET @NewSoid = CAST(@SoId AS VARCHAR(50));
        SET @DocuNo = @WfRef;
        SET @ImportFilePath = NULL;

        SELECT @TotalAmnt = SUM(QtyTon * PricePerTon) FROM wf.SalesOrderLine WHERE SoId = @SoId;
        SET @TotalAmnt = @TotalAmnt - ISNULL(@RebateDiscountAmt, 0);

        INSERT INTO dbo.SOHD (
            SOID, DocuNo, CustID, DocuDate, NetAmnt, AppvFlag, PkgStatus, clearflag, EmpID, BrchID,
            DocuType, OnHold, VatRate, VatType, GoodType, ExchRate, ClearSO, MultiCurrency, DocuStatus, AlertFlag,
            TransRegistration, Remark
        )
        VALUES (
            @NewSoid, @DocuNo, @CustId, CAST(GETDATE() AS DATE), @TotalAmnt, 'N', 'N', 'N', @EmpID, '1',
            '112', 'N', '7', '1', '1', '1', 'N', 'N', 'N', 'N',
            @TruckPlate, @Remark
        );

        INSERT INTO dbo.SODT (
            SOID, ListNo, GoodID, GoodQty2, GoodPrice2, DocuType, LotFlag, SerialFlag, GoodType, VatType,
            StockFlag, GoodFlag, RemaQty, FreeFlag, GoodStockRate1, RemaGoodStockQty, remaamnt
        )
        SELECT @NewSoid, LineNum, GoodId, QtyTon, PricePerTon, '112', 'N', 'N', '1', '1',
               '0', 'G', '0', CASE WHEN IsGiveaway = 1 THEN 'Y' ELSE 'N' END, '0', '0', '0'
        FROM wf.SalesOrderLine
        WHERE SoId = @SoId;

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

PRINT 'WF migration 033 complete (giveaway line approval)'
GO
