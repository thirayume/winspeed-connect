# CLONE-RECIPE — ติดตั้ง / ส่งมอบระบบ WS-Sale-App ให้ลูกค้า

**1 ลูกค้า = 1 instance แยกกันสมบูรณ์** — ลูกค้าเป็นเจ้าของทุกอย่างเอง (บัญชี · เครื่อง · โดเมน · โค้ด · ข้อมูล)
ผู้ติดตั้งเป็นแค่คนรันสคริปต์ให้ ไม่ถือ credential ของ production ลูกค้า

> ⚡ **ทางลัด:** ดับเบิลคลิก **`provision-customer.bat`** แล้วทำตาม wizard
> เอกสารนี้อธิบายว่า wizard ทำอะไรบ้าง + ส่วนที่ต้องทำมือ

---

## 1. โมเดลการส่งมอบ

```
ลูกค้าเตรียมเอง                    ผู้ติดตั้งทำให้                     ผลลัพธ์
──────────────────                ─────────────────                  ──────────
Coolify account                    รัน provision-customer.bat         ระบบพร้อมใช้
Hetzner VPS + SSH key      ──►     (wizard 7 ขั้น)            ──►     + เอกสารส่งมอบ
Domain (ถ้ามี)                     ตั้งค่า Coolify ให้                 + รหัสผ่านชุดเดียว
Fork repo เป็น Private             ส่งมอบ + สอนใช้                     ของลูกค้ารายนั้น
```

**ทำไมให้ลูกค้าเปิดบัญชีเอง:** บิลไปที่ลูกค้าตรง · ลูกค้าคุมข้อมูลตัวเอง · ผู้ติดตั้งไม่ต้องรับผิดชอบ uptime/ค่าใช้จ่าย · ถอนตัวได้สะอาด (ลบ SSH key ของเราออกอย่างเดียว)

---

## 2. ใบสั่งงานสำหรับลูกค้า (ส่งให้ลูกค้าทำก่อน)

- [ ] **Coolify Cloud** — สมัครที่ `app.coolify.io` (~$5/เดือน) แล้วเชิญอีเมลผู้ติดตั้งเข้า Team
- [ ] **Hetzner Cloud** — สมัคร แล้วสร้าง server
      - Type: **Shared vCPU → x86 → CX32** (4 vCPU / 8 GB / 80 GB)
        ⚠️ **ห้ามเลือก Arm64/CAX** — SQL Server ไม่มี image ARM รันไม่ได้
        ⚠️ CX23 (4 GB) พอสำหรับ dev แต่ตึงมากสำหรับ production
      - Image: **Ubuntu 24.04** · Location: EU ถูกสุด (latency ไทย ~200ms) / Singapore เร็วกว่าแต่แพงกว่า
      - ข้าม Volumes / Backups / Placement groups · เก็บ IPv4 ไว้
      - ใส่ **SSH public key ของผู้ติดตั้ง** ตอนสร้าง
- [ ] **Domain** (ถ้ามี) — ชี้ A record 2 ตัวมาที่ IP ของ server
      `app.<domain>` และ `api.<domain>`
      *ยังไม่มีก็ได้ — wizard จะใช้ sslip.io ให้ก่อน*
- [ ] **Fork GitHub repo** เป็น **Private** แล้วเพิ่มผู้ติดตั้งเป็น Collaborator
- [ ] **ไฟล์ข้อมูล** — `.bak` (SQL Server) + `.sql` (MySQL TruckScale) ของบริษัทลูกค้า

> ส่ง IP · ชื่อ repo · โดเมน · ไฟล์ backup ให้ผู้ติดตั้ง แล้วรอรับมอบ

---

## 3. ผู้ติดตั้งรัน wizard

```
ดับเบิลคลิก  deploy\coolify\provision-customer.bat
```
⚠️ **ห้ามคลิกขวา Run as administrator** — ssh บน Windows จะ bind พอร์ต loopback ไม่ได้

| ขั้น | ทำอะไร | อัตโนมัติ |
|---|---|---|
| 1 `init` | ถามข้อมูลลูกค้า · **สุ่มความลับทั้งชุด** · สร้างไฟล์ env ให้วางใน Coolify | ✅ |
| 2 `bootstrap` | เตรียม VPS: swap 4GB · TZ Asia/Bangkok · ufw · fail2ban · key-only SSH | ✅ |
| 3 `coolify` | **[ทำมือ]** เพิ่ม server + สร้าง 3 resource — wizard พิมพ์ค่าที่ต้องวางให้ครบ | ⛔ |
| 4 `data` | หาชื่อ container · อัปโหลด backup · restore ทั้ง 2 ฐาน · ปรับ recovery เป็น SIMPLE | ✅ |
| 5 `schema` | `000_logins` · `run_migrations.js` · GRANT · **`seed_admin.js`** | ✅ |
| 6 `verify` | preflight · ทดสอบ URL จริง · ทดสอบ login | ✅ |
| 7 `handover` | ออกไฟล์ `HANDOVER-<ลูกค้า>.md` | ✅ |

**คุณสมบัติ**
- ทำงานเป็นขั้น — ขั้นที่เสร็จแล้วจะข้าม · รันซ้ำได้ปลอดภัย
- `-Stage status` ดูว่าถึงไหนแล้ว · `-Stage data` รันเฉพาะขั้นนั้น · `-Force` ทำซ้ำ
- profile + ความลับเก็บที่ **`Documents\wf-customers\<ลูกค้า>.json`** (นอก repo · สิทธิ์ล็อกเฉพาะเจ้าของ)

```powershell
# ตัวอย่าง
.\provision-customer.ps1 -Customer acme -Stage status
.\provision-customer.ps1 -Customer acme -Stage data
```

---

## 4. ส่วนที่ต้องทำมือใน Coolify (ขั้น 3)

wizard จะพิมพ์ค่าทั้งหมดให้ — สรุปคือ:

**A. Servers → + Add** → IP ลูกค้า · port 22 · user root · เลือก private key → **Validate Server & Install Docker**

**B. + Add Resource → Docker Compose Empty** → วาง `0-docker-compose.yml`
- ชื่อ `wf-databases` → Save
- Environment Variables → **Developer view** → วาง `1-env-databases.txt`
- General → ☑ **Connect To Predefined Network** → Save → **Restart**
- **Deploy**

**C/D. + Add Resource → Application** (backend และ frontend)

| | backend | frontend |
|---|---|---|
| Source | **Private Repository (with Deploy Key)** | เหมือนกัน |
| Build Pack | Dockerfile | Dockerfile |
| Base Directory | `/backend` | `/WSSale-App` |
| Ports Exposes | (ว่าง) | **80** |
| Name | `wf-backend` | `wf-frontend` |
| Domains | `https://api.<domain>` | `https://app.<domain>` |
| Env | `2-env-backend.txt` | `3-env-frontend.txt` |

> 🔑 **repo Private → ต้องใช้ Deploy Key** (ไม่ใช่ Public Repository)
> Coolify สร้าง key ให้ → คัดลอกไปใส่ GitHub repo → **Settings → Deploy keys → Add deploy key** (Read-only พอ)

> 🌐 **ให้ push แล้ว deploy อัตโนมัติ:** resource → **Webhooks** → คัดลอก GitHub webhook URL
> → GitHub → Settings → Webhooks → Add · `application/json` · Just the push event
> ⚠️ webhook URL มี token — **ห้าม commit ลง repo**

---

## 5. ⚠️ ความลับที่ห้ามซ้ำข้ามลูกค้า

wizard สุ่มให้ทุกตัวอัตโนมัติ — ตารางนี้ไว้ตรวจทานตอนทำมือ

| ค่า | อยู่ที่ |
|---|---|
| `MSSQL_SA_PASSWORD` · `MYSQL_ROOT_PASSWORD` · `MYSQL_PASSWORD` | Coolify env (compose) |
| `WF_READER_PASSWORD` · `WF_OWNER_PASSWORD` | `000_logins.sql` + backend env |
| `JWT_SECRET` · `MIGRATE_SECRET` · `TS_INGEST_SECRET` | Coolify env (backend) |
| `CORS_ORIGIN` · `VITE_API_BASE_URL` | โดเมนของลูกค้ารายนั้น |
| `LINE_LOGIN_*` | LINE channel ของลูกค้า (ถ้าใช้) |
| ข้อมูล (2 backup) | **ของลูกค้ารายนั้นเท่านั้น** |

> ❌ **ห้าม snapshot เครื่องที่มีข้อมูลลูกค้า A ไปสร้างลูกค้า B**

---

## 6. ⚠️ ขั้นที่ลืมไม่ได้ — `node seed_admin.js`

*(wizard ทำให้ในขั้น 5 แล้ว — ส่วนนี้ไว้อ่านตอนแก้ปัญหา)*

backup ของ WINSpeed **ไม่มี schema `wf`** → หลัง migrate ตาราง `wf.AppUser` มีแต่บัญชี `emp-XXXXX`
จาก migration `011_seed_sales_users_giveaway.sql` ซึ่ง **เป็น role `SALES` ทั้งหมด ไม่มี ADMIN เลย**
→ **login ไม่ผ่านทุกบัญชี ไม่มีใครเข้าไปดูแลระบบได้**

```bash
docker exec -it <backend-container> node seed_admin.js
```
1. สร้าง **`admin` / `W0rldF3rt`** — ⚠️ `W0rld` ใช้ **เลขศูนย์** ไม่ใช่ตัว O
2. อ่าน `dbo.EMEmp` → สร้าง/อัปเดต user พร้อม **role จริง**
   (`EmpGroupID=2000`→MANAGER · `2001` หรือ Dept `2004/2005`→WAREHOUSE · Dept `2000/2001`→ACCOUNTING · ที่เหลือ SALES)
   และผูก **`EmpId` ↔ `EMEmp.EmpID`** — จำเป็นต่อการ export SO กลับ WINSpeed
3. ตั้ง `IsActive=0` ให้บัญชีที่ไม่อยู่ในรายการ

> ❌ **อย่า** insert `wf.AppUser` เองด้วย SQL — จะไม่ได้ role/EmpId ที่ถูกต้อง
> ❌ **อย่า** ใช้ `migrations/uat_create_admin.sql` — ของ UAT ถูกกันด้วย pattern `^uat_` โดยตั้งใจ และมีบั๊ก
>    (เช็คชื่อ `uat_admin` แต่ insert `admin`) · ดู `docs/enterprise/08-APPENDICES/MIGRATION-LEDGER-AUDIT-2026-07-22.md`
> ℹ️ login เช็ค `IsActive` **ก่อน** `bcrypt.compare` → บัญชีถูกปิดจะได้ 401 ทั้งที่รหัสถูก

---

## 7. หลังส่งมอบ

**ลูกค้าต้องทำทันที**
- [ ] เปลี่ยนรหัส `admin` · บังคับพนักงานเปลี่ยนรหัสครั้งแรก (ทุกคนได้ `W0rldF3rt` เหมือนกัน)
- [ ] ตั้ง backup อัตโนมัติ — `/root/backup-databases.sh` + cron (ดู `RUNBOOK.md` ขั้น 9)
- [ ] repoint ซอฟต์แวร์ตาชั่งหน้างานมา MySQL ตัวใหม่ (**ทำท้ายสุด** วางแผน cutover)

**ผู้ติดตั้งถอนตัว (ถ้าจบสัญญา)**
- [ ] ลบ SSH public key ของเราออกจาก `/root/.ssh/authorized_keys`
- [ ] ออกจาก Coolify Team ของลูกค้า · ถอนตัวจาก GitHub Collaborator
- [ ] ส่งไฟล์ `<ลูกค้า>.json` (รหัสผ่านทั้งหมด) ให้ลูกค้าผ่านช่องทางปลอดภัย แล้วลบของเราทิ้ง

---

## 8. อัปเดตโค้ดข้ามทุก instance

ทุก instance ใช้ **โค้ดชุดเดียวกัน** ต่างกันแค่ env + ข้อมูล

- แก้โค้ด → push → Coolify ของแต่ละลูกค้า redeploy (ข้อมูลใน volume ไม่หาย)
- มี migration ใหม่ → `docker exec -it <backend> node run_migrations.js` ต่อ instance (idempotent รันซ้ำปลอดภัย)
- แนะนำ **tag เวอร์ชัน** (`v1.0.0`, `v1.1.0`) แล้วให้ prod ลูกค้าตรึงที่ tag ที่ผ่าน UAT แล้ว ส่วน dev ตามล่าสุด

---

## 9. ข้อควรระวัง (SaaS)

- **ข้อมูลไม่ sync ข้าม instance** — แต่ละลูกค้ามี DB ของตัวเอง
- **backup แยกต่อ instance** — `backup.env` ต้องมี `OFFSITE_RSYNC_TARGET` คนละปลายทาง
- **TruckScale เป็น production มีชีวิต** — โคลน DB ได้แค่สภาพ ณ เวลา backup · ใช้จริงต้อง repoint ตาชั่ง
- **sslip.io ใช้ชั่วคราวได้ แต่ production ควรใช้โดเมนจริง** — Let's Encrypt จำกัด rate ของ sslip.io
  และ **ชื่อต้องมี IP อยู่ข้างใน** (`app.1-2-3-4.sslip.io` ✓ · `app.mycompany.sslip.io` ✗ NXDOMAIN)
- **เปลี่ยนโดเมนต้อง redeploy frontend** — `VITE_API_BASE_URL` ถูก bake ตอน build ไม่ใช่ตอน run
