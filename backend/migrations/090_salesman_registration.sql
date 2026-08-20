-- =============================================================
-- 090_salesman_registration.sql
--
-- 1) แยก "ผู้คีย์เอกสาร" ออกจาก "พนักงานขายเจ้าของยอด"
-- 2) มุมมองบอกว่าผู้ใช้คนไหนขึ้นทะเบียนพนักงานขายใน dbo.EMSales แล้วหรือยัง
--
-- ที่มา
--   WINSpeed ตรวจตอนกด Approve & Save ว่า EmpID ของใบอยู่ใน dbo.EMSales หรือไม่
--   ถ้าไม่อยู่จะตอบ "Salesman is not vaid!" และ **อนุมัติใบนั้นไม่ได้เลย**
--   migration 088 แก้ให้ใส่ NULL แทนการเดา แต่ผู้เปิดใบยังไม่รู้ตัวจนไปติดที่ขั้นอนุมัติ
--
--   วัดจริงบน remote 20/08/2569 — ผู้ใช้ที่ยังใช้งานอยู่
--     SALES       ขึ้นทะเบียนแล้ว 16 · **มี EmpId แต่ไม่อยู่ใน EMSales 11**
--     WAREHOUSE   ขึ้นทะเบียนแล้ว  2 · ไม่อยู่ใน EMSales 5
--     MANAGER     ขึ้นทะเบียนครบ 3
--     ACCOUNTING / C_LEVEL  มี EmpId แต่ไม่อยู่ใน EMSales (ถูกต้องแล้ว ไม่ใช่พนักงานขาย)
--     ADMIN       ไม่มี EmpId (ถูกต้องแล้ว)
--
--   แปลว่าพนักงานขาย 11 คนเปิดใบได้ตามปกติ แต่ทุกใบจะถูกปฏิเสธตอนอนุมัติ
--   นี่เป็นปัญหาที่เกิดอยู่จริงแล้ว ไม่ใช่กรณีสมมติ
--
-- เรื่องผู้คีย์แทน
--   เจ้าของระบบระบุว่า "พนักงานขายควรยึดตาม User Logged In หรือที่กำหนด Access As ไว้
--   เช่น Counter_Sale อาจทำงานแทน Sale ต้องบันทึกตาม Access As Sale"
--   เดิมโค้ดยอมให้เฉพาะ ADMIN ระบุแทนคนอื่นได้ และ **ไม่เก็บว่าใครเป็นคนคีย์จริง**
--   ใบจึงบอกไม่ได้ว่าใครลงมือ ซึ่งเป็นสิ่งที่ผู้ตรวจ ISO ถามหา
--   เพิ่ม EnteredByUserId เพื่อให้ตอบได้ว่า "คีย์โดย ก. ในนามพนักงานขาย ข."
-- =============================================================

IF COL_LENGTH('wf.SalesOrder', 'EnteredByUserId') IS NULL
    ALTER TABLE wf.SalesOrder ADD EnteredByUserId INT NULL;
GO

IF COL_LENGTH('wf.SalesOrderExt', 'EnteredByUserId') IS NULL
    ALTER TABLE wf.SalesOrderExt ADD EnteredByUserId INT NULL;
GO

/*
 * สถานะทะเบียนพนักงานขายของผู้ใช้แต่ละคน
 *
 * อ่านจาก dbo.EMSales ตรง ๆ ไม่คัดลอกมาเก็บ — ทะเบียนเป็นของ WINSpeed
 * ฝ่ายบุคคลเพิ่ม/ถอนคนเมื่อไร ที่นี่ต้องเห็นทันทีโดยไม่ต้อง sync
 *
 * IsRegistered = 1 เท่านั้นที่ WINSpeed จะยอมให้อนุมัติใบ
 */
CREATE OR ALTER VIEW wf.v_SalesmanStatus AS
SELECT
    u.Id                AS UserId,
    u.Username,
    u.DisplayName,
    u.Role,
    u.EmpId,
    CASE WHEN ISNUMERIC(u.EmpId) = 1 THEN CAST(u.EmpId AS INT) END AS EmpIdNum,
    CAST(CASE WHEN u.EmpId IS NOT NULL
              AND EXISTS (SELECT 1 FROM dbo.EMSales s WITH (NOLOCK)
                          WHERE s.EmpID = CASE WHEN ISNUMERIC(u.EmpId) = 1 THEN CAST(u.EmpId AS INT) END)
              THEN 1 ELSE 0 END AS BIT) AS IsRegistered,
    CASE
        WHEN u.EmpId IS NULL THEN N'ยังไม่ได้ผูกรหัสพนักงาน'
        WHEN NOT EXISTS (SELECT 1 FROM dbo.EMSales s WITH (NOLOCK)
                         WHERE s.EmpID = CASE WHEN ISNUMERIC(u.EmpId) = 1 THEN CAST(u.EmpId AS INT) END)
            THEN N'ยังไม่ขึ้นทะเบียนพนักงานขายใน WINSpeed'
        ELSE NULL
    END AS Reason
FROM wf.AppUser u;
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
