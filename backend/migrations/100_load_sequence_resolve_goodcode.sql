-- =============================================================
-- 100_load_sequence_resolve_goodcode.sql
--
-- บรรทัด "ขึ้นของตามลำดับ" ต้องมีรหัสสินค้าจริง ไม่ใช่เครื่องหมายคำถาม
--
-- ที่มา
--   ใน sp_ConfirmSalesOrder บรรทัดลำดับขึ้นของสร้างจาก
--     COALESCE(NULLIF(sol.GoodCode,''), NULLIF(sol.GoodName,''), N'?')
--   ถ้าผู้เรียก API ส่งมาแต่ goodId โดยไม่ส่ง goodCode/goodName
--   ทั้งสองช่องจะว่าง แล้วตกไปที่ '?' — WINSpeed จึงได้หมายเหตุว่า
--     "ขึ้นของตามลำดับ 1.? 2.?"
--   ซึ่งอ่านไม่รู้เรื่องและไม่มีใครสังเกตเพราะเอกสารบันทึกผ่านตามปกติ
--   เจอตอนทดสอบ I69-02443 (25/08/2569)
--
-- วิธีแก้
--   ถ้า GoodCode ว่าง ให้ไปอ่านจาก dbo.EMGood ด้วย GoodId ที่มีอยู่แล้ว
--   ข้อมูลอยู่ตรงนั้นอยู่แล้ว — SODT ก็ใช้เส้นทางเดียวกันนี้และได้รหัสถูกต้อง
--   คง '?' ไว้เป็นชั้นสุดท้าย เผื่อกรณีที่หารหัสไม่เจอจริง ๆ
--
-- ไม่แก้โครงสร้าง dbo · แก้เฉพาะ procedure ใน wf schema
-- =============================================================

-- ── 2. sp_ConfirmSalesOrder — ตัวเต็มที่แก้บล็อกหมายเหตุแล้ว ─────────────────
--
-- ตัวนี้สร้างจาก OBJECT_DEFINITION() ของ proc ที่ใช้งานจริง ณ 25/08/2569
-- แล้วแทนที่เฉพาะบล็อก "Logistics Mapping into SOHDRemark" ส่วนอื่นคงเดิมทุกตัวอักษร
-- (เดิมลอง patch ด้วยสตริงซ้อนใน T-SQL แล้วพัง — escape ชั้นเดียวก็ผิดทั้งบล็อก
--  จึงสร้างข้อความเต็มไว้ในไฟล์นี้เลย ตรวจทานได้ด้วยตา และ diff กับของเดิมได้)

-- =============================================================
-- ส่วนที่ 5 — ต่อสาย: ให้ sp_ConfirmSalesOrder เรียก helper ของส่วนที่ 1
--
-- ตำแหน่งที่แทรก: หลังบล็อก SOHDRemark ของของแถม และ **ก่อน**
-- DELETE FROM wf.SalesOrderLine ท้าย proc — เพราะ helper อ่านตารางนั้น
-- ส่วนอื่นของ proc คงเดิมทุกบรรทัด (ยกมาจากตัวที่รันอยู่จริงบน production)
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
                @MaxSoid INT, @CreditDays INT, @TruckRemark NVARCHAR(500), @BillRemark NVARCHAR(500),
                @EnteredByUserId INT;

        SELECT @WfRef = WfRef, @SoPrefix = SoPrefix, @CustId = CustId, @CustName = CustName,
               @TruckPlate = TruckPlate, @ControlTicketNo = ControlTicketNo, @DeliveryDate = DeliveryDate,
               @RequestedAt = RequestedAt, @IsOwnTruck = IsOwnTruck, @NoTruckRequired = NoTruckRequired, @PSling = PSling,
               @Remark = Remark, @SalesUserId = SalesUserId, @CreatedAt = CreatedAt, @RebateDiscountAmt = RebateDiscountAmt,
               @CreditDays = CreditDays, @TruckRemark = TruckRemark, @BillRemark = BillRemark,
               @EnteredByUserId = EnteredByUserId
        FROM wf.SalesOrder
        WHERE Id = @SoId AND Status = 'DRAFT';

        IF @WfRef IS NULL
        BEGIN
            RAISERROR('SalesOrder draft not found', 16, 1);
            ROLLBACK TRANSACTION;
            RETURN;
        END

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
            CreditDays, TruckRemark, BillRemark, EnteredByUserId
        )
        VALUES (
            @NewSoid, @WfRef, @SoPrefix, @SalesUserId, @ControlTicketNo, @DeliveryDate,
            @RequestedAt, ISNULL(@IsOwnTruck, 0), ISNULL(@NoTruckRequired, 0), ISNULL(@PSling, 0),
            @ImportFilePath, @CreatedAt, GETUTCDATE(), ISNULL(@RebateDiscountAmt, 0),
            @CreditDays, @TruckRemark, @BillRemark, @EnteredByUserId
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
