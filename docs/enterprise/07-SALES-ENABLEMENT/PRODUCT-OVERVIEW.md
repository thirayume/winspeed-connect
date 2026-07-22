---
documentId: "WF-SAL-001"
title: "Product Overview — WS-Sale-App"
version: "v1.0"
status: Review
statusDetail: "Merged from v8.0; source verification and approval required"
sourceVersion: "v8.0"
sourceStatus: "Released"
sourceStatusDetail: "Commercial Collateral — Final Baseline"
mergePolicy: latest-document-wins
mergeDisposition: retained-unique-content
mergedAt: "2026-07-21"
owner: "Sales / Solution Architect"
normative: false
---
# Product Overview — WS-Sale-App

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-SAL-001` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v1.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | Sales / Solution Architect |
| Status | Review — merged candidate; source verification required |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Merge provenance — 21 July 2026:** เอกสารต้นทาง v8.0 ถูกคงไว้เป็น v1.0 review candidate ตามนโยบาย `latest-document-wins`; หากขัดกับเอกสารที่ใหม่กว่าหรือ source code ปัจจุบัน ให้ยึดหลักฐานล่าสุด และต้อง review/approve ก่อน baseline.


---

## Product positioning

**WS-Sale-App** คือแพลตฟอร์มบริหารการขายและการปฏิบัติการจ่ายสินค้า สำหรับธุรกิจปุ๋ย/สินค้าเทกองที่ยังใช้ ERP เดิมเป็นแกนการเงิน แต่ต้องการลดความล่าช้า ความผิดพลาด และการตรวจสอบย้อนหลังที่กระจัดกระจาย

## Business value

| Before | With WS-Sale-App |
|---|---|
| Order ผ่านข้อความและคีย์ซ้ำ | digital SO + Verification Gate |
| คลังตีความหมายเหตุ/โหลดเอง | load sequence ต่อรายการ |
| เอกสาร 4 สีติดตามด้วยคน | QR paper trail/custody events |
| Rebate ตรวจทีละ invoice | line accrual/FIFO/claim trace |
| TruckScale แยกจาก sales | weigh evidence linked to ship |
| ERP replacement เสี่ยง | operational layer preserving financial boundary |

## Modules

1. Sales Order & Quotation
2. Verification, approval and unlock
3. Warehouse/mother-baby sequencing
4. TruckScale/WeighTicket
5. Paper Trail and QR
6. Price Book, Rebate Plan, Pool, FIFO, Claim and CN evidence
7. Giveaway and Control Ticket
8. Dashboard, report, RBAC, audit, security and operations

## Differentiators

- designed from actual process/data evidence
- protects existing ERP financial ownership
- ledger-grade rebate traceability
- factory-ready tablet workflow
- production-grade security/DR/reconciliation controls
- ISO/UAT/handover documentation pack

## Ideal client

องค์กรที่มี ERP อยู่แล้ว แต่หน้าร้าน/ฝ่ายขาย/คลัง/เครื่องชั่งยังมี paper/manual workflow, มี promotion/rebate ที่ต้อง audit, และต้องการ digitalization โดยไม่เสี่ยงเปลี่ยน ERP ทั้งระบบทันที
