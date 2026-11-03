-- @transaction
-- UAT round trip (3 November 2026): WINSpeed's booking approval refuses a line with no quantity, so a bill
-- with a giveaway could not be approved, and the piece count was gone once the bill was confirmed. A real
-- WINSpeed sales document has never carried a giveaway line (none in SODT at all). A giveaway now stays out
-- of dbo.SODT: wf.SalesOrderLineExt keeps the item and its pieces, numbered after the sale lines, and the
-- booking's remark names it for WINSpeed users. Bodies = migration 163's sp_ConfirmSalesOrder, 138's
-- usp_WriteBookingDescription and 055's v_AllSalesOrderLines plus only the pinned edits. No dbo structure
-- change. SQL Server 2008 compatible; idempotent.
IF OBJECT_ID('wf.sp_ConfirmSalesOrder','P') IS NULL
 OR OBJECT_ID('wf.usp_WriteBookingDescription','P') IS NULL
 OR OBJECT_ID('wf.v_AllSalesOrderLines','V') IS NULL
 OR OBJECT_ID('wf.SalesOrderLineExt','U') IS NULL
 RAISERROR('GOL_PREREQUISITE_REQUIRED',16,1);
GO
IF COL_LENGTH('wf.SalesOrderLineExt','GiveawayGoodId') IS NULL
    ALTER TABLE wf.SalesOrderLineExt ADD
        GiveawayGoodId   NVARCHAR(20)  NULL,
        GiveawayGoodCode NVARCHAR(50)  NULL,
        GiveawayGoodName NVARCHAR(200) NULL,
        GiveawayPieces   INT           NULL;
GO
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
        DECLARE @SaleAreaID INT, @DeptID INT, @Subtotal DECIMAL(18,2);
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

        SET @Remark=LTRIM(RTRIM(@Remark));
        SET @TruckRemark=LTRIM(RTRIM(@TruckRemark));
        SET @BillRemark=LTRIM(RTRIM(@BillRemark));
        EXEC wf.usp_ValidateBookingNote @Remark;
        EXEC wf.usp_ValidateBookingNote @TruckRemark;
        EXEC wf.usp_ValidateBookingNote @BillRemark;
        DECLARE @TripNote NVARCHAR(MAX);
        SELECT @TripNote=t.TripRemark FROM wf.SalesOrder o JOIN wf.SalesTrip t ON t.TripId=o.TripId WHERE o.Id=@SoId;
        EXEC wf.usp_ValidateBookingNote @TripNote;
        -- Dimensions come from current masters; absent values remain NULL, never fabricated.
        SELECT @SaleAreaID = SaleAreaID FROM dbo.EMCust WHERE CustID = @CustId;
        SELECT @DeptID = DeptID FROM dbo.EMEmp WHERE EmpID = @EmpID;
        -- WINSpeed puts the customer's default contact on the booking; the 104, 202 and 107 copy it.
        DECLARE @ContactName VARCHAR(255);
        SELECT TOP 1 @ContactName = ContactName FROM dbo.EMCustContact WHERE CustID = @CustId AND IsDefault = 'Y' ORDER BY ListNo, ContactID;

        -- SOID ต้องมาจากบล็อกของแอปใน dbo.SMID ไม่ใช่ MAX+1 ของทั้งตาราง
        -- เดิมเลขไปนั่งทับบล็อกที่ SMID จองให้เครื่องอื่น · เหตุผลเต็มอยู่หัวไฟล์ 089
        EXEC wf.usp_AllocateWinspeedId @TableName = 'SOHD', @NewId = @MaxSoid OUTPUT;
        SET @NewSoid = CAST(@MaxSoid AS VARCHAR(50));
        SET @DocuNo = @WfRef;
        SET @ImportFilePath = NULL;

        -- A giveaway alone leaves the booking with no line for WINSpeed to approve.
        IF NOT EXISTS (SELECT 1 FROM wf.SalesOrderLine WHERE SoId=@SoId AND ISNULL(IsGiveaway,0)=0)
            RAISERROR('Native booking requires at least one sale line',16,1);

        -- Per-line currency rounding: header is the sum of persisted line amounts.
        IF EXISTS (SELECT 1 FROM wf.SalesOrderLine WHERE SoId=@SoId
                   AND (QtyTon < 0 OR PricePerTon < 0 OR (IsGiveaway=1 AND PricePerTon<>0)))
            RAISERROR('Native booking requires nonnegative amounts and zero-priced giveaway lines',16,1);
        SELECT @Subtotal = SUM(CAST(ROUND(QtyTon * PricePerTon,2) AS DECIMAL(18,2)))
        FROM wf.SalesOrderLine WHERE SoId=@SoId;
        SET @Subtotal=ISNULL(@Subtotal,0);
        SET @RebateDiscountAmt=ISNULL(@RebateDiscountAmt,0);
        IF @RebateDiscountAmt<0 OR @RebateDiscountAmt>@Subtotal
            RAISERROR('Rebate discount must be between zero and booking subtotal',16,1);
        SET @TotalAmnt=@Subtotal;

        INSERT INTO dbo.SOHD (
            SOID, DocuNo, CustID, CustName, ContactName, DocuDate, NetAmnt, SaleAreaID, DeptID, SumGoodAmnt, BillAftrDiscAmnt, AppvFlag, PkgStatus, clearflag, EmpID, BrchID,
            DocuType, OnHold, VatRate, VatType, GoodType, ExchRate, ClearSO, MultiCurrency, DocuStatus, AlertFlag,
            TransRegistration, Remark, CreditDays, Desc1, Desc2, Desc3, CheckAll,
            QuotStatus, VATGroupID, ValidDays, ShipDate,
            SumIncludeAmnt, BaseDiscAmnt, BillDiscAmnt, VATAmnt, MiscChargAmnt, CommissionAmnt,
            ResvAmnt1, ResvAmnt2, ResvAmnt3, ResvAmnt4, SumExcludeAmnt, TotaExcludeAmnt, TotaBaseAmnt, BillDiscFormula
        )
        VALUES (
            @NewSoid, @DocuNo, @CustId, @CustName, @ContactName, @NativeDocuDate, @TotalAmnt, @SaleAreaID, @DeptID, @Subtotal, @TotalAmnt, 'W', 'N', 'N', @EmpID, '1',
            '103', 'N', 0, '3', '1', 1, 'N', 'N', 'N', 'N',
            @TruckPlate, @Remark, @CreditDays, NULL, NULL, NULL, 'Y',
            -- ค่าที่ WINSpeed ใส่ให้ทุกใบ · ถ้าขาด ใบจะไม่โผล่ในคิวอนุมัติ
            N'รอผู้ใหญ่ตัดสินใจ', 2, DATEDIFF(day,@NativeDocuDate,@PickupDueDate),
            @PickupDueDate,
            -- ช่องจำนวนเงินต้องเป็นศูนย์ ไม่ใช่ NULL — รายงานที่ SUM ข้ามคอลัมน์เหล่านี้จะเพี้ยน
            0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, ''
        );

        INSERT INTO dbo.SODT (
            SOID, ListNo, GoodID, GoodName, InveID, LocaID,
            GoodUnitID1, GoodPrice1, GoodQty1, GoodUnitID2, GoodStockRate1, GoodQty2, GoodPrice2,
            GoodDiscAmnt, MiscChargAmnt, SumExcludeAmnt, GoodAmnt,
            DocuType, LotFlag, SerialFlag, GoodType, VatType, StockFlag, GoodFlag,
            RemaQty, ReserveQty, FreeFlag, GoodStockRate2, GoodStockUnitID, GoodStockQty,
            GoodCost, GoodRemaQty1, GoodRemaQty2, POQty, RemaQtyPkg, Expireflag, Poststock,
            RemaGoodStockQty, remaamnt, CheckFlag, MasterQty, ChildQty, AfterMarkupamnt, ShipDate
        )
        SELECT
            @NewSoid, ROW_NUMBER() OVER (ORDER BY sol.LineNum), sol.GoodId, COALESCE(NULLIF(sol.GoodName, ''), g.GoodName1), 1000, 1000,
            NULL, 0, 0, COALESCE(g.MainGoodUnitID, 1002), 0, sol.QtyTon, sol.PricePerTon,
            0, 0, 0, CAST(ROUND(sol.QtyTon * sol.PricePerTon,2) AS DECIMAL(18,2)),
            '103', 'N', 'N', '1', COALESCE(g.VatType, '3'), '-1', 'G',
            sol.QtyTon, 0, 'N', 1, COALESCE(g.MainGoodUnitID, 1002), sol.QtyTon,
            0, sol.QtyTon, sol.QtyTon, sol.QtyTon, sol.QtyTon, 'N', 'N',
            sol.QtyTon, CAST(ROUND(sol.QtyTon * sol.PricePerTon,2) AS DECIMAL(18,2)), 'Y', CASE WHEN sol.MasterQty IS NULL AND sol.ChildQty IS NULL THEN sol.QtyTon ELSE ISNULL(sol.MasterQty,0) END, ISNULL(sol.ChildQty,0), CAST(ROUND(sol.QtyTon * sol.PricePerTon,2) AS DECIMAL(18,2)), @PickupDueDate
        FROM wf.SalesOrderLine sol
        LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = sol.GoodId
        WHERE sol.SoId = @SoId AND ISNULL(sol.IsGiveaway,0) = 0;

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
            GiveawayApprovalStatus, GiveawayApprovedBy, GiveawayApprovedAt, GiveawayApprovalNote,
            GiveawayGoodId, GiveawayGoodCode, GiveawayGoodName, GiveawayPieces
        )
        SELECT
            @NewSoid, ROW_NUMBER() OVER (ORDER BY ISNULL(IsGiveaway,0), LineNum), NetPricePerTon, IsGiveaway, RebateBooked, LoadSequence, RefControlTicketNo, IsControlTicketDrawn,
            GiveawayApprovalStatus, GiveawayApprovedBy, GiveawayApprovedAt, GiveawayApprovalNote,
            CASE WHEN IsGiveaway=1 THEN GoodId END, CASE WHEN IsGiveaway=1 THEN GoodCode END, CASE WHEN IsGiveaway=1 THEN GoodName END,
            CASE WHEN IsGiveaway=1 THEN CASE WHEN QtyTon>0 THEN CAST(QtyTon AS INT) ELSE QtyBag END END
        FROM wf.SalesOrderLine
        WHERE SoId = @SoId;

        EXEC wf.usp_WriteBookingDescription @NewSoid,@SoId;
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
GO
ALTER PROCEDURE wf.usp_WriteBookingDescription @SOID VARCHAR(50), @DraftId INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Bill NVARCHAR(MAX), @Trip NVARCHAR(MAX), @TruckLegacy NVARCHAR(MAX), @BillLegacy NVARCHAR(MAX),
            @Plate NVARCHAR(MAX), @Flags NVARCHAR(MAX), @Seq NVARCHAR(MAX), @Ticket NVARCHAR(20),
            @Rebate DECIMAL(18,2), @Full DECIMAL(18,2), @Row NVARCHAR(MAX);

    SELECT @Bill = h.Remark, @Plate = h.TransRegistration, @TruckLegacy = e.TruckRemark, @BillLegacy = e.BillRemark,
           @Trip = t.TripRemark, @Ticket = e.ControlTicketNo, @Rebate = e.RebateDiscountAmt, @Full = h.NetAmnt,
           @Flags = CASE WHEN e.PSling = 1 THEN N'ขึ้นพีสลิง ' ELSE N'' END +
                    CASE WHEN e.IsOwnTruck = 1 THEN N'ลูกค้าติดรถมาเอง ' ELSE N'' END +
                    CASE WHEN e.NoTruckRequired = 1 THEN N'ไม่ใช้รถบรรทุก ' ELSE N'' END
    FROM dbo.SOHD h
    JOIN wf.SalesOrderExt e ON e.SOID = CONVERT(VARCHAR(50), h.SOID)
    LEFT JOIN wf.SalesTrip t ON t.TripId = e.TripId
    WHERE h.SOID = @SOID;

    EXEC wf.usp_ValidateBookingNote @Bill;
    EXEC wf.usp_ValidateBookingNote @Trip;
    EXEC wf.usp_ValidateBookingNote @TruckLegacy;
    EXEC wf.usp_ValidateBookingNote @BillLegacy;

    DELETE dbo.SOHDRemark WHERE SOID = @SOID;

    EXEC wf.usp_AppendBookingText @SOID, @Plate;
    EXEC wf.usp_AppendBookingText @SOID, @Flags;
    EXEC wf.usp_AppendBookingText @SOID, @Trip;
    EXEC wf.usp_AppendBookingText @SOID, @TruckLegacy;

    -- R15 (Q3): Loading order by formula name e.g. 1.15-15-15 2.0-0-60
    SELECT @Seq = STUFF((
        SELECT N' ' + CONVERT(NVARCHAR(10), e.LoadSequence) + N'.' + wf.fn_ExtractFormulaName(COALESCE(g.GoodName1, d.GoodName, e.GiveawayGoodName, N'?'))
        FROM wf.SalesOrderLineExt e
        LEFT JOIN dbo.SODT d ON d.SOID = @SOID AND d.ListNo = e.ListNo
        LEFT JOIN dbo.EMGood g ON g.GoodID = d.GoodID
        WHERE e.SOID = @SOID AND e.LoadSequence IS NOT NULL
        ORDER BY e.LoadSequence, e.ListNo
        FOR XML PATH(''), TYPE
    ).value('.', 'NVARCHAR(MAX)'), 1, 1, N'');

    IF NULLIF(@Seq, N'') IS NOT NULL
    BEGIN
        SET @Seq = N'ขึ้นของตามลำดับ ' + @Seq;
        EXEC wf.usp_AppendBookingText @SOID, @Seq;
    END;

    EXEC wf.usp_AppendBookingText @SOID, @Bill;
    EXEC wf.usp_AppendBookingText @SOID, @BillLegacy;
    EXEC wf.usp_WriteControlTicketRemark @SOID, @DraftId, @Ticket;

    DECLARE gifts CURSOR LOCAL FAST_FORWARD FOR
        SELECT N'ของแถม ' + COALESCE(e.GiveawayGoodName, d.GoodName, N'')
             + CASE WHEN e.GiveawayPieces > 0 THEN N' ' + CONVERT(NVARCHAR(10), e.GiveawayPieces) + N' ชิ้น' ELSE N'' END
        FROM wf.SalesOrderLineExt e
        LEFT JOIN dbo.SODT d ON d.SOID = @SOID AND d.ListNo = e.ListNo
        WHERE e.SOID = @SOID AND e.IsGiveaway = 1
        ORDER BY e.ListNo;

    OPEN gifts;
    FETCH NEXT FROM gifts INTO @Row;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        EXEC wf.usp_AppendBookingText @SOID, @Row;
        FETCH NEXT FROM gifts INTO @Row;
    END;
    CLOSE gifts;
    DEALLOCATE gifts;

    IF @Rebate > 0
    BEGIN
        SET @Row = N'หักรีเบท = ' + CONVERT(NVARCHAR(40), CAST(@Rebate AS MONEY), 1) + N' บาท  คงเหลือชำระ = ' + CONVERT(NVARCHAR(40), CAST(@Full - @Rebate AS MONEY), 1) + N' บาท';
        EXEC wf.usp_AppendBookingText @SOID, @Row;
    END;
END;
GO
ALTER VIEW wf.v_AllSalesOrderLines AS
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
LEFT JOIN wf.AppUser au ON au.Id = ext.GiveawayApprovedBy

UNION ALL

SELECT
    CAST(ext.SOID AS VARCHAR(50)) AS SoId,
    ext.ListNo AS LineNum,
    ext.GiveawayGoodId AS GoodId,
    ext.GiveawayGoodCode AS GoodCode,
    ext.GiveawayGoodName AS GoodName,
    CAST(0 AS DECIMAL(12,3)) AS QtyTon,
    ext.GiveawayPieces AS QtyBag,
    CAST(0 AS DECIMAL(12,2)) AS PricePerTon,
    CAST(0 AS DECIMAL(12,2)) AS NetPricePerTon,
    ext.IsGiveaway,
    ISNULL(ext.RebateBooked, 0) AS RebateBooked,
    ext.RefControlTicketNo,
    ISNULL(ext.IsControlTicketDrawn, 0) AS IsControlTicketDrawn,
    ext.LoadSequence,
    ext.GiveawayApprovalStatus,
    ext.GiveawayApprovedBy,
    ext.GiveawayApprovedAt,
    ext.GiveawayApprovalNote,
    au.DisplayName AS GiveawayApprovedByName,
    ext.GiveawayApprovedAt AS CreatedAt,
    CAST(0 AS DECIMAL(12,3)) AS MasterQty,
    CAST(0 AS DECIMAL(12,3)) AS ChildQty
FROM wf.SalesOrderLineExt ext
LEFT JOIN wf.AppUser au ON au.Id = ext.GiveawayApprovedBy
WHERE ext.IsGiveaway = 1 AND ext.GiveawayGoodId IS NOT NULL;
GO
