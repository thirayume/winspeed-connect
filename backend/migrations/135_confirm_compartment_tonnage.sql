-- Forward-only D-04: mother/trailer quantities are tons, never bags. SQL 2008/2022.
ALTER PROCEDURE wf.sp_ConfirmSalesOrder
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
                @EnteredByUserId INT;

        DECLARE @PickupDueDate DATE, @PickupDueType VARCHAR(20), @ConfirmedAt DATETIME2, @PickupPolicySnapshotId INT;
        DECLARE @NativeDocuDate DATE;
        SELECT @WfRef = WfRef, @SoPrefix = SoPrefix, @CustId = CustId, @CustName = CustName,
               @TruckPlate = TruckPlate, @ControlTicketNo = ControlTicketNo, @DeliveryDate = DeliveryDate,
               @RequestedAt = RequestedAt, @IsOwnTruck = IsOwnTruck, @NoTruckRequired = NoTruckRequired, @PSling = PSling,
               @Remark = Remark, @SalesUserId = SalesUserId, @CreatedAt = CreatedAt, @RebateDiscountAmt = RebateDiscountAmt,
               @CreditDays = CreditDays, @TruckRemark = TruckRemark, @BillRemark = BillRemark,
               @EnteredByUserId = EnteredByUserId,
               @PickupDueDate = PickupDueDate, @PickupDueType = PickupDueType,
               @ConfirmedAt = ConfirmedAt, @PickupPolicySnapshotId = PickupPolicySnapshotId
        FROM wf.SalesOrder
        WHERE Id = @SoId AND Status = 'DRAFT';

        IF @WfRef IS NULL
        BEGIN
            RAISERROR('SalesOrder draft not found', 16, 1);
            ROLLBACK TRANSACTION;
            RETURN;
        END

        -- Policy must be resolved before native conversion; credit is unrelated.
        IF @PickupDueDate IS NULL
        BEGIN
            RAISERROR('Confirmed pickup due date is required before native SO creation',16,1);
            RETURN;
        END;
        SET @NativeDocuDate = CAST(DATEADD(hour,7,ISNULL(@ConfirmedAt,GETUTCDATE())) AS DATE);

        -- Draft quantities have scale 3. Tolerance 0.0001 ton detects every stored 0.001 discrepancy.
        -- Both NULL: legacy fallback QtyTon/0. One NULL: the missing compartment is zero.
        IF EXISTS (
            SELECT 1 FROM wf.SalesOrderLine WHERE SoId = @SoId
            AND (ISNULL(MasterQty,0) < 0 OR ISNULL(ChildQty,0) < 0
                 OR (NOT (MasterQty IS NULL AND ChildQty IS NULL)
                     AND ABS(ISNULL(MasterQty,0) + ISNULL(ChildQty,0) - QtyTon) > 0.0001))
        )
            RAISERROR('Mother plus trailer quantity must equal line quantity in tons',16,1);

        -- พนักงานขายของใบ ต้องเป็นคนที่ขึ้นทะเบียนใน dbo.EMSales เท่านั้น
        --
        -- WINSpeed ตรวจข้อนี้ตอนกด Approve & Save และตอบ "Salesman is not vaid!"
        -- ถ้า EmpID ไม่อยู่ในทะเบียน · ยืนยันจากข้อมูลจริง: ใบ 103 ปี 2569 จำนวน
        -- 4,345 ใบ มี 4,289 ใบที่ EmpID อยู่ใน EMSales · 56 ใบปล่อยว่าง
        -- และ **ไม่มีสักใบ** ที่ EmpID อยู่นอกทะเบียน
        --
        -- เดิมบรรทัดสุดท้ายคือ  IF @EmpID IS NULL SET @EmpID = 1000
        -- ซึ่งยัดพนักงานคนแรกของตารางให้เสมอเมื่อผู้ยืนยันไม่มี EmpId
        -- (เช่นบทบาท ADMIN หรือ ACCOUNTING ที่ไม่ได้ผูกกับพนักงานขาย)
        -- EmpID 1000 ไม่อยู่ใน EMSales ใบจึงอนุมัติไม่ได้เลยและไม่มีใครรู้จนไปติดที่หน้าจอ
        --
        -- ปล่อยเป็น NULL ปลอดภัยกว่า — WINSpeed ยอมรับ (ใบที่พนักงานคีย์เองก็มี 56 ใบ
        -- ที่ว่าง) และผู้อนุมัติเลือกพนักงานขายบนหน้าจอได้เอง
        SELECT TOP 1 @EmpID = CASE WHEN ISNUMERIC(u.EmpId) = 1 THEN CAST(u.EmpId AS INT) ELSE NULL END
        FROM wf.AppUser u
        WHERE u.Id = @SalesUserId;

        -- ตกทะเบียนพนักงานขายเมื่อไร ให้ว่างไว้ ห้ามเดาแทน
        IF @EmpID IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM dbo.EMSales s WHERE s.EmpID = @EmpID)
            SET @EmpID = NULL;

        -- SOID ต้องมาจากบล็อกของแอปใน dbo.SMID ไม่ใช่ MAX+1 ของทั้งตาราง
        -- เดิมเลขไปนั่งทับบล็อกที่ SMID จองให้เครื่องอื่น · เหตุผลเต็มอยู่หัวไฟล์ 089
        EXEC wf.usp_AllocateWinspeedId @TableName = 'SOHD', @NewId = @MaxSoid OUTPUT;
        SET @NewSoid = CAST(@MaxSoid AS VARCHAR(50));
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
            @NewSoid, @DocuNo, @CustId, @CustName, @NativeDocuDate, @TotalAmnt, 'W', 'N', 'N', @EmpID, '1',
            '103', 'N', 0, '3', '1', 1, 'N', 'N', 'N', 'N',
            @TruckPlate, @Remark, @CreditDays, @TruckRemark, @BillRemark, 'Y',
            -- ค่าที่ WINSpeed ใส่ให้ทุกใบ · ถ้าขาด ใบจะไม่โผล่ในคิวอนุมัติ
            N'รอผู้ใหญ่ตัดสินใจ', 2, DATEDIFF(day,@NativeDocuDate,@PickupDueDate),
            @PickupDueDate,
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
            sol.QtyTon, sol.QtyTon * sol.PricePerTon, 'Y', CASE WHEN sol.MasterQty IS NULL AND sol.ChildQty IS NULL THEN sol.QtyTon ELSE ISNULL(sol.MasterQty,0) END, ISNULL(sol.ChildQty,0)
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
        -- Description (dbo.SOHDRemark) — รูปแบบตามเอกสารจริง
        --   1 ทะเบียนรถ · 2 โลจิสติกส์ · 3 ลำดับขึ้นของ · 4 ตั๋วคุม · 5+ ของแถม
        -- เรียงต่อเนื่องไม่เว้นเลข · บรรทัดไหนไม่มีข้อมูลก็เลื่อนขึ้นมาแทน
        -- เหตุผลและตัวเลขที่วัดได้อยู่หัวไฟล์ migration 097
        -- ==============================================================
        DECLARE @Rem TABLE (Seq INT IDENTITY(1,1), Line NVARCHAR(500));

        -- 1) ทะเบียนรถ — บรรทัดแรกของเอกสารจริง 10,554 จาก 11,506 ใบ
        IF NULLIF(LTRIM(RTRIM(ISNULL(@TruckPlate, ''))), '') IS NOT NULL
            INSERT INTO @Rem (Line) VALUES (LTRIM(RTRIM(@TruckPlate)));

        -- 2) หมายเหตุโลจิสติกส์ — ภาษาไทยแบบที่คนคีย์จริงเขียน ไม่ใช้วงเล็บเหลี่ยม
        DECLARE @Logi NVARCHAR(500) = '';
        IF @PSling = 1          SET @Logi = @Logi + N'ขึ้นพีสลิง ';
        IF @IsOwnTruck = 1      SET @Logi = @Logi + N'ลูกค้าติดรถมาเอง ';
        IF @NoTruckRequired = 1 SET @Logi = @Logi + N'ไม่ใช้รถบรรทุก ';
        IF LEN(LTRIM(RTRIM(@Logi))) > 0
            INSERT INTO @Rem (Line) VALUES (LTRIM(RTRIM(@Logi)));

        -- 3) ลำดับขึ้นของ — ต้องมีลำดับจริงต่อท้าย ไม่ใช่แท็กเปล่า
        --    ตรงกับความต้องการข้อ 1 ในเอกสาร "ปัญหา/ความต้องการ"
        --    แยก DECLARE กับ SET เพราะใช้ XML method ใน initializer ของ DECLARE ไม่ได้
        IF EXISTS (SELECT 1 FROM wf.SalesOrderLine WHERE SoId = @SoId AND LoadSequence IS NOT NULL)
        BEGIN
            DECLARE @Seq NVARCHAR(MAX);
            SET @Seq = STUFF((
                SELECT N' ' + CAST(sol.LoadSequence AS NVARCHAR(10)) + N'.'
                       + COALESCE(NULLIF(sol.GoodCode, ''),
                              (SELECT RTRIM(g.GoodCode) FROM dbo.EMGood g
                                WHERE CONVERT(NVARCHAR(50), g.GoodID) = CONVERT(NVARCHAR(50), sol.GoodId)),
                              NULLIF(sol.GoodName, ''), N'?')
                FROM   wf.SalesOrderLine sol
                WHERE  sol.SoId = @SoId AND sol.LoadSequence IS NOT NULL
                ORDER BY sol.LoadSequence
                FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 1, '');
            IF NULLIF(LTRIM(RTRIM(ISNULL(@Seq, ''))), '') IS NOT NULL
                INSERT INTO @Rem (Line) VALUES (LEFT(N'ขึ้นของตามลำดับ ' + @Seq, 500));
        END

        INSERT INTO dbo.SOHDRemark (SOID, ListNo, Remark)
        SELECT @NewSoid, Seq, Line FROM @Rem ORDER BY Seq;

        -- 4) ตั๋วคุม — helper ต่อท้ายเลขบรรทัดถัดไปเอง (ดู migration 097)
        EXEC wf.usp_WriteControlTicketRemark
             @NewSoid = @NewSoid, @SoId = @SoId, @ControlTicketNo = @ControlTicketNo;

        -- 5) ของแถม — ต่อท้ายจากบรรทัดสุดท้าย ไม่ตรึงว่าเริ่มที่ 4
        DECLARE @GiftFrom INT = ISNULL((SELECT MAX(ListNo) FROM dbo.SOHDRemark WHERE SOID = @NewSoid), 0);
        INSERT INTO dbo.SOHDRemark (SOID, ListNo, Remark)
        SELECT @NewSoid,
               @GiftFrom + ROW_NUMBER() OVER (ORDER BY sol.LineNum),
               LEFT(N'ของแถม ' + COALESCE(NULLIF(sol.GoodName, ''), g.GoodName1, N''), 500)
        FROM   wf.SalesOrderLine sol
        LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = sol.GoodId
        WHERE  sol.SoId = @SoId AND sol.IsGiveaway = 1;

        INSERT INTO wf.SalesOrderExt (
            SOID, WfRef, SoPrefix, SalesUserId, ControlTicketNo, DeliveryDate,
            RequestedAt, IsOwnTruck, NoTruckRequired, PSling,
            ImportFilePath, CreatedAt, UpdatedAt, RebateDiscountAmt,
            CreditDays, TruckRemark, BillRemark, EnteredByUserId, TripId,
            PickupDueDate, PickupDueType, ConfirmedAt, PickupPolicySnapshotId
        )
        VALUES (
            @NewSoid, @WfRef, @SoPrefix, @SalesUserId, @ControlTicketNo, @DeliveryDate,
            @RequestedAt, ISNULL(@IsOwnTruck, 0), ISNULL(@NoTruckRequired, 0), ISNULL(@PSling, 0),
            @ImportFilePath, @CreatedAt, GETUTCDATE(), ISNULL(@RebateDiscountAmt, 0),
            @CreditDays, @TruckRemark, @BillRemark, @EnteredByUserId,
            (SELECT TripId FROM wf.SalesOrder WHERE Id = @SoId),
            @PickupDueDate, @PickupDueType, @ConfirmedAt, @PickupPolicySnapshotId
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
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;        DECLARE @ErrorMessage NVARCHAR(4000);
        DECLARE @ErrorSeverity INT;
        DECLARE @ErrorState INT;
        SELECT 
            @ErrorMessage = ERROR_MESSAGE(),
            @ErrorSeverity = ERROR_SEVERITY(),
            @ErrorState = ERROR_STATE();
        IF @ErrorSeverity < 16 SET @ErrorSeverity = 16;
        IF @ErrorState < 1 SET @ErrorState = 1;
        RAISERROR ('%s', @ErrorSeverity, @ErrorState, @ErrorMessage);
    END CATCH
END
