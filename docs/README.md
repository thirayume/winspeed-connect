# เอกสารระบบ WS-Sale-App (ชุดปฏิบัติการ)

> World Fert Co., Ltd. · build v4.2.17 · ปรับปรุง 27 มิ.ย. 2569
> ชุดเอกสารนี้จัดทำเพื่อการทดสอบ, ใช้งาน, และยื่นรับรอง **ISO 9001**

## ดัชนีเอกสาร (Document Index)
| # | เอกสาร | เนื้อหา | ผู้ใช้หลัก |
|---|--------|---------|-----------|
| 00 | [DATABASE-OVERVIEW](00-DATABASE-OVERVIEW.md) | ฐานข้อมูล 3 แหล่ง · การ mapping WINSpeed↔App↔TruckScale · diagram · **Data Dictionary** | IT, BA |
| 01 | [PAGES-SQL-MAP](01-PAGES-SQL-MAP.md) | ทุกหน้า → API → SQL → migration (อะไรอยู่/ไม่อยู่ใน migration) | IT, QA |
| 02 | [TEST-CASES](02-TEST-CASES.md) | กรณีทดสอบรายโมดูล (UAT/Regression) | QA, ผู้ทดสอบ |
| 03 | [USER-GUIDE](03-USER-GUIDE.md) | คู่มือผู้ใช้/manual รายหน้า + troubleshooting | ผู้ใช้ทุก Role |
| 04 | [SOP](04-SOP.md) | ขั้นตอนปฏิบัติงานมาตรฐาน (SOP-01..08) | ทุกฝ่าย, ผู้ตรวจ ISO |
| 05 | [PRODUCTION-READINESS](05-PRODUCTION-READINESS.md) | ประเมินความพร้อม Production + Go-Live checklist (P0/P1/P2) | ผู้บริหาร, IT |
| 06 | [FORMS](06-FORMS.md) | แบบฟอร์ม: Test Log, UAT Sign-off, Change Request, RTM, Training, Release, Doc Register | QA, QMR |

> **ฉบับ Word (.docx):** ทุกเอกสารข้างต้นแปลงเป็น Word ไว้ที่โฟลเดอร์ [`word/`](word/) (สำหรับยื่น ISO เป็นไฟล์เอกสาร) · ไดอะแกรมอยู่ใน `refs/WorldFert_Diagrams_v6.drawio` (13 หน้า รวม DB Architecture + 3-Way Mapping)

## เอกสารออกแบบ (อ้างอิง)
- `refs/WorldFert_SRS_v6_0.docx` — Software Requirements Specification v6.2 (รวม §15-18: v6 Release Notes, TruckScale, Implementation Update)
- `refs/WorldFert_Presentation_v6.pptx` — สไลด์นำเสนอ v6.2
- `refs/WorldFert_Diagrams_v6.drawio` — ผังระบบ v6.2 (Swimlane, TO-BE, ER, DFD, UML, TruckScale, Implemented)

## เอกสารเทคนิคอื่น
- [CHANGELOG.md](CHANGELOG.md) · [DOCKER-DEPLOY.md](DOCKER-DEPLOY.md) · [SQL-PERFORMANCE.md](SQL-PERFORMANCE.md)

## สรุประบบโดยย่อ
- **17 หน้า/โมดูล** · React 19 + Express + SQL Server (WINSpeed dbo + wf) + MySQL (TruckScale)
- **7 บทบาท** (RBAC): SALES, COUNTER_SALES, WAREHOUSE, WEIGHBRIDGE, APPROVER, ACCOUNTING, ADMIN
- **schema wf** 18 ตาราง + 7 views (migration 001-019)
- หลักการ: dbo = READ-ONLY (ยกเว้น confirm/picking/ship/cancel/prices) · GL ออกโดย WINSpeed · TruckScale = READ-ONLY
