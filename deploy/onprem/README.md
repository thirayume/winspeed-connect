# แผน C — On-Prem / Self-Hosted (Docker Compose ครบชุด)

รันทุกอย่างบนเครื่องเดียวด้วยคำสั่งเดียว — ไม่ต้องมี Coolify, ไม่ต้องเช่า VPS
ใช้ได้ทั้ง **Docker Desktop บน Windows** และ **Ubuntu server** เข้าถึงจากภายนอกผ่าน **DDNS**

```
┌─────────────────── เครื่องเดียว (PC หรือ Ubuntu) ───────────────────┐
│  Caddy  :80/:443   TLS อัตโนมัติ (Let's Encrypt ผ่าน DDNS)          │
│    ├── frontend    nginx + React (build จาก /WSSale-App)            │
│    └── backend     Node 22 (build จาก /backend)                     │
│          ├── mssql   SQL Server 2022 Express · Thai_CI_AS           │
│          └── mysql   MySQL 8 · TruckScale                           │
│  DB ผูก 127.0.0.1 เท่านั้น — ภายนอกเข้าไม่ถึง                        │
└────────────────────────────────────────────────────────────────────┘
```

## เทียบกับแผนอื่น

| | A · Vercel+Railway+Azure | B · Coolify+Hetzner | **C · On-Prem (นี่)** |
|---|---|---|---|
| ค่าใช้จ่ายรายเดือน | ~$32 | ~$13 | **$0** (ค่าไฟ+เน็ต) |
| ต้องดูแลเอง | น้อย | กลาง | **มากสุด** |
| ข้อมูลอยู่ที่ | cloud | cloud | **ในบริษัท** |
| ต้องมี IP สาธารณะ | ไม่ | ไม่ | **ต้องมี** (หรือ DDNS + forward port) |
| เหมาะกับ | production ทั่วไป | production ประหยัด | ลูกค้าที่ข้อมูลห้ามออกนอกบริษัท · dev/demo · สำรอง |

---

## ติดตั้ง (ครั้งแรก)

### 1. เตรียมเครื่อง

**Windows** — ติดตั้ง [Docker Desktop](https://www.docker.com/products/docker-desktop/) + [Git for Windows](https://git-scm.com/download/win)
ตั้ง RAM ให้ Docker อย่างน้อย **6 GB** (Settings → Resources)

**Ubuntu**
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER    # แล้ว logout/login
```

> ต้องการ RAM รวมอย่างน้อย **8 GB** และดิสก์ว่าง **30 GB**

### 2. ตั้งค่า

```bash
cd deploy/onprem
cp .env.example .env      # Windows: copy .env.example .env
```
แก้ `.env`:
- `APP_DOMAIN` / `API_DOMAIN` — โดเมนหรือ DDNS ที่ชี้มาที่เครื่องนี้
- `VITE_API_BASE_URL` / `CORS_ORIGIN` — ให้สอดคล้องกับโดเมนข้างบน
- รหัสผ่านทุกตัวที่ขึ้นต้นด้วย `CHANGE_ME`

### 3. วางไฟล์ข้อมูล

```
deploy/onprem/backup/
  ├── dbwins_worldfert9_db.bak     ← SQL Server (WINSpeed)
  └── dump-db_truckscale.sql       ← MySQL (TruckScale)
```
(ไม่มีก็รันได้ แต่จะไม่มีข้อมูลตั้งต้น)

### 4. สตาร์ท

| | คำสั่ง |
|---|---|
| **Windows** | ดับเบิลคลิก **`up.bat`** |
| **Ubuntu** | `bash up.sh` |

ครั้งแรกใช้เวลา ~5–15 นาที (build image + restore) เสร็จแล้วเข้า `https://<APP_DOMAIN>` login ด้วย **`admin` / `W0rldF3rt`**

---

## ตั้ง DDNS ให้เข้าถึงจากภายนอก

1. **สมัคร DDNS** — No-IP / DuckDNS / Cloudflare (ฟรี) เช่น `worldfert.ddns.net`
2. **ตั้ง client อัปเดต IP** — ที่ router (ส่วนใหญ่มีในตัว) หรือติดตั้งบนเครื่อง
3. **Forward port ที่ router** → `80` และ `443` มาที่ IP ภายในของเครื่องนี้
4. ใส่ชื่อ DDNS ใน `.env` แล้วรัน `up.bat` / `up.sh` ใหม่

> ✅ Caddy จะขอใบรับรอง Let's Encrypt ให้อัตโนมัติ ไม่ต้องทำอะไรเพิ่ม
> ⚠️ ต้องเปิด port 80 ด้วย (ใช้ตอนยืนยันตัวตนกับ Let's Encrypt) ไม่ใช่แค่ 443

**ใช้ 2 ชื่อ** — ตัวอย่าง `worldfert.ddns.net` (หน้าเว็บ) + `api.worldfert.ddns.net` (API)
ถ้า DDNS ให้ชื่อเดียว ใช้ subdomain ของ Cloudflare หรือแยกด้วย port ก็ได้ (แก้ `API_DOMAIN`)

### ไม่มีโดเมน ใช้ในวง LAN อย่างเดียว
ตั้งใน `.env`:
```ini
APP_DOMAIN=localhost
VITE_API_BASE_URL=http://localhost/api
CORS_ORIGIN=http://localhost
```
Caddy จะออกใบรับรองภายในให้ (เบราว์เซอร์เตือน กด Advanced → Proceed)

---

## คำสั่งที่ใช้บ่อย

| ต้องการ | Windows | Ubuntu |
|---|---|---|
| สตาร์ท/ติดตั้ง | `up.bat` | `bash up.sh` |
| หยุด (ข้อมูลไม่หาย) | `up.bat -Down` | `bash up.sh --down` |
| build ใหม่หมด | `up.bat -Rebuild` | `bash up.sh --rebuild` |
| สตาร์ทเฉย ไม่แตะ DB | `up.bat -SkipBootstrap` | `bash up.sh --skip-bootstrap` |
| ดู log | `docker compose logs -f backend` | เหมือนกัน |
| เปลี่ยนข้อมูลตั้งต้นใหม่ | `bash bootstrap.sh --restore` | เหมือนกัน |

**อัปเดตโค้ด**
```bash
git pull
docker compose up -d --build
bash bootstrap.sh --no-restore     # รัน migrations ใหม่ ไม่แตะข้อมูล
```

---

## เข้าถึงฐานข้อมูล (SSMS / DBeaver)

DB ผูกกับ `127.0.0.1` ของเครื่องนี้ → **ต่อจากเครื่องเดียวกันได้เลย ไม่ต้อง tunnel**

| เครื่องมือ | ค่า |
|---|---|
| SSMS | `127.0.0.1,1433` ← คอมมา · **อย่าใช้ `localhost`** · `sa` · ☑ Trust server certificate |
| DBeaver (MySQL) | `127.0.0.1:3306` · db `db_truckscale` · `wfapp` |

ต่อจาก**เครื่องอื่น**ให้ใช้ SSH tunnel (อย่าเปิด port DB ออก LAN):
```bash
ssh -N -L 14330:127.0.0.1:1433 user@<เครื่องนี้>
```

---

## ⚠️ สิ่งที่ต้องรู้

- **`RESTORE` ทับแล้ว schema `wf` หายทั้งหมด** — `.bak` ของ WINSpeed ไม่มี `wf`
  `bootstrap.sh` จึงสร้าง user + migrate + GRANT + seed ให้ใหม่ทุกครั้งหลัง restore
- **`VITE_API_BASE_URL` ถูก bake ตอน build** — เปลี่ยนโดเมนแล้วต้อง `--build` ใหม่ ไม่ใช่แค่ restart
- **พนักงานทุกคนได้รหัสเริ่มต้น `W0rldF3rt` เหมือนกัน** — บังคับเปลี่ยนก่อนใช้จริง
- **SQL Server ไม่มี image ARM64** — Mac M1/M2 หรือ Raspberry Pi รันไม่ได้ ต้องเป็น x86-64
- **สำรองข้อมูลเอง** — ไม่มีใครทำให้ ใช้ `../coolify/backup-databases.sh` ปรับชื่อ container เป็น `wf-mssql`/`wf-mysql`
- **ไฟดับ/เน็ตหลุด = ระบบล่ม** — ต่างจาก cloud ควรมี UPS ถ้าใช้จริงจัง
- **`caddy-data` volume เก็บใบรับรอง** — อย่าลบ ไม่งั้นต้องขอใหม่ (Let's Encrypt มี rate limit)

## แก้ปัญหา

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| `docker compose up` ค้างนาน | ครั้งแรกต้อง build + ดึง image ~2 GB — ปกติ |
| backend restart วนลูป | ดู `docker compose logs backend` · ส่วนใหญ่คือ DB ยังไม่พร้อม หรือรหัสผ่านใน `.env` ไม่ตรง |
| Caddy ขอใบรับรองไม่ได้ | port 80 ไม่ได้ forward · DDNS ยังไม่ชี้มาที่ IP ปัจจุบัน · ISP บล็อก port 80 |
| SSMS ต่อไม่ได้ | ใช้ `127.0.0.1,1433` ไม่ใช่ `localhost` (Windows แปลงเป็น IPv6 แล้ว timeout) |
| login ไม่ผ่านทุกบัญชี | ยังไม่ได้รัน `bootstrap.sh` (ขั้น seed) · หรือพิมพ์ `WOrld` แทน `W0rld` (เลขศูนย์) |
| ข้อความไทยเพี้ยน | container ไม่ได้ตั้ง `MSSQL_COLLATION=Thai_CI_AS` — ต้อง restore ใหม่บน container ที่ตั้งถูก |
| RAM ไม่พอ / เครื่องอืด | ลด `MSSQL_MEMORY_LIMIT_MB` และ `MYSQL_BUFFER_POOL` ใน `.env` |
