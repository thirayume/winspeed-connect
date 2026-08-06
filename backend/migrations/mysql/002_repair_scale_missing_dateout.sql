-- =============================================================
-- 002_repair_scale_missing_dateout.sql   (MySQL · db_truckscale)
--
-- ⚠ ไฟล์นี้ไม่ได้อยู่ในชุด migration ของ SQL Server สั่งด้วย run-mysql-migrations.js
--
-- ปัญหา
--   ใบชั่งที่ชั่งออกแล้ว (weight_out > 0) ต้องมี Date_Out เสมอ แต่พบใบที่ Date_Out
--   ว่างทั้งที่มีน้ำหนักออกและปิดงานแล้ว ทำให้รายงานที่กรองด้วยวันที่มองไม่เห็นใบนั้น
--   และหน้าจอแสดงเป็นขีดกลางเหมือนใบที่ยังไม่ชั่งออก ซึ่งคนละความหมายกันโดยสิ้นเชิง
--
--   สำรวจทั้งตารางเมื่อ 5 ส.ค. 2569: 403,918 ใบ · ชั่งออกแล้ว 403,886 ใบ
--   · ผิดลักษณะนี้ **1 ใบ** (s_id 281742 · sequence 02619863 · movebill 63041135)
--
-- วิธีซ่อม
--   Date_Out2 เป็นเลข OLE serial (epoch 1899-12-30) ของวันเดียวกัน และยังอยู่ครบ
--   จึงคำนวณ Date_Out กลับได้ตรง ๆ ไม่ต้องเดา
--
--   ใบที่พบยืนยันตรงกันสามทาง: Date_Out2 = 43939 → 18/04/2563 ตรงกับ Date_In
--   ('18/04/2563') · movebill 63041135 (YYMM = 6304 = เม.ย. 2563) · s_day 6304
--
-- ขอบเขตและความปลอดภัย
--   • แตะเฉพาะแถวที่ชั่งออกแล้วและ Date_Out ว่างจริง ๆ เท่านั้น
--   • ต้องมี Date_Out2 ที่ใช้ได้ ถ้าไม่มีจะข้ามไปให้คนดู ไม่เดาจาก Date_In
--   • วันที่คำนวณได้ต้องไม่ก่อนวันชั่งเข้า มิฉะนั้นข้าม (กัน serial ที่เพี้ยน)
--   • สั่งซ้ำได้ รอบที่สองจะไม่มีแถวเข้าเงื่อนไขอีก
--   • ไม่แตะ Date_Out2 ซึ่งเป็นค่าต้นทางที่ใช้อ้างอิง
--
--   สำเนาใน wf.WeighInbox ไม่ต้องแก้ที่นี่ — MERGE ของ truckscale-sync.js อัปเดต
--   DateOut ทุกครั้งที่ใบถูกดึงซ้ำ แต่ใบเก่าอาจไม่เข้าช่วง sync จึงมี migration
--   ฝั่ง SQL Server (072) ซ่อมสำเนาให้ด้วย
-- =============================================================

-- ── ก่อนซ่อม: บันทึกว่าจะกระทบกี่แถว (อ่านได้จาก log ของ runner) ──────────
SELECT COUNT(*) AS rows_to_repair
FROM tblscale
WHERE weight_out > 0
  AND (Date_Out IS NULL OR TRIM(Date_Out) = '' OR TRIM(Date_Out) = '0')
  AND Date_Out2 > 0;

-- ── ซ่อม ────────────────────────────────────────────────────────────────
--
-- DATE_ADD('1899-12-30', INTERVAL Date_Out2 DAY) แปลง OLE serial กลับเป็นวันที่
-- แล้วประกอบเป็น 'DD/MM/BBBB' ตามรูปแบบที่ตารางนี้ใช้ (ปี พ.ศ. = ค.ศ. + 543)

UPDATE tblscale
SET Date_Out = CONCAT(
      LPAD(DAY(DATE_ADD('1899-12-30', INTERVAL Date_Out2 DAY)), 2, '0'), '/',
      LPAD(MONTH(DATE_ADD('1899-12-30', INTERVAL Date_Out2 DAY)), 2, '0'), '/',
      YEAR(DATE_ADD('1899-12-30', INTERVAL Date_Out2 DAY)) + 543)
WHERE weight_out > 0
  AND (Date_Out IS NULL OR TRIM(Date_Out) = '' OR TRIM(Date_Out) = '0')
  AND Date_Out2 > 0
  -- วันชั่งออกต้องไม่ก่อนวันชั่งเข้า — กันกรณี Date_Out2 เพี้ยนแล้วซ่อมผิดเป็นวันในอดีต
  AND (
        Date_In IS NULL OR TRIM(Date_In) IN ('', '0')
        OR DATE_ADD('1899-12-30', INTERVAL Date_Out2 DAY) >= STR_TO_DATE(
             CONCAT(SUBSTRING_INDEX(Date_In, '/', 2), '/',
                    CAST(SUBSTRING_INDEX(Date_In, '/', -1) AS UNSIGNED) - 543),
             '%d/%m/%Y')
      );

-- ── หลังซ่อม: ต้องเหลือเฉพาะใบที่ไม่มี Date_Out2 ให้ใช้เท่านั้น ───────────
SELECT
  SUM(CASE WHEN weight_out > 0
            AND (Date_Out IS NULL OR TRIM(Date_Out) = '' OR TRIM(Date_Out) = '0')
           THEN 1 ELSE 0 END)                                    AS still_missing,
  SUM(CASE WHEN weight_out > 0
            AND (Date_Out IS NULL OR TRIM(Date_Out) = '' OR TRIM(Date_Out) = '0')
            AND (Date_Out2 IS NULL OR Date_Out2 = 0)
           THEN 1 ELSE 0 END)                                    AS unrepairable_no_serial
FROM tblscale;
