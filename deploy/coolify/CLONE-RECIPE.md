# CLONE-RECIPE — โคลน / ส่งมอบระบบ WS-Sale-App (SaaS / per-customer)

เอกสารนี้ตอบโจทย์ **"1 ลูกค้า = 1 instance แยกกันสมบูรณ์"** — โคลนซ้ำได้เร็ว, ส่งมอบให้ลูกค้าเป็นเจ้าของเองได้

> ระบบเราเป็น **Docker Compose ก้อนเดียว** (SQL Server + MySQL + backend + frontend) บน **self-host Coolify**
> → หน่วยของการโคลนคือ "ทั้งเครื่อง" ไม่ใช่แค่โค้ด → ก็อปได้ทั้งชุด ไม่ผูกกับ provider ใด

---

## 1. หนึ่ง instance ประกอบด้วยอะไร

| ส่วน | แชร์ได้ไหม | หมายเหตุ |
|---|---|---|
| VPS (Hetzner CX32 8GB) | ❌ ต่อลูกค้า 1 เครื่อง | แยก resource/ความปลอดภัยเด็ดขาด |
| self-host Coolify | ❌ อยู่ในเครื่องนั้น | dashboard จัดการของลูกค้ารายนั้น |
| SQL Server + MySQL (compose) | ❌ ข้อมูลลูกค้า | คนละ volume/รหัส |
| backend + frontend | ✅ **โค้ดเดียวกัน** | ต่างกันแค่ env (domain, รหัส, LINE keys) |
| `docker-compose.yml` + สคริปต์ `deploy/coolify/*` | ✅ ใช้ซ้ำทุก instance | คือ "แม่แบบ" |

**สรุป:** โค้ด + compose + สคริปต์ = แม่แบบใช้ซ้ำ · ต่างกันแค่ **ข้อมูล (backup) + env ต่อราย**

---

## 2. สองวิธีโคลน — เลือกตามสถานการณ์

### วิธี A — Snapshot clone (เร็วสุด · ลูกค้าใหม่ในไม่กี่นาที)

ใช้เมื่อ **คุณเป็นคน provision ให้ลูกค้า** และอยู่ Hetzner เหมือนกัน

1. ตั้งเครื่อง "golden" 1 ตัวให้เสร็จสมบูรณ์ (bootstrap + Coolify + compose + restore + migrate)
   — จะ restore ข้อมูล demo หรือปล่อยว่างก็ได้ (แนะนำ **ว่าง** เพื่อไม่พาข้อมูลลูกค้าเก่าติดไป)
2. ปิด container ให้ข้อมูล flush: `cd /data/coolify && docker compose stop` (หรือหยุดจาก Coolify UI)
3. Hetzner Console → เครื่อง golden → **Snapshot → Create**
4. ลูกค้าใหม่: **Create Server → Image = เลือก snapshot นั้น** → ได้เครื่องพร้อมทุกอย่าง
5. เข้าเครื่องใหม่ ทำ **checklist ข้อ 3** (เปลี่ยนรหัส/โดเมน/กุญแจ) แล้ว restore backup ของลูกค้ารายนั้น

> ข้อดี: 5–10 นาที/ราย · ข้อจำกัด: snapshot ผูกกับ Hetzner (ข้ามเจ้าไม่ได้)

### วิธี B — Script clone (พกพา · ข้าม provider ได้)

ใช้เมื่อ **ลูกค้าเปิดบัญชี/เครื่องเอง** (คนละ provider ก็ได้) แล้วคุณ deploy ให้ หรือส่งสูตรให้ทีมลูกค้าทำเอง

รันตาม `RUNBOOK.md` ตั้งแต่ต้น — ทุกอย่างเป็นสคริปต์อยู่แล้ว:
```
ขั้น1 สร้าง VPS  →  ขั้น2 bootstrap --mode self  →  ขั้น3 deploy compose
  →  ขั้น5 restore 2 backup  →  ขั้น6 migrate + backend  →  ขั้น8 frontend  →  ขั้น9 backup cron
```
เวลารวม ~1–2 ชม./ราย (ส่วนใหญ่รอ restore)

> ข้อดี: ไม่ผูก provider, ทำซ้ำได้ทุกที่ · ข้อจำกัด: ช้ากว่า snapshot

---

## 3. Checklist ต่อ instance (⚠ ต้องเปลี่ยนทุกครั้ง — ห้ามใช้ค่าซ้ำ)

ทุกอย่างในตารางนี้ **ต้องไม่ซ้ำระหว่างลูกค้า** ไม่งั้นข้อมูลรั่วข้ามกัน / โดนสวมสิทธิ์

| ค่า | เปลี่ยนที่ | วิธีสร้างใหม่ |
|---|---|---|
| `MSSQL_SA_PASSWORD` | Coolify env (compose) | รหัสสุ่ม ≥16 ตัว |
| `MYSQL_ROOT_PASSWORD` / `MYSQL_PASSWORD` | Coolify env (compose) | รหัสสุ่ม ≥16 ตัว |
| `JWT_SECRET` | Coolify env (backend) | `openssl rand -base64 48` |
| `MIGRATE_SECRET` / `TS_INGEST_SECRET` | Coolify env (backend) | `openssl rand -hex 24` |
| Domain (`VITE_API_BASE_URL`, `CORS_ORIGIN`) | frontend build + backend env | โดเมนของลูกค้ารายนั้น |
| `LINE_LOGIN_*` | Coolify env (backend) | LINE channel ของลูกค้า (ถ้าใช้) |
| Coolify admin password | หน้า `http://IP:8000` | ตั้งใหม่ตอนสร้าง admin |
| `--admin-ip` (ufw) | ตอนรัน bootstrap | IP ของลูกค้า/ผู้ดูแลรายนั้น |
| ข้อมูล (2 backup) | ขั้น 5 restore | **backup ของลูกค้ารายนั้นเท่านั้น** |

### ⚠️ ขั้นที่ลืมไม่ได้ — `node seed_admin.js` หลัง migrate

backup ของ WINSpeed **ไม่มี schema `wf`** → หลัง migrate ตาราง `wf.AppUser` จะมีแต่บัญชี `emp-XXXXX`
จาก migration `011_seed_sales_users_giveaway.sql` ซึ่ง **เป็น role `SALES` ทั้งหมด และไม่มี ADMIN เลย**
→ ไม่มีใคร login เข้าไปดูแลระบบได้

**อย่า insert user เองด้วย SQL** — ใช้สคริปต์ที่ระบบเตรียมไว้ (ดู `DEPLOY.md`):
```bash
cd backend
node seed_admin.js
```
สคริปต์นี้ทำ 3 อย่าง:
1. สร้าง **`admin` / `W0rldF3rt`** (role ADMIN) — ⚠️ `W0rld` ใช้ **เลขศูนย์** ไม่ใช่ตัว O
2. อ่าน `dbo.EMEmp` (พนักงานที่ยังไม่ลาออก) → สร้าง/อัปเดต user พร้อม **map role จริง**
   (`EmpGroupID=2000`→MANAGER · `2001`/Dept `2004,2005`→WAREHOUSE · Dept `2000,2001`→ACCOUNTING · ที่เหลือ SALES)
   และ map `EmpId` ให้ตรง `EMEmp.EmpID` — **จำเป็นสำหรับ export SO กลับเข้า WINSpeed**
3. ตั้ง `IsActive=0` ให้ทุกบัญชีที่ไม่อยู่ในรายการ (ล้างบัญชีค้างเก่า)

> รหัสเริ่มต้นของพนักงานทุกคนคือ `W0rldF3rt` เช่นกัน — **ต้องบังคับเปลี่ยนก่อนใช้งานจริง**
> login ตรวจ `IsActive` **ก่อน** `bcrypt.compare` → บัญชีที่ถูกปิดจะได้ 401 ทั้งที่รหัสถูก

> ℹ️ `migrations/uat_create_admin.sql` ถูกกันออกจาก deploy path ด้วย pattern `^uat_` โดยตั้งใจ
> (เป็นของ UAT · มีบั๊ก: เช็คชื่อ `uat_admin` แต่ insert `admin`) — **อย่าเอามาใช้ใน production**
> ดูรายละเอียดที่ `docs/enterprise/08-APPENDICES/MIGRATION-LEDGER-AUDIT-2026-07-22.md`

สคริปต์ช่วยสุ่มทั้งชุด:
```bash
echo "MSSQL_SA_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=' | head -c 20)Aa1!"
echo "MYSQL_ROOT_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=' | head -c 24)"
echo "MYSQL_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=' | head -c 24)"
echo "JWT_SECRET=$(openssl rand -base64 48)"
echo "MIGRATE_SECRET=$(openssl rand -hex 24)"
echo "TS_INGEST_SECRET=$(openssl rand -hex 24)"
```

---

## 4. ส่งมอบให้ลูกค้าเป็นเจ้าของ (Migrate Owner)

เลือก 1 ใน 2 ตามความสัมพันธ์:

**แบบ 1 — โอนทั้งเครื่อง (คุณเป็นคนตั้งให้ แล้วยกให้)**
- Hetzner: **Project → Transfer** ไปยังบัญชีลูกค้า (หรือสร้าง project แยกต่อลูกค้าตั้งแต่แรก แล้วโอนทั้ง project)
- เปลี่ยน SSH key เป็นของลูกค้า, เปลี่ยน Coolify admin, หมุนรหัสทั้งหมดในข้อ 3
- ลบ key/สิทธิ์ของคุณออก → ลูกค้าถือครองสมบูรณ์

**แบบ 2 — ลูกค้าเปิดบัญชีเอง (คุณแค่ deploy)**
- ลูกค้าสร้าง Hetzner/provider account + VPS เอง (บิลไปที่ลูกค้าตรงๆ)
- คุณ (หรือทีมลูกค้า) รัน **วิธี B** ในเครื่องนั้น
- คุณไม่ถือ credential ใดๆ ของ production ลูกค้า = ปลอดภัย/ความรับผิดชอบชัด

> 💡 สำหรับโมเดล "dev = คุณ / prod = ลูกค้ารับผิดชอบ" → **แบบ 2** เหมาะสุด
> คุณพัฒนา/ทดสอบบนเครื่อง dev ของคุณ แล้วส่งสูตร (เอกสารนี้ + RUNBOOK) ให้ลูกค้า deploy prod เอง

---

## 5. อัปเดตโค้ดข้ามทุก instance (หลังโคลนไปหลายราย)

เพราะทุก instance ใช้ **โค้ด/compose เดียวกัน** จาก git:
- แก้โค้ด → push → แต่ละ Coolify ของลูกค้า **Redeploy** ดึง commit ใหม่ (ข้อมูลใน volume ไม่หาย)
- migration ใหม่: รัน `npm run migrate` ต่อ instance หลัง redeploy (idempotent — รันซ้ำปลอดภัย)
- แนะนำ: tag เวอร์ชัน (`v1.0.0`, `v1.1.0`) แล้วให้ลูกค้า prod ตรึงที่ tag ที่ทดสอบแล้ว ส่วน dev ตามล่าสุด

---

## 6. สิ่งที่ต้องระวัง (SaaS)

- **ห้ามใช้รหัส/JWT/secret ซ้ำข้ามลูกค้า** — checklist ข้อ 3 คือหัวใจ
- **ห้าม snapshot เครื่องที่มีข้อมูลลูกค้า A ไปสร้างลูกค้า B** — ใช้ golden ที่ข้อมูลว่างเท่านั้น
- **backup แยกต่อ instance** — `backup.env` ของแต่ละเครื่องต้องมี `OFFSITE_RSYNC_TARGET` คนละปลายทาง
- **TruckScale** เป็น production มีชีวิต — การโคลน DB นี้ = ก็อปสภาพ ณ เวลา backup เท่านั้น การใช้จริงต้อง repoint ซอฟต์แวร์ตาชั่งของลูกค้ารายนั้น (ทำท้ายสุด)
- **โดเมน + TLS** — แต่ละ instance ต้องมีโดเมนของตัวเอง (Coolify ออก Let's Encrypt ให้อัตโนมัติ)

---

## สรุป flow สั้นสำหรับลูกค้าใหม่ 1 ราย

```
[Snapshot มี golden แล้ว]                    [ยังไม่มี / ข้าม provider]
Create Server จาก snapshot                    RUNBOOK ขั้น 1–2 (bootstrap --mode self)
        │                                              │
        └──────────────┬───────────────────────────────┘
                       ▼
            Checklist ข้อ 3: หมุนรหัส/JWT/โดเมน/กุญแจ ทั้งหมด
                       ▼
            Restore backup ของลูกค้ารายนั้น (RUNBOOK ขั้น 5)
                       ▼
            migrate + backend + frontend + backup cron (ขั้น 6,8,9)
                       ▼
            (ถ้าส่งมอบ) โอน owner / เปลี่ยน key — ข้อ 4
```
