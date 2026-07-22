---
documentId: "WF-QA-015"
title: "06 — แบบฟอร์มและบันทึก (Forms & Records · ISO 9001)"
version: "v1.0"
status: Released
owner: "QA Lead"
normative: true
---
> **World Fert · WS-Sale-App — Enterprise Documentation v1.0**
> Document ID: `WF-QA-015` · Version: v1.0 · Date: 21 กรกฎาคม 2569 (21 July 2026) · Status: Released
> Classification: Confidential — Client / Authorized Partner Use Only
> Source of truth: operational build v1.0 · verified against `dbwins_worldfert9`

---
# 06 — แบบฟอร์มและบันทึก (Forms & Records · ISO 9001)

> ชุดแบบฟอร์มสำหรับบันทึกหลักฐานคุณภาพ · WS-Sale-App
> วิธีใช้: คัดลอกตารางไปกรอกจริง (Excel/กระดาษ) ต่อรอบการทดสอบ/เปลี่ยนแปลง

---

## ฟอร์ม 1 — Test Log (บันทึกผลการทดสอบ)
**รหัสฟอร์ม:** WF-FM-01 · ใช้คู่กับ [02-TEST-CASES](TEST-CASES-DETAIL.md)

**ข้อมูลรอบทดสอบ**
| รายการ | ค่า |
|--------|-----|
| โครงการ/เวอร์ชัน | WS-Sale-App v__________ |
| รอบทดสอบ | ☐ UAT ☐ Regression ☐ Smoke |
| แหล่งข้อมูล (DB) | ☐ LOCAL ☐ REMOTE |
| วันที่ทดสอบ | ____/____/______ |
| ผู้ทดสอบ | ____________________ |
| ผู้ตรวจสอบ | ____________________ |

**ผลรายกรณี**
| TC-รหัส | โมดูล | ผล (✅ผ่าน/❌ไม่ผ่าน/➖ข้าม) | หลักฐาน (screenshot/เลขที่) | หมายเหตุ/ข้อบกพร่อง | ผู้ทดสอบ | วันที่ |
|---------|-------|------|------|------|--------|--------|
| TC-B01 |  |  |  |  |  |  |
| TC-C01 |  |  |  |  |  |  |
| TC-D03 |  |  |  |  |  |  |
| ... |  |  |  |  |  |  |

**สรุปรอบ**
| ทั้งหมด | ผ่าน | ไม่ผ่าน | ข้าม | % ผ่าน | ผ่านเกณฑ์ (≥90% critical)? |
|---------|------|---------|------|--------|------|
|  |  |  |  |  | ☐ ใช่ ☐ ไม่ |

---

## ฟอร์ม 2 — UAT Sign-off (ใบยอมรับการทดสอบ)
**รหัสฟอร์ม:** WF-FM-02

| รายการ | รายละเอียด |
|--------|------------|
| ระบบ/เวอร์ชัน | WS-Sale-App v__________ |
| ขอบเขตที่ทดสอบ | ____________________________ |
| จำนวน TC ผ่าน / ทั้งหมด | _______ / _______ |
| ข้อบกพร่องคงค้าง (critical) | _______ รายการ |

**มติ:** ☐ ยอมรับ (Go-Live)   ☐ ยอมรับแบบมีเงื่อนไข   ☐ ไม่ยอมรับ

| บทบาท | ชื่อ | ลายเซ็น | วันที่ |
|-------|------|---------|--------|
| ตัวแทนผู้ใช้ (ฝ่ายขาย) |  |  |  |
| ตัวแทนบัญชี |  |  |  |
| IT / ผู้พัฒนา |  |  |  |
| ผู้อนุมัติ (ผู้บริหาร) |  |  |  |

---

## ฟอร์ม 3 — Change Request (คำขอเปลี่ยนแปลง)
**รหัสฟอร์ม:** WF-FM-03

| รายการ | รายละเอียด |
|--------|------------|
| เลขที่ CR | CR-______ |
| วันที่ขอ / ผู้ขอ | ____/____/____ ___________ |
| ประเภท | ☐ ฟีเจอร์ใหม่ ☐ แก้บั๊ก ☐ ปรับปรุง ☐ เอกสาร |
| รายละเอียด/เหตุผล | ____________________________ |
| ผลกระทบ (หน้า/SQL/migration) | ____________________________ |
| ความเสี่ยง / แผนถอย | ____________________________ |
| ผู้อนุมัติ / วันที่ | ___________ ____/____/____ |
| สถานะ | ☐ รออนุมัติ ☐ อนุมัติ ☐ ดำเนินการ ☐ ปิด (เวอร์ชัน v____) |

---

## ฟอร์ม 4 — Requirement Traceability Matrix (RTM)
**รหัสฟอร์ม:** WF-FM-04 · เชื่อม FR → โมดูล → Test Case → สถานะ

| FR | ความต้องการ | โมดูล/หน้า | Migration/แหล่ง | Test Case | สถานะ |
|----|-------------|-----------|-----------------|-----------|-------|
| FR-001 | SO State Machine | ขาย, Paper Trail | 001 | TC-C03, TC-D01 | ✅ |
| FR-004 | เอกสาร 4 สี + QR | Paper Trail | 016 | TC-F01..F02 | ✅ |
| FR-006/007 | Unlock Request | Paper Trail | 018 | TC-E01..E05 | ✅ |
| FR-008/009 | Rebate Plan + จัดสรร | Rebate Plan | 017 | TC-H01..H05 | ✅ |
| FR-010/011 | Rebate FIFO + Claim | รีเบท, บัญชี | 001/010 | TC-G01..G05 | ✅ |
| FR-012/013 | Paper scan + alert | Paper Trail | 016 | TC-F03..F06 | ✅ |
| FR-017 | Reports + Excel | รายงาน | code | TC-M01..M03 | ✅ |
| FR-019 | Mother/Baby load | คลัง | 007 | TC-D02 | ✅ |
| FR-020 | ของแถม + งบ | ของแถม | 002 | TC-L01..L03 | ✅ |
| FR-021 | Control Ticket | ชุดตั๋วคุม | dbo+008 | TC-K01..K03 | ✅ |
| FR-022 | Verification Gate | Paper Trail | 018 | TC-C01..C04 | ✅ |
| FR-023 | Price Book NET | ข้อมูลหลัก | dbo | TC-O02..O03 | ✅ |
| FR-024/025/026 | TruckScale live | TruckScale, คลัง | MySQL/019 | TC-N01..N05, TC-D04..D06 | ✅ |
| FR-003 | Credit Hold | — | — | — | ⏳ เลื่อน |
| FR-016 | LINE Login / LINE integration | Auth / Admin Users / LINE route | 035 + code | TC-A05..A06, TC-O06 | ✅ code ready / pending DB apply |

---

## ฟอร์ม 5 — Training Record (บันทึกการอบรม)
**รหัสฟอร์ม:** WF-FM-05

| วันที่ | หัวข้อ/โมดูล | ผู้สอน | Role ผู้เข้าอบรม | รายชื่อ (ลายเซ็น) | ประเมินผล |
|--------|--------------|--------|------------------|-------------------|-----------|
|  |  |  |  |  |  |

---

## ฟอร์ม 6 — Deployment / Release Record (บันทึกการ Deploy)
**รหัสฟอร์ม:** WF-FM-06

| เวอร์ชัน | วันที่ | ผู้ deploy | migration ที่รัน | สรุปการเปลี่ยนแปลง | ผลตรวจหลัง deploy | rollback? |
|----------|--------|-----------|------------------|---------------------|-------------------|-----------|
| v5.0.0 | 27/06/2569 | T.M | 016-019 | TruckScale live | ✅ | - |
|  |  |  |  |  |  |  |

---

## ฟอร์ม 7 — Document Control Register (ทะเบียนเอกสาร)
**รหัสฟอร์ม:** WF-FM-07

| รหัสเอกสาร | ชื่อเอกสาร | เวอร์ชัน | วันที่ | เจ้าของ | ที่จัดเก็บ |
|-----------|-----------|---------|--------|---------|-----------|
| WF-SRS-001 | SRS | 6.2 | 27/06/2569 | BA/SA | refs/ |
| WF-DOC-00 | Database Overview | 1.0 | 27/06/2569 | IT | docs/ |
| WF-DOC-01 | Pages/SQL Map | 1.0 | 27/06/2569 | IT | docs/ |
| WF-DOC-02 | Test Cases | 1.0 | 27/06/2569 | QA | docs/ |
| WF-DOC-03 | User Guide | 1.0 | 27/06/2569 | ฝ่ายขาย | docs/ |
| WF-SOP-WSSALE | SOP | 1.0 | 27/06/2569 | IT/ฝ่ายขาย | docs/ |

---

## Current Addendum - 2026-07-08

### Release Record row to add
| Version | Date | Deployer | Migrations | Change Summary | Post-deploy Check | Rollback? |
|---|---|---|---|---|---|---|
| v5.0.0 | 08/07/2569 | T.M / IT | 031-035 | SO requested/transport flags, Rebate Plan Ref Doc, giveaway line approval, customer request flow, LINE Login binding | Applied to restored local DB; smoke test pending | Restore backup / disable feature routes |
| v5.0.0 | 13/07/2569 | T.M / IT | 036-045 | WINSpeed SO/Quotation alignment, Access As audit, automated QA scripts | Migration/query/API smoke, lint, and build passed locally | Restore backup / disable feature routes |

### RTM additions
| Requirement | Module | Migration / Source | Test Case | Status |
|---|---|---|---|---|
| Requested date-time and transport flags | Sales Order | 031 | TC-B06 | Implemented, DB applied |
| 5-level price color | Sales Order | code | TC-B07 | Implemented |
| Giveaway per-item approval | Sales Order / Giveaway | 033 | TC-B08..B09 | Implemented, DB applied |
| Rebate Plan Ref Doc | Rebate Plan | 032 | TC-H06 | Implemented, DB applied |
| New customer request flow | Master Data | 034 | TC-O04..O05 | Implemented, DB applied |
| LINE Login | Auth / Admin Users | 035 + code | TC-A05..A06, TC-O06 | Implemented, DB applied; self-link/UAT pending |

### Deployment checklist additions
- [x] Restore target database.
- [x] Apply migrations `031-035`.
- [ ] Restart backend.
- [ ] Verify LINE Login callback URL in LINE Developers matches `LINE_LOGIN_CALLBACK_URL`.
- [ ] Self-link at least one active user through LINE Login and perform login smoke test.
- [x] Run automated query/API smoke tests locally and attach result reference: `docs/09-AUTOMATED-QA.md`.
- [ ] Manual retest Access As by real role hierarchy.
| WF-DOC-05 | Production Readiness | 1.0 | 27/06/2569 | SA | docs/ |
| WF-FM-01..07 | Forms | 1.0 | 27/06/2569 | QMR | docs/ |

---
*ฟอร์มเหล่านี้เป็น "บันทึกคุณภาพ" (Quality Records) ตาม ISO 9001 ข้อ 7.5 — เก็บรักษาตามรอบที่กำหนด*

