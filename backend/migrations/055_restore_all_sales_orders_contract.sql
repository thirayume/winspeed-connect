-- 055_restore_all_sales_orders_contract.sql
-- Forward-only repair after a historical migration rerun replaced the current
-- view with an older 18-column contract. Keep applied migrations immutable.

-- Restore extension-table columns removed by the historical 003 rerun.
IF COL_LENGTH('wf.SalesOrderExt', 'RequestedAt') IS NULL
  ALTER TABLE wf.SalesOrderExt ADD RequestedAt DATETIME2 NULL;
GO
IF COL_LENGTH('wf.SalesOrderExt', 'IsOwnTruck') IS NULL
  ALTER TABLE wf.SalesOrderExt ADD IsOwnTruck BIT NOT NULL CONSTRAINT DF_SalesOrderExt_IsOwnTruck_055 DEFAULT (0);
GO
IF COL_LENGTH('wf.SalesOrderExt', 'NoTruckRequired') IS NULL
  ALTER TABLE wf.SalesOrderExt ADD NoTruckRequired BIT NOT NULL CONSTRAINT DF_SalesOrderExt_NoTruckRequired_055 DEFAULT (0);
GO
IF COL_LENGTH('wf.SalesOrderExt', 'PSling') IS NULL
  ALTER TABLE wf.SalesOrderExt ADD PSling BIT NOT NULL CONSTRAINT DF_SalesOrderExt_PSling_055 DEFAULT (0);
GO
IF COL_LENGTH('wf.SalesOrderExt', 'IsUnlocked') IS NULL
  ALTER TABLE wf.SalesOrderExt ADD IsUnlocked BIT NOT NULL CONSTRAINT DF_SalesOrderExt_IsUnlocked_055 DEFAULT (0);
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
IF COL_LENGTH('wf.SalesOrderExt', 'NotifiedAt') IS NULL
  ALTER TABLE wf.SalesOrderExt ADD NotifiedAt DATETIME2 NULL;
GO

IF COL_LENGTH('wf.SalesOrderLineExt', 'MasterQty') IS NULL
  ALTER TABLE wf.SalesOrderLineExt ADD MasterQty DECIMAL(12,3) NULL;
GO
IF COL_LENGTH('wf.SalesOrderLineExt', 'ChildQty') IS NULL
  ALTER TABLE wf.SalesOrderLineExt ADD ChildQty DECIMAL(12,3) NULL;
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

-- 2. Documents already visible in WINSpeed (deduplicated by DocuNo)
SELECT
    Id,
    WfRef,
    SoPrefix,
    CustId,
    CustName,
    TruckPlate,
    ControlTicketNo,
    DeliveryDate,
    RequestedAt,
    IsOwnTruck,
    NoTruckRequired,
    PSling,
    Remark,
    Status,
    SalesUserId,
    ImportFilePath,
    ImportedDocuNo,
    ImportedAt,
    CreatedAt,
    UpdatedAt,
    RebateDiscountAmt,
    IsLoaded,
    WeighOutWeight,
    CreditDays,
    TruckRemark,
    BillRemark,
    TranspId
FROM (
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
        ISNULL(ext.TranspId, hd.TranspID) AS TranspId,
        ROW_NUMBER() OVER(PARTITION BY hd.DocuNo ORDER BY hd.DocuType DESC, hd.SOID DESC) AS rn
    FROM dbo.SOHD hd
    LEFT JOIN wf.SalesOrderExt ext ON CONVERT(VARCHAR(50), ext.SOID) = CONVERT(VARCHAR(50), hd.SOID)
    WHERE hd.DocuType IN (103, 104)
) Dedup
WHERE rn = 1;
GO

-- Restore the latest line-view contract from migration 038.
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

-- Restore the latest confirmation procedure from migration 052.
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
                @MaxSoid INT, @CreditDays INT, @TruckRemark NVARCHAR(500), @BillRemark NVARCHAR(500);

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
            TransRegistration, Remark, CreditDays, Desc1, Desc2
        )
        VALUES (
            @NewSoid, @DocuNo, @CustId, @CustName, CAST(GETDATE() AS DATE), @TotalAmnt, 'W', 'N', 'N', @EmpID, '1',
            '103', 'N', 0, '3', '1', 1, 'N', 'N', 'N', 'N',
            @TruckPlate, @Remark, @CreditDays, @TruckRemark, @BillRemark
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

        -- ==============================================================
        -- Logistics Mapping into SOHDRemark
        -- Line 1: Pre-Sling and Truck types
        -- Line 2: Sequence Loading
        -- Line 3: Reserved for future logistics
        -- Line 4+: Giveaways
        -- ==============================================================
        
        DECLARE @RemarkLine1 NVARCHAR(500) = '';
        IF @PSling = 1 SET @RemarkLine1 = @RemarkLine1 + '[ต้องการ Pre-Sling] ';
        IF @IsOwnTruck = 1 SET @RemarkLine1 = @RemarkLine1 + '[รถลูกค้า] ';
        IF @NoTruckRequired = 1 SET @RemarkLine1 = @RemarkLine1 + '[ไม่ใช้รถบรรทุก] ';
        
        IF LEN(@RemarkLine1) > 0
        BEGIN
            INSERT INTO dbo.SOHDRemark (SOID, ListNo, Remark) VALUES (@NewSoid, 1, LTRIM(RTRIM(@RemarkLine1)));
        END

        IF EXISTS (SELECT 1 FROM wf.SalesOrderLine WHERE SoId = @SoId AND LoadSequence IS NOT NULL)
        BEGIN
            DECLARE @SeqDetails NVARCHAR(500) = '[ขึ้นของตามลำดับ] ';
            
            -- Can also enumerate sequences if needed, but keeping it brief
            INSERT INTO dbo.SOHDRemark (SOID, ListNo, Remark) VALUES (@NewSoid, 2, @SeqDetails);
        END

        -- Giveaway Remarks in SOHDRemark (ListNo >= 4)
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
            GiveawayApprovalStatus, GiveawayApprovedBy, GiveawayApprovedAt, GiveawayApprovalNote
        )
        SELECT
            @NewSoid, LineNum, NetPricePerTon, IsGiveaway, RebateBooked, LoadSequence, RefControlTicketNo, IsControlTicketDrawn,
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
PRINT 'WF migration 055 complete (restored extension schema, views, and confirmation procedure)';
GO
