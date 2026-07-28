-- =============================================================
-- 001_index_product_detail_one_num.sql   (MySQL · db_truckscale)
--
-- ⚠ ไฟล์นี้ไม่ได้อยู่ในชุด migration ของ SQL Server (run_migrations.js)
--    เพราะเป็นคนละฐานข้อมูลคนละชนิด สั่งด้วย run-mysql-migrations.js
--
-- เหตุผล
--   tblproduct_detail มี 550,000 แถวและไม่มี index ที่ one_num ซึ่งเป็นคอลัมน์
--   เดียวที่ใช้ผูกกลับไปยัง tblscale ทุกการค้นรายการย่อยจึงสแกนทั้งตาราง
--   ผลที่วัดได้จริง: รายงานสรุปตามเที่ยวหมดเวลา 6 วินาทีทุกครั้ง
--
--   การเขียนกลับใน T6-01 ก็ค้นด้วย one_num เช่นกัน (ลบรายการเดิมก่อนเขียนใหม่)
--   index นี้จึงช่วยทั้งฝั่งอ่านและฝั่งเขียน
--
-- ผลกระทบ
--   เพิ่ม index อย่างเดียว ไม่แก้ข้อมูลและไม่แก้โครงสร้างคอลัมน์ ย้อนกลับได้ด้วย
--   DROP INDEX ถ้าไม่ต้องการ · MySQL 5.6 ขึ้นไปสร้าง index แบบ online ตารางยังใช้งานได้
--   ระหว่างสร้าง แต่ควรทำนอกเวลาที่โรงงานชั่งหนัก
-- =============================================================

-- MySQL ไม่มี CREATE INDEX IF NOT EXISTS จึงต้องตรวจเองก่อนเพื่อให้สั่งซ้ำได้
SET @exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tblproduct_detail'
    AND INDEX_NAME = 'idx_pd_one_num'
);

SET @ddl := IF(@exists = 0,
  'CREATE INDEX idx_pd_one_num ON tblproduct_detail (one_num)',
  'SELECT ''idx_pd_one_num already exists'' AS note');

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
