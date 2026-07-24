---
documentId: "WF-SEC-012"
title: "Docker Deployment Guide"
version: "v1.1"
status: Released
owner: "Security / DevOps Lead"
normative: true
---
> **World Fert · WS-Sale-App — Enterprise Documentation v1.0**
> Document ID: `WF-SEC-012` · Version: v1.1 · Date: 24 กรกฎาคม 2569 (24 July 2026) · Status: Released
> Classification: Confidential — Client / Authorized Partner Use Only
> Source of truth: operational build v1.0 · verified against `dbwins_worldfert9`

---
# Docker Deployment Guide

คู่มือ deploy ด้วย Docker — ครอบคลุมทั้ง **On-Prem** และ **Coolify (cloud)**

> **v1.1 (2026-07-24)** — ปรับให้ตรงกับสถาปัตยกรรมจริง: เพิ่ม Coolify/Hetzner, ย้าย on-prem ไปใช้
> ชุดไฟล์ `deploy/onprem/`, เพิ่มขั้นตอน `seed_admin.js` ที่ขาดหายไป, ตัดวิธี Railway ที่เลิกใช้กับ SQL Server
> เอกสารภาพรวมการเลือกปลายทาง deploy อยู่ที่ `DEPLOY.md` (root ของ repo)

---

## 1. ปลายทาง deploy ที่รองรับ

| | **A · Cloud PaaS** | **B · Coolify + VPS** | **C · On-Prem** |
|---|---|---|---|
| Frontend | Vercel | Coolify → `wf-frontend` | container `wf-frontend` |
| Backend | Railway | Coolify → `wf-backend` | container `wf-backend` |
| SQL Server | VM แยก (Azure) | container `wf-databases` | container `wf-mssql` |
| MySQL | remote | container `wf-databases` | container `wf-mysql` |
| TLS | platform จัดให้ | Coolify (Traefik) | Caddy (Let's Encrypt) |
| ชุดไฟล์ | `vercel.json`, `backend/Dockerfile` | `deploy/coolify/` | `deploy/onprem/` |

> 🚫 **SQL Server 2022 รันบน Railway ไม่ได้** — `sqlpal` เจอ misaligned log IO / stack overflow
> เพราะ storage layer ของ Railway ไม่รองรับ IO alignment ที่ต้องการ ลอง trace flag / memory limit /
> volume / UID มาแล้วทั้งหมด ไม่ช่วย **อย่าพยายามซ้ำ** — Railway ใช้ได้เฉพาะ backend (Node)

---

## 2. โครงสร้างไฟล์ที่เกี่ยวข้อง

```
winspeed-frontend/
├── backend/Dockerfile           Node 22 Alpine
├── WSSale-App/
│   ├── Dockerfile               multi-stage: Vite build -> nginx
│   └── nginx.conf               SPA fallback + static caching
├── deploy/
│   ├── coolify/                 ปลายทาง B
│   │   ├── docker-compose.yml       SQL Server + MySQL
│   │   ├── provision-customer.ps1   wizard ติดตั้งลูกค้าใหม่
│   │   ├── refresh-data.sh          เปลี่ยนข้อมูลตั้งต้น
│   │   ├── tunnel.ps1 / .bat        SSH tunnel สำหรับ SSMS/DBeaver
│   │   └── RUNBOOK.md · CLONE-RECIPE.md
│   ├── onprem/                  ปลายทาง C
│   │   ├── docker-compose.yml       Caddy + mssql + mysql + backend + frontend
│   │   ├── Caddyfile · .env.example
│   │   ├── up.ps1 / up.bat / up.sh  ติดตั้งคำสั่งเดียว
│   │   └── bootstrap.sh             restore + migrate + seed
│   └── LINE-LOGIN-GUIDE.md
└── docker-compose.yml           legacy — dev/ทดลองเท่านั้น (ดูข้อ 6)
```

---

## 3. Option C — On-Prem (แนะนำสำหรับ self-host)

รันครบทุกอย่างบนเครื่องเดียว ใช้ได้ทั้ง Docker Desktop (Windows) และ Ubuntu

### Prerequisites
```bash
# Ubuntu
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker
docker compose version        # ต้องเป็น v2.x
```
Windows: ติดตั้ง Docker Desktop + Git for Windows · ตั้ง RAM ให้ Docker ≥ 6 GB

**ความต้องการขั้นต่ำ:** RAM 8 GB · ดิสก์ว่าง 30 GB · **CPU x86-64 เท่านั้น**
(SQL Server ไม่มี image ARM64 — Mac M-series / Raspberry Pi รันไม่ได้)

### ขั้นตอน
```bash
cd deploy/onprem
cp .env.example .env          # Windows: copy .env.example .env
# แก้ .env: APP_DOMAIN, API_DOMAIN, VITE_API_BASE_URL, CORS_ORIGIN
#           และรหัสผ่านทุกตัวที่ขึ้นต้นด้วย CHANGE_ME

# วางไฟล์ข้อมูลตั้งต้น
#   ./backup/xxx.bak   -> SQL Server (WINSpeed)
#   ./backup/xxx.sql   -> MySQL (TruckScale)

bash up.sh                    # Ubuntu
up.bat                        # Windows (ดับเบิลคลิกได้)
```

`up.*` จะตรวจ Docker → ตรวจ `.env` → `docker compose up -d --build` → เรียก `bootstrap.sh`

### bootstrap.sh ทำอะไร
```
1) รอ container healthy (SQL Server boot ~90 วินาที)
2) สร้าง LOGIN wf_reader / wf_owner
3) RESTORE .bak  + ตั้ง RECOVERY SIMPLE + ย่อ log
4) สร้าง DATABASE USER (restore ลบทิ้งทุกครั้ง)
5) import MySQL dump
6) node run_migrations.js       สร้าง schema wf
7) GRANT CONTROL/SELECT ON SCHEMA::wf
8) node seed_admin.js           สร้าง admin + พนักงาน
```
รันซ้ำได้ปลอดภัย · `--restore` บังคับทับ · `--no-restore` ข้าม restore

### TLS + DDNS
Caddy ขอใบรับรอง Let's Encrypt ให้อัตโนมัติ ต้องมี:
- DDNS (No-IP / DuckDNS / Cloudflare) ชี้มาที่ IP สาธารณะของเครื่อง
- forward **port 80 และ 443** ที่ router (ต้องมี 80 ด้วย ใช้ตอน ACME challenge)

ใช้ในวง LAN อย่างเดียว → ตั้ง `APP_DOMAIN=localhost` (Caddy ออกใบรับรองภายในให้)

### คำสั่งที่ใช้บ่อย
```bash
bash up.sh --down             # หยุด (ข้อมูลใน volume ไม่หาย)
bash up.sh --rebuild          # build ใหม่ทั้งหมด
docker compose logs -f backend
git pull && docker compose up -d --build && bash bootstrap.sh --no-restore
```

---

## 4. Option B — Coolify + VPS

ดูขั้นตอนเต็ม 10 ขั้นที่ **`deploy/coolify/RUNBOOK.md`**
ติดตั้งให้ลูกค้าใหม่ใช้ wizard: **`deploy/coolify/provision-customer.bat`**

สรุปประเด็นเฉพาะของ Coolify:
- สร้าง resource เป็น **Docker Compose Empty** สำหรับ DB และ **Application** สำหรับ backend/frontend
- ใช้ `${VAR}` เปล่าๆ ใน compose — Coolify แปล `${VAR:?ข้อความ}` ผิด (เอาข้อความ error มาเป็นค่า)
- Coolify ทับ `container_name` เป็น `<service>-<uuid>` → สคริปต์ที่อ้างชื่อ container ต้องรับค่าจาก env
- เปิด **Connect To Predefined Network** ให้ compose service (Application เข้า network `coolify` เอง)
- บน network `coolify` ต้องใช้ **ชื่อ container เต็ม** — alias สั้น `mssql`/`mysql` ใช้ไม่ได้
- repo Private ต้องใช้ **Deploy Key** ไม่ใช่ Public Repository

---

## 5. Option A — Railway (เฉพาะ backend) + Vercel (frontend)

**Railway** — Builder = Dockerfile (detect จาก `backend/Dockerfile`) · Networking port ต้องตรง `PORT`
**Vercel** — `vercel.json` ตั้งไว้แล้ว (build `WSSale-App/dist`, SPA rewrite, `.vercelignore` ตัด `backend/`)

Environment Variables ที่ต้องตั้ง ดูตารางในข้อ 7

> ⚠️ `VITE_*` ถูก **bake ตอน build** → เปลี่ยนโดเมนแล้วต้อง **rebuild** ไม่ใช่ restart

---

## 6. `docker-compose.yml` ที่ root — ใช้เฉพาะ dev

ไฟล์ที่ root เป็นของเดิม เหมาะกับการทดลองในเครื่องเท่านั้น **อย่าใช้กับ production** เพราะ:
- ไม่ได้ตั้ง `MSSQL_COLLATION=Thai_CI_AS` → เสี่ยง collation conflict ตอน join คอลัมน์ภาษาไทย
- ไม่ได้ตั้ง `TZ=Asia/Bangkok` → วันที่คลาดไป 1 วัน (ข้อมูลเป็น พ.ศ./เวลาไทย)
- เปิด port `1433`/`3306` สู่ทุก interface (ควรผูก `127.0.0.1` เท่านั้น)
- ไม่มี reverse proxy / TLS
- ไม่มีขั้น restore / migrate / seed

**production ให้ใช้ `deploy/onprem/` แทน**

---

## 7. Environment Variables

> 🚨 โค้ด **ไม่รู้จัก** `DB_HOST` / `DB_PORT` — ตั้งไปก็ไม่มีผล และจะ fallback ไป IP เดิมเงียบๆ

| ตัวแปร | ค่า | หมายเหตุ |
|---|---|---|
| `DB_MODE` | `remote` | บน Linux/container ต้องเป็น `remote` เสมอ (`local` = Windows Trusted Connection) |
| `REMOTE_DB_SERVER` | ชื่อ service/container หรือ IP | บน Coolify ใช้ชื่อเต็ม `mssql-<uuid>` |
| `REMOTE_DB_PORT` / `_USER` / `_PASSWORD` | `1433` / `sa` / … | |
| `DB_NAME` | `dbwins_worldfert9` | |
| `DB_USER` / `DB_PASSWORD` | `wf_reader` / … | อ่านอย่างเดียว |
| `DB_OWNER_USER` / `DB_OWNER_PASSWORD` | `wf_owner` / … | เขียนได้เฉพาะ schema `wf` |
| `MYSQL_HOST/PORT/DATABASE/USER/PASSWORD` | TruckScale | pool แยก ไม่เกี่ยวกับ `DB_MODE` |
| `JWT_SECRET` / `JWT_EXPIRES_IN` | สุ่ม ≥32 ตัว / `8h` | |
| `CORS_ORIGIN` | โดเมน frontend | ต้องตรงเป๊ะ ไม่งั้นโดน CORS block |
| `VITE_API_BASE_URL` | `https://<api>/api` | **bake ตอน build** |
| `MIGRATE_SECRET` · `TS_INGEST_SECRET` | สุ่ม | |
| `TS_SYNC_INTERVAL_MS` | `60000` | |
| `EXPORT_OUTPUT_PATH` | `/app/exports` | |
| `LINE_LOGIN_*` (4 ตัว) | ไม่บังคับ | ดู `deploy/LINE-LOGIN-GUIDE.md` |
| `LINE_CHANNEL_SECRET` · `LINE_CHANNEL_ACCESS_TOKEN` | ไม่บังคับ | Messaging API (OA) — คนละ channel กับ LINE Login |

---

## 8. 🚨 ลำดับการตั้ง DB ครั้งแรก — ห้ามสลับ

```
1) migrations/000_logins.sql     สร้าง LOGIN (ต้องใช้สิทธิ์ sysadmin)
2) node run_migrations.js        สร้าง schema wf
3) GRANT CONTROL/SELECT ON SCHEMA::wf
4) node seed_admin.js            สร้างผู้ใช้
```

**ทำไมลำดับสำคัญ:** `001_wf_schema.sql` ครอบ GRANT ไว้ด้วย `IF EXISTS (... sys.database_principals ...)`
ถ้า `wf_reader`/`wf_owner` ยังไม่มีตอนนั้น **มันจะข้าม GRANT ไปเงียบๆ ไม่มี error** ผลคือ `wf_owner`
ไม่มีสิทธิ์เขียน schema `wf` และ backend พังแบบหาสาเหตุยาก

**ทำไมขั้น 4 ขาดไม่ได้:** ไฟล์ `.bak` ของ WINSpeed **ไม่มี schema `wf`** หลัง migrate ตาราง
`wf.AppUser` จะมีแต่บัญชี `emp-XXXXX` จาก `011_seed_sales_users_giveaway.sql` ซึ่ง **role `SALES` ทั้งหมด
ไม่มี ADMIN เลย** → **login ไม่ผ่านทุกบัญชี**

`seed_admin.js` สร้าง `admin` / `W0rldF3rt` (**`W0rld` ใช้เลขศูนย์**) + map role จริงจาก `dbo.EMEmp`
(EmpGroupID 2000→MANAGER · 2001 หรือ Dept 2004/2005→WAREHOUSE · Dept 2000/2001→ACCOUNTING · ที่เหลือ SALES)
+ ผูก `EmpId` ที่จำเป็นต่อการ export SO กลับ WINSpeed

> ❌ อย่า insert `wf.AppUser` เองด้วย SQL — จะไม่ได้ role/EmpId ที่ถูกต้อง
> ❌ อย่าใช้ `migrations/uat_create_admin.sql` — ถูกกันด้วย pattern `^uat_` โดยตั้งใจ และมีบั๊ก
> 🔐 พนักงานทุกคนได้รหัสเริ่มต้นเดียวกัน — **บังคับเปลี่ยนก่อน go-live**

**RESTORE ทับเมื่อไหร่ ต้องทำขั้น 1–4 ใหม่ทุกครั้ง** (restore ลบ schema `wf` และ database user ทิ้ง)
ใช้ `deploy/coolify/refresh-data.sh` หรือ `deploy/onprem/bootstrap.sh --restore` ที่ทำครบให้แล้ว

---

## 9. ตรวจหลัง deploy

```bash
docker exec -it <backend> node scripts/preflight-check.js   # env + DB + collation + wf + MySQL
curl https://<api-domain>/api/health                        # {"ok":true, db: up/up}
npm run smoke:queries && npm run smoke:api:local            # smoke test (local)
```
แล้วทำ manual UAT: SO, Rebate Plan, Giveaway approval, Customer Request, LINE Login,
Access As, WINSpeed Quotation, TruckScale live sync

---

## 10. Troubleshooting

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| login ไม่ผ่านทุกบัญชี | ยังไม่ได้รัน `seed_admin.js` · หรือพิมพ์ `WOrld` แทน `W0rld` (เลขศูนย์) |
| 401 ทั้งที่รหัสถูก | บัญชีถูก `IsActive=0` — login เช็ค `IsActive` **ก่อน** `bcrypt.compare` |
| Frontend "Failed to fetch" | `VITE_API_BASE_URL` ผิด → แก้แล้ว **rebuild** (ไม่ใช่ restart) |
| Backend ต่อ DB ไม่ได้ | ใช้ `DB_HOST` แทน `REMOTE_DB_SERVER` · หรือไม่ได้อยู่ network เดียวกัน |
| ข้อความไทยเพี้ยน | container ไม่ได้ตั้ง `MSSQL_COLLATION=Thai_CI_AS` (ต้อง restore ใหม่บน container ที่ตั้งถูก) |
| วันที่คลาด 1 วัน | ลืม `TZ=Asia/Bangkok` |
| `wf` ว่างหลัง restore | ยังไม่ได้รัน `run_migrations.js` |
| `wf_owner` เขียนไม่ได้ | GRANT ถูกข้ามเพราะสร้าง login หลัง migrate → รัน GRANT ย้อนหลัง (ข้อ 8) |
| Port 80 ถูกใช้อยู่ | แก้ `HTTP_PORT` ใน `.env` (on-prem) |
| Caddy ขอใบรับรองไม่ได้ | port 80 ไม่ได้ forward · DDNS ยังไม่อัปเดต IP · ISP บล็อก port 80 |
| SSMS ต่อผ่าน tunnel ไม่ได้ | ใช้ `127.0.0.1,14330` ไม่ใช่ `localhost` (Windows แปลงเป็น IPv6 แล้ว timeout Error 258) |
| ssh tunnel `bind: Permission denied` | เปิดหน้าต่างแบบ Run as administrator — ใช้หน้าต่างธรรมดา |
| Image build นาน | ครั้งแรกต้องดึง image ~2 GB — ปกติ · `--no-cache` เมื่อต้องการ fresh build |
