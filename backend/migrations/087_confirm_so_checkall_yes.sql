-- =============================================================
-- 087_confirm_so_checkall_yes.sql
--
-- CheckAll ต้องเป็น 'Y' ไม่ใช่ 'N' — แก้ทิศที่ migration 084 ทำผิด
--
-- ที่มา
--   084 ตั้ง CheckAll='N' โดยอนุมานจากใบที่อนุมัติแล้วซึ่งมี CheckAll='Y'
--   จึงเข้าใจว่า 'Y' คือ "ผลของการอนุมัติ" · **ข้อสันนิษฐานนั้นผิด**
--
--   อ่าน SQL ที่หน้าจอ Approve Confirm Order (WF) ยิงจริง (จาก plan cache
--   ตอนผู้ใช้กด F2 เมื่อ 19 ส.ค. 2569 19:17) ได้เงื่อนไขคิวเต็ม ๆ ดังนี้
--
--     FROM SOHD WHERE
--           SOHD.DocuType = 103
--       AND isnull(Sohd.onhold,    'N') = 'N'
--       AND isnull(Sohd.Clearso,   'N') = 'N'
--       AND isnull(Sohd.Docustatus,'N') NOT IN ('Y','P')
--       AND isnull(Sohd.checkall,  'N') = 'Y'      <-- ตรงนี้
--       AND isnull(Sohd.appvflag,  'W') = 'W'
--       AND docudate BETWEEN <ต้นเดือน> AND <สิ้นเดือน>
--
--   ความหมายจริงของ CheckAll คือ "ผู้เปิดใบตรวจรายการครบทุกบรรทัดแล้ว
--   พร้อมส่งให้ผู้ใหญ่อนุมัติ" ไม่ใช่ "อนุมัติแล้ว" · จึงเป็น **เงื่อนไขนำเข้าคิว**
--
--   ตรวจใบของแอปทีละเงื่อนไขแล้ว ผ่านทุกข้อยกเว้นข้อนี้ข้อเดียว
--
-- สิ่งที่ยืนยันเพิ่มระหว่างทาง
--   • QuotStatus **ไม่อยู่ใน WHERE เลย** — ไม่เกี่ยวกับคิว แต่ migration 086
--     ที่เติมไว้ยังถูกต้องและควรเก็บ เพราะทำให้ใบเหมือนของ WINSpeed จริง
--     และกันรายงานที่ SUM ข้ามช่องจำนวนเงินเพี้ยน
--   • ExpireDate ไม่ต้องใส่ — WINSpeed เองก็ปล่อยว่างทั้ง 4,345 ใบของปี 2569
--   • คิวกรองเฉพาะเดือนปัจจุบัน ตรงกับป้าย "This Month" ที่มุมล่างขวาของจอ
--
-- ตัว procedure คัดลอกจากของจริงบนฐาน (หลัง 086) เปลี่ยนเฉพาะค่า CheckAll
-- =============================================================

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
            TransRegistration, Remark, CreditDays, Desc1, Desc2, CheckAll,
            QuotStatus, VATGroupID, ValidDays, ShipDate,
            SumIncludeAmnt, BaseDiscAmnt, BillDiscAmnt, VATAmnt, MiscChargAmnt, CommissionAmnt,
            ResvAmnt1, ResvAmnt2, ResvAmnt3, ResvAmnt4
        )
        VALUES (
            @NewSoid, @DocuNo, @CustId, @CustName, CAST(GETDATE() AS DATE), @TotalAmnt, 'W', 'N', 'N', @EmpID, '1',
            '103', 'N', 0, '3', '1', 1, 'N', 'N', 'N', 'N',
            @TruckPlate, @Remark, @CreditDays, @TruckRemark, @BillRemark, 'Y',
            -- ค่าที่ WINSpeed ใส่ให้ทุกใบ · ถ้าขาด ใบจะไม่โผล่ในคิวอนุมัติ
            N'รอผู้ใหญ่ตัดสินใจ', 2, ISNULL(@CreditDays, 0),
            ISNULL(@DeliveryDate, DATEADD(day, ISNULL(@CreditDays, 0), CAST(GETDATE() AS DATE))),
            -- ช่องจำนวนเงินต้องเป็นศูนย์ ไม่ใช่ NULL — รายงานที่ SUM ข้ามคอลัมน์เหล่านี้จะเพี้ยน
            0, 0, 0, 0, 0, 0,
            0, 0, 0, 0
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
            
            INSERT INTO dbo.SOHDRemark (SOID, ListNo, Remark) VALUES (@NewSoid, 2, @SeqDetails);
        END

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
