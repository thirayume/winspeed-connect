--## Query ตั๋วคุม — พร้อม Filter (แก้ syntax + เพิ่ม parameters)

-- ============================================================
-- ตั๋วคุม: แยก "รอชั่ง" (ยังค้าง) และ "เสร็จสิ้น" 100 แรกจากเก่าสุด
-- ------------------------------------------------------------
-- FILTER ที่ปรับได้ (ใส่ NULL = ไม่ filter):
--   @DateFrom        วันที่จองตั้งแต่  เช่น '2024-01-01'
--   @DateTo          วันที่จองถึง      เช่น '2024-12-31'
--   @CustName        ชื่อลูกค้า (ค้นแบบ LIKE) เช่น N'สหกรณ์'
--   @TransReg        ทะเบียนรถ (ค้นแบบ LIKE)  เช่น '70-1087'
--   @AppvDocuNo      เลขตั๋วคุม (ค้นตรง)       เช่น 'AI68-00123'
-- ============================================================

DECLARE @DateFrom   DATE         = NULL   -- เช่น '2024-01-01'
DECLARE @DateTo     DATE         = NULL   -- เช่น '2024-12-31'
DECLARE @CustName   NVARCHAR(100)= NULL   -- เช่น N'สหกรณ์'
DECLARE @TransReg   NVARCHAR(50) = NULL   -- เช่น '70-1087'
DECLARE @AppvDocuNo VARCHAR(30)  = NULL   -- เช่น 'AI68-00123'

-- ── รอชั่ง (ยังค้าง) ──────────────────────────────────────
SELECT * FROM (
    SELECT TOP 100
        N'รอชั่ง'                                   AS สถานะ,
        h.DocuNo                                    AS เลขใบจอง,
        CAST(NULL AS VARCHAR(30))                   AS เลขตั๋วคุม,
        CONVERT(DATE, h.DocuDate)                   AS วันที่จอง,
        CAST(NULL AS DATE)                          AS วันที่อนุมัติ,
        c.CustName                                  AS ลูกค้า,
        COALESCE(h.TransRegistration,
                 (SELECT r.Remark FROM dbo.SOHDRemark r
                  WHERE r.SOID = h.SOID AND r.ListNo = 1))
                                                    AS ทะเบียนรถ,
        h.Desc1                                     AS รายละเอียด1,
        h.Desc2                                     AS รายละเอียด2,
        h.NetAmnt                                   AS ยอดสุทธิ
    FROM  dbo.SOHD h
    JOIN  dbo.EMCust c ON c.CustID = h.CustID
    WHERE h.DocuType   = 103
      AND h.AppvFlag   = 'W'
      AND h.DocuStatus = 'Y'
      AND (@DateFrom   IS NULL OR CONVERT(DATE, h.DocuDate) >= @DateFrom)
      AND (@DateTo     IS NULL OR CONVERT(DATE, h.DocuDate) <= @DateTo)
      AND (@CustName   IS NULL OR c.CustName LIKE N'%' + @CustName + N'%')
      AND (@TransReg   IS NULL OR h.TransRegistration LIKE '%' + @TransReg + '%'
           OR EXISTS (SELECT 1 FROM dbo.SOHDRemark r
                      WHERE r.SOID = h.SOID AND r.ListNo = 1
                        AND r.Remark LIKE '%' + @TransReg + '%'))
    ORDER BY h.DocuDate ASC
) AS pending

UNION ALL

-- ── เสร็จสิ้น (อนุมัติแล้ว มีเลขตั๋วคุม AI) ────────────────
SELECT * FROM (
    SELECT TOP 100
        N'เสร็จสิ้น'                                AS สถานะ,
        h.DocuNo                                    AS เลขใบจอง,
        h.AppvDocuNo                                AS เลขตั๋วคุม,
        CONVERT(DATE, h.DocuDate)                   AS วันที่จอง,
        CONVERT(DATE, h.AppvDate)                   AS วันที่อนุมัติ,
        c.CustName                                  AS ลูกค้า,
        COALESCE(h.TransRegistration,
                 (SELECT r.Remark FROM dbo.SOHDRemark r
                  WHERE r.SOID = h.SOID AND r.ListNo = 1))
                                                    AS ทะเบียนรถ,
        h.Desc1                                     AS รายละเอียด1,
        h.Desc2                                     AS รายละเอียด2,
        h.NetAmnt                                   AS ยอดสุทธิ
    FROM  dbo.SOHD h
    JOIN  dbo.EMCust c ON c.CustID = h.CustID
    WHERE h.DocuType   = 103
      AND h.AppvFlag   = 'Y'
      AND h.DocuStatus = 'Y'
      AND (@DateFrom   IS NULL OR CONVERT(DATE, h.DocuDate) >= @DateFrom)
      AND (@DateTo     IS NULL OR CONVERT(DATE, h.DocuDate) <= @DateTo)
      AND (@CustName   IS NULL OR c.CustName LIKE N'%' + @CustName + N'%')
      AND (@TransReg   IS NULL OR h.TransRegistration LIKE '%' + @TransReg + '%'
           OR EXISTS (SELECT 1 FROM dbo.SOHDRemark r
                      WHERE r.SOID = h.SOID AND r.ListNo = 1
                        AND r.Remark LIKE '%' + @TransReg + '%'))
      AND (@AppvDocuNo IS NULL OR h.AppvDocuNo = @AppvDocuNo)
    ORDER BY h.DocuDate ASC
) AS done

ORDER BY สถานะ DESC, วันที่จอง ASC;
-- DESC ทำให้ "รอชั่ง" ขึ้นก่อน "เสร็จสิ้น" (ร > ส ตาม Thai sort)
-- ถ้าต้องการสลับ ให้เปลี่ยนเป็น ASC

--### วิธีใช้ Filter

--| ต้องการกรอง | ตั้งค่า |
--|---|---|
--| เฉพาะปี 2567 | `@DateFrom = '2024-01-01'`, `@DateTo = '2024-12-31'` |
--| เฉพาะลูกค้า "สหกรณ์" | `@CustName = N'สหกรณ์'` |
--| ทะเบียน "70-1087" | `@TransReg = '70-1087'` |
--| เลขตั๋วคุม AI68-00123 | `@AppvDocuNo = 'AI68-00123'` |
--| ไม่ filter | ปล่อย `NULL` ทิ้งไว้ทุก parameter |

--### สิ่งที่แก้ไข
--- ✅ ย้าย `ORDER BY` เข้าไปใน subquery แต่ละส่วน → ไม่เกิด `Msg 156` อีก
--- ✅ เพิ่ม `COALESCE(TransRegistration, SOHDRemark.Remark)` — ดึงทะเบียนรถจากทั้ง 2 ที่อัตโนมัติ
--- ✅ Filter ทุกตัวเป็น optional (NULL = ข้ามการ filter นั้น)