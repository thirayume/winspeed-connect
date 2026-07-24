# RUNBOOK — Deploy WS-Sale-App ขึ้น Coolify (ทีละขั้น)

ทำตามลำดับ · แต่ละขั้นมี "ตรวจก่อนไปต่อ" · เวลารวมโดยประมาณ **2–3 ชม.** (ส่วนใหญ่คือรอ upload/restore)

**ไฟล์ backup ที่จะใช้ (อยู่ที่ `C:\MyWork\WorldFert\`)**
| ไฟล์ | ขนาด | ปลายทาง |
|---|---|---|
| `dbwins_worldfert9_db_202607021642.bak` | 3,288 MB | SQL Server |
| `dump-db_truckscale-202607212333.sql` | 443 MB | MySQL |

---

## ขั้น 0 — เตรียมก่อนเริ่ม (บน PC)

**SSH key** (ถ้ายังไม่มี):
```powershell
ssh-keygen -t ed25519 -C "worldfert-coolify"
Get-Content $HOME\.ssh\id_ed25519.pub | Set-Clipboard   # คัดลอกไปใส่ตอนสร้าง server
```

**หา IP ของคุณ** (ใช้ล็อก firewall):
```powershell
(Invoke-RestMethod ifconfig.me/ip).Trim()
```

**บีบอัด .bak ก่อนอัปโหลด** (3.2 GB → ~1 GB ประหยัดเวลามาก):
```powershell
Compress-Archive -Path C:\MyWork\WorldFert\dbwins_worldfert9_db_202607021642.bak `
                 -DestinationPath C:\MyWork\WorldFert\mssql-backup.zip
```

---

## ขั้น 1 — สร้าง VPS (Hetzner Cloud)

Hetzner Cloud Console (`console.hetzner.cloud`) → Project → **Add Server**
- **Location:** **Falkenstein / Nürnberg / Helsinki** (EU — ราคาถูกสุด ~€7/เดือน) · latency→ไทย ~230–260ms (ERP งานฟอร์ม/รายงาน รับได้สบาย)
- **Image:** Ubuntu 24.04
- **Type:** **CX32** (4 vCPU / 8 GB / 80 GB, Shared) — CX line มีเฉพาะโซน EU
- **Networking:** ☑ IPv4 (+ IPv6) — **เก็บ IPv4 ไว้** ($0.60/เดือน จำเป็นสำหรับ SSH/Coolify)
- **SSH key:** วาง public key จากขั้น 0
- **ข้ามทั้งหมด:** Volumes (disk 80GB พอ) · Firewalls (ใช้ ufw ในสคริปต์แทน) · Backups (+20% ซ้ำกับ `backup-databases.sh`) · Placement groups
- จด **IP** ที่ได้

> 💡 ราคารวมควร **~$7-8/เดือน** — ต้องเลือกแถบ **Cost-Optimized → x86 → CX32** (ไม่ใช่ Regular Performance/CPX ซึ่ง 8GB = $41.99)
> ⚠ **ห้ามเลือก Arm64/CAX** — SQL Server ไม่มี image ARM รันไม่ได้
> 8 GB สำหรับ SQL Server + MySQL + backend (Coolify Cloud คุมจากภายนอก ไม่กิน RAM เครื่องนี้)

✅ **ตรวจ:** `ssh root@YOUR_IP` เข้าได้

---

## ขั้น 2 — Bootstrap server

> **ใช้ Coolify Cloud (`app.coolify.io`) ที่จ่าย $5/เดือนไปแล้ว** → `--mode cloud`
> (ไม่ติดตั้ง Coolify บน VPS · ประหยัด RAM ~1 GB ให้ SQL Server · คุมหลายเครื่องจาก dashboard เดียว = ดีกับโมเดล SaaS)

อัปโหลดสคริปต์แล้วรัน:
```powershell
scp C:\MyWork\WorldFert\winspeed-frontend\deploy\coolify\*.sh root@YOUR_IP:/root/
```
```bash
ssh root@YOUR_IP
bash 01-server-bootstrap.sh --mode cloud
```

สคริปต์ทำ: อัปเดตระบบ · swap 4GB · TZ Asia/Bangkok · **key-only SSH** · fail2ban ·
ufw (22 เปิดจากภายนอก · 80/443 · **ไม่เปิด 1433/3306**)

> ⚠ **ทำไม port 22 ต้องเปิดจากภายนอก:** Coolify Cloud SSH เข้ามาจากเซิร์ฟเวอร์ของเขา
> ถ้าล็อกเฉพาะ IP บ้านคุณ Coolify จะเชื่อม server ไม่ได้ — ความปลอดภัยมาจาก key-only auth + fail2ban แทน
> (ถ้าอยากประหยัด $5 ภายหลัง → เปลี่ยนเป็น self-host: `--mode self --admin-ip YOUR_PC_IP`)

✅ **ตรวจ:** สคริปต์พิมพ์ IP ออกมาท้ายสุด · `ufw status` ไม่มี 1433/3306

---

## ขั้น 2b — เพิ่ม Server เข้า Coolify Cloud

ที่ `app.coolify.io` → **Servers → + Add**

| ช่อง | ค่า |
|---|---|
| Name | `worldfert-prod` |
| IP Address | IP ของ VPS |
| Port / User | `22` / `root` |
| Private Key | key ที่คุณสร้าง (อยู่ในรายการ **Private Keys** ของ Coolify แล้ว) |

กด **Validate Server & Install Docker** → Coolify จะติดตั้ง Docker ให้เอง

> 💡 ทางเลือก "สร้าง server ในตัว Coolify": Servers → Add → **Hetzner** → ใส่ Hetzner API token → Coolify สั่งสร้าง CX32 บนบัญชี Hetzner ของคุณ + ลง Docker ให้อัตโนมัติ (server ยังคิดเงินที่ Hetzner ตามปกติ)

✅ **ตรวจ:** สถานะ server เป็น **reachable / valid**

---

## ขั้น 3 — Deploy databases

Coolify → Project → **+ Add Resource → Docker Compose Empty** → วางเนื้อหาจาก `docker-compose.yml` → **Save**

> ⚠️ **กับดัก: Coolify แปลง `${VAR:?ข้อความ}` ผิด** — มันเอา *ข้อความ error* มาเป็นค่าตัวแปร
> (เช่นได้ `MSSQL_SA_PASSWORD=ต้องตั้ง MSSQL_SA_PASSWORD` → SQL Server ไม่รับรหัส)
> compose ในรีโปแก้เป็น `${VAR}` เปล่าๆ แล้ว · **ต้องตั้งค่าจริงในหน้า Environment Variables เสมอ**

ไปแท็บ **Environment Variables → Developer view** แล้ววางทับทั้งบล็อก (เร็วกว่าแก้ทีละช่อง):

```
MSSQL_SA_PASSWORD=<รหัสแข็งแรง ≥12 ตัว มีตัวใหญ่/เล็ก/เลข/อักขระพิเศษ>
MYSQL_ROOT_PASSWORD=<รหัสแข็งแรง>
MYSQL_USER=wfapp
MYSQL_PASSWORD=<รหัสแข็งแรง>
```
> **เก็บรหัสเหล่านี้ไว้** — ต้องใช้ซ้ำในขั้น 5, 6 และไฟล์ backup.env

Deploy แล้วรอ (SQL Server boot ~90 วิ)

✅ **ตรวจ:**
```bash
docker ps                                    # เห็น mssql, mysql = Up (healthy)
docker logs mssql --tail 30                  # ไม่มี "misaligned log IOs" / stack overflow
docker exec mssql /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P '<PW>' -C -Q "SELECT @@VERSION"
```

---

## ขั้น 4 — อัปโหลด backup (WinSCP)

**WinSCP** → New Site:
| ช่อง | ค่า |
|---|---|
| File protocol | **SFTP** |
| Host name | `YOUR_IP` |
| Port | `22` |
| User name | `root` |
| Advanced → SSH → Authentication → Private key | `id_ed25519.ppk` * |

\* WinSCP ใช้ `.ppk` — แปลงด้วย PuTTYgen (Load `id_ed25519` → Save private key) หรือใช้ Password auth ถ้าเปิดไว้

สร้างโฟลเดอร์ `/root/backup/` แล้วลากไฟล์ทั้ง 2 ขึ้นไป
(ถ้าบีบอัด: อัปโหลด `mssql-backup.zip` แล้ว `unzip mssql-backup.zip -d /root/backup/` บน server)

✅ **ตรวจ:**
```bash
ls -lh /root/backup/     # เห็น .bak ~3.2G และ .sql ~443M
df -h /                  # เหลือ > 15GB
```

---

## ขั้น 5 — Restore ทั้ง 2 ฐาน

> ⚠️ **Coolify เปลี่ยนชื่อ container** เป็น `mssql-<service-uuid>` / `mysql-<service-uuid>`
> (ทับ `container_name` ใน compose) → สคริปต์ restore หาไม่เจอถ้าไม่บอกชื่อใหม่
> ดูชื่อจริงด้วย `docker ps --format '{{.Names}}'`

สร้างไฟล์ secret ครั้งเดียว (สิทธิ์ 600 · ไม่โผล่ใน process list):
```bash
cat > /root/.wf-secrets <<'SECRETS'
MSSQL_SA_PASSWORD=<รหัสจากขั้น 3>
MYSQL_ROOT_PASSWORD=<รหัสจากขั้น 3>
MYSQL_USER=wfapp
MYSQL_PASSWORD=<รหัสจากขั้น 3>
MSSQL_CONTAINER=mssql-<service-uuid>
MYSQL_CONTAINER=mysql-<service-uuid>
MSSQL_DB=dbwins_worldfert9
MYSQL_DB=db_truckscale
SECRETS
chmod 600 /root/.wf-secrets
```

แล้ว restore:
```bash
set -a; . /root/.wf-secrets; set +a
bash /root/02-restore-mssql.sh /root/backup/dbwins_worldfert9_db_202607021642.bak
bash /root/03-restore-mysql.sh /root/backup/dump-db_truckscale-202607212333.sql
```

สคริปต์จะ: ตรวจเนื้อที่ · อ่าน logical names อัตโนมัติ · เช็คลิมิต Express · restore · ตรวจผล

✅ **ตรวจ (สคริปต์แสดงให้เอง):** `state_desc = ONLINE` · `Collation = Thai_CI_AS` · `SOHD` มีข้อมูล · `tblscale ≈ 403,908 แถว`

> ถ้า `wf_tables = 0` เป็นเรื่องปกติ — จะรัน migrations ในขั้นถัดไป

---

## ขั้น 6 — Deploy backend

Coolify → **+ New Resource → Private Repository** → เลือก repo (backend อยู่ที่ `winspeed-frontend/backend`, มี `Dockerfile` แล้ว)

- **Network:** ผูกเข้า `wf-net` เดียวกับ DB (สำคัญ! ไม่งั้นชื่อ service ไม่ resolve)
- **Environment Variables:** คัดลอกจาก `backend/.env.coolify.example` แล้วเติมค่าจริง

> ⚠ **ห้ามใช้ `DB_HOST`/`DB_PORT`** — โค้ดไม่รู้จัก จะ fallback ไป IP Azure เดิม
> ใช้ `DB_MODE=remote` + `REMOTE_DB_SERVER=<hostname>`

> 🔌 **เรื่อง network — สำคัญ**
> DB อยู่คนละ resource กับ backend → ต้องเปิด **Connect To Predefined Network** (แท็บ General)
> ให้ **ทั้งสองฝั่ง** แล้ว Restart · ทั้งคู่จะเข้า network `coolify` ร่วมกัน
>
> ⚠️ บน network `coolify` **alias สั้น `mssql`/`mysql` ใช้ไม่ได้** — มีเฉพาะใน network ของ service เอง
> ต้องใช้ **ชื่อ container เต็ม**:
> ```
> REMOTE_DB_SERVER=mssql-<service-uuid>     # ไม่ใช่ "mssql"
> MYSQL_HOST=mysql-<service-uuid>           # ไม่ใช่ "mysql"
> ```
> หาชื่อจริง: `docker ps --format '{{.Names}}'` · ตรวจว่าต่อได้:
> `docker run --rm --network coolify alpine nc -z -w3 mssql-<uuid> 1433`

สร้าง `JWT_SECRET` ใหม่สำหรับ production:
```bash
openssl rand -base64 48
```

**รัน migrations** (ทำครั้งเดียวหลัง restore):

> 🚨 **ต้องสร้าง login/user ก่อนรัน migration เสมอ** — นี่คือกับดักที่เสียเวลาที่สุด
> `001_wf_schema.sql` ครอบ GRANT ไว้ด้วย `IF EXISTS (... sys.database_principals ...)`
> ถ้า `wf_reader`/`wf_owner` ยังไม่มี **มันจะข้าม GRANT ไปเงียบๆ** (ไม่ error)
> ผลคือ `wf_owner` ไม่มีสิทธิ์เขียน schema wf → backend ใช้งานไม่ได้ และหาสาเหตุยากมาก
>
> รัน `migrations/000_logins.sql` **ก่อน** (มันถูกกันออกจาก policy เพราะต้องใช้สิทธิ์ sysadmin)
> และ **เปลี่ยนรหัสผ่านในไฟล์** — ค่าเริ่มต้นเป็น placeholder `ChangeMe_Strong#2026`
>
> ถ้าเผลอรัน migration ไปก่อนแล้ว ให้เติมสิทธิ์ย้อนหลัง:
> ```sql
> GRANT CONTROL ON SCHEMA::wf TO wf_owner;
> GRANT SELECT  ON SCHEMA::wf TO wf_reader;
> ```
> ตรวจว่าได้ผล: `SELECT dp.name, p.permission_name FROM sys.database_permissions p JOIN sys.database_principals dp ON dp.principal_id=p.grantee_principal_id WHERE p.major_id=SCHEMA_ID('wf')`
> → ต้องเห็น `wf_owner CONTROL` และ `wf_reader SELECT`

> ⚠️ **ไม่มี `npm run migrate`** — ตัวรันจริงคือ `run_migrations.js`
> (`package.json` มีแค่ `migrate:plan`) · `--plan` เป็น read-only จึง bootstrap ledger ไม่ได้
> ครั้งแรกต้องรันแบบ apply เลย
```bash
docker exec -it <backend-container> node run_migrations.js --plan   # dry-run (ใช้ได้หลังมี ledger แล้ว)
docker exec -it <backend-container> node run_migrations.js          # apply จริง
```

**แล้ว seed ผู้ใช้ (ขั้นนี้ลืมไม่ได้ — ตาม `DEPLOY.md`)**
```bash
docker exec -it <backend-container> node seed_admin.js
```
> 🚨 **migration อย่างเดียวยังเข้าระบบไม่ได้** — `011_seed_sales_users_giveaway.sql` สร้างแต่บัญชี
> `emp-XXXXX` role `SALES` ทั้งหมด **ไม่มี ADMIN สักบัญชี** → login ไม่ได้ทั้งระบบ
>
> `seed_admin.js` สร้าง **`admin` / `W0rldF3rt`** (⚠️ `W0rld` = **เลขศูนย์**) + map role จริงจาก `dbo.EMEmp`
> (MANAGER/WAREHOUSE/ACCOUNTING) + ผูก `EmpId` ที่จำเป็นต่อการ export SO กลับ WINSpeed
> พนักงานทุกคนได้รหัสเริ่มต้น `W0rldF3rt` เหมือนกัน — **ต้องบังคับเปลี่ยนก่อน go-live**
>
> ❌ **อย่า** ใช้ `migrations/uat_create_admin.sql` (ของ UAT · ถูกกันด้วย pattern `^uat_` · มีบั๊ก)
> ❌ **อย่า** insert `wf.AppUser` เองด้วย SQL — จะไม่ได้ role/EmpId ที่ถูกต้อง

✅ **ตรวจ:**
```bash
docker exec -it <backend-container> node scripts/preflight-check.js    # ต้อง exit 0
```

ตั้ง **Domain** ใน Coolify → ได้ HTTPS (Let's Encrypt) อัตโนมัติ

---

## ขั้น 7 — เข้าถึง DB จาก PC (SSMS / DBeaver)

DB ไม่ได้เปิดสู่อินเทอร์เน็ต — ใช้ **SSH tunnel**

**วิธีที่ง่ายที่สุด — ดับเบิลคลิก `tunnel.bat`** (ใน `deploy\coolify\`)
หรือสั่งเอง:
```powershell
cd C:\MyWork\WorldFert\winspeed-frontend\deploy\coolify
.\tunnel.ps1                          # ค่า default ชี้ server นี้อยู่แล้ว
.\tunnel.ps1 -ServerIp 1.2.3.4 -KeyFile C:\path\to\key
```
เปิดค้างไว้ (Ctrl+C เพื่อปิด)

> 🚨 **ห้ามเปิดหน้าต่างแบบ Run as administrator** — ssh บน Windows จะ bind พอร์ต loopback ไม่ได้
> ขึ้น `bind [127.0.0.1]:14330: Permission denied` (port > 1024 ไม่ต้องใช้สิทธิ์ admin อยู่แล้ว)

**SSMS**
| ช่อง | ค่า |
|---|---|
| Server name | **`127.0.0.1,14330`** ← **อย่าใช้ `localhost`** · คอมมา ไม่ใช่ colon |
| Authentication | SQL Server Authentication |
| Login / Password | `sa` / รหัสจากขั้น 3 |
| Options → | ☑ **Trust server certificate** |

> 🚨 **ทำไมห้ามใช้ `localhost`:** Windows แปลงเป็น **IPv6 `::1`** ก่อน แต่ tunnel ผูกเฉพาะ **IPv4**
> → ODBC ยิงไป IPv6 แล้วรอจน timeout: `TCP Provider: The wait operation timed out (Error 258)`
> ทั้งที่ tunnel ทำงานปกติ · วัดจริง: `127.0.0.1` ต่อได้ 2.7 วิ · `localhost` fail ที่ 21 วิ

**DBeaver (MySQL)** — ทางที่สะดวกกว่าคือใช้ SSH tunnel ในตัว DBeaver (ไม่ต้องรัน `tunnel.bat`):
| แท็บ | ช่อง | ค่า |
|---|---|---|
| Main | Host / Port | `127.0.0.1` / `3306` |
| Main | Database | `db_truckscale` |
| Main | User / Password | `wfapp` / รหัสจากขั้น 3 |
| **SSH** | ☑ Use SSH Tunnel · Host / User | `YOUR_IP` / `root` |
| SSH | Auth method | Public key → `wf-key` |

> ถ้าใช้ `tunnel.bat` แทน ให้ต่อที่ `127.0.0.1:33060`
> (DBeaver/JDBC ไม่เจอปัญหา IPv6 เพราะ fallback เองได้ แต่ใช้ `127.0.0.1` ไว้ก่อนปลอดภัยกว่า)

**DBeaver (SQL Server)** ก็ทำแบบเดียวกันได้ — Host `127.0.0.1` Port `1433` + แท็บ SSH

---

## ขั้น 8 — Frontend

`VITE_API_BASE_URL` ถูก **bake ตอน build** → แก้แล้วต้อง **rebuild**
```
VITE_API_BASE_URL=https://api.yourdomain.com/api
```
คงไว้ที่ Vercel (ความเสี่ยงต่ำสุด) หรือย้ายมา Coolify ก็ได้

✅ **ตรวจ:** เปิดเว็บ → login → Dashboard โหลดข้อมูลได้ · เปิด DevTools ดูว่าไม่มี CORS error

---

## ขั้น 9 — Backup อัตโนมัติ · *(เครื่อง dev ข้ามได้)*

> 🔵 **เครื่อง dev (CX23 4GB/40GB): ข้ามขั้นนี้**
> กู้คืนจากไฟล์ต้นฉบับ 2 ไฟล์ได้อยู่แล้ว (`dbwins_worldfert9_db_202607021642.bak`, `dump-db_truckscale-202607212333.sql`)
> และ backup รายวันกินดิสก์ ~1GB/รอบ ไม่คุ้มบนดิสก์ 40GB
>
> 🔴 **เครื่อง production: ต้องทำ** — ทำตามด้านล่าง (ค่าเริ่มต้นตั้งไว้ที่ 3 วัน · ถ้าดิสก์ 80GB+ ปรับเป็น 14 วันได้)

```bash
mkdir -p /opt/wf
cp /root/backup-databases.sh /opt/wf/ && chmod +x /opt/wf/backup-databases.sh
cp /root/backup.env.example /opt/wf/backup.env && chmod 600 /opt/wf/backup.env
nano /opt/wf/backup.env          # ใส่รหัสผ่าน + OFFSITE_RSYNC_TARGET
/opt/wf/backup-databases.sh --dry-run
crontab -e
```
```cron
15 2 * * *  /opt/wf/backup-databases.sh >> /var/log/wf-backup.log 2>&1
```

✅ **ตรวจ:** รันจริง 1 ครั้ง → มีไฟล์ใน `/var/backups/wf/` และ log ลงท้ายว่า `BACKUP OK`

---

## ขั้น 10 — ปิดงาน

- [ ] TruckScale: repoint ซอฟต์แวร์ตาชั่งหน้างานไป MySQL ใหม่ (**ทำท้ายสุด** วางแผน cutover)
- [ ] ลบ Railway MSSQL service + volume 75 GB (คิดเงินตามขนาดที่จอง)
- [ ] Azure: ลบ `sqlserver-rg` + disk + public IP
- [ ] ลบไฟล์ `.bak`/`.sql` ใน `/root/backup/` (คืนเนื้อที่)
- [ ] **ทดสอบ restore จริงจาก backup** อย่างน้อยเดือนละครั้ง

---

## แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| backend ต่อ DB ไม่ได้ | ใช้ `DB_HOST` แทน `REMOTE_DB_SERVER` · หรือไม่ได้อยู่ network `wf-net` เดียวกัน |
| `Login failed for user 'sa'` | `REMOTE_DB_PASSWORD` ≠ `MSSQL_SA_PASSWORD` |
| mssql restart วนลูป | ดู `docker logs mssql` — ถ้าเป็น OOM ให้เพิ่ม swap / ลด memory limit |
| SSMS ต่อ `localhost,14330` ไม่ได้ | tunnel ไม่ได้เปิด · หรือ compose ไม่มี `127.0.0.1:1433:1433` |
| ข้อความไทยเพี้ยน | container ไม่ได้ตั้ง `MSSQL_COLLATION=Thai_CI_AS` |
| วันที่คลาดไป 1 วัน | ลืม `TZ=Asia/Bangkok` ใน container |
| restore แล้ว `wf` ว่าง | ยังไม่ได้ `npm run migrate` |
