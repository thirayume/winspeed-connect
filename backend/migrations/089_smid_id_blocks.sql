-- =============================================================
-- 089_smid_id_blocks.sql
--
-- จ่ายเลขคีย์ของ WINSpeed จากบล็อกใน dbo.SMID แทนการใช้ MAX+1
--
-- ที่มา
--   WINSpeed ไม่ได้ใช้ IDENTITY กับ SOHD.SOID · WFCoupon.CouponID · SMAudit.audit_id
--   แต่แจก "บล็อกละ 1000" ให้แต่ละเครื่องผ่านตาราง dbo.SMID (Name, Prefix, Type)
--   โดย Name เป็นรูป  <server>/<ชื่อเครื่อง>/<ตาราง>  แล้วจ่ายเลขภายในบล็อกของตัวเอง
--
--   คำสั่งจริงที่อ่านได้จาก plan cache ตอนบันทึกใบ K69-01852 (19/08/2569)
--     Select max(prefix) From SMID Where Type =1 And charindex('WFCoupon', name) > 0
--     INSERT INTO [SMID]([Name],[Prefix],[Type]) values(@1,@2,@3)
--     SELECT max(couponid) FROM WFCoupon WHERE (couponid >= 242000 and couponid < 243000)
--
--   เห็นผลชัดตรงที่ SOID กระโดดจาก 274013 ไป 275000 เพราะเครื่อง WF-TEST-1
--   เพิ่งได้บล็อก 275000 ทั้งที่ MAX(SOID) ตอนนั้นคือ 274013
--
-- ปัญหาของ MAX+1
--   sp_ConfirmSalesOrder ใช้ MAX(SOID)+1 และ winspeed-audit.js ใช้ MAX(audit_id)+1
--   เลขที่ได้จึงไป **นั่งทับบล็อกที่ SMID จองให้เครื่องอื่นไว้แล้ว**
--     แถวของแอป SOID 274001-274013   อยู่ในบล็อก 274000 ของเครื่อง WF-TEST-2
--     แถวของแอป audit_id 1577001-1577026 อยู่ในบล็อก 1577000 ของอีกเครื่องหนึ่ง
--   ยังไม่ชนเพราะทั้งสองฝั่งหาเลขว่างด้วย max-ภายในช่วง แต่จะชนแน่เมื่อบล็อกนั้นเต็ม
--   หรือเมื่อ SMID แจกบล็อกที่แอปไต่ขึ้นไปนั่งอยู่ให้เครื่องใหม่
--
-- วิธีแก้
--   ให้แอปขึ้นทะเบียนเป็น "เครื่อง" หนึ่งใน SMID ชื่อ wssale-app/backend/<ตาราง>
--   แล้วจ่ายเลขในบล็อกของตัวเองด้วยกติกาเดียวกับ WINSpeed ทุกประการ
--   เลขแรกของบล็อกคือค่า Prefix เอง (ยืนยันจาก CouponID 242000 = บล็อก 242000)
--
-- ⚠ เป็นการ INSERT ลง dbo.SMID ซึ่งเป็น dbo write นอกรายการเดิม
--   เจ้าของระบบอนุมัติแล้ว 19/08/2569 · เพิ่มแถวอย่างเดียว ไม่แก้และไม่ลบของเดิม
--   แถวเก่าที่แอปเคยเขียนไว้ในบล็อกของเครื่องอื่นปล่อยไว้ตามเดิม ไม่ย้อนแก้
-- =============================================================

CREATE OR ALTER PROCEDURE wf.usp_AllocateWinspeedId
    @TableName SYSNAME,
    @NewId     INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    -- รับเฉพาะตารางที่รู้จัก · ชื่อคอลัมน์มาจากตรงนี้ ไม่ได้รับจากผู้เรียก
    -- เพื่อไม่ให้ค่าที่ส่งเข้ามาไหลไปอยู่ในคำสั่ง dynamic SQL
    DECLARE @IdColumn SYSNAME =
        CASE LOWER(@TableName)
             WHEN 'sohd'     THEN 'SOID'
             WHEN 'smaudit'  THEN 'audit_id'
             WHEN 'wfcoupon' THEN 'CouponID'
             WHEN 'soinvhd'  THEN 'SOInvID'
        END;

    IF @IdColumn IS NULL
    BEGIN
        RAISERROR('wf.usp_AllocateWinspeedId: ยังไม่รองรับตาราง %s', 16, 1, @TableName);
        RETURN;
    END

    DECLARE @Owner  VARCHAR(255) = 'wssale-app/backend/' + LOWER(@TableName);
    DECLARE @Prefix INT, @Next INT, @Guard INT = 0, @Sql NVARCHAR(MAX);

    -- บล็อกล่าสุดที่แอปถืออยู่ · PK ของ SMID เป็น (Name, Prefix) จึงถือได้หลายบล็อก
    SELECT @Prefix = MAX(Prefix)
    FROM dbo.SMID WITH (UPDLOCK, HOLDLOCK)
    WHERE Name = @Owner AND Type = 1;

    WHILE @Guard < 20
    BEGIN
        SET @Guard += 1;

        IF @Prefix IS NULL
        BEGIN
            -- ขอบล็อกใหม่ด้วยกติกาเดิมของ WINSpeed: max(prefix) ของตารางนั้น + 1000
            SELECT @Prefix = ISNULL(MAX(Prefix), 0) + 1000
            FROM dbo.SMID WITH (UPDLOCK, HOLDLOCK)
            WHERE Type = 1 AND CHARINDEX(@TableName, Name) > 0;

            INSERT INTO dbo.SMID (Name, Prefix, Type) VALUES (@Owner, @Prefix, 1);
        END

        -- เลขว่างถัดไปในบล็อก · ถ้าบล็อกยังว่างเปล่าให้ใช้ค่า Prefix เป็นเลขแรก
        SET @Sql = N'SELECT @out = ISNULL(MAX(' + QUOTENAME(@IdColumn) + N') + 1, @p)
                     FROM dbo.' + QUOTENAME(@TableName) + N' WITH (UPDLOCK, HOLDLOCK)
                     WHERE ' + QUOTENAME(@IdColumn) + N' >= @p
                       AND ' + QUOTENAME(@IdColumn) + N' <  @p + 1000;';
        EXEC sp_executesql @Sql, N'@p INT, @out INT OUTPUT', @p = @Prefix, @out = @Next OUTPUT;

        IF @Next < @Prefix + 1000
        BEGIN
            SET @NewId = @Next;
            RETURN;
        END

        SET @Prefix = NULL;   -- บล็อกเต็มแล้ว วนไปขอใหม่
    END

    RAISERROR('wf.usp_AllocateWinspeedId: ขอเลขให้ตาราง %s ไม่สำเร็จ', 16, 1, @TableName);
END
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
