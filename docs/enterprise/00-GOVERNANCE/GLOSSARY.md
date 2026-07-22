---
documentId: "WF-GOV-003"
title: "อภิธานศัพท์ระบบ"
version: "v1.0"
status: Review
statusDetail: "Merged from v8.0; source verification and approval required"
sourceVersion: "v8.0"
sourceStatus: "Released"
sourceStatusDetail: "Final — Commercial Delivery Baseline"
mergePolicy: latest-document-wins
mergeDisposition: retained-unique-content
mergedAt: "2026-07-21"
owner: "BA / Product Owner"
normative: true
---
# อภิธานศัพท์ระบบ

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-GOV-003` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v1.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | BA / Product Owner |
| Status | Review — merged candidate; source verification required |
| Classification | Confidential — Client / Authorized Partner Use Only |

> **Merge provenance — 21 July 2026:** เอกสารต้นทาง v8.0 ถูกคงไว้เป็น v1.0 review candidate ตามนโยบาย `latest-document-wins`; หากขัดกับเอกสารที่ใหม่กว่าหรือ source code ปัจจุบัน ให้ยึดหลักฐานล่าสุด และต้อง review/approve ก่อน baseline.


---

| คำ | ความหมาย |
|---|---|
| SO | Sales Order / ใบสั่งขาย |
| Reservation / ใบสั่งจอง | เอกสารต้นทาง WINSpeed DocuType 103 ที่ผูกตั๋วคุม |
| Control Ticket / ตั๋วคุม | เลข approval prefix `AI` และสิทธิ์รับสินค้า |
| Verification | การตรวจซ้ำโดย Counter Sales ก่อน Confirm |
| Picking | ขั้นตอนรับ/จัดสินค้าและลำดับโหลด |
| Shipped | จ่ายออกสำเร็จพร้อม weight evidence |
| WeighTicket | tare/gross/net, เวลา, scale และ source reference |
| Rebate | ส่วนลดส่งเสริมการขายจากส่วนต่าง sell price/NET |
| Accrual | ยอด rebate ที่เกิดตาม line |
| Pool | ยอดระดับ Sales × Plan × Formula × Region × Period |
| FIFO | ตัดยอดเก่าก่อน |
| Claim | คำขอเคลมรีเบท |
| CN | Credit Note DocuType 109 ใน WINSpeed |
| Price Book | ราคา NET ต่อสูตร/เดือน |
| Giveaway | ของแถม/สื่อส่งเสริมการขาย |
| Paper Trail | การติดตามเอกสาร 4 สีด้วย QR |
| Mother/Baby | รถพ่วงแม่/ลูกที่ต้องเรียงลำดับโหลด |
| RBAC | Role-Based Access Control |
| RTO/RPO | เวลาฟื้นคืนระบบ/ข้อมูลสูญหายที่ยอมรับได้ |
| Canonical Source | แหล่งข้อมูลที่เลือกเป็นข้อเท็จจริงสุดท้าย |
