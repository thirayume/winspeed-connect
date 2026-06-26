-- ==========================================
-- 005_sp_confirm_so.sql
-- ย้ายเอกสารจาก wf.SalesOrder ไปยัง dbo.SOHD และ wf.SalesOrderExt
-- เพื่อให้ Winspeed มองเห็นทันที
-- ==========================================

CREATE OR ALTER PROCEDURE wf.sp_ConfirmSalesOrder
    @SoId INT,
    @NewSoid VARCHAR(50) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    -- 1. อ่านข้อมูลจาก wf.SalesOrder
    DECLARE @WfRef NVARCHAR(30), @SoPrefix NVARCHAR(5), @CustId NVARCHAR(20), @CustName NVARCHAR(200);
    DECLARE @TruckPlate NVARCHAR(30), @ControlTicketNo NVARCHAR(20), @DeliveryDate DATE, @Remark NVARCHAR(500);
    DECLARE @SalesUserId INT, @ImportFilePath NVARCHAR(500), @CreatedAt DATETIME2;

    SELECT 
        @WfRef = WfRef, @SoPrefix = SoPrefix, @CustId = CustId, @CustName = CustName,
        @TruckPlate = TruckPlate, @ControlTicketNo = ControlTicketNo, @DeliveryDate = DeliveryDate,
        @Remark = Remark, @SalesUserId = SalesUserId, @ImportFilePath = ImportFilePath,
        @CreatedAt = CreatedAt
    FROM wf.SalesOrder
    WHERE Id = @SoId AND Status = 'DRAFT';

    IF @@ROWCOUNT = 0
    BEGIN
        RAISERROR('ไม่พบ SalesOrder %d หรือไม่ใช่สถานะ DRAFT', 16, 1, @SoId);
        RETURN;
    END

    -- 2. สร้าง SOID และ DocuNo ฝั่ง Winspeed
    -- หา SOID ถัดไป
    DECLARE @MaxSoid INT;
    SELECT @MaxSoid = ISNULL(MAX(CAST(SOID AS INT)), 1000) FROM dbo.SOHD;
    SET @NewSoid = CAST(@MaxSoid + 1 AS VARCHAR(50));

    -- หา DocuNo ถัดไป (สมมติว่าใช้ SO Prefix + ปีเดือน + วิ่งเลข)
    -- เพื่อความเรียบง่าย ใช้ SO6705-xxxxx ไปก่อน (หรือให้ผู้ใช้อัปเดตได้)
    DECLARE @DocuNo VARCHAR(50) = 'SO6705-' + RIGHT('00000' + @NewSoid, 5);

    -- หา EmpID ของเซลส์
    DECLARE @EmpID VARCHAR(20) = '1003';
    SELECT @EmpID = EmpId FROM wf.AppUser WHERE Id = @SalesUserId AND EmpId IS NOT NULL;

    BEGIN TRY
        BEGIN TRANSACTION;

        -- 3. INSERT INTO dbo.SOHD
        DECLARE @TotalAmnt DECIMAL(18,2);
        SELECT @TotalAmnt = SUM(QtyTon * PricePerTon) FROM wf.SalesOrderLine WHERE SoId = @SoId;

        INSERT INTO dbo.SOHD (
            SOID, DocuNo, CustID, DocuDate, NetAmnt, AppvFlag, PkgStatus, clearflag, EmpID, BrchID,
            DocuType, OnHold, VatRate, VatType, GoodType, ExchRate, ClearSO, MultiCurrency, DocuStatus, AlertFlag,
            TransRegistration, Remark
        )
        VALUES (
            @NewSoid, @DocuNo, @CustId, CAST(GETDATE() AS DATE), @TotalAmnt, 'N', 'N', 'N', @EmpID, '1',
            '112', 'N', '7', '1', '1', '1', 'N', 'N', 'Y', 'N',
            @TruckPlate, @Remark
        );

        -- 4. INSERT INTO dbo.SODT
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

        -- 5. INSERT INTO wf.SalesOrderExt
        INSERT INTO wf.SalesOrderExt (
            SOID, WfRef, SoPrefix, SalesUserId, ControlTicketNo, DeliveryDate, ImportFilePath, CreatedAt, UpdatedAt
        )
        VALUES (
            @NewSoid, @WfRef, @SoPrefix, @SalesUserId, @ControlTicketNo, @DeliveryDate, @ImportFilePath, @CreatedAt, GETUTCDATE()
        );

        -- 6. INSERT INTO wf.SalesOrderLineExt
        INSERT INTO wf.SalesOrderLineExt (
            SOID, ListNo, NetPricePerTon, IsGiveaway, RebateBooked, RefControlTicketNo, IsControlTicketDrawn
        )
        SELECT 
            @NewSoid, LineNum, NetPricePerTon, IsGiveaway, RebateBooked, RefControlTicketNo, IsControlTicketDrawn
        FROM wf.SalesOrderLine
        WHERE SoId = @SoId;

        -- 7. ลบทิ้งจาก wf.SalesOrder (เพื่อป้องกันข้อมูลซ้ำซ้อน)
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
