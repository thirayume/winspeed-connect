-- =============================================================
-- 093_traceability_gaps.sql
--
-- ปิดช่องว่างการตามรอย 3 ข้อที่ยังไม่ผ่านเกณฑ์ใน DOCUMENT-FLOW-QA-GUIDE
--   AC-10  RB ไม่มีตัวนับเลขในระบบ       → เฝ้าระวังเลขซ้ำ/เลขข้าม + แนะเลขถัดไป
--   AC-12  ตั๋วคุม 103 → 104 ไม่มีลิงก์     → เขียนเลขลง WINSpeed แบบอ่านได้ทั้งคนและเครื่อง
--   AC-13  ใบส่งของทางตัน (CouponFlag='N') → ตรวจจับทันทีแทนที่จะเงียบ
--
-- ขอบเขตที่ยึด
--   * เขียนลง dbo เฉพาะ dbo.SOHDRemark ซึ่ง sp_ConfirmSalesOrder เขียนอยู่แล้ว (ListNo 1,2,4+)
--     migration นี้ใช้ ListNo 3 ที่ว่างอยู่ — ไม่แตะโครงสร้าง dbo ใด ๆ
--   * ไม่แตะ dbo.EMRunBrch, dbo.SMForm และไม่เพิ่มคอลัมน์ใน dbo
--   * object ทั้งหมดอยู่ใน schema wf และอ่าน dbo อย่างเดียว (ยกเว้น SOHDRemark ข้างต้น)
--
-- สถานะการทดสอบ (22/08/2569 · อ่านอย่างเดียวบน remote 20.255.185.14)
--   ตรรกะของทุก view/proc รันผ่านบนข้อมูลจริงแล้ว พร้อมเวลาที่วัดได้
--   **ยังไม่ได้ apply migration** — ต้องให้เจ้าของระบบสั่งรัน `node run_migrations.js`
-- =============================================================


-- =============================================================
-- ส่วนที่ 1 — AC-12: เขียนเลขตั๋วคุมลง WINSpeed
--
-- ที่มา
--   แอปเก็บเลขตั๋วคุมไว้แล้วที่ wf.SalesOrder.ControlTicketNo (หัวใบ) และ
--   wf.SalesOrderLine.RefControlTicketNo (รายบรรทัด) แต่ sp_ConfirmSalesOrder
--   *อ่านค่ามาแล้วไม่เคยเขียนลง dbo* ค่าจึงค้างอยู่ฝั่งแอปเท่านั้น
--   คนที่เปิดดูใบใน WINSpeed มองไม่เห็นว่าใบนี้เบิกจากตั๋วคุมใบไหน
--
--   วัดจริง 22/08/2569 (กรอบ ม.ค.–มี.ค. 2569 · ใบ 104 ทั้งหมด 2,265 ใบ)
--     Remark ที่มีเลขเอกสารให้ parse ได้   **0 ใบ**
--     Remark ที่เขียนแค่คำว่า "ตั๋วคุม"        283 ใบ
--     Remark ที่พูดถึงการตัด/เบิก             85 ใบ
--   แปลว่าการกู้ข้อมูลย้อนหลังจากข้อความ **ทำไม่ได้** เพราะไม่มีเลขให้ parse
--   ทางเดียวคือดักตั้งแต่ตอนสร้างใบใหม่
--
-- รูปแบบที่เลือก:  [ตั๋วคุม] I69-01141
--   วงเล็บเหลี่ยมตรงกับรูปแบบเดิมที่ proc ใช้อยู่ ([ต้องการ Pre-Sling], [รถลูกค้า])
--   คนอ่านออกทันทีในแท็บ Description ของ WINSpeed
--   เครื่อง parse ได้ด้วย pattern เดียว ไม่ต้องเดา
-- =============================================================

/*
 * เติมบรรทัดตั๋วคุมที่ ListNo 3
 *
 * ListNo ที่ proc ใช้อยู่: 1 = ธงโลจิสติกส์ · 2 = ลำดับการขึ้นของ · 4+ = ของแถม
 * (ของแถมใช้ ROW_NUMBER() + 3 จึงเริ่มที่ 4) — **ListNo 3 ว่างมาตลอด**
 * เลือกใช้ช่องนี้เพื่อไม่ต้องขยับเลขบรรทัดเดิมซึ่งจะทำให้ใบเก่ากับใบใหม่ไม่เหมือนกัน
 */
CREATE OR ALTER PROCEDURE wf.usp_WriteControlTicketRemark
    @NewSoid         VARCHAR(50),
    @SoId            INT,
    @ControlTicketNo NVARCHAR(20)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Line NVARCHAR(500) = NULL;

    -- เลขระดับหัวใบมาก่อน ถ้าไม่มีค่อยรวบเลขจากรายบรรทัด
    IF NULLIF(LTRIM(RTRIM(ISNULL(@ControlTicketNo, ''))), '') IS NOT NULL
        SET @Line = N'[ตั๋วคุม] ' + LTRIM(RTRIM(@ControlTicketNo));
    ELSE
    BEGIN
        -- บางใบผูกตั๋วคุมรายบรรทัด (เบิกหลายตั๋วในใบเดียว) รวมเป็นรายการเดียวคั่นด้วยจุลภาค
        SELECT @Line = N'[ตั๋วคุม] ' + STUFF((
            SELECT DISTINCT N', ' + LTRIM(RTRIM(sol.RefControlTicketNo))
            FROM   wf.SalesOrderLine sol
            WHERE  sol.SoId = @SoId
              AND  NULLIF(LTRIM(RTRIM(ISNULL(sol.RefControlTicketNo, ''))), '') IS NOT NULL
            FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 2, '')
        WHERE EXISTS (
            SELECT 1 FROM wf.SalesOrderLine sol
            WHERE sol.SoId = @SoId
              AND NULLIF(LTRIM(RTRIM(ISNULL(sol.RefControlTicketNo, ''))), '') IS NOT NULL);
    END

    IF @Line IS NULL RETURN;                       -- ใบนี้ไม่ได้เบิกจากตั๋วคุม ไม่ต้องเขียนอะไร

    -- กันเขียนซ้ำหากมีการเรียกซ้ำ
    IF EXISTS (SELECT 1 FROM dbo.SOHDRemark WHERE SOID = @NewSoid AND ListNo = 3)
        UPDATE dbo.SOHDRemark SET Remark = LEFT(@Line, 500) WHERE SOID = @NewSoid AND ListNo = 3;
    ELSE
        INSERT INTO dbo.SOHDRemark (SOID, ListNo, Remark) VALUES (@NewSoid, 3, LEFT(@Line, 500));
END
GO


/*
 * มุมมองการเบิกตั๋วคุม — อ่านได้ทั้งใบที่แอปสร้าง (มี ControlTicketNo)
 * และใบเก่าที่มีแต่ข้อความ (best-effort)
 *
 * ตั้งใจให้ MatchType บอกชัดว่าแถวนั้นเชื่อถือได้แค่ไหน ไม่กลบความต่าง:
 *   EXACT  = แอปบันทึกเลขไว้ ตรงไปตรงมา
 *   PARSED = ดึงจากข้อความรูปแบบ [ตั๋วคุม] ที่ proc เขียน
 *   TEXT   = ใบเก่าที่เขียนคำว่า "ตั๋วคุม" ลอย ๆ ไม่มีเลข — ตามต่อไม่ได้
 */
CREATE OR ALTER VIEW wf.v_ControlTicketDrawdown
AS
SELECT
    h.SOID                                   AS DeliverySOID,
    RTRIM(h.DocuNo)                          AS DeliveryDocuNo,
    CAST(h.DocuDate AS DATE)                 AS DeliveryDate,
    RTRIM(h.CustID)                          AS CustId,
    RTRIM(h.CustName)                        AS CustName,
    ext.ControlTicketNo                      AS ControlTicketNo_App,
    ctr.ParsedNo                             AS ControlTicketNo_Parsed,
    COALESCE(ext.ControlTicketNo, ctr.ParsedNo) AS ControlTicketNo,
    CASE WHEN ext.ControlTicketNo IS NOT NULL THEN 'EXACT'
         WHEN ctr.ParsedNo        IS NOT NULL THEN 'PARSED'
         WHEN txt.HasText         = 1         THEN 'TEXT'
         ELSE NULL END                       AS MatchType,
    tons.QtyTon                              AS DrawnTon,
    h.NetAmnt                                AS DrawnAmount
FROM dbo.SOHD h
LEFT JOIN wf.SalesOrderExt ext ON ext.SOID = h.SOID
OUTER APPLY (
    -- ดึงเลขจากบรรทัด [ตั๋วคุม] ที่ ListNo 3 เท่านั้น — ไม่เดาจากบรรทัดอื่น
    SELECT TOP 1 LTRIM(RTRIM(REPLACE(r.Remark, N'[ตั๋วคุม]', ''))) AS ParsedNo
    FROM   dbo.SOHDRemark r
    WHERE  r.SOID = h.SOID AND r.ListNo = 3 AND r.Remark LIKE N'[[]ตั๋วคุม]%'
) ctr
OUTER APPLY (
    SELECT CAST(1 AS BIT) AS HasText
    WHERE EXISTS (SELECT 1 FROM dbo.SOHDRemark r2
                  WHERE r2.SOID = h.SOID AND r2.Remark LIKE N'%ตั๋วคุม%')
) txt
OUTER APPLY (
    SELECT SUM(d.GoodQty2) AS QtyTon FROM dbo.SODT d WHERE d.SOID = h.SOID
) tons
WHERE h.DocuType = '104';
GO


/*
 * ยอดคงเหลือของตั๋วคุมแต่ละใบ
 *
 * จับคู่ได้เฉพาะใบที่มีเลข (EXACT/PARSED) — ใบที่เป็น TEXT จะไม่ถูกนับ
 * และรายงานจำนวนใบที่ตามไม่ได้ไว้ในคอลัมน์แยก เพื่อไม่ให้ยอดคงเหลือดูดีเกินจริง
 */
CREATE OR ALTER VIEW wf.v_ControlTicketBalance
AS
SELECT
    b.SOID                                   AS BookingSOID,
    RTRIM(b.DocuNo)                          AS BookingDocuNo,
    CAST(b.DocuDate AS DATE)                 AS BookingDate,
    RTRIM(b.CustID)                          AS CustId,
    RTRIM(b.CustName)                        AS CustName,
    RTRIM(b.AppvDocuNo)                      AS AppvDocuNo,
    bk.TonBooked,
    ISNULL(dw.TonDrawn, 0)                   AS TonDrawn,
    bk.TonBooked - ISNULL(dw.TonDrawn, 0)    AS TonRemaining,
    ISNULL(dw.DeliveryCount, 0)              AS DeliveryCount,
    -- จำนวนใบส่งของของลูกค้ารายนี้ที่พูดถึงตั๋วคุมแต่ไม่มีเลข → ตามไม่ได้
    ISNULL(un.UntraceableCount, 0)           AS UntraceableDeliveries
FROM dbo.SOHD b
OUTER APPLY (SELECT SUM(d.GoodQty2) AS TonBooked FROM dbo.SODT d WHERE d.SOID = b.SOID) bk
OUTER APPLY (
    SELECT SUM(v.DrawnTon) AS TonDrawn, COUNT(*) AS DeliveryCount
    FROM   wf.v_ControlTicketDrawdown v
    WHERE  v.ControlTicketNo = RTRIM(b.DocuNo)
      AND  v.MatchType IN ('EXACT', 'PARSED')
) dw
OUTER APPLY (
    SELECT COUNT(*) AS UntraceableCount
    FROM   wf.v_ControlTicketDrawdown v2
    WHERE  v2.MatchType = 'TEXT' AND v2.CustId = RTRIM(b.CustID)
      AND  v2.DeliveryDate >= CAST(b.DocuDate AS DATE)
) un
WHERE b.DocuType = '103'
  AND RTRIM(b.TransRegistration) = N'ตั๋วคุม';
GO


-- =============================================================
-- ส่วนที่ 2 — AC-10: เฝ้าระวังเลขเอกสาร RB
--
-- ที่มา
--   RB ไม่มีตัวนับใน dbo.EMRunBrch — ตารางนั้นมี 1 แถวต่อ RunCode (203 แถว, BrchID=1 ทั้งหมด)
--   และ RunCode '106' ถูกสาย RD ใช้ไปแล้ว (RunFormat = 'RDyy-00000')
--   จึง **ใส่ตัวนับ RB เพิ่มไม่ได้** โดยไม่ทับสาย RD ซึ่งจะพังของเดิม
--   ผู้ใช้พิมพ์เลข RB เองทั้งหมด (16,195 ใบตั้งแต่ปี 2556)
--
--   วัดจริง 22/08/2569 — ผลออกมาดีกว่าที่คาด
--     เลขซ้ำ      **0 ใบ** (ทุกปี)
--     เลขข้าม     **0 เลข** ทั้ง 8 ชุดในปี 69 (A,B,D,O,P,S,T,Y เรียง 1..N ต่อเนื่อง)
--   วินัยการคีย์มือทำงานได้ดีมาตลอด 13 ปี ความเสี่ยงจึงเป็นเชิงทฤษฎี
--   ทางแก้ที่เหมาะสมคือ "เฝ้าระวัง" ไม่ใช่ไปยัดตัวนับที่ WINSpeed รองรับไม่ได้
-- =============================================================

/*
 * ความสมบูรณ์ของเลข RB แยกตามชุดอักษร/ปี
 *
 * ให้ 3 ตัวเลขที่ตอบคำถามต่างกัน อย่ารวมเป็นตัวเดียว:
 *   DuplicateCount = เลขซ้ำ (ร้ายแรงที่สุด — เอกสารสองใบเลขเดียวกัน)
 *   MissingCount   = เลขข้ามในช่วงที่ใช้ไปแล้ว (อาจเป็นใบที่ถูกลบ หรือคีย์ข้าม)
 *   NextSuggested  = เลขถัดไปที่ควรใช้ (ไว้ให้คนคีย์ใช้แทนการเดา)
 */
CREATE OR ALTER VIEW wf.v_RbNumberIntegrity
AS
WITH parsed AS (
    SELECT
        SUBSTRING(RTRIM(h.DocuNo), 3, 1)                       AS SeriesLetter,
        SUBSTRING(RTRIM(h.DocuNo), 4, 2)                       AS YearBE,
        TRY_CAST(SUBSTRING(RTRIM(h.DocuNo), 7, 10) AS INT)     AS Seq,
        RTRIM(h.DocuNo)                                        AS DocuNo
    FROM dbo.ARReceHD h
    WHERE RTRIM(h.DocuNo) LIKE 'RB[A-Z][0-9][0-9]-%'
      AND RTRIM(h.DocuNo) NOT LIKE '%TEST%'
)
SELECT
    SeriesLetter,
    YearBE,
    COUNT(*)                                   AS IssuedCount,
    COUNT(DISTINCT DocuNo)                     AS DistinctCount,
    COUNT(*) - COUNT(DISTINCT DocuNo)          AS DuplicateCount,
    MIN(Seq)                                   AS FirstSeq,
    MAX(Seq)                                   AS LastSeq,
    (MAX(Seq) - MIN(Seq) + 1) - COUNT(DISTINCT Seq) AS MissingCount,
    'RB' + SeriesLetter + YearBE + '-'
        + RIGHT('000' + CAST(MAX(Seq) + 1 AS VARCHAR(10)), 3) AS NextSuggested
FROM parsed
WHERE Seq IS NOT NULL
GROUP BY SeriesLetter, YearBE;
GO


/*
 * รายชื่อเลขที่หายไปจริง ๆ (ไม่ใช่แค่จำนวน) เพื่อให้บัญชีตรวจได้ว่าเป็นใบที่ยกเลิกหรือคีย์ตก
 * ใช้ตาราง sys.all_objects เป็นตัวสร้างลำดับ — ไม่ต้องสร้างตารางตัวเลขใหม่
 */
CREATE OR ALTER VIEW wf.v_RbMissingNumbers
AS
WITH parsed AS (
    SELECT SUBSTRING(RTRIM(DocuNo), 3, 1) AS SeriesLetter,
           SUBSTRING(RTRIM(DocuNo), 4, 2) AS YearBE,
           TRY_CAST(SUBSTRING(RTRIM(DocuNo), 7, 10) AS INT) AS Seq
    FROM   dbo.ARReceHD
    WHERE  RTRIM(DocuNo) LIKE 'RB[A-Z][0-9][0-9]-%' AND RTRIM(DocuNo) NOT LIKE '%TEST%'
),
bounds AS (
    SELECT SeriesLetter, YearBE, MIN(Seq) AS Lo, MAX(Seq) AS Hi
    FROM parsed WHERE Seq IS NOT NULL GROUP BY SeriesLetter, YearBE
),
nums AS (
    SELECT TOP 2000 ROW_NUMBER() OVER (ORDER BY (SELECT 1)) AS v FROM sys.all_objects
)
SELECT b.SeriesLetter, b.YearBE, n.v AS MissingSeq,
       'RB' + b.SeriesLetter + b.YearBE + '-' + RIGHT('000' + CAST(n.v AS VARCHAR(10)), 3) AS MissingDocuNo
FROM bounds b
JOIN nums n ON n.v BETWEEN b.Lo AND b.Hi
WHERE NOT EXISTS (
    SELECT 1 FROM parsed p
    WHERE p.SeriesLetter = b.SeriesLetter AND p.YearBE = b.YearBE AND p.Seq = n.v);
GO


/*
 * ยอดคงเหลือของวงเงินรีเบทแต่ละใบ (จาก dbo.SOAdvnList ที่เป็นตารางเชื่อมจริง)
 *
 * ทำเป็น view เพราะเดิมไม่มีรายงานนี้ ต้องไล่ดูทีละใบบนหน้าจอ
 * สถานะสอดคล้องกับคอลัมน์ Recept บนหน้าจอ "รับเงินมัดจำ" (Full / Partial / ว่าง)
 */
CREATE OR ALTER VIEW wf.v_RbBalance
AS
SELECT
    RTRIM(h.DocuNo)                          AS RbDocuNo,
    CAST(h.DocuDate AS DATE)                 AS RbDate,
    SUBSTRING(RTRIM(h.DocuNo), 3, 1)         AS SeriesLetter,
    RTRIM(h.CustID)                          AS CustId,
    RTRIM(cu.CustCode)                       AS CustCode,
    RTRIM(cu.CustName)                       AS CustName,
    h.ReceAmnt                               AS ApprovedAmount,
    ISNULL(d.DrawnAmount, 0)                 AS DrawnAmount,
    h.ReceAmnt - ISNULL(d.DrawnAmount, 0)    AS RemainingAmount,
    ISNULL(d.DrawCount, 0)                   AS DrawCount,
    d.LastDrawDate,
    CASE WHEN d.DrawnAmount IS NULL              THEN N'ยังไม่เบิก'
         WHEN d.DrawnAmount >= h.ReceAmnt - 0.01 THEN N'เบิกครบ'
         ELSE N'เบิกบางส่วน' END              AS DrawStatus
FROM dbo.ARReceHD h
LEFT JOIN dbo.EMCust cu ON cu.CustID = h.CustID
OUTER APPLY (
    SELECT SUM(al.CutAdvnAmnt) AS DrawnAmount,
           COUNT(*)            AS DrawCount,
           MAX(CAST(r.DocuDate AS DATE)) AS LastDrawDate
    FROM   dbo.SOAdvnList al
    JOIN   dbo.ARReceHD r ON r.ARReceID = al.ARReceID
    WHERE  RTRIM(al.AdvnNo) = RTRIM(h.DocuNo)
) d
WHERE RTRIM(h.DocuNo) LIKE 'RB%'
  AND h.DocuType = '106';
GO


-- =============================================================
-- ส่วนที่ 3 — AC-13: ตรวจจับใบส่งของ (104) ที่เป็นทางตัน
--
-- ที่มา
--   สาเหตุที่ CouponFlag เป็น 'N' ยังหาไม่พบ (ต้องเทียบ build/.pbl กับเครื่องผลิต
--   หรือส่ง Prosoft) — migration นี้ **ไม่ได้แก้สาเหตุ**
--   แต่ทำให้ "รู้ตัวทันที" แทนที่จะปล่อยให้ใบทางตันนอนเงียบจนไปเจอตอนวางบิล
--
--   นิยามใบทางตัน (เข้าเงื่อนไขข้อใดข้อหนึ่ง)
--     CouponFlag <> 'Y'  ·  ไม่มีคูปอง  ·  คูปองไม่มีเลข  ·  ไม่มีใบกำกับ 202
--
--   วัดจริง 22/08/2569
--     กรอบที่เชื่อถือได้ ม.ค.–มี.ค. 2569  →  **0 ใบ** (ใบ 104 ทั้ง 2,265 ใบสมบูรณ์)  [456ms]
--     ช่วง ส.ค. 2569 (ช่วงที่ทดสอบระบบ)   →  **7 ใบ** ทุกใบเป็น CouponFlag='N'      [774ms]
--       K69-01850 · K69-01851 · K69-01852 · K69-01853 · K69-01854 · K69-01855 · K69-01856
--       ทุกใบมีคูปองแต่ **ไม่มีเลขสักใบ** และไม่มีใบกำกับ 202
--       (เดิมทีมงานทราบแค่ 2 ใบ — proc นี้เจอเพิ่มอีก 5 ใบที่ตกสำรวจ)
-- =============================================================

/*
 * ทำเป็น stored procedure ไม่ใช่ view — เพราะต้องกรองวันที่ *ก่อน* ไปแตะ WFCoupon
 *
 * ทางที่ลองแล้วไม่ผ่าน (บันทึกไว้กันคนถัดไปลองซ้ำ)
 *   ครั้งที่ 1  view + OUTER APPLY บนใบ 104 ทั้งหมด → **query timeout**
 *               (ใบ 104 ในระบบมี 61,855 ใบ · ตาราง WFCoupon 111k+ แถว)
 *   ครั้งที่ 2  view แบบ set-based แล้วให้ผู้เรียกกรองวันที่จากข้างนอก → **ยัง timeout**
 *               เพราะ subquery GROUP BY ทั้ง WFCoupon ถูก materialize ก่อนกรอง
 *   ครั้งที่ 3  view + INNER JOIN wf.SalesOrderExt (คิดว่าใบจากแอปมีน้อย) → **เร็ว แต่ผิด**
 *               wf.SalesOrderExt เก็บ **ใบ 103 (ใบสั่งจอง)** ที่แอปสร้าง ไม่ใช่ใบ 104
 *               ใบ 104 เกิดทีหลังโดยคนคีย์ใน WINSpeed จึงไม่มีแถวใน wf เลย
 *               พิสูจน์: ใบทางตันจริง K69-01854/K69-01855 (SOID 275004/275005)
 *               มี CouponFlag='N' และไม่มีแถวใน wf.SalesOrderExt → view จับไม่ได้ (คืน 0 แถว)
 *
 * บทเรียน: "ใบที่แอปสร้าง" ≠ "ใบ 104" — อย่าใช้ wf.SalesOrderExt เป็นตัวกรองของใบส่งของ
 */
CREATE OR ALTER PROCEDURE wf.usp_FindDeadEndDeliveries
    @From DATE,
    @To   DATE            -- ไม่รวมวันสุดท้าย (ใช้ < @To)
AS
BEGIN
    SET NOCOUNT ON;

    -- ดึงใบ 104 ในช่วงก่อน แล้วค่อย join ตารางใหญ่ — กันไม่ให้ WFCoupon ถูกอ่านทั้งตาราง
    SELECT
        h.SOID,
        RTRIM(h.DocuNo)                  AS DocuNo,
        CAST(h.DocuDate AS DATE)         AS DocuDate,
        RTRIM(h.CustName)                AS CustName,
        h.NetAmnt,
        h.CouponFlag,
        ISNULL(c.CouponCount, 0)         AS CouponCount,
        ISNULL(c.NumberedCoupons, 0)     AS NumberedCoupons,
        CASE WHEN inv.SOInvID IS NULL THEN 0 ELSE 1 END AS HasTaxInvoice,
        CASE
            WHEN h.CouponFlag <> 'Y'              THEN N'CouponFlag ไม่ใช่ Y'
            WHEN ISNULL(c.CouponCount, 0) = 0     THEN N'ไม่มีคูปอง'
            WHEN ISNULL(c.NumberedCoupons, 0) = 0 THEN N'คูปองไม่มีเลข'
            WHEN inv.SOInvID IS NULL              THEN N'ไม่มีใบกำกับ 202'
        END                              AS Problem
    FROM      dbo.SOHD h
    LEFT JOIN dbo.SOInvHD inv
           ON RTRIM(inv.DocuNo) = RTRIM(h.DocuNo) AND inv.Docutype = '202'
    OUTER APPLY (
        SELECT COUNT(*) AS CouponCount,
               SUM(CASE WHEN NULLIF(LTRIM(RTRIM(ISNULL(w.CouponNo, ''))), '') IS NOT NULL
                        THEN 1 ELSE 0 END) AS NumberedCoupons
        FROM   dbo.WFCoupon w WHERE w.DocuID = h.SOID
    ) c
    WHERE h.DocuType = '104'
      AND h.DocuDate >= @From AND h.DocuDate < @To
      AND (h.CouponFlag <> 'Y'
           OR ISNULL(c.CouponCount, 0) = 0
           OR ISNULL(c.NumberedCoupons, 0) = 0
           OR inv.SOInvID IS NULL)
    ORDER BY h.DocuDate DESC, h.SOID DESC;
END
GO


-- =============================================================
-- ส่วนที่ 4 — มุมมองรวมสำหรับหน้า QA / preflight
-- คืนหนึ่งแถวต่อเกณฑ์ พร้อมค่าที่วัดได้จริง เพื่อให้เทียบกับเอกสารได้ตรง ๆ
-- =============================================================
CREATE OR ALTER VIEW wf.v_TraceabilityHealth
AS
SELECT 'AC-10a' AS Code, N'เลข RB ซ้ำ' AS Metric,
       CAST(ISNULL(SUM(DuplicateCount), 0) AS INT) AS Value, 0 AS Threshold,
       CASE WHEN ISNULL(SUM(DuplicateCount), 0) = 0 THEN 'PASS' ELSE 'FAIL' END AS Status
FROM wf.v_RbNumberIntegrity
UNION ALL
SELECT 'AC-10b', N'เลข RB ข้าม',
       CAST(ISNULL(SUM(MissingCount), 0) AS INT), 0,
       CASE WHEN ISNULL(SUM(MissingCount), 0) = 0 THEN 'PASS' ELSE 'WARN' END
FROM wf.v_RbNumberIntegrity
UNION ALL
SELECT 'AC-11', N'ใบ RB ที่เบิกเกินวงเงิน',
       CAST(COUNT(*) AS INT), 0,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM (SELECT RTRIM(AdvnNo) AS n FROM dbo.SOAdvnList
      WHERE RTRIM(AdvnNo) LIKE 'RB%'
      GROUP BY RTRIM(AdvnNo)
      HAVING SUM(CutAdvnAmnt) > MAX(AdvnTotaAmnt) + 0.01) x
UNION ALL
-- จำกัด 90 วันล่าสุดของข้อมูล ไม่ใช่ทั้งระบบ — ใบ 104 มี 61,855 ใบ ถ้าไม่กรองจะช้ามาก
SELECT 'AC-12', N'ใบส่งของที่อ้างตั๋วคุมแบบไม่มีเลข (90 วันล่าสุด)',
       CAST(COUNT(*) AS INT), 0,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'WARN' END
FROM (
    SELECT 1 AS x
    FROM   dbo.SOHD h
    WHERE  h.DocuType = '104'
      AND  h.DocuDate >= DATEADD(day, -90, (SELECT MAX(DocuDate) FROM dbo.SOHD WHERE DocuType = '104'))
      AND  EXISTS (SELECT 1 FROM dbo.SOHDRemark r
                   WHERE r.SOID = h.SOID AND r.Remark LIKE N'%ตั๋วคุม%')
      AND  NOT EXISTS (SELECT 1 FROM dbo.SOHDRemark r3
                       WHERE r3.SOID = h.SOID AND r3.ListNo = 3 AND r3.Remark LIKE N'[[]ตั๋วคุม]%')
      AND  NOT EXISTS (SELECT 1 FROM wf.SalesOrderExt e
                       WHERE e.SOID = h.SOID AND e.ControlTicketNo IS NOT NULL)
) t12
UNION ALL
-- ใช้เงื่อนไขเดียวกับ usp_FindDeadEndDeliveries แต่จำกัด 90 วันล่าสุดของข้อมูล
-- (view เรียก proc ไม่ได้ จึงต้องเขียนซ้ำ — ถ้าแก้เงื่อนไข ต้องแก้ทั้งสองที่)
SELECT 'AC-13', N'ใบส่งของทางตัน (90 วันล่าสุด)',
       CAST(COUNT(*) AS INT), 0,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM (
    SELECT h.SOID
    FROM   dbo.SOHD h
    LEFT   JOIN dbo.SOInvHD inv
           ON RTRIM(inv.DocuNo) = RTRIM(h.DocuNo) AND inv.Docutype = '202'
    OUTER  APPLY (
        SELECT COUNT(*) AS CouponCount,
               SUM(CASE WHEN NULLIF(LTRIM(RTRIM(ISNULL(w.CouponNo, ''))), '') IS NOT NULL
                        THEN 1 ELSE 0 END) AS NumberedCoupons
        FROM   dbo.WFCoupon w WHERE w.DocuID = h.SOID
    ) c
    WHERE  h.DocuType = '104'
      AND  h.DocuDate >= DATEADD(day, -90, (SELECT MAX(DocuDate) FROM dbo.SOHD WHERE DocuType = '104'))
      AND  (h.CouponFlag <> 'Y'
            OR ISNULL(c.CouponCount, 0) = 0
            OR ISNULL(c.NumberedCoupons, 0) = 0
            OR inv.SOInvID IS NULL)
) t13;
GO


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

        -- เขียนเลขตั๋วคุมลง dbo.SOHDRemark (ListNo 3) ให้ WINSpeed มองเห็น
        -- ต้องเรียกก่อน DELETE wf.SalesOrderLine ด้านล่าง เพราะ helper อ่านตารางนั้น
        -- เหตุผลเต็มอยู่หัวไฟล์ migration 093
        EXEC wf.usp_WriteControlTicketRemark
             @NewSoid = @NewSoid, @SoId = @SoId, @ControlTicketNo = @ControlTicketNo;

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
