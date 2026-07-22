---
documentId: "WF-GOV-001"
title: "การควบคุมเอกสารและการกำกับการเปลี่ยนแปลง"
version: "v1.0"
status: Released
statusDetail: "Released — Single Source of Truth"
owner: "QMR / Product Owner / Solution Architect"
normative: true
---
# การควบคุมเอกสารและการกำกับการเปลี่ยนแปลง

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-GOV-001` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate/Coupon Management |
| Client | World Fert Co., Ltd. |
| Version | **v1.0** (enterprise consolidated; สืบทอดจาก v8.0) |
| Date | 21 กรกฎาคม 2569 (21 July 2026) |
| App build อ้างอิง | 1.0.0 (unified 21 ก.ค. 2569; reset จาก 5.0.25) |
| Owner | QMR / Product Owner / Solution Architect |
| Status | Released — Single Source of Truth |
| Classification | Confidential — Client / Authorized Partner Use Only |

> เอกสาร v1.0 เป็นชุดรวมฉบับสมบูรณ์ชุดเดียว (แทนที่ operational 00–12, v7, v8) — baseline สำหรับการขาย ส่งมอบ พัฒนา ทดสอบ ติดตั้ง และปฏิบัติการระบบ

---

## วัตถุประสงค์

กำหนดให้เอกสาร การเปลี่ยนแปลงโค้ด การเปลี่ยน schema และการเปลี่ยน workflow สามารถย้อนกลับได้ ระบุผู้อนุมัติ และเชื่อมไปยังหลักฐานการทดสอบได้ครบถ้วน

## ลำดับเอกสาร

| ชั้น | เอกสาร | ตอบคำถาม |
|---|---|---|
| Why | BAD / Product Overview | ทำไมต้องทำ และปัญหาใดที่จะแก้ |
| What | SRS / Requirements Catalog | ระบบต้องทำอะไร |
| How | SAD / C4 / ADR / Data Contract | จะออกแบบและเชื่อมอย่างไร |
| Prove | Test / UAT / RTM | พิสูจน์อย่างไรว่าทำครบ |
| Run | SOP / Runbook / DR / Security | ใช้งานและรับมือเหตุการณ์อย่างไร |
| Sell | Scope / Implementation Plan | เสนอขายอย่างไร |

## กติกาการเปลี่ยนแปลง

1. ทุกการเปลี่ยนแปลงมี `CR-YYYY-NNN`
2. CR ต้องระบุเหตุผล ผลกระทบต่อ Requirement, Data, API, Security, Test และ Rollback
3. การแก้ schema ทำผ่าน migration ใหม่เท่านั้น
4. การแตะ WINSpeed `dbo`, Price Book, rebate logic, role permission หรือ TruckScale mapping เป็น **High Risk Change**
5. High Risk Change ต้องมี peer review, UAT evidence, release approval และ rollback/forward-fix plan
6. เอกสารที่ถูกแทนที่ต้อง retain ไว้ไม่น้อยกว่า 7 ปีตาม policy audit

## State ของเอกสาร

| State | ความหมาย |
|---|---|
| Draft | ยังแก้ไขได้ |
| Review | รอผู้เกี่ยวข้องตรวจ |
| Approved | อนุมัติให้อ้างอิง |
| Released | ใช้กับ release จริง |
| Superseded | ถูกเอกสารรุ่นใหม่แทน |
| Archived | เก็บประวัติ |

## Required approvals

| Artefact | Owner | Reviewer | Approver |
|---|---|---|---|
| BAD / Scope | BA | Sales Manager, Factory | Sponsor |
| SRS | Product Owner | Tech Lead, QA | Sponsor |
| Architecture / ADR | Solution Architect | DBA, Security, Tech Lead | IT Manager |
| API/Data Contract | Tech Lead | DBA, Integration owner | Solution Architect |
| Test/UAT | QA Lead | Process owner | Business owner |
| Release/Production | Release Manager | IT, QA, Accounting | Executive delegate |

---

## § การรวมรุ่น v1.0 (Consolidation Record — 21 ก.ค. 2569)

รุ่น v1.0 รวมเอกสารที่กระจัดกระจายทั้งหมดมาไว้ที่ `docs/enterprise/` ที่เดียว โดยยึด **วันที่ปรับปรุงล่าสุด** เป็นเกณฑ์ความน่าเชื่อถือ:

| แหล่งเดิม | การจัดการใน v1.0 |
|---|---|
| operational `docs/00–12` (build v1.0, เนื้อเข้ม) | นำเข้าเป็นเอกสาร `-DETAIL` + เอกสารเด่น (Rebate/Coupon, Database Overview, WINSpeed SO Flow) |
| `docs/reference` (Security, SQL-Perf, Docker) | นำเข้า `05-SECURITY-DEVOPS/` + คงต้นฉบับใน `_archive/reference-src` |
| `docs/records` (ประชุม/รายงาน) | `_archive/records` + ขึ้นทะเบียน RECORDS-REGISTER |
| `L:\World Fert\drawio` (.drawio) | `03-DRAWIO/` |
| `WS Comment Update 9-6-69` (sales xlsx + SQL) | `_archive/sales-comments`, `_archive/sql-reference` |
| SRS v1–v6 | `_archive/srs-history` (retain ≥ 7 ปี) |
| v7_Full, docs-dup, wf/out KI | Superseded — เก็บประวัติ/ลบได้หลังตรวจยืนยัน |

**การซ่อมข้อมูล:** ซ่อม encoding ภาษาไทย (mojibake) 9 ไฟล์ในชุดปฏิบัติการก่อนนำเข้า (กู้ผ่าน CP874 → UTF-8)

**เงื่อนไขการลบต้นทางเดิม:** ต้นทางภายนอก (`docs/records`, `docs/reference`, `docs/_archive`, `docs/00–12`, `drawio`, `WS Comment Update`, `wf` ส่วนเอกสาร) ลบได้ก็ต่อเมื่อยืนยันแล้วว่าถูกดูดเข้า `docs/enterprise/` ครบ — บันทึกทะเบียนใน RECORDS-REGISTER แล้ว
