---
documentId: "WF-QA-021"
title: "Test Log (แบบฟอร์มบันทึกผลทดสอบ)"
version: "v1.0"
status: Released
owner: "QA Lead"
normative: true
---
> **World Fert · WS-Sale-App — Enterprise Documentation v1.0**
> Document ID: `WF-QA-021` · Version: v1.0 · Status: Released · Classification: Confidential

# Test Log (แบบฟอร์มบันทึกผลทดสอบ)

คัดลอกไฟล์นี้เป็นรอบทดสอบใหม่ (เช่น `TEST-LOG-2026-07-25.md`) — ผูกกับ `TEST-CATALOG-CURRENT.md` และเวอร์ชัน app จริงเสมอ เพื่อให้ log **ตรงกับ UI/UX ปัจจุบัน**

## หัวรอบทดสอบ

| รายการ | ค่า |
|---|---|
| รอบทดสอบ (Round) | _เช่น UAT-2026-07-25_ |
| App version (`package.json`) | _เช่น 1.0.0_ |
| Doc set version | v1.0 |
| Environment | _local / staging / production_ |
| ผู้ทดสอบ | _ชื่อ + role_ |
| วันที่ | _yyyy-mm-dd_ |
| Build/commit | _git sha (ถ้ามี)_ |

> ก่อนเริ่ม: รัน `pipeline/build-docs.ps1` ให้ผ่าน (ยืนยัน catalog ครอบคลุมหน้าจอปัจจุบัน + docs/app version ตรง)

## ผลการทดสอบ

| TC-ID | หน้าจอ/ฟังก์ชัน | ขั้นตอนย่อ | คาดหวัง | ผล (Pass/Fail/Blocked) | หลักฐาน (screenshot/URL) | หมายเหตุ |
|---|---|---|---|---|---|---|
| TC-AUTH-01 | Login | เข้าด้วยบัญชีถูก | เข้าตาม role | | | |
| TC-DASH-01 | Dashboard | เปิดหน้าแรก | KPI ตรง DB | | | |
| TC-SALE-01 | สร้าง SO (I) | ลูกค้า→สินค้า→บันทึก | บันทึกสำเร็จ | | | |
| TC-SALE-05 | เบิกตั๋วคุม (AI) | เบิกจาก WFCoupon | RemaQty ลดลง | | | |
| TC-QUO-03 | Quotation→SO | แปลง multi-bill | ได้ SO ครบ | | | |
| TC-STORE-02 | Truck Loader | จัดลำดับโหลด | LoadSequence ถูก | | | |
| TC-TS-02 | Weigh Inbox | จับคู่ตั๋วชั่ง↔SO | SHIPPED + WeighTicket | | | |
| TC-TS-03 | ชั่งออก | weigh-out | rebate accrual เกิด | | | |
| TC-REB-03 | เคลมรีเบท | FIFO cut→CN | RemainingAmt ลด | | | |
| TC-REB-04 | CN Rebate | ดูรายการ 109 | ผูก RefSOID | | | |
| TC-VOU-01 | คูปองคงเหลือ | สรุปต่อลูกค้า | ตรง WFCoupon | | | |
| TC-MAS-03 | Price Book | 5-level color | สีตรง Set Price | | | |
| TC-SET-02 | PDPA audit | access-as | บันทึก audit log | | | |

_เพิ่มแถวตาม TC-ID ที่เหลือใน `TEST-CATALOG-CURRENT.md`_

## สรุปรอบ

| ตัวชี้วัด | จำนวน |
|---|---|
| ทดสอบทั้งหมด | |
| Pass | |
| Fail | |
| Blocked | |
| Pass rate % | |

## ข้อบกพร่องที่พบ (Defects)

| # | TC-ID | อาการ | ความรุนแรง (P0/P1/P2) | สถานะ | ผู้รับผิดชอบ |
|---|---|---|---|---|---|
| 1 | | | | | |

## Sign-off

| บทบาท | ชื่อ | ผล (อนุมัติ/ไม่) | วันที่ |
|---|---|---|---|
| QA Lead | | | |
| Business Owner | | | |
| Release Manager (ถ้าเป็น release) | | | |

> เก็บ log ที่ผ่านแล้วเป็น **quality record** (ขึ้นทะเบียนใน `00-GOVERNANCE/RECORDS-REGISTER.md`, retain ≥ 3 ปี)
