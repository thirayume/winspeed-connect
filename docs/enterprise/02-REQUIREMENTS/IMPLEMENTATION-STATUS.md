---
documentId: "WF-REQ-IMPL-008"
title: "Implementation Status & Feature Gap (vs SRS v8 FRs)"
version: "v1.0"
runtimeVersion: "1.0.0"
sourceMigrationSequence: 55
status: Review
statusDetail: "Merged from v8.0; source verification and approval required"
sourceVersion: "v8.0"
sourceStatus: "Approved"
sourceStatusDetail: "Controlled — Living document (อัปเดตทุก release)"
mergePolicy: latest-document-wins
mergeDisposition: retained-unique-content
mergedAt: "2026-07-21"
owner: "Solution Architect / Product Owner"
normative: true
---
# Implementation Status & Feature Gap (vs SRS v8 FRs)

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-REQ-IMPL-008` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Version | v1.0 |
| Date | 28 มิถุนายน 2569 (28 June 2026) |
| Owner | Solution Architect / Product Owner |
| Status | Review — merged candidate; source verification required |
| Classification | Confidential — Client / Authorized Partner Use Only |
| Source snapshot | package runtime 1.0.0 · migration sequence through 055 · 17 route modules / 160 endpoints / 22 portal keys |

> **Merge provenance — 21 July 2026:** เอกสารต้นทาง v8.0 ถูกคงไว้เป็น v1.0 review candidate ตามนโยบาย `latest-document-wins`; หากขัดกับเอกสารที่ใหม่กว่าหรือ source code ปัจจุบัน ให้ยึดหลักฐานล่าสุด และต้อง review/approve ก่อน baseline.

> เอกสารนี้เป็น review-candidate mapping ระหว่าง FR ใน [SRS-v8](SRS-v8.md) กับ source ปัจจุบัน; source inventory และหลักฐานทดสอบที่ผ่าน gate เท่านั้นเป็น technical evidence จนกว่าจะ review/approve.

---

## Legend
- ✅ **Implemented** — พบ implementation ใน source ปัจจุบัน; สถานะ deploy/UAT ต้องยืนยันด้วย evidence แยก
- 🟡 **Partial** — ใช้งานได้บางส่วน ยังไม่ครบ acceptance ของ SRS v8
- ⛔ **Planned** — ยังไม่ได้ implement (เป้าหมาย/รอบถัดไป)

> หมายเลข build v4.2.x ที่ปรากฏด้านล่างเป็น historical implementation milestone จากเอกสารต้นทาง v8.0 ไม่ใช่ runtime version ปัจจุบัน.

## 1. สถานะตาม Functional Requirement

| FR | สาระ | สถานะ | หลักฐาน / ช่องว่าง |
|---|---|:--:|---|
| FR-001 | SO state machine + cancel/unlock | ✅ | wf.SalesOrder + SalesOrderAudit |
| FR-002 | สร้าง/แก้ SO | ✅ | หน้า ขาย (POS) |
| FR-005 | Quotation → convert SO | ✅ | wf.Quotation/Line |
| FR-019 | Mother/Baby + load sequence | ✅ | SalesOrderLineExt.LoadSequence (mig 007) |
| FR-022 | Verification Gate | ✅ | VerifiedBy/At + confirm gate (mig 018) |
| FR-004 | เอกสาร 4 สี + QR | ✅ | wf.PaperCopy + QR (mig 016) |
| FR-012 | บันทึก PaperCopy | ✅ | color/nonce/status |
| FR-013 | Scan + ติดตาม + alert | ✅ | wf.PaperScan + /lost |
| FR-006 | ขอ unlock (1 pending/SO) | ✅ | wf.UnlockRequest (mig 018) |
| FR-007 | Reverse effects เมื่อ approve | ✅ | reverse RebateLedger (ReversedFlag) |
| FR-024 | TruckScale health | ✅ | /truckscale/ping |
| FR-025 | Search plate/movebill | ✅ | **candidate ranking + evidence (v4.2.22)** — /for-so score (plate/ลูกค้า/วันที่/net) + เหตุผล match + bestSequence |
| FR-026 | WeighTicket + validate ก่อน ship | ✅ | wf.WeighTicket gross/tare/net/scale/movebill (mig 019) |
| FR-027 | Reconcile ship ↔ WINSpeed/TruckScale | ✅ | **Reconciliation Workbench (build v4.2.20)** — หน้า "กระทบยอด": weigh (WeighTicket↔TruckScale ±50kg) + invoice (SOInvDT.RefID→SOHD.SOID) + resolve/ignore (wf.ReconResolution) |
| FR-023 | Monthly NET Price Book | ✅ | **Price Book workflow (v4.2.22)** — wf.PriceBook DRAFT→APPROVED→ACTIVE→ARCHIVED + audit + seed จากราคาปัจจุบัน (หน้า Price Book) |
| FR-008 | Rebate Plan create/activate/close | ✅ | wf.RebatePlan (mig 017) |
| FR-009 | Allocate plan → pools | ✅ | RebatePlanAllocation |
| FR-010 | Line accrual + FIFO ledger | ✅ | bookRebateAccrual + RebateLedger |
| FR-011 | Claim + CN evidence | ✅ | RebateClaim → CN 109 |
| FR-020 | Giveaway budget/withdrawal | ✅ | wf.Giveaway* (mig 002) |
| FR-021 | Control-ticket balance + draws | ✅ | /control-tickets + /draws |
| FR-014 | อ่าน WINSpeed master/read model | ✅ | v_Customer/v_FertGood/v_CurrentPrice |
| FR-017 | Dashboard/report/export | ✅ | Reports + Excel (xlsx) |
| FR-018 | RBAC/auth/audit | ✅ | JWT + 7 roles + helmet + rate-limit |
| FR-028 | Configurable approval policy | ✅ | **wf.ApprovalPolicy + engine (v4.2.22)** — case/threshold/role/effective + หน้า "นโยบายอนุมัติ" |
| FR-029 | Outbox/integration event | ✅ | **wf.OutboxEvent + worker (v4.2.22)** — idempotency/retry, enqueue ตอน confirm/ship, ดูใน "สถานะระบบ" |
| FR-030 | Operational telemetry/alerts | ✅ | **Observability (build v4.2.21)** — telemetry + wf.ErrorLog + webhook alert (Slack/Discord/Teams) + release/crash signal + หน้า "สถานะระบบ" |
| FR-031 | Controlled migration/release | ✅ | **wf.SchemaMigration ledger (build v4.2.19)** — skip ไฟล์ที่ checksum ไม่เปลี่ยน + record applied; deploy versioned |
| FR-032 | Retention/DSAR (PDPA) | ✅ | **wf.RetentionPolicy + DsarLog (v4.2.23)** — DSAR export (ลูกค้า/ผู้ใช้) + retention purge (หน้า "กำกับข้อมูล") |
| FR-003 | Credit Hold | ✅ | **wf.CreditMaster (v4.2.23)** — ตรวจตอน confirm, override ตามนโยบาย CREDIT_OVERRIDE |
| FR-016 | LINE intake/notify | 🟡 | **scaffold (v4.2.23)** — webhook (verify signature) + push notify พร้อมใช้ · ต้องตั้ง LINE channel จริงก่อนเปิด |

**สรุป candidate เทียบ source runtime v1.0.0:** ✅ 29 · 🟡 1 (FR-016 scaffold — รอตั้ง LINE channel) · ⛔ 0 — ✅ **P0 + P1 + P2 ครบทั้งหมด** · DG-04 มีแหล่ง wf แล้ว · **เพิ่ม TruckScale pull-back (Weigh Inbox + sync)** — ดู [CURRENT-SYSTEM-STATE](CURRENT-SYSTEM-STATE.md)

## 2. Backlog ฟังก์ชันที่ต้อง implement รอบถัดไป (จัดลำดับ)

| ลำดับ | ฟีเจอร์ | FR/Gate | แนวทางย่อ | Dependency |
|---|---|---|---|---|
| ~~P0-A~~ ✅ | Reconciliation workbench (ship ↔ WINSpeed/TruckScale) | FR-027 / R-002,R-009 | **เสร็จแล้ว (v4.2.20)** — wf.ReconResolution + หน้า "กระทบยอด" (weigh+invoice, resolve/ignore) | DG-09 |
| ~~P0-B~~ ✅ | Observability + alerting | FR-030 / R-005 | **เสร็จแล้ว (v4.2.21)** — telemetry + wf.ErrorLog + webhook alert + หน้า "สถานะระบบ" | DG-10 |
| ~~P0-C~~ ✅ | Migration ledger | FR-031 | **เสร็จแล้ว (v4.2.19)** — wf.SchemaMigration + runner skip-by-checksum | — |
| ~~P1-A~~ ✅ | Configurable approval policy | FR-028 | **เสร็จ (v4.2.22)** — wf.ApprovalPolicy + engine + หน้าจัดการ | DG-05 |
| ~~P1-B~~ ✅ | Integration outbox | FR-029 | **เสร็จ (v4.2.22)** — wf.OutboxEvent + worker (idempotency/retry) | DG-01 |
| ~~P1-C~~ ✅ | Price Book workflow (version/approve/activate) | FR-023 | **เสร็จ (v4.2.22)** — wf.PriceBook DRAFT→APPROVED→ACTIVE + audit | DG-08 |
| ~~P1-D~~ ✅ | TruckScale candidate ranking + evidence | FR-025 | **เสร็จ (v4.2.22)** — score + เหตุผล match ใน /for-so | DG-02 |
| ~~P2-A~~ ✅ | Credit Hold + wf credit master | FR-003 | **เสร็จ (v4.2.23)** — wf.CreditMaster + check ตอน confirm + override | DG-03 |
| ~~P2-B~~ 🟡 | LINE intake/notify | FR-016 | **scaffold (v4.2.23)** — webhook + notify · รอตั้ง channel จริง | — |
| ~~P2-C~~ ✅ | Retention/DSAR (PDPA) | FR-032 | **เสร็จ (v4.2.23)** — RetentionPolicy + DsarLog + purge/export | DG-06 |
| ~~P2-D~~ ✅ | Operational stock source | DG-04 | **เสร็จ (v4.2.23)** — wf.OperationalStock (ไม่ assume ICStock) · ยังเป็น open decision | DG-04 |

## 3. หมายเหตุการกำกับ
- รายการ ⛔/🟡 **ตรงกับ FR ที่ระบุไว้ใน SRS v7 แล้ว** (เอกสารครอบคลุม เป้าหมายครบ) — ส่วนนี้คือสถานะ build เพื่อใช้วางแผน sprint
- การปิดแต่ละรายการให้สร้าง release note + อัปเดต [TRACEABILITY-MATRIX](TRACEABILITY-MATRIX.md) + ตารางนี้ (ไม่ rewrite ทั้งชุด)
- P0 ทั้งหมดเป็น **production gate** ตาม [PRODUCTION-READINESS-GATE](../06-QUALITY-OPERATIONS/PRODUCTION-READINESS-GATE.md)
