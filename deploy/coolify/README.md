# Coolify Deployment — WS-Sale-App

ไฟล์สำหรับ deploy บน Hetzner VPS + **Coolify Cloud** (`app.coolify.io`)

## 🚀 เริ่มตรงนี้

| ต้องการ | ทำอะไร |
|---|---|
| **ติดตั้งให้ลูกค้าใหม่** | ดับเบิลคลิก **`provision-customer.bat`** (wizard 7 ขั้น) → อ่าน `CLONE-RECIPE.md` |
| **เปิด SSH tunnel ต่อ DB** | ดับเบิลคลิก **`tunnel.bat`** → SSMS ใช้ `127.0.0.1,14330` |
| **ทำ deploy ทีละขั้นเอง** | อ่าน `RUNBOOK.md` (10 ขั้น) |
| **ภาพรวม/เลือกปลายทาง deploy** | อ่าน `../../DEPLOY.md` |

## ไฟล์ทั้งหมด

| ไฟล์ | ใช้ทำอะไร |
|---|---|
| **`provision-customer.bat` / `.ps1`** | **Wizard ติดตั้งลูกค้าใหม่** — สุ่มความลับ · bootstrap · restore · migrate · seed · ออกเอกสารส่งมอบ |
| **`tunnel.bat` / `tunnel.ps1`** | เปิด SSH tunnel ให้ SSMS/DBeaver (กัน error ที่เกิดจากยกสิทธิ์/IPv6 ให้แล้ว) |
| `CLONE-RECIPE.md` | ขั้นตอนส่งมอบให้ลูกค้า + สิ่งที่ลูกค้าต้องเตรียม |
| `RUNBOOK.md` | ขั้นตอน deploy ละเอียดทีละขั้น + กับดักที่เคยเจอ |
| `docker-compose.yml` | SQL Server 2022 Express + MySQL 8 (collation ไทย · TZ · healthcheck · จูนสำหรับ RAM น้อย) |
| `01-server-bootstrap.sh` | เตรียม Ubuntu: swap · TZ · ufw · fail2ban · key-only SSH |
| `02-restore-mssql.sh` / `03-restore-mysql.sh` | restore `.bak` / `.sql` เข้า container (ใช้ตอนติดตั้งครั้งแรก) |
| **`refresh-data.sh`** | **เปลี่ยนข้อมูลตั้งต้นใหม่** — restore ทับ + สร้าง user + migrations + GRANT + seed ครบวงจร (`--dry-run` ได้) |
| `backup-databases.sh` | สำรอง DB ทั้งสองผ่าน cron (Express ไม่มี SQL Agent) |
| `backup.env.example` | ค่ารหัสผ่าน/ปลายทางของ backup script |
| `../../backend/.env.coolify.example` | env ของ backend (**ชื่อตัวแปรที่โค้ดอ่านจริง**) |
| `../../backend/scripts/preflight-check.js` | ตรวจความพร้อมก่อน/หลัง deploy |
| `../../backend/scripts/migrate-targets.js` | รัน migration ไปหลายปลายทาง (`npm run migrate` = ทุกที่) |

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
- **`ports:` ผูกกับ `127.0.0.1` ของ VM เท่านั้น** → อินเทอร์เน็ตเข้าไม่ถึง แต่ SSH tunnel ต่อได้
  (ถ้าไม่ใส่ `ports:` เลย tunnel จะต่อไม่ได้ เพราะ port ไม่ได้อยู่บน host) · **ห้ามเปลี่ยนเป็น `1433:1433`**
- **`MSSQL_COLLATION=Thai_CI_AS`** ให้ตรงกับ `dbwins_worldfert9` (กัน tempdb collation conflict ตอน join คอลัมน์ไทย)
- **`TZ=Asia/Bangkok`** ทั้งคู่ (ข้อมูลใช้ พ.ศ. / เวลาไทย)
- **`MSSQL_PID=Express`** — วัดจริงแล้ว data 3.37 GB < ลิมิต 10 GB
- **จูนหน่วยความจำสำหรับเครื่อง RAM น้อย** — `MSSQL_MEMORY_LIMIT_MB` + memory limit ต่อ container
  (ถ้าเครื่อง 8 GB ปรับขึ้นได้ ดูหมายเหตุในไฟล์)
- **ไม่มี trace flags / mssql.conf / custom entrypoint** — พวกนั้นเป็น workaround เฉพาะ Railway ไม่ต้องใช้บน ext4
- **ใช้ `${VAR}` เปล่าๆ ไม่ใช่ `${VAR:?ข้อความ}`** — Coolify แปล syntax หลังผิด เอาข้อความ error มาเป็นค่า

## 2. Restore + migrations + seed

```bash
scp *.bak *.sql root@YOUR_IP:/root/backup/
ssh root@YOUR_IP
set -a; . /root/.wf-secrets; set +a       # ไฟล์ความลับ (chmod 600)
bash /root/02-restore-mssql.sh /root/backup/<file>.bak
bash /root/03-restore-mysql.sh /root/backup/<file>.sql
```
เสร็จแล้ว **3 ขั้นนี้ห้ามสลับลำดับ** (restore ได้แค่สิ่งที่อยู่ใน `.bak` ซึ่ง**ไม่มี schema `wf`**):
```bash
# 1) สร้าง login/user ก่อน — ไม่งั้น GRANT ใน migration 001 จะถูกข้ามเงียบๆ
sqlcmd ... -i migrations/000_logins.sql
# 2) migrations
docker exec -it <backend> node run_migrations.js
# 3) seed ผู้ใช้ — ถ้าข้ามขั้นนี้จะ login ไม่ได้ทั้งระบบ
docker exec -it <backend> node seed_admin.js
```

## 3. Backend

เปิด **Connect To Predefined Network** ให้ทั้ง `wf-databases` และ backend → ทั้งคู่จะอยู่ network `coolify`
แล้วใช้ env จาก `backend/.env.coolify.example`

> ⚠ **ห้ามใช้ `DB_HOST`/`DB_PORT`** — โค้ดไม่รู้จัก จะ fallback ไป IP Azure เดิม
> ใช้ `DB_MODE=remote` + `REMOTE_DB_SERVER=<ชื่อ container เต็ม>`
>
> ⚠ บน network `coolify` **alias สั้น `mssql`/`mysql` ใช้ไม่ได้** (มีเฉพาะใน network ของ service เอง)
> ต้องใช้ชื่อเต็ม เช่น `mssql-<service-uuid>` · ดูด้วย `docker ps --format '{{.Names}}'`

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
- หมุนเวียน **3 วัน** · สำเนา weekly ทุกวันอาทิตย์เก็บ **21 วัน** (ค่าเริ่มต้นสำหรับดิสก์ 40 GB — ถ้า 80 GB+ ปรับเป็น 14/90 ได้)
- **disk guard** — ถ้าที่ว่าง < `MIN_FREE_GB` จะลบของเก่า/ยกเลิก กันดิสก์เต็มจน DB ล่ม
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
