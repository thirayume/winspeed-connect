---
documentId: "WF-BAD-003"
title: "Business Rules Catalog"
version: "v1.0"
status: Review
statusDetail: "Merged from v8.0; source verification and approval required"
sourceVersion: "v8.0"
sourceStatus: "Released"
sourceStatusDetail: "Final — Commercial Delivery Baseline"
mergePolicy: latest-document-wins
mergeDisposition: retained-unique-content
mergedAt: "2026-07-21"
owner: "BA / Process Owner"
normative: true
---
# Business Rules Catalog

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-BAD-003` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v1.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | BA / Process Owner |
| Status | Review — merged candidate; source verification required |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Merge provenance — 21 July 2026:** เอกสารต้นทาง v8.0 ถูกคงไว้เป็น v1.0 review candidate ตามนโยบาย `latest-document-wins`; หากขัดกับเอกสารที่ใหม่กว่าหรือ source code ปัจจุบัน ให้ยึดหลักฐานล่าสุด และต้อง review/approve ก่อน baseline.


---

## Sales Order Rules

| ID | Rule |
|---|---|
| BR-SO-001 | SO เริ่ม `DRAFT`; แก้ได้ก่อน confirm หรือหลัง approved unlock |
| BR-SO-002 | SO ต้องมีลูกค้า สินค้า จำนวน ราคา วันที่ส่ง และทะเบียนรถตาม policy ก่อนบันทึก |
| BR-SO-003 | ต้องผ่าน `VerifiedBy/VerifiedAt` ก่อน confirm ยกเว้น authorized bypass + reason |
| BR-SO-004 | Confirm ต้องสร้าง audit และตรึง snapshot ของ NET price/plan |
| BR-SO-005 | ระหว่าง `PICKING` ห้ามแก้ line/product/quantity ตรง |
| BR-SO-006 | `SHIPPED` ต้องมี weight evidence หรือ authorized manual override |
| BR-SO-007 | Correction หลัง confirm ใช้ compensation; ห้าม hard delete history |

## Loading Rules

| ID | Rule |
|---|---|
| BR-LOAD-001 | Line ระบุ `MOTHER`, `BABY`, หรือ `UNSPECIFIED` ได้ |
| BR-LOAD-002 | `LoadSequence` ห้ามซ้ำใน SO เดียวกันตาม policy |
| BR-LOAD-003 | เอกสารจ่ายของต้องแสดง sequence/หมายเหตุรับพร้อม |
| BR-LOAD-004 | แก้ sequence หลัง picking ต้องผ่าน exception audit |

## Rebate Rules

| ID | Rule |
|---|---|
| BR-RB-001 | Accrual เกิดเฉพาะ line ที่ match active Plan/Price ณ confirm |
| BR-RB-002 | `accrual = (sell - net) × qtyTon`; negative ต้องผ่าน special policy |
| BR-RB-003 | Ledger ชี้กลับ SO line, plan, pool, sales, region |
| BR-RB-004 | Claim ตัด FIFO และห้ามเกิน available |
| BR-RB-005 | Unlock reverse ledger ด้วย compensation/reversedFlag ไม่ลบ |
| BR-RB-006 | Approved claim ต้องมี CN evidence จาก WINSpeed |
| BR-RB-007 | Plan overlap เลือกตาม priority/validity/policy |

## Giveaway/Control Ticket

| ID | Rule |
|---|---|
| BR-GW-001 | Giveaway เป็น line/withdrawal แยกและราคา 0 ตามรูปแบบ |
| BR-GW-002 | Budget แยก Region, Sales, Item, Brand, Period |
| BR-GW-003 | Over-budget ต้องเตือนและ audit/approval ตาม policy |
| BR-CT-001 | Ticket ใช้ `AI...`/mapping ที่ยืนยัน |
| BR-CT-002 | Balance = reserved − draw; ต้อง drill-down |
| BR-CT-003 | receive mode `SET_ONLY` และ `WITH_ORDER` |
| BR-CT-004 | Overdraw blocked เว้น approved exception |

## TruckScale/Accounting

| ID | Rule |
|---|---|
| BR-TS-001 | App ห้ามแก้ completed-weigh source; เขียนได้เฉพาะ INSERT/DELETE `tbl_keyone` ตาม pre-weigh lifecycle |
| BR-TS-002 | Match หลักใช้ normalized plate + evidence/time window |
| BR-TS-003 | เลือก source แล้วเก็บ immutable source reference |
| BR-TS-004 | Manual entry ต้อง authorized + reason |
| BR-ACC-001 | WINSpeed owner ของ invoice/CN/GL |
| BR-ACC-002 | ห้ามเขียน `SOInvHD/SOInvDT/GLHD/GLDT` ตรง |
| BR-ACC-003 | dbo write ทำได้เฉพาะ approved contract ตาม ADR-003 |
