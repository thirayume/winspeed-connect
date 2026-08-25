-- =============================================================
-- 099_coupon_repair_and_watch.sql
--
-- ซ่อมใบส่งขายที่ตั๋วปุ๋ยค้าง + เฝ้าระวังไม่ให้หลุดอีก
--
-- แก้ข้อสรุปใน 098
--   098 เขียนไว้ว่า "ใบที่แอปสร้างจะไม่มีแถวตั๋ว" ซึ่ง **ไม่ถูก**
--   `wf.sp_ConfirmSalesOrder` สร้าง **ใบสั่งจอง (103)** ไม่ใช่ใบส่งขาย (104)
--   และตั๋วปุ๋ยผูกกับ 104 เท่านั้น — ตรวจแล้วทั้ง 111,210 แถวเป็น 104 ล้วน
--   ใบสั่งจองจริง 61,439 ใบเป็น `CouponFlag='N'` ทุกใบ ซึ่งถูกต้องตามปกติ
--   แอปจึงไม่ได้มีข้อบกพร่องตรงนี้ · hook ที่เคยใส่ใน routes/so.js ถอนออกแล้ว
--
-- ปัญหาที่เหลืออยู่จริง
--   ใบส่งขายที่เจ้าหน้าที่เปิดใน WINSpeed แล้ว **ข้ามแท็บ Coupon**
--   จะได้แถวใน dbo.WFCoupon ที่ `CouponNo` เป็น NULL และ `ContainQty`/`SackQty` = 0
--   WINSpeed ซ่อมเองไม่ได้ เพราะเอกสาร 104 ที่บันทึกแล้วกลายเป็น read-only ทั้งใบ
--   (ทดสอบแล้ว: พิมพ์ลงช่องใดก็ไม่เข้า) ใบพวกนี้จึงตายค้างถาวรถ้าไม่มีใครซ่อม
--   ปัจจุบันมี 18 แถวทั่วทั้งระบบ — 17 แถวเป็นเอกสารทดสอบของเรา
--
-- ของใหม่ในไฟล์นี้
--   1) `wf.usp_IssueSalesOrderCoupons` เพิ่มโหมดซ่อม — เติมเลขให้แถวที่ CouponNo เป็น NULL
--   2) `wf.v_DeliveryCouponGaps` — รายการใบส่งขายที่ตั๋วไม่ครบ ไว้เฝ้าระวัง
--
-- ⚠ ไม่แก้โครงสร้าง dbo · เพิ่มเฉพาะ object ใน wf และเขียนเฉพาะ "ข้อมูล" ลง dbo
-- =============================================================

CREATE OR ALTER PROCEDURE wf.usp_IssueSalesOrderCoupons
    @SoId      INT,               -- SOHD.SOID ของใบส่งขาย (104)
    @Issued    INT = 0 OUTPUT,    -- แถวตั๋วที่ "ออกใหม่"
    @Repaired  INT = 0 OUTPUT     -- แถวเดิมที่ "เติมเลขให้"
AS
BEGIN
    SET NOCOUNT ON;
    SET @Issued = 0;
    SET @Repaired = 0;

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

    -- ตั๋วปุ๋ยเป็นของใบส่งขายเท่านั้น · ใบสั่งจอง (103) ไม่ออกตั๋ว และไม่ใช่ความผิดพลาด
    IF @DocuType <> '104' RETURN;

    DECLARE @Series CHAR(1) =
        CASE LEFT(@DocuNo, 1) WHEN 'I' THEN 'C' WHEN 'K' THEN 'D' END;

    IF @Series IS NULL
    BEGIN
        RAISERROR('wf.usp_IssueSalesOrderCoupons: เอกสาร %s ไม่ได้อยู่เล่ม I หรือ K — ไม่รู้ว่าตั๋วต้องเป็นเล่มไหน',
                  16, 1, @DocuNo);
        RETURN;
    END

    -- ขนาดบรรจุสำรอง = ค่าที่ใช้บ่อยที่สุดในระบบ · คิดจากข้อมูลจริง ไม่ได้ fix ไว้ในโค้ด
    DECLARE @FallbackContain DECIMAL(18, 4);
    SELECT TOP 1 @FallbackContain = ContainQty
    FROM dbo.WFCoupon
    WHERE CouponNo IS NOT NULL AND ContainQty > 0
    GROUP BY ContainQty ORDER BY COUNT(*) DESC;

    DECLARE @ListNo VARCHAR(20), @GoodID VARCHAR(20), @Qty DECIMAL(18, 4),
            @CouponID INT, @Contain DECIMAL(18, 4), @CouponNo VARCHAR(25), @Mode CHAR(1);

    -- ทั้งสองงานใช้กติกาเดียวกัน ต่างแค่ INSERT กับ UPDATE จึงรวมเป็นรอบเดียว
    --   N = บรรทัดที่ยังไม่มีแถวตั๋วเลย        -> ออกใหม่
    --   R = แถวตั๋วที่มีอยู่แต่ CouponNo ว่าง   -> เติมเลขให้
    DECLARE cur CURSOR LOCAL FAST_FORWARD FOR
        SELECT 'N', d.ListNo, d.GoodID, d.GoodQty2, NULL
        FROM dbo.SODT d
        WHERE d.SOID = @SoId AND ISNULL(d.GoodQty2, 0) > 0
          AND NOT EXISTS (SELECT 1 FROM dbo.WFCoupon c
                          WHERE c.DocuID = @SoId AND c.RefListno = d.ListNo)
        UNION ALL
        SELECT 'R', c.RefListno, c.GoodID, d.GoodQty2, c.CouponID
        FROM dbo.WFCoupon c
        JOIN dbo.SODT d ON d.SOID = c.DocuID AND d.ListNo = c.RefListno
        WHERE c.DocuID = @SoId AND c.CouponNo IS NULL;

    OPEN cur;
    FETCH NEXT FROM cur INTO @Mode, @ListNo, @GoodID, @Qty, @CouponID;

    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @Contain = NULL;
        SELECT TOP 1 @Contain = ContainQty
        FROM dbo.WFCoupon
        WHERE GoodID = @GoodID AND CouponNo IS NOT NULL AND ContainQty > 0
        ORDER BY CouponID DESC;

        SET @Contain = ISNULL(NULLIF(@Contain, 0), @FallbackContain);

        IF ISNULL(@Contain, 0) <= 0
        BEGIN
            CLOSE cur; DEALLOCATE cur;
            RAISERROR('wf.usp_IssueSalesOrderCoupons: ไม่รู้ขนาดบรรจุของสินค้า %s — ออกตั๋วไม่ได้',
                      16, 1, @GoodID);
            RETURN;
        END

        EXEC wf.usp_AllocateCouponNo @Series = @Series, @DocuDate = @DocuDate,
                                     @BrchID = @BrchID, @CouponNo = @CouponNo OUTPUT;

        IF @Mode = 'N'
        BEGIN
            EXEC wf.usp_AllocateWinspeedId @TableName = 'wfcoupon', @NewId = @CouponID OUTPUT;

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
        END
        ELSE
        BEGIN
            -- แถวที่ WINSpeed ทิ้งไว้ครึ่ง ๆ กลาง ๆ · เติมให้ครบตามสูตรเดียวกับใบปกติ
            UPDATE c
            SET c.CouponNo   = @CouponNo,
                c.ContainQty = @Contain,
                c.SackQty    = @Qty * 1000.0 / @Contain,
                c.GoodQty    = @Qty,
                c.RemaQty    = CASE WHEN ISNULL(c.RemaQty, 0) = 0 THEN @Qty ELSE c.RemaQty END
            FROM dbo.WFCoupon c
            WHERE c.CouponID = @CouponID;

            SET @Repaired += 1;
        END

        FETCH NEXT FROM cur INTO @Mode, @ListNo, @GoodID, @Qty, @CouponID;
    END

    CLOSE cur;
    DEALLOCATE cur;

    -- ตั้งธงเมื่อครบจริงเท่านั้น: ทุกบรรทัดมีแถวตั๋ว และทุกแถวตั๋วมีเลข
    IF NOT EXISTS (SELECT 1 FROM dbo.SODT d
                   WHERE d.SOID = @SoId AND ISNULL(d.GoodQty2, 0) > 0
                     AND NOT EXISTS (SELECT 1 FROM dbo.WFCoupon c
                                     WHERE c.DocuID = @SoId AND c.RefListno = d.ListNo))
       AND NOT EXISTS (SELECT 1 FROM dbo.WFCoupon c
                       WHERE c.DocuID = @SoId AND c.CouponNo IS NULL)
        UPDATE dbo.SOHD SET CouponFlag = 'Y' WHERE SOID = @SoId AND ISNULL(CouponFlag, 'N') <> 'Y';
END
GO

-- ใบส่งขายที่ตั๋วปุ๋ยไม่ครบ · ใบพวกนี้จะไปต่อ ตัดตั๋วปุ๋ย → Post Invoice (WF) ไม่ได้
-- และแก้ใน WINSpeed ไม่ได้แล้วเพราะเอกสารบันทึกแล้วเป็น read-only
CREATE OR ALTER VIEW wf.v_DeliveryCouponGaps
AS
SELECT
    h.SOID,
    RTRIM(h.DocuNo)  AS DocuNo,
    h.DocuDate,
    h.BrchID,
    h.CustID,
    RTRIM(h.CustName) AS CustName,
    h.CouponFlag,
    (SELECT COUNT(*) FROM dbo.SODT d
      WHERE d.SOID = h.SOID AND ISNULL(d.GoodQty2, 0) > 0)              AS LineCount,
    (SELECT COUNT(*) FROM dbo.WFCoupon c WHERE c.DocuID = h.SOID)       AS CouponRows,
    (SELECT COUNT(*) FROM dbo.WFCoupon c
      WHERE c.DocuID = h.SOID AND c.CouponNo IS NULL)                   AS MissingCouponNo,
    CASE
        WHEN NOT EXISTS (SELECT 1 FROM dbo.WFCoupon c WHERE c.DocuID = h.SOID)
             THEN N'ไม่มีแถวตั๋วเลย'
        WHEN EXISTS (SELECT 1 FROM dbo.WFCoupon c
                     WHERE c.DocuID = h.SOID AND c.CouponNo IS NULL)
             THEN N'มีแถวตั๋วแต่ไม่มีเลข'
        ELSE N'บรรทัดสินค้าไม่ครบทุกใบตั๋ว'
    END AS Gap
FROM dbo.SOHD h
WHERE h.DocuType = '104'
  AND EXISTS (SELECT 1 FROM dbo.SODT d WHERE d.SOID = h.SOID AND ISNULL(d.GoodQty2, 0) > 0)
  AND (
        ISNULL(h.CouponFlag, 'N') <> 'Y'
     OR EXISTS (SELECT 1 FROM dbo.WFCoupon c WHERE c.DocuID = h.SOID AND c.CouponNo IS NULL)
     OR EXISTS (SELECT 1 FROM dbo.SODT d
                WHERE d.SOID = h.SOID AND ISNULL(d.GoodQty2, 0) > 0
                  AND NOT EXISTS (SELECT 1 FROM dbo.WFCoupon c
                                  WHERE c.DocuID = h.SOID AND c.RefListno = d.ListNo))
      );
GO
