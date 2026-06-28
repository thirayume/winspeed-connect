# db-init/mysql

วางไฟล์ dump ของ TruckScale (`*.sql` หรือ `*.sql.gz`) ในโฟลเดอร์นี้
→ เมื่อ start `mysql` service ครั้งแรก (`docker compose --profile db up`) MySQL จะ **import อัตโนมัติ**
เข้าฐาน `db_truckscale` (เรียงตามชื่อไฟล์)

## วิธีได้ไฟล์ dump จาก Railway/แหล่งปัจจุบัน
```bash
mysqldump -h reseau.proxy.rlwy.net -P 42508 -u root -p \
  --default-character-set=utf8mb4 --single-transaction \
  db_truckscale > db-init/mysql/01-truckscale.sql
```

> ⚠️ ไฟล์ dump อาจมีข้อมูลจริง — อย่า commit ขึ้น git (เพิ่มใน .gitignore แล้ว)
> import จะทำงานเฉพาะตอน volume `mysql_data` ยังว่าง (ครั้งแรกเท่านั้น)
