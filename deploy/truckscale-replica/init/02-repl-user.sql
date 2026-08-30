-- ผู้ใช้สำหรับให้ปลายทางดึง binlog
--
-- แยกจาก root โดยตั้งใจ: บัญชีนี้ทำได้อย่างเดียวคืออ่าน binlog
-- ถ้ารหัสรั่ว ผู้ถือก็เขียนอะไรไม่ได้ ต่างจาก root ที่โปรแกรมเครื่องชั่ง hardcode ไว้
--
-- caching_sha2_password คือค่าปริยายของ MySQL 8+ ปลายทางที่ยังใช้ไดรเวอร์เก่า
-- อาจต้องใช้ mysql_native_password แทน — ดู README หัวข้อ "ปลายทางต่อไม่ได้"

CREATE USER IF NOT EXISTS 'repl'@'%' IDENTIFIED BY 'replpw';
GRANT REPLICATION SLAVE, REPLICATION CLIENT ON *.* TO 'repl'@'%';
FLUSH PRIVILEGES;
