-- =============================================================
-- 031_so_requested_transport_flags.sql
-- Meeting Minutes 02072026:
--   - SO requested/notification date-time
--   - own truck / no truck required / P-Sling flags
-- Stored in wf-owned workflow tables only. No dbo schema changes.
-- =============================================================

IF COL_LENGTH('wf.SalesOrder', 'RequestedAt') IS NULL
  ALTER TABLE wf.SalesOrder ADD RequestedAt DATETIME2 NULL;
GO
IF COL_LENGTH('wf.SalesOrder', 'IsOwnTruck') IS NULL
  ALTER TABLE wf.SalesOrder ADD IsOwnTruck BIT NOT NULL CONSTRAINT DF_SalesOrder_IsOwnTruck DEFAULT 0;
GO
IF COL_LENGTH('wf.SalesOrder', 'NoTruckRequired') IS NULL
  ALTER TABLE wf.SalesOrder ADD NoTruckRequired BIT NOT NULL CONSTRAINT DF_SalesOrder_NoTruckRequired DEFAULT 0;
GO
IF COL_LENGTH('wf.SalesOrder', 'PSling') IS NULL
  ALTER TABLE wf.SalesOrder ADD PSling BIT NOT NULL CONSTRAINT DF_SalesOrder_PSling DEFAULT 0;
GO

IF COL_LENGTH('wf.SalesOrderExt', 'RequestedAt') IS NULL
  ALTER TABLE wf.SalesOrderExt ADD RequestedAt DATETIME2 NULL;
GO
IF COL_LENGTH('wf.SalesOrderExt', 'IsOwnTruck') IS NULL
  ALTER TABLE wf.SalesOrderExt ADD IsOwnTruck BIT NOT NULL CONSTRAINT DF_SalesOrderExt_IsOwnTruck DEFAULT 0;
GO
IF COL_LENGTH('wf.SalesOrderExt', 'NoTruckRequired') IS NULL
  ALTER TABLE wf.SalesOrderExt ADD NoTruckRequired BIT NOT NULL CONSTRAINT DF_SalesOrderExt_NoTruckRequired DEFAULT 0;
GO
IF COL_LENGTH('wf.SalesOrderExt', 'PSling') IS NULL
  ALTER TABLE wf.SalesOrderExt ADD PSling BIT NOT NULL CONSTRAINT DF_SalesOrderExt_PSling DEFAULT 0;
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

-- 2. CONFIRMED, PICKING, LOADED, SHIPPED from Winspeed
SELECT
    hd.SOID AS Id,
    ISNULL(ext.WfRef, hd.DocuNo) AS WfRef,
    ISNULL(ext.SoPrefix, 'W') AS SoPrefix,
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
        WHEN hd.DocuStatus = 'Y' THEN 'SHIPPED'
        WHEN hd.clearflag = 'Y' THEN 'SHIPPED'
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
LEFT JOIN wf.SalesOrderExt ext ON ext.SOID = hd.SOID;
GO

CREATE OR ALTER PROCEDURE wf.sp_ConfirmSalesOrder
    @SoId INT,
    @NewSoid VARCHAR(50) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @WfRef NVARCHAR(30), @SoPrefix NVARCHAR(5), @CustId NVARCHAR(20), @CustName NVARCHAR(200);
    DECLARE @TruckPlate NVARCHAR(30), @ControlTicketNo NVARCHAR(20), @DeliveryDate DATE, @Remark NVARCHAR(500);
    DECLARE @RequestedAt DATETIME2, @IsOwnTruck BIT, @NoTruckRequired BIT, @PSling BIT;
    DECLARE @SalesUserId INT, @ImportFilePath NVARCHAR(500), @CreatedAt DATETIME2;
    DECLARE @RebateDiscountAmt DECIMAL(12,2);

    SELECT
        @WfRef = WfRef, @SoPrefix = SoPrefix, @CustId = CustId, @CustName = CustName,
        @TruckPlate = TruckPlate, @ControlTicketNo = ControlTicketNo, @DeliveryDate = DeliveryDate,
        @RequestedAt = RequestedAt, @IsOwnTruck = IsOwnTruck, @NoTruckRequired = NoTruckRequired, @PSling = PSling,
        @Remark = Remark, @SalesUserId = SalesUserId, @ImportFilePath = ImportFilePath,
        @CreatedAt = CreatedAt, @RebateDiscountAmt = RebateDiscountAmt
    FROM wf.SalesOrder
    WHERE Id = @SoId AND Status = 'DRAFT';

    IF @@ROWCOUNT = 0
    BEGIN
        RAISERROR('ไม่พบ SalesOrder %d หรือไม่ใช่สถานะ DRAFT', 16, 1, @SoId);
        RETURN;
    END

    DECLARE @MaxSoid INT;
    SELECT @MaxSoid = ISNULL(MAX(CAST(SOID AS INT)), 1000) FROM dbo.SOHD;
    SET @NewSoid = CAST(@MaxSoid + 1 AS VARCHAR(50));

    DECLARE @DocuNo VARCHAR(50) = 'SO6705-' + RIGHT('00000' + @NewSoid, 5);
    DECLARE @EmpID VARCHAR(20) = '1003';
    SELECT @EmpID = EmpId FROM wf.AppUser WHERE Id = @SalesUserId AND EmpId IS NOT NULL;

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @TotalAmnt DECIMAL(18,2);
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
            SOID, ListNo, GoodID, GoodQty2, GoodPrice2,
            DocuType, LotFlag, SerialFlag, GoodType, VatType, StockFlag, GoodFlag, RemaQty, FreeFlag,
            GoodStockRate1, RemaGoodStockQty, remaamnt
        )
        SELECT
            @NewSoid, LineNum, GoodId, QtyTon, PricePerTon,
            '112', 'N', 'N', '1', '1', '0', 'G', '0', 'N',
            '0', '0', '0'
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
            SOID, ListNo, NetPricePerTon, IsGiveaway, RebateBooked, RefControlTicketNo, IsControlTicketDrawn
        )
        SELECT
            @NewSoid, LineNum, NetPricePerTon, IsGiveaway, RebateBooked, RefControlTicketNo, IsControlTicketDrawn
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

PRINT '✓ WF migration 031 complete (SO requested date-time + transport flags)'
GO
