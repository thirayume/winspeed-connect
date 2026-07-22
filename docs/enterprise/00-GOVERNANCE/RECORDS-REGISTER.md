---
documentId: "WF-GOV-005"
title: "Records Register (ทะเบียนบันทึกคุณภาพ — ISO 9001 §7.5)"
version: "v1.0"
status: Released
owner: "QMR"
normative: true
---
# Records Register (ทะเบียนบันทึกคุณภาพ — ISO 9001 §7.5)

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-GOV-005` |
| Version | v1.0 |
| Date | 21 กรกฎาคม 2569 (21 July 2026) |
| Owner | QMR |
| Status | Released |
| Classification | Confidential |

> ทะเบียนนี้บันทึกหลักฐาน/records ที่ต้องเก็บรักษาตาม ISO 9001 (control of documented information) — เก็บไว้ในโฟลเดอร์ [`_archive/`](../_archive/) ของชุดเอกสารนี้ ไม่ทำลาย

## บันทึกที่เก็บรักษา (Retained Records)

| รหัส | บันทึก | ที่เก็บ | ประเภท | ระยะเก็บ |
|---|---|---|---|---|
| REC-MIN-001 | Meeting Minutes — WorldFert 02/07/2569 | `_archive/records/Meeting_Minutes_WorldFert_02072026.*` | บันทึกประชุม | ≥ 7 ปี |
| REC-RPT-001 | Weekly Report — CD-ERPNext 28/06/2569 | `_archive/records/Weekly_Report_CD-ERPNext_28062026.docx` | รายงานความคืบหน้า | ≥ 3 ปี |
| REC-CMT-001 | WF Sales Comment (ข้อคิดเห็นฝ่ายขาย) | `_archive/sales-comments/WF Sales Comment.xlsx` | Requirement/Feedback | ≥ 3 ปี |
| REC-SRS-HIST | SRS v1.0–v6.0 (ประวัติข้อกำหนด) | `_archive/srs-history/` | เอกสารถูกแทนที่ | ≥ 7 ปี |
| REC-SQL-REF | SQL อ้างอิงงานจริง (ตั๋วคุม, Finished Goods, Souvenir ฯลฯ) | `_archive/sql-reference/` | Technical evidence | อ้างอิง |
| REC-REF-SRC | เอกสารเทคนิคเดิม (Security, SQL-Performance, Docker) | `_archive/reference-src/` | Superseded (นำเข้า 05-SECURITY-DEVOPS แล้ว) | ≥ 3 ปี |
| REC-DRAWIO | ไดอะแกรมต้นฉบับ WorldfertFlow 1/4/8-6-69 | `../03-DRAWIO/` | Diagram source | ต่อเนื่อง |

## กติกา (ISO §7.5.3)

1. บันทึกในทะเบียนนี้ **ห้ามทำลาย** ก่อนครบระยะเก็บ
2. เอกสารที่ถูกแทนที่ (Superseded) ต้องคงไว้เพื่อ traceability ไม่น้อยกว่า 7 ปี
3. การเข้าถึงจำกัดตาม Classification (Confidential)
4. ทุกครั้งที่มีเอกสาร/บันทึกใหม่ ต้องขึ้นทะเบียนที่นี่

## หมายเหตุการรวมเอกสาร (21 ก.ค. 2569)

บันทึก/หลักฐานทั้งหมดที่เคยกระจายอยู่ที่ `docs/records`, `docs/reference`, `docs/_archive`, `L:\World Fert\drawio`, `L:\World Fert\WS Comment Update 9-6-69`, `L:\World Fert\wf` ถูกรวมเข้ามาไว้ในชุดเอกสารนี้แล้ว (`enterprise/_archive/` และ `enterprise/03-DRAWIO/`) — ต้นทางเดิมสามารถลบได้หลังตรวจยืนยันความครบถ้วน (ดู DOCUMENT-CONTROL §การรวมรุ่น v1.0)
