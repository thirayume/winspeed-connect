# Coolify Deployment — WS-Sale-App

ไฟล์สำหรับ deploy บน Hetzner VPS + Coolify · อ้างอิงแผนเต็มที่ `coolify-migration-plan.md`

| ไฟล์ | ใช้ทำอะไร |
|---|---|
| `docker-compose.yml` | SQL Server 2022 + MySQL 8 (collation ไทย + TZ + healthcheck, ไม่เปิด port ออก host) |
| `backup-databases.sh` | สำรอง DB ทั้งสองผ่าน cron (Express ไม่มี SQL Agent) |
| `backup.env.example` | ค่ารหัสผ่าน/ปลายทางของ backup script |
| `../../backend/.env.coolify.example` | env ของ backend (**ชื่อตัวแปรที่โค้ดอ่านจริง**) |
| `../../backend/scripts/preflight-check.js` | ตรวจความพร้อมก่อน/หลัง deploy |

---

## 1. Databases

ใน Coolify → New Resource → **Docker Compose** → วางเนื้อหา `docker-compose.yml`

ตั้ง Environment Variables:
```
MSSQL_SA_PASSWORD=<strong_password>
MYSQL_ROOT_PASSWORD=<strong_password>
MYSQL_USER=wfapp
MYSQL_PASSWORD=<strong_password>
```

จุดที่ตั้งใจไว้ในไฟล์นี้:
- **ไม่มี `ports:`** → DB เข้าถึงได้เฉพาะใน Docker network (เข้าจากเครื่องตัวเองผ่าน SSH tunnel)
- **`MSSQL_COLLATION=Thai_CI_AS`** ให้ตรงกับ `dbwins_worldfert9` (กัน tempdb collation conflict ตอน join คอลัมน์ไทย)
- **`TZ=Asia/Bangkok`** ทั้งคู่ (ข้อมูลใช้ พ.ศ. / เวลาไทย)
- **`MSSQL_PID=Express`** — วัดจริงแล้ว data 3.37 GB < ลิมิต 10 GB
- **ไม่มี trace flags / mssql.conf / custom entrypoint** — พวกนั้นเป็น workaround เฉพาะ Railway ไม่ต้องใช้บน ext4

## 2. Restore + migrations

```bash
scp dbwins_worldfert9_db.bak root@YOUR_IP:/tmp/
docker cp /tmp/dbwins_worldfert9_db.bak mssql:/var/opt/mssql/backup/
ssh -L 1433:localhost:1433 root@YOUR_IP     # แล้ว restore ผ่าน SSMS/ADS
```
เสร็จแล้วรัน migrations (restore ได้แค่สิ่งที่อยู่ใน .bak):
```bash
npm run migrate
```

## 3. Backend

ผูก backend เข้า network **`wf-net`** เดียวกัน แล้วใช้ env จาก `backend/.env.coolify.example`

> ⚠ **ห้ามใช้ `DB_HOST`/`DB_PORT`** — โค้ดไม่รู้จัก จะ fallback ไป IP Azure เดิม
> ใช้ `DB_MODE=remote` + `REMOTE_DB_SERVER=mssql`

ตรวจก่อน go-live:
```bash
node scripts/preflight-check.js
```

## 4. Backup (cron)

```bash
mkdir -p /opt/wf
cp backup-databases.sh /opt/wf/ && chmod +x /opt/wf/backup-databases.sh
cp backup.env.example /opt/wf/backup.env && chmod 600 /opt/wf/backup.env   # ใส่รหัสผ่าน
/opt/wf/backup-databases.sh --dry-run        # ทดสอบก่อน
crontab -e
```
```cron
15 2 * * *  /opt/wf/backup-databases.sh >> /var/log/wf-backup.log 2>&1
```

สคริปต์ทำอะไรบ้าง:
- `BACKUP DATABASE ... WITH CHECKSUM` + **`RESTORE VERIFYONLY`** (ไม่เชื่อว่าสำเร็จจนกว่าจะ verify)
- `mysqldump --single-transaction` + ตรวจว่าไฟล์ไม่เล็กผิดปกติ + `gzip -t`
- หมุนเวียน 14 วัน · สำเนา weekly ทุกวันอาทิตย์เก็บ 90 วัน
- rsync ออกนอกเครื่อง (ถ้าตั้ง `OFFSITE_RSYNC_TARGET`) — **สำคัญ: backup บนเครื่องเดียวกับ DB ไม่ช่วยตอนดิสก์พัง**
- ยิง webhook เตือนเมื่อล้มเหลว + `exit 1`

**ตรวจ restore จริงอย่างน้อยเดือนละครั้ง** — backup ที่ยัง restore ไม่เคยทดสอบ ไม่นับว่าเป็น backup

## 5. Frontend

`VITE_API_BASE_URL` ถูก **bake ตอน build** → เปลี่ยนโดเมน backend แล้วต้อง **rebuild** ไม่ใช่แค่ restart

---

## 6. ตั้งค่า Auto-Deploy ผ่าน GitHub Webhook (สำหรับ Coolify)

ถ้าต้องการให้ Coolify ดึงโค้ดไป Build และ Deploy อัตโนมัติทุกครั้งที่เราพิมพ์คำสั่ง `npm run deploy` (เหมือนที่ Vercel และ Railway ทำได้) คุณต้องตั้งค่า Webhook ดังนี้:

**ส่วนของ Coolify:**
1. ไปที่โปรเจกต์ Frontend / Backend ใน Coolify Dashboard
2. ไปที่เมนู **Configuration** → **Webhooks**
3. คัดลอกลิงก์ **Push Webhook URL** (หรือ GitHub App webhook) มาเก็บไว้

**ส่วนของ GitHub:**
1. ไปที่ Repository ใน GitHub → **Settings** → **Webhooks**
2. กดปุ่ม **Add webhook**
3. ช่อง **Payload URL**: วางลิงก์ที่ก๊อปมาจาก Coolify
4. ช่อง **Content type**: เลือก `application/json`
5. เลื่อนลงมากด **Add webhook**

เมื่อตั้งค่าเสร็จสิ้น เวลาเรารัน `npm run deploy` โค้ดที่ Push ขึ้น `main` จะไปสะกิด Coolify ให้เริ่ม Build ใหม่ทันทีครับ!
