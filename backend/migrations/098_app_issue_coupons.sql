-- =============================================================
-- 098_app_issue_coupons.sql
--
-- ให้ใบส่งขายที่แอปสร้าง ออกตั๋วปุ๋ยได้เหมือนที่ WINSpeed ทำ
--
-- ที่มา
--   `wf.sp_ConfirmSalesOrder` ไม่เคยแตะ dbo.WFCoupon / SOHD.CouponFlag เลย
--   ใบที่แอปสร้างจึงไม่มีแถวตั๋ว → ตัดตั๋วปุ๋ยไม่ได้ → Post Invoice (WF) ไม่เห็นเอกสาร
--   → ถูกบังคับให้ไปออกทางเมนูขายเชื่อ ซึ่งได้ DocuNo ผิดเล่ม
--
--   ใน WINSpeed ขั้นนี้เป็นงานมือ: แท็บ Coupon ของหน้าต่างรายละเอียดสินค้า
--   กรอกน้ำหนักกับจำนวนคูปอง แล้วกดปุ่ม Calculate (`runcouponno_btn` ใน wf_window.pbd)
--   พิสูจน์ด้วย K69-01860 เมื่อ 25/08/2569 → ได้ D6903751
--
-- กติกาที่ถอดจากข้อมูลจริง 111,192 แถว — ไม่มีข้อยกเว้นสักข้อ
--   1 บรรทัดสินค้า = 1 ใบตั๋วเสมอ                     (111,192 บรรทัด n=1 ทั้งหมด)
--   SackQty x ContainQty / 1000 = GoodQty            (ตรงทุกแถว)
--   SUM(GoodQty ของตั๋ว) = SODT.GoodQty2             (ตรงทุกแถว)
--   ContainQty คงที่ต่อรหัสสินค้า                      (140 รหัส มีค่าเดียวทุกรหัส)
--   GoodUnitID = SODT.GoodUnitID2 · GoodPrice = SODT.GoodPrice2   (ตรงทุกแถว)
--   เล่มใบส่งขาย I -> ตั๋วเล่ม C · K -> ตั๋วเล่ม D        (59,746 / 51,392 · หลุด 54 ใบ)
--   ลำดับรีเซ็ตเป็น 00001 ทุกปีพุทธ                    (ทุกปีตั้งแต่ 2562)
--
-- ตัวนับอยู่คนละที่กันสองเล่ม — ยืนยันจากเลขจริง
--   เล่ม D  dbo.EMRunBrch  RunCode='couponno'              LastNo D6903751 = MAX จริง
--   เล่ม C  dbo.EMRunChar  RunCode='couponno' Prefix Cyy%  Lastno C6903904 = MAX จริง
--
-- ⚠ ไม่แก้โครงสร้าง dbo ใด ๆ · เพิ่มเฉพาะ object ใน wf schema
--   ส่วนที่เขียนลง dbo เป็น "ข้อมูล" อย่างเดียว (INSERT WFCoupon · UPDATE SOHD/ตัวนับ)
--   ซึ่งเป็นงานเดียวกับที่ sp_ConfirmSalesOrder ทำอยู่แล้วตาม ADR-003
--
-- ⚠ ตัวนับใช้ร่วมกับเครื่อง WINSpeed ทุกเครื่อง จึงกันเลขซ้ำสามชั้น
--   1) ล็อกแถวตัวนับด้วย UPDLOCK/HOLDLOCK ตลอด transaction
--   2) เลขถัดไป = MAX(ค่าในตัวนับ, MAX เลขจริงในตาราง) + 1  — ตัวนับล้าหลังก็ไม่ทับ
--   3) ตรวจซ้ำก่อน INSERT ถ้าชนให้ขยับขึ้นจนกว่าจะว่าง
-- =============================================================

CREATE OR ALTER PROCEDURE wf.usp_AllocateCouponNo
    @Series    CHAR(1),        -- 'C' หรือ 'D'
    @DocuDate  DATETIME,
    @BrchID    VARCHAR(20),
    @CouponNo  VARCHAR(25) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    IF @Series NOT IN ('C', 'D')
    BEGIN
        RAISERROR('wf.usp_AllocateCouponNo: เล่มตั๋ว %s ไม่ถูกต้อง — รองรับเฉพาะ C กับ D', 16, 1, @Series);
        RETURN;
    END

    -- ปีพุทธสองหลักจากวันที่เอกสาร · ลำดับรีเซ็ตทุกปี
    DECLARE @YY     CHAR(2)     = RIGHT(CONVERT(VARCHAR(4), YEAR(@DocuDate) + 543), 2);
    DECLARE @Prefix VARCHAR(3)  = @Series + @YY;
    DECLARE @FromCounter INT = 0, @FromData INT = 0, @Next INT, @Guard INT = 0;

    IF @Series = 'D'
    BEGIN
        -- ล็อกแถวตัวนับไว้จนจบ transaction ของผู้เรียก
        SELECT @FromCounter =
               CASE WHEN LEFT(LastNo, 3) = @Prefix
                    THEN TRY_CAST(SUBSTRING(LastNo, 4, 5) AS INT) ELSE 0 END
        FROM dbo.EMRunBrch WITH (UPDLOCK, HOLDLOCK)
        WHERE RunCode = 'couponno' AND BrchID = @BrchID;
    END
    ELSE
    BEGIN
        SELECT @FromCounter =
               CASE WHEN LEFT(Lastno, 3) = @Prefix
                    THEN TRY_CAST(SUBSTRING(Lastno, 4, 5) AS INT) ELSE 0 END
        FROM dbo.EMRunChar WITH (UPDLOCK, HOLDLOCK)
        WHERE RunCode = 'couponno' AND BrchID = @BrchID AND LEFT(Prefix, 1) = 'C';
    END

    -- เลขจริงสูงสุดที่ออกไปแล้วในเล่ม+ปีนี้ · กันกรณีตัวนับล้าหลัง
    SELECT @FromData = ISNULL(MAX(TRY_CAST(SUBSTRING(CouponNo, 4, 5) AS INT)), 0)
    FROM dbo.WFCoupon WITH (UPDLOCK, HOLDLOCK)
    WHERE CouponNo LIKE @Prefix + '[0-9][0-9][0-9][0-9][0-9]';

    SET @Next = (CASE WHEN @FromCounter > @FromData THEN @FromCounter ELSE @FromData END) + 1;

    -- ชั้นสุดท้าย: ถ้าเลขนั้นมีอยู่แล้วให้ขยับขึ้น
    WHILE @Guard < 1000
    BEGIN
        SET @Guard += 1;
        SET @CouponNo = @Prefix + RIGHT('00000' + CONVERT(VARCHAR(5), @Next), 5);
        IF NOT EXISTS (SELECT 1 FROM dbo.WFCoupon WHERE CouponNo = @CouponNo) BREAK;
        SET @Next += 1;
    END

    IF @Guard >= 1000 OR @Next > 99999
    BEGIN
        RAISERROR('wf.usp_AllocateCouponNo: หาเลขว่างในเล่ม %s ไม่ได้', 16, 1, @Prefix);
        RETURN;
    END

    -- เดินตัวนับตามที่จ่ายไปจริง
    IF @Series = 'D'
        UPDATE dbo.EMRunBrch SET LastNo = @CouponNo
        WHERE RunCode = 'couponno' AND BrchID = @BrchID;
    ELSE
        UPDATE dbo.EMRunChar SET Lastno = @CouponNo
        WHERE RunCode = 'couponno' AND BrchID = @BrchID AND LEFT(Prefix, 1) = 'C';
END
GO

CREATE OR ALTER PROCEDURE wf.usp_IssueSalesOrderCoupons
    @SoId    INT,                  -- SOHD.SOID ของใบส่งขาย (104) ที่เพิ่งสร้าง
    @Issued  INT = 0 OUTPUT        -- จำนวนใบตั๋วที่ออกให้รอบนี้
AS
BEGIN
    SET NOCOUNT ON;
    SET @Issued = 0;

    DECLARE @DocuNo   VARCHAR(50),
            @DocuType VARCHAR(10),
            @DocuDate DATETIME,
            @BrchID   VARCHAR(20);

    SELECT @DocuNo = RTRIM(DocuNo), @DocuType = DocuType, @DocuDate = DocuDate, @BrchID = BrchID
    FROM dbo.SOHD WHERE SOID = @SoId;

    IF @DocuNo IS NULL
    BEGIN
        RAISERROR('wf.usp_IssueSalesOrderCoupons: ไม่พบ SOHD.SOID = %d', 16, 1, @SoId);
        RETURN;
    END

    -- ตั๋วปุ๋ยออกเฉพาะใบส่งขาย (104) เท่านั้น ใบสั่งจอง (103) ไม่ออก
    IF @DocuType <> '104' RETURN;

    DECLARE @Series CHAR(1) =
        CASE LEFT(@DocuNo, 1) WHEN 'I' THEN 'C' WHEN 'K' THEN 'D' END;

    IF @Series IS NULL
    BEGIN
        RAISERROR('wf.usp_IssueSalesOrderCoupons: เอกสาร %s ไม่ได้อยู่เล่ม I หรือ K — ไม่รู้ว่าตั๋วต้องเป็นเล่มไหน',
                  16, 1, @DocuNo);
        RETURN;
    END

    -- ขนาดบรรจุที่ใช้เมื่อสินค้านั้นยังไม่เคยออกตั๋วมาก่อน — คิดจากค่าที่ใช้บ่อยที่สุดในระบบ
    -- (ไม่ได้ fix ค่าไว้ในโค้ด · ปัจจุบันข้อมูลจริงให้ 50)
    DECLARE @FallbackContain DECIMAL(18, 4);
    SELECT TOP 1 @FallbackContain = ContainQty
    FROM dbo.WFCoupon
    WHERE CouponNo IS NOT NULL AND ContainQty > 0
    GROUP BY ContainQty ORDER BY COUNT(*) DESC;

    DECLARE @ListNo VARCHAR(20), @GoodID VARCHAR(20), @Qty DECIMAL(18, 4),
            @Contain DECIMAL(18, 4), @CouponID INT, @CouponNo VARCHAR(25);

    DECLARE cur CURSOR LOCAL FAST_FORWARD FOR
        SELECT d.ListNo, d.GoodID, d.GoodQty2
        FROM dbo.SODT d
        WHERE d.SOID = @SoId
          AND ISNULL(d.GoodQty2, 0) > 0
          -- ออกซ้ำไม่ได้ · เรียกกี่ครั้งผลก็เท่าเดิม
          AND NOT EXISTS (SELECT 1 FROM dbo.WFCoupon c
                          WHERE c.DocuID = @SoId AND c.RefListno = d.ListNo)
        ORDER BY d.ListNo;

    OPEN cur;
    FETCH NEXT FROM cur INTO @ListNo, @GoodID, @Qty;

    WHILE @@FETCH_STATUS = 0
    BEGIN
        -- ขนาดบรรจุยึดตามที่สินค้าตัวนี้เคยออกตั๋วไว้ ถ้าไม่เคยจึงใช้ค่าที่ใช้บ่อยที่สุด
        SET @Contain = NULL;
        SELECT TOP 1 @Contain = ContainQty
        FROM dbo.WFCoupon
        WHERE GoodID = @GoodID AND CouponNo IS NOT NULL AND ContainQty > 0
        ORDER BY CouponID DESC;

        SET @Contain = ISNULL(@Contain, @FallbackContain);

        IF ISNULL(@Contain, 0) <= 0
        BEGIN
            CLOSE cur; DEALLOCATE cur;
            RAISERROR('wf.usp_IssueSalesOrderCoupons: ไม่รู้ขนาดบรรจุของสินค้า %s — ออกตั๋วไม่ได้',
                      16, 1, @GoodID);
            RETURN;
        END

        EXEC wf.usp_AllocateWinspeedId @TableName = 'wfcoupon', @NewId = @CouponID OUTPUT;
        EXEC wf.usp_AllocateCouponNo @Series = @Series, @DocuDate = @DocuDate,
                                     @BrchID = @BrchID, @CouponNo = @CouponNo OUTPUT;

        INSERT INTO dbo.WFCoupon
            (CouponID, GoodID, InveID, LocaID, GoodUnitID, GoodPrice, DocuID,
             RefListno, Docutype, Listno, CouponNo, SONo,
             ContainQty, GoodQty, SackQty, RemaQty, GoodName)
        SELECT
            @CouponID, d.GoodID, d.InveID, d.LocaID, d.GoodUnitID2, d.GoodPrice2, @SoId,
            d.ListNo, @DocuType, 1, @CouponNo, @DocuNo,
            @Contain, d.GoodQty2, d.GoodQty2 * 1000.0 / @Contain, d.GoodQty2, d.GoodName
        FROM dbo.SODT d
        WHERE d.SOID = @SoId AND d.ListNo = @ListNo;

        SET @Issued += 1;
        FETCH NEXT FROM cur INTO @ListNo, @GoodID, @Qty;
    END

    CLOSE cur;
    DEALLOCATE cur;

    -- ธงนี้คือสิ่งที่แยกใบที่ออกตั๋วแล้วออกจากใบที่ไม่ออก — ตรงกับเลขตั๋วแบบ 1:1
    -- ทั้ง 111,209 แถวในระบบ ตั้งเมื่อมีแถวตั๋วครบทุกบรรทัดแล้วเท่านั้น
    IF NOT EXISTS (SELECT 1 FROM dbo.SODT d
                   WHERE d.SOID = @SoId AND ISNULL(d.GoodQty2, 0) > 0
                     AND NOT EXISTS (SELECT 1 FROM dbo.WFCoupon c
                                     WHERE c.DocuID = @SoId AND c.RefListno = d.ListNo))
        UPDATE dbo.SOHD SET CouponFlag = 'Y' WHERE SOID = @SoId AND ISNULL(CouponFlag, 'N') <> 'Y';
END
GO
