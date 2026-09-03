---
documentId: "WF-SEC-002"
title: "ความลับทั้งหมดของระบบอยู่ที่ไหน — รหัสผ่าน กุญแจ และโทเคน"
version: "v1.0"
status: Draft
statusDetail: "จัดทำ 3 กันยายน 2569 · ตรวจจากโค้ดและเครื่องจริงทุกข้อ · v1.9.0"
owner: "Solution Architect"
normative: true
---

# ความลับทั้งหมดของระบบอยู่ที่ไหน

> **เอกสารนี้ไม่มีค่าความลับใด ๆ อยู่ข้างใน และต้องไม่มีตลอดไป**
> บอกแค่ว่า *อะไร* เก็บ *ที่ไหน* และ *ใครเข้าถึงได้* — ค่าจริงอ่านจากที่ที่ระบุเท่านั้น
> รีโปนี้เป็นสาธารณะ (`github.com/thirayume/winspeed-connect`)

---

## 1. สรุปหนึ่งหน้า — ความลับมี 5 ประเภท เก็บคนละที่

| # | ความลับ | เก็บที่ไหน | อยู่ใน git ไหม |
|---|---|---|---|
| 1 | **รหัสผ่านผู้ใช้แอป** (62 คน) | `wf.AppUser.PasswordHash` ในฐานข้อมูล — **bcrypt cost 12** | ❌ ไม่มีทางอยู่ |
| 2 | **รหัสฐานข้อมูล / JWT / LINE** ของเครื่องนักพัฒนา | `backend/.env` | ❌ `.gitignore` บรรทัด 32 |
| 3 | **รหัสทุกอย่างของ VPS** | `deploy/cloud-vps/.env` บนเครื่อง + `.local-secrets/CREDENTIALS.txt` | ❌ `.gitignore` บรรทัด 61 |
| 4 | **กุญแจ SSH / SFTP** | `deploy/cloud-vps/.local-secrets/worldfert-hostinger-*` | ❌ `.gitignore` บรรทัด 19, 61 |
| 5 | **รหัสของ PROD-A** (Railway / Vercel / Azure) | ตั้งเป็น environment variable ในแผงควบคุมของบริการนั้น | ❌ ไม่เคยอยู่ในไฟล์ |

**ตรวจแล้ว 3 ก.ย. 2569** — `git ls-files` หา `.env`, `.local-secrets`, `CREDENTIALS`, `.pem`, `.key`
**ไม่พบไฟล์ความลับใน git แม้แต่ไฟล์เดียว**

---

## 2. รหัสผ่านผู้ใช้แอป

### 2.1 เก็บอย่างไร

| | |
|---|---|
| ที่เก็บ | `wf.AppUser.PasswordHash` |
| อัลกอริทึม | **bcrypt · cost factor 12** |
| ที่ทำ hash | `backend/routes/auth.js` และ `backend/seed_admin.js` |
| ตรวจรหัส | `bcrypt.compare()` — **ไม่มีที่ไหนในระบบอ่านรหัสจริงกลับมาได้** |

bcrypt เป็น one-way hash **ต่อให้เป็น ADMIN หรือเข้าถึงฐานข้อมูลได้โดยตรง ก็อ่านรหัสผ่านของใครไม่ได้**
สิ่งที่ทำได้คือ *ตั้งรหัสใหม่* ให้เขา ซึ่งเป็นคนละเรื่อง

### 2.2 เมื่อผู้ดูแลตั้งรหัสให้คนอื่น

`PATCH /api/auth/users/:id` เมื่อส่ง `password` มาด้วย ระบบจะ **บังคับ `MustChangePassword = 1`**
ยกเว้นกรณีเปลี่ยนรหัสของตัวเอง

> **เหตุผล** — ผู้ดูแลตั้งรหัสให้คนอื่น แปลว่าผู้ดูแลรู้รหัสของคนนั้น
> ถ้าปล่อยไว้แบบนั้น ชื่อผู้ทำรายการในหลักฐานก็ไม่ได้พิสูจน์ว่าเจ้าของบัญชีเป็นคนทำ (D6-02)
> เจ้าของบัญชีจึงต้องตั้งรหัสใหม่ก่อนบันทึกข้อมูลได้อีก

การบังคับนี้ทำงานเมื่อเปิด `ENFORCE_PASSWORD_CHANGE` เท่านั้น — บนเครื่องนักพัฒนาจะไม่ขึ้น

### 2.3 รหัสตั้งต้นตอน seed

`backend/seed_admin.js` อ่านจาก **`DEFAULT_SEED_PASSWORD`** ใน environment
ถ้าไม่ตั้ง จะสร้างค่าขึ้นมาเอง — **ห้ามพึ่ง fallback บนระบบจริง ให้ตั้ง env นี้เสมอ**

### 2.4 ถ้าลืมรหัสผู้ดูแล

`backend/scripts/local_user_recovery.js` — ตั้งรหัสใหม่ให้บัญชีที่ระบุ (ค่าเริ่มต้นคือ `admin`)
ต้องรันบนเครื่องที่ต่อฐานข้อมูลได้ และรู้ `DB_OWNER_PASSWORD` อยู่แล้ว

---

## 3. โทเคน (JWT)

| | |
|---|---|
| ลงนามด้วย | `JWT_SECRET` จาก environment |
| อายุ | `JWT_EXPIRES_IN` · **ค่าเริ่มต้น `8h`** |
| โทเคนผูก LINE | อายุ `10m` ตายตัว |
| ตรวจที่ | `backend/middleware/auth.js` |

> 🔴 **`middleware/auth.js` มี fallback `'dev_secret_change_in_production'`**
> ถ้าลืมตั้ง `JWT_SECRET` บนระบบจริง ระบบจะยังทำงานได้ตามปกติ **แต่ใครก็ปลอมโทเคนได้**
> `deploy-release.sh` บังคับให้ `JWT_SECRET` ต้องมีค่าและต้องไม่ขึ้นต้นด้วย `CHANGE_ME` ก่อน deploy
> ซึ่งปิดช่องนี้บน VPS แล้ว — แต่ **ไม่ได้ปิดบน Railway** ต้องตรวจเองที่แผงควบคุม

---

## 4. `backend/.env` — เครื่องนักพัฒนา

ไม่อยู่ใน git (`.gitignore` บรรทัด 32) · ตัวอย่างโครงอยู่ที่ `backend/.env.example`

| กลุ่ม | ตัวแปร |
|---|---|
| เลือกฐาน | `DB_MODE` (**`local` / `remote` / `remote_b`** — ค่าเริ่มต้น `remote` = Azure) |
| ฐานในเครื่อง | `LOCAL_DB_SERVER` · `LOCAL_DB_CONNECTION_STRING` |
| Azure (PROD-A) | `REMOTE_DB_SERVER` · `REMOTE_DB_PORT` · `REMOTE_DB_USER` · `REMOTE_DB_PASSWORD` |
| Hostinger (PROD-B) | `REMOTE_B_DB_SERVER` · `REMOTE_B_DB_PORT` · `REMOTE_B_DB_USER` · `REMOTE_B_DB_PASSWORD` · `REMOTE_B_DB_NAME` |
| ผู้ใช้ฐานข้อมูล | `DB_NAME` · `DB_USER` / `DB_PASSWORD` (wf_reader) · `DB_OWNER_USER` / `DB_OWNER_PASSWORD` (wf_owner) |
| โทเคน | `JWT_SECRET` · `JWT_EXPIRES_IN` |
| LINE | `LINE_LOGIN_CHANNEL_ID` · `LINE_LOGIN_CHANNEL_SECRET` · `LINE_CHANNEL_ACCESS_TOKEN` · `LINE_CHANNEL_SECRET` |
| migration | `MIGRATE_SECRET` (ใช้กับ `/api/admin/migrate` ซึ่งปิดใน production) |
| ~~MySQL~~ | ~~`MYSQL_*`~~ · **`TRUCKSCALE_MYSQL` ต้องไม่ตั้ง** — ชั้น MySQL ยกเลิกแล้ว 03/09/2569 |

> ⚠ **`DB_MODE` ไม่ใช่ `DB_TARGET`** — `DB_TARGET` ถูกเพิกเฉยเงียบ ๆ และคำสั่งจะไปลงที่ Azure
> เคยพลาดมาแล้ว 03/09/2569 ตอนรัน migration ที่ตั้งใจจะลง dev

---

## 5. VPS Hostinger (PROD-B)

### 5.1 `deploy/cloud-vps/.env` — บนเครื่อง VPS

อยู่ที่ `/opt/worldfert/app/deploy/cloud-vps/.env` · สิทธิ์ `600` · เจ้าของ root

`deploy-release.sh` **ปฏิเสธการ deploy** ถ้าตัวแปรเหล่านี้ว่างหรือยังเป็น `CHANGE_ME`

```
ROOT_DOMAIN APP_DOMAIN API_DOMAIN PORTAINER_DOMAIN MSSQL_DOMAIN MYSQL_DOMAIN
VITE_API_BASE_URL CORS_ORIGIN
MSSQL_SA_PASSWORD MYSQL_ROOT_PASSWORD MYSQL_PASSWORD JWT_SECRET
```

และตรวจซ้ำอีกชุดหนึ่งว่าไม่ใช่ค่าตั้งต้น:
`MSSQL_SA_PASSWORD` `MYSQL_ROOT_PASSWORD` `MYSQL_PASSWORD` `WF_READER_PASSWORD` `WF_OWNER_PASSWORD` `JWT_SECRET` `MIGRATE_SECRET` `TS_INGEST_SECRET`

> **การ deploy ไม่แตะ `.env` บนเครื่อง** — `03-remote-deploy.bat` รักษาไฟล์เดิมไว้เสมอ
> จะเขียนทับต้องสั่ง `--sync-env` โดยตั้งใจเท่านั้น

### 5.2 `deploy/cloud-vps/.local-secrets/` — บนเครื่องผู้ดูแล

ไม่อยู่ใน git (`.gitignore` บรรทัด 61)

| ไฟล์ | เก็บอะไร |
|---|---|
| `CREDENTIALS.txt` | สรุปทุกความลับ แยกหมวด `[VPS]` `[DEPLOY]` `[SFTP]` `[MSSQL]` `[MYSQL]` `[APPLICATION]` `[NETWORK]` |
| `APPLICATION-ADMIN.txt` | บัญชีผู้ดูแลของแอป |
| `worldfert-hostinger-deploy` / `.pub` | กุญแจ SSH สำหรับ deploy |
| `worldfert-hostinger-sftp` / `.pub` | กุญแจ SFTP สำหรับรับส่ง backup |
| `worldfert-db-ca.crt` | ใบรับรอง CA ของฐานข้อมูล |
| `known_hosts` | ลายนิ้วมือเซิร์ฟเวอร์ |

> `[NETWORK]` เก็บ IP ที่อยู่ใน allowlist ของไฟร์วอลล์ — **เป็น IP ไม่คงที่**
> ค่าที่จดไว้ที่อื่นจะล้าสมัยเสมอ ให้อ่านจากที่นี่เท่านั้น

### 5.3 สร้างไฟล์เหล่านี้ครั้งแรก

`windows\09-generate-hostinger-profile.ps1` รันครั้งเดียว สร้าง `.env`, `server-config.env`,
`remote-config.bat` และ `CREDENTIALS.txt` ให้ทั้งชุด

> ⚠ **ห้ามรัน generator ซ้ำบนระบบที่ใช้งานจริง** — มันสร้าง secret ชุดใหม่ทั้งหมด

---

## 6. PROD-A — Railway / Vercel / Azure

**ไม่มีไฟล์ `.env` ที่ไหนเลย** ทุกค่าตั้งเป็น environment variable ในแผงควบคุมของแต่ละบริการ

| บริการ | ตั้งค่าที่ไหน | ตัวแปรสำคัญ |
|---|---|---|
| Railway (backend) | Railway → Variables | `DB_MODE=remote` · `REMOTE_DB_*` · `JWT_SECRET` · `CORS_ORIGIN` · `NODE_ENV=production` |
| Vercel (frontend) | Vercel → Environment Variables | `VITE_API_BASE_URL` |
| Azure (SQL Server) | ในตัว SQL Server | `sa` · `wf_reader` · `wf_owner` |

> Vercel build ใช้ `WSSale-App/.env.production` ซึ่ง **อยู่ใน git** — ตรวจแล้วมีแค่ `VITE_API_BASE_URL`
> ซึ่งเป็น URL สาธารณะ ไม่ใช่ความลับ

---

## 7. บัญชีฐานข้อมูล — ใครทำอะไรได้

| บัญชี | สิทธิ์ | ใช้ทำอะไร |
|---|---|---|
| `wf_reader` | `db_datareader` + `SELECT ON SCHEMA::wf` | คิวรีทั่วไปทั้งหมดของแอป |
| `wf_owner` | `db_datareader` + **`CONTROL ON SCHEMA::wf`** | migration · เขียน `wf` · เรียก stored procedure |
| `sa` | ทุกอย่าง | RESTORE และงานระดับเครื่องเท่านั้น |

**`dbo` เป็น read-only โดยหลัก** ข้อยกเว้นที่อนุมัติแล้วอยู่ใน
[`DOCUMENT-FLOW-TRACEABLE.md`](../08-APPENDICES/DOCUMENT-FLOW-TRACEABLE.md) §8

> `RESTORE` ลบ database user ทิ้งทุกครั้ง — `finalize-mssql.sh` สร้างกลับให้
> **ลำดับ logins → migrate → seed_admin ห้ามสลับ** migration 002 จะล้มถ้าไม่มี user มาก่อน

---

## 8. รายการตรวจก่อนขึ้นระบบใหม่

| # | ตรวจ | คำสั่ง / วิธี |
|---|---|---|
| 1 | ไม่มีความลับใน git | `git ls-files \| grep -iE "\.env$\|local-secrets\|CREDENTIAL\|\.pem$\|\.key$"` → ต้องว่าง |
| 2 | `JWT_SECRET` ตั้งจริง ไม่ใช่ fallback | ตรวจที่แผงควบคุมของบริการ (Railway ไม่มีตัวบังคับ) |
| 3 | `DEFAULT_SEED_PASSWORD` ตั้งจริง | ก่อนรัน `seed_admin.js` |
| 4 | `ENFORCE_PASSWORD_CHANGE` เปิด | เพื่อให้การตั้งรหัสให้คนอื่นบังคับเปลี่ยนได้ |
| 5 | `TRUCKSCALE_MYSQL` **ไม่ได้ตั้ง** | ชั้น MySQL ต้องปิด — `/api/health` ต้องขึ้น `mysql: "disabled"` |
| 6 | ไฟล์ `.env` บน VPS สิทธิ์ `600` | `deploy-release.sh` ตั้งให้เอง |
| 7 | กุญแจ SSH สิทธิ์ `600` | `chmod 600` ก่อนใช้ |

---

## 9. เมื่อความลับรั่ว — ทำอะไรก่อน

| รั่วอะไร | ทำทันที |
|---|---|
| `JWT_SECRET` | เปลี่ยนค่า → ทุกโทเคนที่ออกไปแล้วใช้ไม่ได้ทันที ผู้ใช้ต้องเข้าระบบใหม่ |
| รหัสฐานข้อมูล | เปลี่ยนรหัสของ login นั้น แล้วอัปเดต env ทุกที่ที่ใช้ |
| กุญแจ SSH | ถอด public key ออกจาก `authorized_keys` แล้วสร้างคู่ใหม่ |
| IP ใน allowlist | ดู [`SYNC-PROD-A-TO-PROD-B.md`](SYNC-PROD-A-TO-PROD-B.md) §2.1 และ `deploy/cloud-vps/README.md` |
| รหัสผ่านผู้ใช้ | ตั้งใหม่ผ่าน User Management — ระบบบังคับให้เจ้าของเปลี่ยนเองอีกครั้ง |

> **ประวัติ git ก็เป็นที่รั่วได้** — 23 ส.ค. 2569 เคยต้องล้างประวัติเพราะมีชื่อพนักงานหลุด
> และ 3 ก.ย. 2569 พบ IP ผู้ดูแลอยู่ในไฟล์ `.pyc` ที่ commit ไว้
> **ไฟล์คอมไพล์เก็บ string literal จาก source** จึงรั่วสิ่งเดียวกันโดยที่การ review source มองไม่เห็น
> ตอนนี้ `__pycache__/` และ `*.pyc` เข้า `.gitignore` แล้ว
