# WS-Sale-App — คู่มือรัน & Deploy

## 🖥️ รันบนเครื่อง (Local Dev) — คำสั่งเดียว
```powershell
cd C:\MyWork\winspeed-frontend
npm run dev
```
- `[API]` backend → http://localhost:3000
- `[WEB]` frontend → http://localhost:5173  ← เปิดเบราว์เซอร์ที่นี่
- ปิด: **Ctrl+C**

> ครั้งแรก/หลัง clone: `npm install` ใน `backend` และ `WSSale-App` ก่อน
> Login demo: `admin / Admin@2026` (ดู role อื่นใน README)

---

## 🔌 เลือกโหมดเชื่อมต่อ SQL Server  (`backend/.env` → `DB_MODE`)

| โหมด | Auth | ใช้เมื่อ | Driver |
|---|---|---|---|
| **`local`** | Windows Authentication | dev บนเครื่องนี้ (`.\SQLEXPRESS`) | msnodesqlv8 (named-pipe) |
| **`remote`** | SQL Server Authentication (`sa`) | server กลาง / cloud (`20.255.185.14`) | tedious/TCP (ข้ามแพลตฟอร์มได้) |

**สลับโหมด** — แก้ `backend/.env`:
```ini
# โหมด local (ค่าเริ่มต้น)
DB_MODE=local
LOCAL_DB_SERVER=localhost\SQLEXPRESS

# โหมด remote — เปลี่ยนเป็น
DB_MODE=remote
REMOTE_DB_SERVER=20.255.185.14
REMOTE_DB_PORT=1433
REMOTE_DB_USER=sa
REMOTE_DB_PASSWORD=<<ใส่ sa password ที่นี่>>
```
> remote ต้องเปิด TCP/IP + เปิด port 1433 ที่ firewall ของ SQL Server ปลายทาง
> ครั้งแรกบน remote: รัน migration `000_logins.sql`, `001_*.sql`, `002_*.sql` + `node seed_admin.js` + `node import_giveaway.js` (เปลี่ยน DB_MODE=remote ก่อน)

---

## ☁️ Deploy ขึ้น Vercel

Vercel deploy ได้**เฉพาะ frontend** (backend + SQL Server ต้องรันแยก — serverless ต่อ SQL local ไม่ได้)

### แบบ (ข) Demo Mock — ไม่ต้องมี backend  ✅ ค่าเริ่มต้น
- `WSSale-App/.env.production` ตั้ง `VITE_USE_MOCKUP_DATA=true`
- ใช้ข้อมูลตัวอย่างจริงจาก `dbwins_worldfert9` (100 ชุด) ใน `src/mock/sample-data.json`
- **Deploy ได้เลย**: push → Vercel build (`vercel.json` ตั้งค่าครบ) → ใช้งานได้ทันที (อ่านอย่างเดียว, รีโหลด reset)
- รีเฟรช sample data: `cd backend && node export_sample.js` (DB_MODE=local) แล้ว commit

### แบบ (ก) Frontend(Vercel) + Backend จริง
1. รัน backend บน server ที่เห็น SQL (เช่นเครื่องที่มี `20.255.185.14` หรือ tunnel) ให้มี **public URL**
2. ตั้ง backend `.env`: `DB_MODE=remote` + `CORS_ORIGIN=https://<your-app>.vercel.app`
3. ตั้ง Vercel → Project → **Environment Variables**:
   ```
   VITE_USE_MOCKUP_DATA = false
   VITE_API_BASE_URL    = https://<your-backend-domain>/api
   ```
4. Redeploy

> `vercel.json` ปัจจุบัน: build `WSSale-App/dist` (vite) + SPA rewrite + `.vercelignore` ตัด `backend/`

---

## 🔑 บัญชีทดสอบ
| user | pass | role |
|---|---|---|
| admin | Admin@2026 | ADMIN |
| sales1 / sales2 | Sales@2026 | SALES |
| warehouse1 | Whouse@2026 | WAREHOUSE |
| acct1 | Acct@2026 | ACCOUNTING |
| surachai | Approve@2026 | APPROVER |
