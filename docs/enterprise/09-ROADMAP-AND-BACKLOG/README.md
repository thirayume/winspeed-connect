---
documentId: "WF-ROADMAP-001"
title: "09 — Roadmap & Backlog (แผนงาน / งานค้าง / ประเด็นเปิด)"
version: "v1.0"
status: Released
owner: "Product Owner"
normative: false
---
> **World Fert · WS-Sale-App — Enterprise Documentation v1.0**
> Document ID: `WF-ROADMAP-001` · Version: v1.0 · Date: 21 กรกฎาคม 2569 · Status: Released
> Classification: Confidential — Client / Authorized Partner Use Only

# 09 — Roadmap & Backlog (แผนงาน / งานค้าง / ประเด็นเปิด)

รวมสิ่งที่ **วางแผนไว้แต่ยังไม่เข้ากระบวนการพัฒนา** และงาน/ประเด็นที่ยังค้าง ไว้ที่เดียว เพื่อไม่ให้ตกหล่น (ไม่ถูกเก็บเข้า `_archive`)

## สารบัญ

| ไฟล์ | เนื้อหา | สถานะ |
|---|---|---|
| [`roadmap/THAI-LOCALIZATION-ROADMAP.md`](roadmap/THAI-LOCALIZATION-ROADMAP.md) | แผน Thai accounting/localization (+ .docx/.pptx) | **วางแผนแล้ว ยังไม่พัฒนา** |
| [`PENDING-ISSUES.md`](PENDING-ISSUES.md) | ประเด็นค้าง/known issues | เปิด |
| [`OPEN-DECISIONS-REGISTER.md`](OPEN-DECISIONS-REGISTER.md) | การตัดสินใจที่ยังไม่ปิด | เปิด |
| [`V6-TO-V8-DELTA-AND-RISK-REGISTER.md`](V6-TO-V8-DELTA-AND-RISK-REGISTER.md) | ส่วนต่างรุ่น + ทะเบียนความเสี่ยง | อ้างอิง |
| [`legacy-open-items/`](legacy-open-items/) | งานค้างจากการวิเคราะห์ยุคแรก (findings, open items, requirement verification, workflow tests) | ทบทวน |

## กติกา

1. **งานที่วางแผนแต่ยังไม่พัฒนา** อยู่ที่นี่ (ไม่ใช่ `_archive`) จนกว่าจะเริ่มพัฒนา → ย้ายเข้า SRS/Requirements Catalog
2. เมื่อพัฒนาเสร็จ → ย้ายรายการเข้า `02-REQUIREMENTS/IMPLEMENTATION-STATUS.md` + เพิ่ม test ใน `06-QUALITY-OPERATIONS/TEST-CATALOG-CURRENT.md`
3. ทบทวน backlog นี้ทุกรอบ release (ดู `05-SECURITY-DEVOPS/DOC-SYNC-PIPELINE.md`)
4. `legacy-open-items/` = สแน็ปช็อตจาก KI ยุคแรก (มิ.ย. 2569) — ตรวจว่ายังเกี่ยวข้องก่อนนำมาใช้ (ต้นฉบับเต็มอยู่ใน `_archive/wf-out-ki/`)
