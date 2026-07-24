# WS-Sale-App — คู่มือรัน & Deploy

## 🖥️ รันบนเครื่อง (Local Dev) — คำสั่งเดียว
```powershell
cd C:\MyWork\WorldFert\winspeed-frontend
npm run dev
```
- `[API]` backend → http://localhost:3000
- `[WEB]` frontend → http://localhost:5173  ← เปิดเบราว์เซอร์ที่นี่
- ปิด: **Ctrl+C**

> ครั้งแรก/หลัง clone: รัน `npm install` ใน `backend` และ `WSSale-App` ก่อน
> **Login เริ่มต้น: `admin` / `W0rldF3rt`** — ⚠️ `W0rld` ใช้ **เลขศูนย์ (0)** ไม่ใช่ตัวอักษร O
> พนักงาน (`emp-XXXXX`) ใช้รหัสเริ่มต้นเดียวกัน · ทั้งหมดสร้างโดย `backend/seed_admin.js`
> ดูสิทธิ์แต่ละ role เพิ่มเติมใน README หรือ UAT Workbook

---

## 🔌 เลือกโหมดเชื่อมต่อ SQL Server  (`backend/.env` → `DB_MODE`)

| โหมด | Auth | ใช้เมื่อ | Driver |
|---|---|---|---|
| **`local`** | Windows Authentication | dev บนเครื่องนี้ (`.\SQLEXPRESS`) | msnodesqlv8 (named-pipe) |
| **`remote`** | SQL Server Authentication (`sa`) | server กลาง / cloud | tedious/TCP (ข้ามแพลตฟอร์มได้) |

**สลับโหมด** — แก้ `backend/.env`:
```ini
# โหมด local (ค่าเริ่มต้น)
DB_MODE=local
LOCAL_DB_SERVER=localhost\SQLEXPRESS

# โหมด remote — เปลี่ยนเป็น
DB_MODE=remote
REMOTE_DB_SERVER=<IP หรือชื่อ service ปลายทาง>
REMOTE_DB_PORT=1433
REMOTE_DB_USER=sa
REMOTE_DB_PASSWORD=<<ใส่ sa password ที่นี่>>
```
> remote ต้องเปิด TCP/IP + เปิด port 1433 ที่ firewall ของ SQL Server ปลายทาง
> ⚠️ โค้ด **ไม่รู้จัก** `DB_HOST` / `DB_PORT` — ถ้าตั้งชื่อผิดจะ fallback ไป IP เดิมเงียบๆ
> ⚠️ `DB_MODE=local` ใช้ได้เฉพาะ Windows · บน Linux/container ต้องเป็น `remote` เสมอ

---

# 🎯 ปลายทาง Deploy — เลือกได้ 3 แบบ

ทั้งสองระบบ trigger ด้วย **`git push origin main`** เหมือนกัน จึงเลือกได้ว่าจะขึ้นที่ไหน

| | **A · ระบบหลัก (เดิม)** | **B · ระบบสำรอง (ใหม่)** |
|---|---|---|
| Frontend | **Vercel** | **Coolify** → `wf-frontend` |
| Backend | **Railway** | **Coolify** → `wf-backend` |
| SQL Server | **Azure VM** `20.255.185.14` | **Coolify** → `wf-databases` (container) |
| MySQL (TruckScale) | remote เดิม | **Coolify** → `wf-databases` (container) |
| Trigger | push → Vercel/Railway auto | push → Coolify webhook |
| ค่าใช้จ่าย | Vercel free + Railway + Azure ~$32/ด. | Coolify $5 + Hetzner ~$8 = **~$13/ด.** |

**วิธีเลือก**
| ต้องการ | ทำอย่างไร |
|---|---|
| **A อย่างเดียว** | ค่าเริ่มต้น — ไม่ต้องตั้ง webhook ฝั่ง Coolify |
| **B อย่างเดียว** | ปิด auto-deploy ที่ Vercel/Railway (Settings → Git) แล้วตั้ง webhook Coolify |
| **ทั้งสอง** (แนะนำช่วง transition) | เปิด auto ทั้งคู่ · push ครั้งเดียวขึ้นทั้ง 2 ที่ |

> ⚠️ **สำคัญเมื่อเปิดทั้งสอง:** DB คนละตัว **ข้อมูลไม่ sync กัน** — A ใช้ Azure, B ใช้ container บน Hetzner
> ใช้ B เป็น staging / DR / ทดสอบได้ แต่**ห้ามให้ผู้ใช้จริงคีย์งานพร้อมกันทั้ง 2 ระบบ**

---

## 🚀 การ Deploy สู่ Production (CI/CD Pipeline)

ระบบ Deploy อัตโนมัติผ่าน GitHub Webhooks โดยใช้สคริปต์ `deploy.ps1` ซึ่งจัดการให้ครบจบในคำสั่งเดียว:
1. **Bump Version**: ปรับเลขเวอร์ชันใน `package.json` อัตโนมัติ (Root, Backend, Frontend)
2. **Database Migrations**: รัน SQL Scripts อัปเดต Schema บน Remote Server (`node run_migrations.js`)
3. **Commit & Push**: บันทึกการเปลี่ยนแปลงแล้วส่งโค้ดขึ้น GitHub
4. **Trigger Deploy**: การ Push ไปยังกิ่ง `main` สั่งให้ Platform ปลายทางดึงโค้ดไป Build:
   - **A** — Backend ผ่าน **Railway** · Frontend ผ่าน **Vercel**
   - **B** — Backend + Frontend ผ่าน **Coolify** (ต้องตั้ง webhook ครั้งเดียว ดูหัวข้อ B)

### 📦 คำสั่งสำหรับ Deploy
(รันจาก Root Directory)

- `npm run deploy` : ขยับเวอร์ชัน (Patch `1.0.0` → `1.0.1`), Migrate DB Remote, push ขึ้น Production
- `npm run deploy:minor` : ขยับเวอร์ชันระดับ Minor (`1.0.0` → `1.1.0`)
- `npm run deploy:major` : ขยับเวอร์ชันระดับ Major (`1.0.0` → `2.0.0`)
- `npm run deploy:skip-migrate` : ข้าม DB Migration (ใช้เมื่อต่อ Remote DB จากเครื่องตัวเองไม่ได้)
- `npm run deploy:dry` : จำลองการ Deploy (Dry run) ไม่แก้ไฟล์และไม่ push จริง

> `deploy.ps1` migrate **ทุกปลายทาง** เป็นค่าเริ่มต้น · เลือกเฉพาะบางที่ด้วย `-Targets`
> ```powershell
> .\deploy.ps1 -Targets remote_b        # เฉพาะ Coolify
> .\deploy.ps1 -Targets local,remote    # เฉพาะที่ระบุ
> ```

### 🛠️ คำสั่งจัดการฐานข้อมูล (Migrations) อย่างเดียว

**ค่าเริ่มต้นคือ `all` — ยิงทุกปลายทางเสมอ** เพราะระบบใกล้ production แล้ว schema ต้องไม่หลุดกัน

| คำสั่ง | ปลายทาง |
|---|---|
| `npm run migrate` | **ทุกที่** (local + remote + remote_b) ← ค่าเริ่มต้น |
| `npm run migrate:plan` | ทุกที่ · read-only ไม่แตะ ledger |
| `npm run migrate:local` | local (SQLEXPRESS) |
| `npm run migrate:remote` | remote — Azure (ระบบหลัก) |
| `npm run migrate:remote_b` | remote_b — Coolify (ระบบสำรอง) |
| `npm run migrate:plan:<target>` | plan เฉพาะปลายทางนั้น |

พฤติกรรมของ `scripts/migrate-targets.js`:
- **remote_b เปิด SSH tunnel ให้อัตโนมัติ** แล้วปิดหลังเสร็จ · ถ้าเปิดค้างไว้เองอยู่แล้วจะ**ใช้ร่วมและไม่ไปปิดของคุณ**
- ปลายทางที่ยังไม่ตั้งค่าใน `.env` → **ข้าม** (ไม่ทำให้พัง) · `local` ถูกข้ามอัตโนมัติบน Linux
- รันต่อจนครบทุกปลายทางแล้วค่อยสรุป · ใส่ `--stop-on-error` ถ้าอยากให้หยุดทันทีที่พลาด
- **exit 1 ถ้ามีปลายทางใดล้มเหลว** → `deploy.ps1` จะหยุดก่อน push

ตัวอย่างผลลัพธ์ที่ต้องการเห็น (schema ตรงกันทั้ง 3):
```
=== สรุป ===
  ✓ สำเร็จ  local
  ✓ สำเร็จ  remote
  ✓ สำเร็จ  remote_b
✓ ครบทุกปลายทาง — schema ตรงกัน
```

**ตั้งค่า remote_b** — เพิ่มใน `backend/.env` (ดูตัวอย่างครบใน `.env.example`):
```ini
REMOTE_B_DB_SERVER=127.0.0.1      # ปลาย tunnel ฝั่งเรา
REMOTE_B_DB_PORT=14330
REMOTE_B_DB_USER=sa
REMOTE_B_DB_PASSWORD=<sa password ของ Coolify>
REMOTE_B_SSH_HOST=178.104.120.21  # ใส่เพื่อให้เปิด tunnel อัตโนมัติ
REMOTE_B_SSH_USER=root
REMOTE_B_SSH_KEY=C:\Users\<you>\.ssh\wf-key
```

---

## A · ระบบหลัก — Vercel + Railway + Azure

### Environment Variables
- **Vercel (Frontend)**: `VITE_API_BASE_URL=https://<your-railway-domain>/api` และ `VITE_USE_MOCKUP_DATA=false`
- **Railway (Backend)**: `DB_MODE=remote` + `REMOTE_DB_SERVER=20.255.185.14` + credentials + `CORS_ORIGIN=https://<your-vercel-domain>`

> `VITE_*` ถูก **bake ตอน build** → เปลี่ยนค่าแล้วต้อง **rebuild** ไม่ใช่ restart

### โหมด Demo Mock (ไม่ต้องมี backend)
`vercel.json` ตั้ง `VITE_USE_MOCKUP_DATA=true` เป็นค่าเริ่มต้น → ใช้ข้อมูลตัวอย่างจาก `src/mock/sample-data.json`
รีเฟรช sample data: `cd backend && node export_sample.js` (DB_MODE=local) แล้ว commit

### ข้อควรระวัง
- ⚠️ **เครดิต Azure หมดเคยทำให้ VM ถูกบล็อก** — เช็คสถานะ VM ก่อน deploy ทุกครั้ง
- ⚠️ **SQL Server 2022 รันบน Railway ไม่ได้** (`sqlpal` เจอ misaligned log IO / stack overflow) — อย่าย้ายมา Railway

---

## B · ระบบสำรอง — Coolify + Hetzner

ทุกอย่าง (frontend + backend + SQL Server + MySQL) อยู่บนเครื่องเดียว จัดการผ่าน Coolify Cloud

| | ค่า |
|---|---|
| Server | Hetzner CX23 · `178.104.120.21` · Nuremberg |
| Coolify | `app.coolify.io` → server `worldfert-dev` |
| Frontend | https://app.178-104-120-21.sslip.io |
| Backend | https://api.178-104-120-21.sslip.io |
| Resources | `wf-frontend` (`/WSSale-App`) · `wf-backend` (`/backend`) · `wf-databases` (compose) |

### ตั้ง webhook ให้ push แล้ว deploy อัตโนมัติ (ทำครั้งเดียว)
Coolify เปิด **Auto Deploy** ไว้แล้ว แต่ repo แบบ Public Repository ต้องต่อ webhook เอง:

1. Coolify → resource (`wf-backend` แล้วทำซ้ำกับ `wf-frontend`) → แท็บ **Webhooks** → คัดลอก **GitHub webhook URL**
2. GitHub → repo → **Settings → Webhooks → Add webhook**
   - Payload URL = URL ที่คัดลอกมา
   - Content type = `application/json`
   - Events = **Just the push event**

> 🔐 webhook URL มี token ในตัว — **ห้าม commit ลง repo** (repo นี้เป็น public)
> ถ้าไม่ตั้ง webhook: เข้า Coolify แล้วกดปุ่ม **Deploy** ของแต่ละ resource เองได้ตลอด

### Environment Variables ฝั่ง Coolify
ตั้งที่ resource → **Environment Variables → Developer view** (วางทีเดียวทั้งบล็อก)

> ⚠️ Coolify แปลง `${VAR:?ข้อความ}` ผิด — เอา*ข้อความ error*มาเป็นค่า → ใช้ `${VAR}` เปล่าๆ ใน compose
> ⚠️ ชื่อ host ของ DB ต้องใช้ **ชื่อ container เต็ม** (`mssql-<uuid>`) — alias สั้น `mssql` ใช้ไม่ได้บน network `coolify`
> ดูชื่อจริง: `docker ps --format '{{.Names}}'`

### เอกสารเต็ม
- ขั้นตอน deploy ทีละขั้น (10 ขั้น) → **`deploy/coolify/RUNBOOK.md`**
- โคลนให้ลูกค้า / ส่งมอบระบบ → **`deploy/coolify/CLONE-RECIPE.md`**

---

## 🔁 เข้าถึง DB ฝั่ง B ด้วยมือ (SSMS / DBeaver)

`npm run migrate` เปิด tunnel ให้เองอยู่แล้ว แต่ถ้าจะเปิด SSMS/DBeaver ต้องเปิดค้างไว้เอง

**วิธีที่ง่ายที่สุด — ดับเบิลคลิก `deploy\coolify\tunnel.bat`**
(เช็คสิทธิ์/คีย์/พอร์ตให้ครบ แล้วแสดงค่าที่ต้องกรอกใน SSMS/DBeaver)

หรือสั่งเอง:
```powershell
ssh -N -L 14330:127.0.0.1:1433 -L 33060:127.0.0.1:3306 -i $env:USERPROFILE\.ssh\wf-key root@178.104.120.21
```

> 🚨 **ห้ามเปิดหน้าต่างแบบ Run as administrator** — `ssh` บน Windows จะ bind พอร์ต loopback ไม่ได้
> จะขึ้น `bind [127.0.0.1]:14330: Permission denied` · port forwarding ที่พอร์ต > 1024 ไม่ต้องใช้สิทธิ์ admin
| เครื่องมือ | ค่าเชื่อมต่อ |
|---|---|
| **SSMS** | **`127.0.0.1,14330`** ← **คอมมา ไม่ใช่ colon** · SQL Auth `sa` · ☑ Trust server certificate |
| **DBeaver (MySQL)** | `127.0.0.1:33060` · db `db_truckscale` · user `wfapp` |

> 🚨 **ห้ามใช้ `localhost` กับ SSMS** — Windows แปลง `localhost` เป็น **IPv6 `::1`** ก่อน
> แต่ SSH tunnel ผูกเฉพาะ **IPv4 `127.0.0.1`** → ODBC ยิงไป IPv6 แล้วรอจน timeout
> ขึ้น `TCP Provider: The wait operation timed out (Error 258)` ทั้งที่ tunnel ทำงานปกติ
> วัดจริง: `127.0.0.1,14330` ต่อได้ 2.7 วิ · `localhost,14330` fail ที่ 21 วิ
> (DBeaver/JDBC ไม่เจอปัญหานี้เพราะ fallback ไป IPv4 เองได้)

> หรือรัน migration ในเครื่องปลายทางตรงๆ: `docker exec -it <backend-container> node run_migrations.js`

---

## 🆕 ตั้งค่าครั้งแรกบน DB ใหม่ (ใช้กับทั้ง A และ B)

ลำดับนี้ **ห้ามสลับ** — ผิดลำดับแล้ว GRANT จะถูกข้ามเงียบๆ และ login ไม่ได้ทั้งระบบ

```bash
cd backend

# 1) สร้าง login/user — ต้องสิทธิ์ sysadmin · ถูกกันออกจาก migration policy โดยตั้งใจ
#    ⚠️ เปลี่ยนรหัสผ่านในไฟล์ก่อนรัน (ค่าเริ่มต้นเป็น placeholder)
#    รันผ่าน sqlcmd หรือ SSMS: migrations/000_logins.sql

# 2) รัน migrations ทั้งหมด
node run_migrations.js

# 3) seed ผู้ใช้  ← ขั้นนี้ลืมไม่ได้
node seed_admin.js
```

**ทำไมขั้น 3 จำเป็น:** migration `011_seed_sales_users_giveaway.sql` สร้างแต่บัญชี `emp-XXXXX`
role `SALES` ทั้งหมด **ไม่มี ADMIN สักบัญชี** → login ไม่ผ่านทุกบัญชี ระบบไม่มีใครดูแลได้

`seed_admin.js` ทำ 3 อย่าง:
1. สร้าง **`admin` / `W0rldF3rt`** (role ADMIN)
2. อ่าน `dbo.EMEmp` (พนักงานที่ยังไม่ลาออก) → สร้าง/อัปเดต user พร้อม **role จริง**
   (`EmpGroupID=2000`→MANAGER · `2001` หรือ Dept `2004/2005`→WAREHOUSE · Dept `2000/2001`→ACCOUNTING · ที่เหลือ SALES)
   และผูก **`EmpId` ↔ `EMEmp.EmpID`** — จำเป็นต่อการ export SO กลับ WINSpeed
3. ตั้ง `IsActive=0` ให้บัญชีที่ไม่อยู่ในรายการ

> ❌ **อย่า** insert `wf.AppUser` เองด้วย SQL — จะไม่ได้ role และ `EmpId` ที่ถูกต้อง
> ❌ **อย่า** ใช้ `migrations/uat_create_admin.sql` — เป็นของ UAT ถูกกันด้วย pattern `^uat_` โดยตั้งใจ
>    และมีบั๊ก (เช็คชื่อ `uat_admin` แต่ insert `admin`)
>    รายละเอียด: `docs/enterprise/08-APPENDICES/MIGRATION-LEDGER-AUDIT-2026-07-22.md`
> 🔐 พนักงานทุกคนได้รหัสเริ่มต้นเดียวกัน — **ต้องบังคับเปลี่ยนก่อน go-live**

ข้อมูลของแถม (`GiveawayItem`, `GiveawayItemMapping`) seed จาก migration `047`–`049` แล้ว
**ไม่ต้อง**รันสคริปต์ import แยก

---

## 🩺 ตรวจความพร้อมก่อน/หลัง Deploy
```bash
cd backend
node scripts/preflight-check.js            # ตรวจ env + DB + collation + wf schema + MySQL
node scripts/preflight-check.js --no-db    # ตรวจเฉพาะชื่อ env
```

## 🔧 ปัญหาที่พบบ่อย
| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| login ไม่ผ่านทุกบัญชี | ยังไม่ได้รัน `node seed_admin.js` · หรือพิมพ์ `WOrld` (ตัว O) แทน `W0rld` (เลขศูนย์) |
| 401 ทั้งที่รหัสถูก | บัญชีถูก `IsActive=0` — login เช็ค `IsActive` **ก่อน** `bcrypt.compare` |
| backend ต่อ DB ไม่ได้ | ใช้ `DB_HOST` แทน `REMOTE_DB_SERVER` · หรือไม่ได้อยู่ Docker network เดียวกัน |
| frontend เรียก API ผิด URL | `VITE_API_BASE_URL` bake ตอน build → ต้อง **rebuild** ไม่ใช่ restart |
| ข้อความไทยเพี้ยน | container ไม่ได้ตั้ง `MSSQL_COLLATION=Thai_CI_AS` |
| `wf` ว่างหลัง restore | ยังไม่ได้รัน `node run_migrations.js` |
| วันที่คลาด 1 วัน | ลืมตั้ง `TZ=Asia/Bangkok` ใน container |
