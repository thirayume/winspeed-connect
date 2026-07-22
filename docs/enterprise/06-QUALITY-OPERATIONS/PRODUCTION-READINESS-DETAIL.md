---
documentId: "WF-QA-014"
title: "05 — ประเมินความพร้อม Production (Production Readiness Assessment)"
version: "v1.0"
status: Released
owner: "QA Lead"
normative: true
---
> **World Fert · WS-Sale-App — Enterprise Documentation v1.0**
> Document ID: `WF-QA-014` · Version: v1.0 · Date: 21 กรกฎาคม 2569 (21 July 2026) · Status: Released
> Classification: Confidential — Client / Authorized Partner Use Only
> Source of truth: operational build v1.0 · verified against `dbwins_worldfert9`

---
# 05 — ประเมินความพร้อม Production (Production Readiness Assessment)

> WS-Sale-App · build v5.0.0 · ประเมิน 8 ก.ค. 2569 · โดย Solution Architect

## บทสรุปผู้บริหาร (Verdict)
> **สถานะ: พร้อมระดับ "Soft Launch / Pilot" — ยังไม่ควรขึ้น Full Production จนกว่าจะปิดรายการ P0 (ความปลอดภัย/ความถูกต้องบัญชี)**

ระบบมีฟังก์ชันครบตาม SRS v6.2 (22 หน้า, FR หลักครบ, deploy จริง Railway+Vercel, migration clean) — **ความพร้อมด้านฟีเจอร์ ≈ 90%** แต่ความพร้อมด้าน **Operations/Security ≈ 55%** ต้อง hardening ก่อนใช้งานจริงเต็มรูปแบบ

| มิติ | คะแนน | สรุป |
|------|-------|------|
| Functionality | 🟢 95% | ครบตาม SRS หลัก + Meeting Minutes 02072026 ส่วนใหญ่ · LINE Login implemented in code; Credit Hold ยังเป็น next phase |
| Security | 🔴 50% | **credentials หลุด/อ่อน, JWT default** (P0) |
| Data Integrity / บัญชี | 🟡 65% | เขียน dbo ตรง — ต้องยืนยันว่าไม่กระทบ GL WINSpeed (P0) |
| Reliability / Backup | 🟡 60% | ยังไม่มี backup/DR policy ที่ชัด, ไม่มี error monitoring |
| Testability / QA | 🟡 75% | มี manual test cases และ automated smoke tests สำหรับ migration/query/API/build/lint แล้ว; ยังต้องเพิ่ม unit/integration เชิงลึก |
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
| P2-1 | Automated tests เชิงลึก: unit สำหรับ rebate FIFO/accrual และ integration สำหรับ SO lifecycle เพิ่มเติม; smoke tests ปัจจุบันอยู่ที่ `docs/09-AUTOMATED-QA.md` |
| P2-2 | Code-split frontend (bundle 858KB > 500KB warning) — lazy load หน้าที่ไม่ใช้บ่อย |
| P2-3 | Credit Hold (FR-003) — Phase ถัดไป; LINE Login implemented in code, pending migration/UAT |
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
- [ ] UAT ผ่าน ≥90% ([02-TEST-CASES](TEST-CASES-DETAIL.md)) + ผู้ใช้เซ็นรับ ([06-FORMS](FORMS-DETAIL.md))
- [ ] อบรมผู้ใช้ครบทุก Role + ส่งมอบคู่มือ ([03-USER-GUIDE](USER-GUIDE-DETAIL.md))
- [ ] Backup/rollback plan สื่อสารกับทีมแล้ว

---

## ข้อสรุปและคำแนะนำ
1. **ขึ้น Pilot ได้เลย** กับผู้ใช้กลุ่มเล็ก (1-2 ภาค) เพื่อเก็บ feedback — แต่ต้องปิด **P0-1 (security) ก่อน** เพราะ credentials หลุดแล้ว
2. **อย่าเพิ่งตัด WINSpeed manual** — รัน dual-run จนมั่นใจบัญชี (P0-2)
3. ลงทุน **backup + monitoring (P1)** ก่อนขยายผู้ใช้
4. หลังเสถียร ค่อยทำ **automated tests + Phase 2 (Credit/LINE)**

> โดยรวม: ระบบ "ใช้งานได้จริงและออกแบบดี" แต่ต้อง **harden ด้าน security/ops** ให้ถึงมาตรฐาน production ก่อนใช้เต็มรูปแบบ — ซึ่งเป็นงานปิด gap ที่ชัดเจนและทำได้ในเวลาสั้น

---

## Current Addendum - 2026-07-08

### Feature readiness update
- Functionality is now closer to pilot-complete for the Meeting Minutes 02072026 backlog.
- Implemented in source: SO requested/transport flags, 5-level price colors, rebate role visibility, dashboard/date search, customer filters, goods dedupe, giveaway line approval, status timestamps, Paper Trail price hiding/security green, customer request flow, Rebate Plan Ref Doc, and LINE Login.
- Migrations `031-035` have been applied to the restored local `dbwins_worldfert9` database on 2026-07-08.

### Remaining critical work before full production
- Run smoke tests against the restored local database.
- Restart backend after migration/config changes.
- Verify LINE Login callback domain and CORS on the real deployment domain.
- Smoke test first-time LINE self-link with an existing active user; Admin binding is only needed for support exceptions.
- Keep P0 security controls active: rotate any secrets exposed in chat/history, store secrets only in env vars, and confirm `.env` is not tracked.

### Updated P2 status
- LINE Login is no longer purely future work; it is implemented in code and schema, but requires callback URL verification and self-link UAT.
- Credit Hold remains a future/next-phase item.

## Current Addendum - 2026-07-13

### QA readiness update
- Added repeatable local smoke commands:
  - `npm run smoke:queries`
  - `npm run smoke:api`
  - `npm run smoke:api:local`
- Latest local QA passed migration, SQL query smoke, API smoke, frontend lint, and production build.
- `wf.AccessAsAudit` and `wf.ApiAuditLog` are verified by API smoke.
- The remaining QA gap is not basic stability; it is deeper workflow/UAT coverage for real users, WINSpeed screens, and TruckScale live data.

### Remaining before wider UAT
- Continue tuning `/api/so?page=1&limit=5` if concurrent UAT needs sub-second response; latest local API smoke improved from about 3.2 seconds to about 1.9 seconds after splitting total-count and page queries.
- Run manual retest checklist in [09-AUTOMATED-QA.md](AUTOMATED-QA.md).
- Confirm Access As behavior by real role: Admin, Manager, Accounting, Approver, Counter Sale, Sales.
- Confirm LINE callback URL and first-time self-link on the real deployment domain.

