---
documentId: "WF-REQ-STATE-008"
title: "Current System State — Modules, Data Dictionary & API (v8)"
version: "v1.0"
runtimeVersion: "1.0.1"
sourceMigrationSequence: 55
truckScaleWriteTargets: "tbl_keyone"
status: Review
statusDetail: "Merged from v8.0; source verification and approval required"
sourceVersion: "v8.0"
sourceStatus: "Released"
sourceStatusDetail: "Final — UAT Demo Baseline"
mergePolicy: latest-document-wins
mergeDisposition: retained-unique-content
mergedAt: "2026-07-21"
owner: "Solution Architect"
normative: true
---
# Current System State — Modules, Data Dictionary & API (v8)

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-REQ-STATE-008` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v1.0 |
| Date | 1 กรกฎาคม 2569 (1 July 2026) |
| Owner | Solution Architect |
| Status | Review — merged candidate; source verification required |
| Classification | Confidential — Client / Authorized Partner Use Only |
| Source snapshot | package runtime 1.0.1 · migration sequence through 055 · 17 route modules / 160 endpoints / 22 portal keys |

> **Merge provenance — 21 July 2026:** เอกสารต้นทาง v8.0 ถูกคงไว้เป็น v1.0 review candidate ตามนโยบาย `latest-document-wins`; หากขัดกับเอกสารที่ใหม่กว่าหรือ source code ปัจจุบัน ให้ยึดหลักฐานล่าสุด และต้อง review/approve ก่อน baseline.

> เอกสารนี้คือภาพรวม "สถานะปัจจุบันของระบบ" ที่ตรงกับโค้ดจริง — โมดูล, ตารางข้อมูล (wf), API และการเชื่อม WINSpeed ↔ TruckScale · ใช้คู่กับ [IMPLEMENTATION-STATUS](IMPLEMENTATION-STATUS.md) (FR ↔ build)

---

## 1. สถาปัตยกรรมโดยย่อ
3 ฐานข้อมูล: **WINSpeed dbo** (SQL Server, system of record บัญชี — อ่านเป็นหลัก, เขียนเฉพาะ flow ที่อนุมัติ), **wf schema** (SQL Server เดียวกัน — operational extension, read-write ผ่าน migration), **TruckScale** (MySQL/Railway — อ่าน `tblscale`/ตารางอ้างอิง และเขียนเฉพาะ pre-weigh queue `tbl_keyone`)

รูปแบบสำคัญ: dual-pool DB switch (local/remote ผ่าน `X-DB-Target`), Socket.IO realtime, **migration ledger** (กันรันซ้ำ), **integration outbox** (event เชื่อถือได้), **approval policy engine** (อนุมัติ config ได้), **observability** (telemetry + alert), **TruckScale pull-sync** (ดึงข้อมูลชั่งกลับ)

## 2. โมดูล / หน้า (source inventory: 22 portal keys)
| กลุ่ม | หน้า |
|---|---|
| ขาย/เอกสาร | Dashboard, ขาย(POS), เสนอราคา(Quotation), Paper Trail, ตั๋วคงค้าง(Aging) |
| คลัง/ชั่ง | คลัง(Store), TruckScale (ค้นหา), **Weigh Inbox (ดึงชั่ง+จับคู่ SO)**, ชุดตั๋วคุม |
| รีเบท/ของแถม | รีเบท(App), Rebate Plan, CN Rebate, Voucher, ของแถม |
| บัญชี/กำกับ | บัญชี, **กระทบยอด(Recon)**, **Price Book**, **นโยบายอนุมัติ**, **กำกับข้อมูล(เครดิต/สต๊อก/PDPA)** |
| รายงาน/ระบบ | รายงาน, **สถานะระบบ(Ops)**, ผู้ใช้งาน(Admin), ข้อมูลหลัก |

(**ตัวหนา** = เพิ่มใหม่ใน v8)

## 3. Data Dictionary — schema `wf` (ตารางหลัก)
| ตาราง | migration | สาระ |
|---|---|---|
| SalesOrder / SalesOrderLine(Ext) | 001/007 | SO draft + state + load sequence |
| SalesOrderAudit | 001 | audit การเปลี่ยนสถานะ |
| RebateLedger / RebateClaim | 001/003 | FIFO accrual + เคลม → CN |
| Giveaway* | 002 | งบของแถมรายภาค + เบิก |
| Quotation / QuotationLine | 008 | ใบเสนอราคา |
| PaperCopy / PaperScan | 016 | เอกสาร 4 สี + QR + สแกน |
| RebatePlan / RebatePlanAllocation | 017 | แผนรีเบท + จัดสรรงบ |
| UnlockRequest | 018 | ขอปลดล็อก SO (1 pending/SO) |
| WeighTicket | 019 | ตั๋วชั่ง gross/tare/net + movebill |
| **SchemaMigration** | 020 | **migration ledger (checksum)** |
| **ReconResolution** | 021 | **การตัดสิน exception การกระทบยอด** |
| **ErrorLog** | 022 | **error log ถาวร (observability)** |
| **ApprovalPolicy** | 023 | **นโยบายอนุมัติ (case/วงเงิน/role/effective)** |
| **OutboxEvent** | 024 | **integration outbox (idempotency/retry)** |
| **PriceBook / PriceBookLine / PriceBookAudit** | 025 | **price book workflow + audit** |
| **CreditMaster** | 026 | **เครดิต/credit hold ลูกค้า** |
| **OperationalStock** | 027 | **สต๊อกปฏิบัติการ (wf)** |
| **RetentionPolicy / DsarLog** | 028 | **PDPA retention + DSAR log** |
| **WeighInbox / TruckScaleSync** | 029 | **inbox ชั่งจาก TruckScale + watermark** |

> ตารางนี้สรุป object หลักจาก baseline เดิม; source inventory ปัจจุบันมี migration sequence ต่อเนื่องถึง 055 และต้องใช้รายงาน pipeline ตรวจรายการไฟล์จริง.

## 4. API Reference (หมวด /api)
| Base | endpoints หลัก |
|---|---|
| `/auth` | login, me, (admin: users CRUD) |
| `/master` | customers, goods, prices (GET/PATCH/POST), invoices, aging |
| `/so` | CRUD, confirm, picking, ship, verify, unlock — *confirm มี credit-hold check + outbox enqueue* |
| `/rebate` `/giveaway` `/quotation` `/papertrail` | โมดูลตามชื่อ |
| `/reports` | types, report, export(xlsx) |
| `/truckscale` | ping, weigh, scale/:seq, **for-so (ranking+evidence)**, **sync/status, sync/run, inbox, inbox/:id/match/:soId, ingest(push)** |
| **`/recon`** | summary, cases, :soId/resolve |
| **`/ops`** | status, errors, outbox, test-alert |
| **`/policy`** | list, resolve, CRUD |
| **`/pricebook`** | list, :id, create, :id/lines, approve, activate, archive |
| **`/credit`** | list, :custId, PUT |
| **`/stock`** | list, PUT |
| **`/pdpa`** | policies, dsar, dsar/export, retention/run |
| **`/line`** | webhook(verify sig), notify, status |

## 5. การเชื่อม TruckScale (ดึงข้อมูลกลับ) — pull/sync
**ปัญหา:** เมื่อ TruckScale (MySQL) บันทึกชั่งเข้า/ชั่งออก ระบบเราจะรู้ได้อย่างไร
**การออกแบบที่เลือก:** *pull/polling ฝั่งเรา* — completed-weigh source (`tblscale` และตารางอ้างอิง) เป็น read-only; App เขียนเฉพาะ INSERT/DELETE `tbl_keyone` เพื่อจัดการ pre-weigh ticket โดยไม่เพิ่ม trigger/procedure ในระบบชั่งจริง

ขั้นตอน (`services/truckscale-sync.js`, รันทุก `TS_SYNC_INTERVAL_MS` ค่าเริ่มต้น 60 วิ):
1. ดึงรายการใหม่ `s_id > watermark` (LastSid ใน `wf.TruckScaleSync`) + refresh รายการที่ยัง `OPEN` (รอชั่งออก) → จับการอัปเดต `weight_out`
2. upsert เข้า `wf.WeighInbox` (idempotent ตาม `sequence`)
3. เมื่อ `COMPLETED` (มี weight_out) → จับคู่ SO ที่ยัง active (CONFIRMED/PICKING/LOADED) ด้วยทะเบียน → `MATCHED | MULTI | UNMATCHED`
4. broadcast `weigh_inbox` → หน้า **Weigh Inbox** อัปเดตสด · เจ้าหน้าที่จับคู่ที่เหลือด้วยมือ + ยืนยัน Shipped กลับ WINSpeed

**ทางเลือก push (เผื่ออนาคต):** `POST /api/truckscale/ingest` (header `X-Ingest-Secret`) ให้ agent ฝั่งโรงงานส่งเข้ามาได้ โดยไม่ต้องแก้สถาปัตยกรรม

**ขอบเขตหลักฐานปัจจุบัน:** Automated E2E run `2026-07-23T09-56-59-217Z` ผ่าน 10/10 กรณี, source stable, runtime 1.0.1 และ health check รายงาน SQL Server/MySQL เป็น `up`. ผลนี้ยืนยัน full-loop ใน development test environment และการแสดงสถานะ TruckScale ตาม health response แต่ยังไม่ใช้แทนหลักฐาน production sync/watermark/matching, อุปกรณ์ชั่งจริง, network resilience หรือ manual fallback; ต้องทดสอบ integration กับ TruckScale และ hardware ที่เชื่อมต่อจริงแยกต่างหาก.

## 6. รูปแบบ integration ที่รองรับ ISO/enterprise
- **Migration ledger** (FR-031): runner ข้ามไฟล์ที่ checksum ไม่เปลี่ยน + บันทึก applied → release ควบคุมได้
- **Outbox** (FR-029): enqueue ตอน confirm/ship → worker ส่ง (idempotency/retry) → audit ได้
- **Approval policy engine** (FR-028): ตาราง config + `resolveApprovalPolicy()` ใช้ใน credit override ฯลฯ
- **Observability** (FR-030): `/api/health` (version/uptime/db), error log, webhook alert (Slack/Discord/Teams), release/crash signal
- **Reconciliation** (FR-027): ship ↔ WINSpeed invoice ↔ TruckScale net + การตัดสิน exception
