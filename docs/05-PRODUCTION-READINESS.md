# 05 — ประเมินความพร้อม Production (Production Readiness Assessment)

> WS-Sale-App · build v4.2.17 · ประเมิน 27 มิ.ย. 2569 · โดย Solution Architect

## บทสรุปผู้บริหาร (Verdict)
> **สถานะ: พร้อมระดับ "Soft Launch / Pilot" — ยังไม่ควรขึ้น Full Production จนกว่าจะปิดรายการ P0 (ความปลอดภัย/ความถูกต้องบัญชี)**

ระบบมีฟังก์ชันครบตาม SRS v6.2 (17 หน้า, FR หลักครบ, deploy จริง Railway+Vercel, migration clean) — **ความพร้อมด้านฟีเจอร์ ≈ 90%** แต่ความพร้อมด้าน **Operations/Security ≈ 55%** ต้อง hardening ก่อนใช้งานจริงเต็มรูปแบบ

| มิติ | คะแนน | สรุป |
|------|-------|------|
| Functionality | 🟢 90% | ครบตาม SRS · ยังขาด LINE intake, Credit Hold (เลื่อนได้) |
| Security | 🔴 50% | **credentials หลุด/อ่อน, JWT default** (P0) |
| Data Integrity / บัญชี | 🟡 65% | เขียน dbo ตรง — ต้องยืนยันว่าไม่กระทบ GL WINSpeed (P0) |
| Reliability / Backup | 🟡 60% | ยังไม่มี backup/DR policy ที่ชัด, ไม่มี error monitoring |
| Testability / QA | 🟡 60% | มี test cases (manual) แต่ยังไม่มี automated test |
| Observability | 🔴 40% | log แค่ console · ไม่มี centralized log/alert |
| Performance | 🟢 80% | indexed views, polling เบา, dataset ใหญ่แต่ query มี TOP/cache |

---

## 🔴 P0 — ต้องแก้ก่อน Full Production (สำคัญสูงสุด)

### P0-1 Credentials หลุดและอ่อนแอ
- รหัส SQL `sa`, MySQL `root`, และค่าใน `.env` ถูกพิมพ์ลงแชต/ประวัติแล้ว → **ต้อง rotate (เปลี่ยนรหัสทั้งหมด) ทันที**
- `JWT_SECRET` ยังเป็นค่า default placeholder (`wssale_jwt_secret_please_change...`) → **เปลี่ยนเป็น random ≥64 ตัวอักษร**
- ใช้ `sa` / `root` (สิทธิ์สูงสุด) ในการเชื่อม → ควรใช้ **least-privilege user** (เช่น wf_owner สำหรับ wf, read-only user สำหรับ dbo, read-only user สำหรับ MySQL)
- **แนวทาง:** เก็บ secret ใน Railway/Vercel env vars เท่านั้น · ห้าม commit `.env` (ตรวจว่า .gitignore ครอบคลุม) · เปลี่ยนรหัสทุกตัว

### P0-2 ความถูกต้องบัญชี (dbo direct-write)
- ระบบเขียน `dbo.SOHD/SODT` ตรง (confirm/picking/ship) — ตัดสินใจรับไว้แล้ว แต่ **ต้อง dual-run / ตรวจสอบกับบัญชีจริง 2-4 สัปดาห์** ว่า:
  - ใบสั่งขายที่ App สร้าง → WINSpeed ออกใบกำกับ + post GL ได้ถูกต้อง 100%
  - ไม่มีเลขซ้ำ/ข้ามเลข, ยอดตรง, VAT ถูก (ปุ๋ยยกเว้น VAT)
- มี **rollback plan**: ถ้าผิดต้องคีย์ WINSpeed ตรงได้ (Non-Invasive fallback)

### P0-3 ตรวจสิทธิ์ DB ของ App บน Production
- ยืนยันว่า user ที่ Railway ใช้ **เขียนได้เฉพาะที่จำเป็น** (wf + SOHD/SODT/EMSetPrice ที่อนุญาต) — ไม่ใช่ full `sa`

---

## 🟡 P1 — ควรทำก่อน/ระหว่าง Pilot

| # | รายการ | แนวทาง |
|---|--------|--------|
| P1-1 | **Backup & DR** | SQL Server: full daily + log hourly · MySQL: Railway backup + export สำรอง · ทดสอบ restore (RTO<4ชม., RPO<1ชม. ตาม NFR-009) |
| P1-2 | **Error monitoring** | เพิ่ม Sentry/Logtail หรือ log รวมศูนย์ + alert เมื่อ 5xx · ตอนนี้ log แค่ console |
| P1-3 | **Rate limiting + Helmet** | กัน brute-force login + security headers (express-rate-limit, helmet) |
| P1-4 | **CORS เข้ม** | ตั้ง `CORS_ORIGIN` เป็น domain Vercel จริง (ไม่ใช่ `*`) |
| P1-5 | **Health check** | endpoint `/health` (DB ping ทั้ง SQL+MySQL) ให้ Railway/monitor เรียก |
| P1-6 | **Migration tracking** | ตอนนี้ runner รันทุกไฟล์ทุกครั้ง (idempotent) — พิจารณาตาราง schema_migrations กันรันซ้ำ |
| P1-7 | **TruckScale env บน Railway** | เพิ่ม `MYSQL_*` ใน Railway backend (ตอนนี้มีแค่ local) ไม่งั้น TruckScale ไม่ทำงานบน prod |

---

## 🟢 P2 — ปรับปรุงต่อเนื่อง (หลัง Go-Live)

| # | รายการ |
|---|--------|
| P2-1 | Automated tests (unit สำหรับ rebate FIFO/accrual, integration สำหรับ SO lifecycle) — อ้าง RBD68-019 เป็น fixture |
| P2-2 | Code-split frontend (bundle 858KB > 500KB warning) — lazy load หน้าที่ไม่ใช้บ่อย |
| P2-3 | Credit Hold (FR-003) + LINE intake (FR-016) — Phase ถัดไป |
| P2-4 | Receive-mode (รับเฉพาะชุด/รับพร้อม) ให้บันทึกชัดใน Control Ticket |
| P2-5 | ลบ migration ตาย (002_wf_schema_v2 no-op, 011 section) ออกเพื่อความสะอาด — optional |
| P2-6 | PDPA: เข้ารหัสข้อมูลส่วนบุคคล + retention policy (NFR-007) |

---

## รายการตรวจก่อน Go-Live (Go-Live Checklist)
- [ ] **P0-1** เปลี่ยนรหัส DB ทั้งหมด + JWT_SECRET + ใช้ least-privilege user
- [ ] **P0-1** ยืนยัน `.env` ไม่อยู่ใน git (`git ls-files | grep .env` ต้องว่าง ยกเว้น .env.example)
- [ ] **P0-2** dual-run บัญชี 2-4 สัปดาห์ + ยืนยัน GL/ใบกำกับถูก
- [ ] **P0-3** ยืนยันสิทธิ์ DB user บน Railway
- [ ] **P1-7** ตั้ง MYSQL_* บน Railway
- [ ] **P1-1** ตั้ง backup + ทดสอบ restore สำเร็จ
- [ ] **P1-4** CORS = domain จริง
- [ ] UAT ผ่าน ≥90% ([02-TEST-CASES](02-TEST-CASES.md)) + ผู้ใช้เซ็นรับ ([06-FORMS](06-FORMS.md))
- [ ] อบรมผู้ใช้ครบทุก Role + ส่งมอบคู่มือ ([03-USER-GUIDE](03-USER-GUIDE.md))
- [ ] Backup/rollback plan สื่อสารกับทีมแล้ว

---

## ข้อสรุปและคำแนะนำ
1. **ขึ้น Pilot ได้เลย** กับผู้ใช้กลุ่มเล็ก (1-2 ภาค) เพื่อเก็บ feedback — แต่ต้องปิด **P0-1 (security) ก่อน** เพราะ credentials หลุดแล้ว
2. **อย่าเพิ่งตัด WINSpeed manual** — รัน dual-run จนมั่นใจบัญชี (P0-2)
3. ลงทุน **backup + monitoring (P1)** ก่อนขยายผู้ใช้
4. หลังเสถียร ค่อยทำ **automated tests + Phase 2 (Credit/LINE)**

> โดยรวม: ระบบ "ใช้งานได้จริงและออกแบบดี" แต่ต้อง **harden ด้าน security/ops** ให้ถึงมาตรฐาน production ก่อนใช้เต็มรูปแบบ — ซึ่งเป็นงานปิด gap ที่ชัดเจนและทำได้ในเวลาสั้น
