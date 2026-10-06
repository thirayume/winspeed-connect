-- D07: new wf helpers only; no dbo schema changes. SQL Server 2008 compatible.
IF OBJECT_ID('wf.fn_BookingNoteRows','TF') IS NULL
 EXEC('CREATE FUNCTION wf.fn_BookingNoteRows(@Text NVARCHAR(MAX)) RETURNS @r TABLE(Seq INT,Line NVARCHAR(100)) AS BEGIN RETURN END');
GO
ALTER FUNCTION wf.fn_BookingNoteRows(@Text NVARCHAR(MAX))
RETURNS @Rows TABLE(Seq INT,Line NVARCHAR(100))
AS
BEGIN
 DECLARE @textLeft NVARCHAR(MAX),@part NVARCHAR(MAX),@nl INT,@cut INT,@space INT,@seq INT;
 SET @textLeft=REPLACE(REPLACE(REPLACE(ISNULL(@Text,N''),CHAR(13)+CHAR(10),CHAR(10)),CHAR(13),CHAR(10)),CHAR(9),N' ');
 SET @seq=0;
 WHILE LEN(@textLeft)>0
 BEGIN
  SET @nl=CHARINDEX(CHAR(10),@textLeft);
  IF @nl=0 BEGIN SET @part=@textLeft; SET @textLeft=N''; END
  ELSE BEGIN SET @part=SUBSTRING(@textLeft,1,@nl-1);SET @textLeft=SUBSTRING(@textLeft,@nl+1,LEN(@textLeft));END;
  SET @part=LTRIM(RTRIM(@part));
  WHILE LEN(@part)>0
  BEGIN
   SET @cut=LEN(@part);
   IF @cut>100
   BEGIN
    SET @space=CHARINDEX(N' ',REVERSE(LEFT(@part,101)));
    SET @cut=CASE WHEN @space BETWEEN 1 AND 100 THEN 101-@space ELSE 100 END;
   END;
   SET @seq=@seq+1;
   INSERT @Rows VALUES(@seq,RTRIM(LEFT(@part,@cut)));
   SET @part=LTRIM(SUBSTRING(@part,@cut+1,LEN(@part)));
  END;
 END;
 RETURN;
END;
GO
IF OBJECT_ID('wf.usp_ValidateBookingNote','P') IS NULL EXEC('CREATE PROCEDURE wf.usp_ValidateBookingNote AS RETURN 0');
GO
ALTER PROCEDURE wf.usp_ValidateBookingNote @Value NVARCHAR(MAX)
AS
BEGIN
 SET @Value=LTRIM(RTRIM(ISNULL(@Value,N'')));
 IF LEN(@Value)>255 RAISERROR(N'หมายเหตุต้องไม่เกิน 255 ตัวอักษร',16,1);
 IF CONVERT(VARBINARY(MAX),@Value)<>CONVERT(VARBINARY(MAX),CONVERT(NVARCHAR(MAX),CONVERT(VARCHAR(MAX),@Value COLLATE Thai_CI_AS)))
  RAISERROR(N'หมายเหตุมีอักขระที่ WinSpeed ไม่รองรับ (code page 874)',16,1);
END;
GO
IF OBJECT_ID('wf.usp_AppendBookingText','P') IS NULL EXEC('CREATE PROCEDURE wf.usp_AppendBookingText AS RETURN 0');
GO
ALTER PROCEDURE wf.usp_AppendBookingText @SOID VARCHAR(50),@Text NVARCHAR(MAX)
AS
BEGIN
 IF CONVERT(VARBINARY(MAX),@Text)<>CONVERT(VARBINARY(MAX),CONVERT(NVARCHAR(MAX),CONVERT(VARCHAR(MAX),@Text COLLATE Thai_CI_AS)))
  RAISERROR(N'ข้อความ Description มีอักขระที่ WinSpeed ไม่รองรับ (code page 874)',16,1);
 DECLARE @Base INT;
 SELECT @Base=ISNULL(MAX(ListNo),0) FROM dbo.SOHDRemark WHERE SOID=@SOID;
 INSERT dbo.SOHDRemark(SOID,ListNo,Remark) SELECT @SOID,@Base+Seq,Line FROM wf.fn_BookingNoteRows(@Text);
END;
GO
ALTER PROCEDURE wf.usp_WriteControlTicketRemark @NewSoid VARCHAR(50),@SoId INT,@ControlTicketNo NVARCHAR(20)
AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Line NVARCHAR(MAX);
 IF NULLIF(LTRIM(RTRIM(@ControlTicketNo)),N'') IS NOT NULL SET @Line=N'ตั๋วคุม '+LTRIM(RTRIM(@ControlTicketNo));
 ELSE
 SELECT @Line=N'ตั๋วคุม '+STUFF((SELECT N', '+t.RefNo FROM (
 SELECT DISTINCT LTRIM(RTRIM(RefControlTicketNo)) RefNo FROM wf.SalesOrderLine WHERE SoId=@SoId
 UNION SELECT DISTINCT LTRIM(RTRIM(RefControlTicketNo)) FROM wf.SalesOrderLineExt WHERE @SoId IS NULL AND SOID=@NewSoid
 )t WHERE NULLIF(t.RefNo,N'') IS NOT NULL ORDER BY t.RefNo FOR XML PATH(''),TYPE).value('.','NVARCHAR(MAX)'),1,2,N'');
 EXEC wf.usp_AppendBookingText @NewSoid,@Line;
END;
GO
IF OBJECT_ID('wf.usp_WriteBookingDescription','P') IS NULL EXEC('CREATE PROCEDURE wf.usp_WriteBookingDescription AS RETURN 0');
GO
ALTER PROCEDURE wf.usp_WriteBookingDescription @SOID VARCHAR(50),@DraftId INT=NULL
AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Bill NVARCHAR(MAX),@Trip NVARCHAR(MAX),@TruckLegacy NVARCHAR(MAX),@BillLegacy NVARCHAR(MAX),@Plate NVARCHAR(MAX),@Flags NVARCHAR(MAX),@Seq NVARCHAR(MAX),@Ticket NVARCHAR(20),@Rebate DECIMAL(18,2),@Full DECIMAL(18,2),@Row NVARCHAR(MAX);
 SELECT @Bill=h.Remark,@Plate=h.TransRegistration,@TruckLegacy=e.TruckRemark,@BillLegacy=e.BillRemark,@Trip=t.TripRemark,
 @Ticket=e.ControlTicketNo,@Rebate=e.RebateDiscountAmt,@Full=h.NetAmnt,
 @Flags=CASE WHEN e.PSling=1 THEN N'ขึ้นพีสลิง ' ELSE N'' END+CASE WHEN e.IsOwnTruck=1 THEN N'ลูกค้าติดรถมาเอง ' ELSE N'' END+CASE WHEN e.NoTruckRequired=1 THEN N'ไม่ใช้รถบรรทุก ' ELSE N'' END
 FROM dbo.SOHD h JOIN wf.SalesOrderExt e ON e.SOID=CONVERT(VARCHAR(50),h.SOID) LEFT JOIN wf.SalesTrip t ON t.TripId=e.TripId WHERE h.SOID=@SOID;
 EXEC wf.usp_ValidateBookingNote @Bill;
 EXEC wf.usp_ValidateBookingNote @Trip;
 EXEC wf.usp_ValidateBookingNote @TruckLegacy;
 EXEC wf.usp_ValidateBookingNote @BillLegacy;
 DELETE dbo.SOHDRemark WHERE SOID=@SOID;
 EXEC wf.usp_AppendBookingText @SOID,@Plate;
 EXEC wf.usp_AppendBookingText @SOID,@Flags;
 EXEC wf.usp_AppendBookingText @SOID,@Trip;
 EXEC wf.usp_AppendBookingText @SOID,@TruckLegacy;
 SELECT @Seq=STUFF((SELECT N' '+CONVERT(NVARCHAR(10),e.LoadSequence)+N'.'+COALESCE(NULLIF(RTRIM(g.GoodCode),N''),d.GoodName,N'?') FROM wf.SalesOrderLineExt e JOIN dbo.SODT d ON d.SOID=@SOID AND d.ListNo=e.ListNo LEFT JOIN dbo.EMGood g ON g.GoodID=d.GoodID WHERE e.SOID=@SOID AND e.LoadSequence IS NOT NULL ORDER BY e.LoadSequence,e.ListNo FOR XML PATH(''),TYPE).value('.','NVARCHAR(MAX)'),1,1,N'');
 IF NULLIF(@Seq,N'') IS NOT NULL BEGIN SET @Seq=N'ขึ้นของตามลำดับ '+@Seq;EXEC wf.usp_AppendBookingText @SOID,@Seq;END;
 EXEC wf.usp_AppendBookingText @SOID,@Bill;
 EXEC wf.usp_AppendBookingText @SOID,@BillLegacy;
 EXEC wf.usp_WriteControlTicketRemark @SOID,@DraftId,@Ticket;
 DECLARE gifts CURSOR LOCAL FAST_FORWARD FOR SELECT N'ของแถม '+ISNULL(d.GoodName,N'') FROM dbo.SODT d JOIN wf.SalesOrderLineExt e ON e.SOID=CONVERT(VARCHAR(50),d.SOID) AND e.ListNo=d.ListNo WHERE d.SOID=@SOID AND e.IsGiveaway=1 ORDER BY d.ListNo;
 OPEN gifts;FETCH NEXT FROM gifts INTO @Row;
 WHILE @@FETCH_STATUS=0 BEGIN EXEC wf.usp_AppendBookingText @SOID,@Row;FETCH NEXT FROM gifts INTO @Row;END;
 CLOSE gifts;DEALLOCATE gifts;
 IF @Rebate>0 BEGIN
 SET @Row=N'หักรีเบท = '+CONVERT(NVARCHAR(40),CAST(@Rebate AS MONEY),1)+N' บาท  คงเหลือชำระ = '+CONVERT(NVARCHAR(40),CAST(@Full-@Rebate AS MONEY),1)+N' บาท';
 EXEC wf.usp_AppendBookingText @SOID,@Row;
 END;
END;
GO
-- Forward-only D05/D06: master-derived header dimensions and reconciled booking totals. SQL 2008+.
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

        -- SOID ต้องมาจากบล็อกของแอปใน dbo.SMID ไม่ใช่ MAX+1 ของทั้งตาราง
        -- เดิมเลขไปนั่งทับบล็อกที่ SMID จองให้เครื่องอื่น · เหตุผลเต็มอยู่หัวไฟล์ 089
        EXEC wf.usp_AllocateWinspeedId @TableName = 'SOHD', @NewId = @MaxSoid OUTPUT;
        SET @NewSoid = CAST(@MaxSoid AS VARCHAR(50));
        SET @DocuNo = @WfRef;
        SET @ImportFilePath = NULL;

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
            SOID, DocuNo, CustID, CustName, DocuDate, NetAmnt, SaleAreaID, DeptID, SumGoodAmnt, BillAftrDiscAmnt, AppvFlag, PkgStatus, clearflag, EmpID, BrchID,
            DocuType, OnHold, VatRate, VatType, GoodType, ExchRate, ClearSO, MultiCurrency, DocuStatus, AlertFlag,
            TransRegistration, Remark, CreditDays, Desc1, Desc2, Desc3, CheckAll,
            QuotStatus, VATGroupID, ValidDays, ShipDate,
            SumIncludeAmnt, BaseDiscAmnt, BillDiscAmnt, VATAmnt, MiscChargAmnt, CommissionAmnt,
            ResvAmnt1, ResvAmnt2, ResvAmnt3, ResvAmnt4, SumExcludeAmnt, TotaExcludeAmnt, TotaBaseAmnt, BillDiscFormula
        )
        VALUES (
            @NewSoid, @DocuNo, @CustId, @CustName, @NativeDocuDate, @TotalAmnt, @SaleAreaID, @DeptID, @Subtotal, @TotalAmnt, 'W', 'N', 'N', @EmpID, '1',
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
            @NewSoid, sol.LineNum, sol.GoodId, COALESCE(NULLIF(sol.GoodName, ''), g.GoodName1), 1000, 1000,
            NULL, 0, 0, COALESCE(g.MainGoodUnitID, 1002), 0, sol.QtyTon, sol.PricePerTon,
            0, 0, 0, CAST(ROUND(sol.QtyTon * sol.PricePerTon,2) AS DECIMAL(18,2)),
            '103', 'N', 'N', '1', COALESCE(g.VatType, '3'), '-1', 'G',
            sol.QtyTon, 0, CASE WHEN sol.IsGiveaway = 1 THEN 'Y' ELSE 'N' END, 1, COALESCE(g.MainGoodUnitID, 1002), sol.QtyTon,
            0, sol.QtyTon, sol.QtyTon, sol.QtyTon, sol.QtyTon, 'N', 'N',
            sol.QtyTon, CAST(ROUND(sol.QtyTon * sol.PricePerTon,2) AS DECIMAL(18,2)), 'Y', CASE WHEN sol.MasterQty IS NULL AND sol.ChildQty IS NULL THEN sol.QtyTon ELSE ISNULL(sol.MasterQty,0) END, ISNULL(sol.ChildQty,0), CAST(ROUND(sol.QtyTon * sol.PricePerTon,2) AS DECIMAL(18,2)), @PickupDueDate
        FROM wf.SalesOrderLine sol
        LEFT JOIN dbo.EMGood g WITH (NOLOCK) ON g.GoodID = sol.GoodId
        WHERE sol.SoId = @SoId;

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
IF OBJECT_ID('wf.usp_RefreshBookingHeader','P') IS NULL EXEC('CREATE PROCEDURE wf.usp_RefreshBookingHeader AS RETURN 0');
GO
ALTER PROCEDURE wf.usp_RefreshBookingHeader @SOID VARCHAR(50)
AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @Subtotal DECIMAL(18,2),@Rebate DECIMAL(18,2);
 SELECT @Subtotal=ISNULL(SUM(ROUND(GoodQty2*GoodPrice2,2)),0) FROM dbo.SODT WHERE SOID=@SOID;
 SELECT @Rebate=ISNULL(RebateDiscountAmt,0) FROM wf.SalesOrderExt WHERE SOID=@SOID;
 IF @Rebate<0 OR @Rebate>@Subtotal RAISERROR(N'ยอดรีเบทต้องอยู่ระหว่างศูนย์และยอดเต็มบิล',16,1);
 UPDATE h SET SumGoodAmnt=@Subtotal,BillAftrDiscAmnt=@Subtotal,NetAmnt=@Subtotal,
 BaseDiscAmnt=0,BillDiscAmnt=0,BillDiscFormula='',SumExcludeAmnt=0,TotaExcludeAmnt=0,TotaBaseAmnt=0,SumIncludeAmnt=0,VATAmnt=0,
 Desc1=NULL,Desc2=NULL,Desc3=NULL,SaleAreaID=c.SaleAreaID,DeptID=e.DeptID
 FROM dbo.SOHD h LEFT JOIN dbo.EMCust c ON c.CustID=h.CustID LEFT JOIN dbo.EMEmp e ON e.EmpID=h.EmpID
 WHERE h.SOID=@SOID AND h.DocuType=103;
END;
GO

IF OBJECT_ID('wf.fn_BookingTicketNos','FN') IS NULL EXEC('CREATE FUNCTION wf.fn_BookingTicketNos(@Text NVARCHAR(MAX)) RETURNS NVARCHAR(MAX) AS BEGIN RETURN NULL END');
GO
ALTER FUNCTION wf.fn_BookingTicketNos(@Text NVARCHAR(MAX)) RETURNS NVARCHAR(MAX)
AS
BEGIN
 IF LEFT(@Text,8)<>N'ตั๋วคุม ' RETURN NULL;
 DECLARE @Rest NVARCHAR(MAX),@Out NVARCHAR(MAX),@Token NVARCHAR(MAX),@Comma INT;
 SET @Rest=SUBSTRING(@Text,9,LEN(@Text));SET @Out=N'';
 IF LEN(@Rest)=0 RETURN NULL;
 WHILE LEN(@Rest)>0
 BEGIN
  SET @Comma=CHARINDEX(N', ',@Rest);
  SET @Token=CASE WHEN @Comma=0 THEN @Rest ELSE LEFT(@Rest,@Comma-1) END;
  IF NOT ((LEN(@Token)=9 AND (@Token LIKE N'I[0-9][0-9]-[0-9][0-9][0-9][0-9][0-9]' OR @Token LIKE N'K[0-9][0-9]-[0-9][0-9][0-9][0-9][0-9]'))
   OR (LEN(@Token)=10 AND @Token LIKE N'AI[0-9][0-9]-[0-9][0-9][0-9][0-9][0-9]')) RETURN NULL;
  SET @Out=@Out+CASE WHEN @Out=N'' THEN N'' ELSE N', ' END+@Token;
  SET @Rest=CASE WHEN @Comma=0 THEN N'' ELSE SUBSTRING(@Rest,@Comma+2,LEN(@Rest)) END;
 END;
 IF CONVERT(VARBINARY(MAX),@Text)<>CONVERT(VARBINARY(MAX),N'ตั๋วคุม '+@Out) RETURN NULL;
 RETURN @Out;
END;
GO

