# SECURITY — การจัดการความปลอดภัย & การเปลี่ยนรหัสผ่าน (P0-1)

> ⚠️ **สำคัญสูงสุด (P0)** · ผู้รับผิดชอบ: ADMIN/IT · ปัจจุบันอยู่ DEV server (ยังไม่ critical)
> ดำเนินการ **ก่อนขึ้น Production** เท่านั้น — เจ้าของระบบเปลี่ยนเองเพื่อความปลอดภัย

## ทำไมต้องเปลี่ยน
รหัสผ่าน/ความลับต่อไปนี้เคยถูกพิมพ์ในแชต/ประวัติการพัฒนา และ/หรือเป็นค่า default
→ เมื่อขึ้น Production ถือว่า **หลุดแล้ว** ต้อง rotate ทั้งหมด

## รายการที่ต้องเปลี่ยน (Checklist)

### 1. SQL Server (WINSpeed + wf)
- [ ] เปลี่ยนรหัส `sa` (หรือเลิกใช้ `sa` สำหรับ App)
- [ ] **แนะนำ:** สร้าง least-privilege users แทน `sa`
  - `wf_owner` — CONTROL เฉพาะ schema `wf` (เขียน wf + รัน migration)
  - `wf_app` — datareader บน dbo + เขียนเฉพาะ object ที่อนุญาต (SOHD/SODT/EMSetPrice) ถ้าทำได้ (หรือใช้ stored proc)
- [ ] อัปเดต `REMOTE_DB_USER` / `REMOTE_DB_PASSWORD` ใน env (Railway + local)

### 2. MySQL (TruckScale)
- [ ] เปลี่ยนรหัส `root`
- [ ] **แนะนำ:** สร้าง user read-only เฉพาะ `db_truckscale` (App อ่านอย่างเดียว)
- [ ] อัปเดต `MYSQL_USER` / `MYSQL_PASSWORD` ใน env

### 3. JWT
- [ ] เปลี่ยน `JWT_SECRET` เป็นค่าสุ่มยาว ≥64 ตัวอักษร (เลิกใช้ค่า default placeholder)
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
  ```

### 4. รหัสผู้ใช้ในระบบ (wf.AppUser)
- [ ] เปลี่ยนรหัสผ่าน seed users (เช่น `Sales@2026`) ทั้งหมด

## วิธีเก็บความลับ (ห้ามอยู่ในโค้ด)
- เก็บใน **environment variables** ของ Railway (backend) / Vercel (frontend) เท่านั้น
- `.env` จริง **ห้าม commit** — ตรวจ:
  ```bash
  git ls-files | grep -E "(^|/)\.env$"   # ต้องไม่มีผลลัพธ์ (ยกเว้น .env.example/.env.docker.example)
  ```
- ใช้ `.env.example` / `.env.docker.example` เป็น template (มีแต่ placeholder)

## Current Addendum - 2026-07-08

### LINE Login security notes
- `LINE_LOGIN_CHANNEL_SECRET` must be stored only in backend environment variables.
- `backend/.env` is ignored by git; do not commit it.
- LINE Login is account-binding based: first-time users must verify their existing WS-Sale-App username/password before `wf.AppUser.LineUserId` is saved.
- Unbound LINE accounts receive a short-lived link token, not the raw LINE User ID. If credential verification fails, the user must contact Admin.
- Callback URL must be exact:
  - local: `http://localhost:3000/api/auth/line/callback`
  - production: `https://<backend-domain>/api/auth/line/callback`

### Secret rotation reminder
- The LINE secret was entered into local `.env`; treat it as sensitive.
- If any secret was pasted into chat/history or screenshots, rotate it in LINE Developers before production.

## เมื่อเปลี่ยนรหัสเสร็จ
1. อัปเดต env บน Railway + Vercel + เครื่อง dev
2. Restart services (`docker compose up -d` หรือ redeploy)
3. ตรวจ `GET /api/health` → `db.sqlserver: up`, `db.mysql: up`
4. ทดสอบ login + 1-2 หน้าหลัก

## มาตรการที่ระบบทำให้แล้ว (P1 — implemented)
- ✅ `helmet` — security headers
- ✅ `express-rate-limit` — จำกัด login 20 ครั้ง/15 นาที (กัน brute-force)
- ✅ `/api/health` — ตรวจสถานะ DB (SQL + MySQL)
- ✅ CORS ตั้งผ่าน `CORS_ORIGIN` (ตั้ง domain จริง ห้ามใช้ `*` บน prod)
- ✅ JWT auth + RBAC 7 roles · bcrypt password hash

## Current Addendum - 2026-07-13

### Access As security notes
- Access As is limited to `ADMIN`, `MANAGER`, `ACCOUNTING`, `APPROVER`, and `COUNTER_SALES`.
- A user can only access the same or lower role according to the approved hierarchy: `ADMIN` -> `MANAGER` -> `ACCOUNTING` -> `APPROVER` -> `COUNTER_SALES` -> `SALES`.
- While Access As is active, authorization uses the effective user/role so menus and customer visibility match the selected user.
- The JWT still preserves the real actor as `actorId` / `actorRole`.
- `wf.AccessAsAudit` records START/STOP and `wf.ApiAuditLog` records mutating API calls with actor/effective user.

Security follow-up:
- Review Access As audit weekly during pilot to detect repeated work performed on behalf of other users.
- Keep Access As unavailable to normal SALES users.

## ที่ยังต้องทำเพิ่ม (แนะนำ)
- [ ] Backup อัตโนมัติ + ทดสอบ restore (P1-1)
- [ ] Centralized log + alert (Sentry/Logtail) (P1-2)
- [ ] TLS/HTTPS หน้า reverse proxy (Railway/Vercel มีให้; on-prem ต้องตั้ง nginx+cert)
