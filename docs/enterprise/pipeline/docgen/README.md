---
documentId: "WF-PIPE-002"
title: "Doc-Gen Pipeline (สร้าง DOCX/PPTX + diagrams จาก markdown)"
version: "1.0-draft"
status: Draft
owner: "Solution Architect"
normative: true
---
# Doc-Gen Pipeline (สร้าง DOCX/PPTX + diagrams จาก markdown)

pipeline ที่ 2 (นอกจาก `../build-docs.ps1`) — สร้าง **เอกสาร matrix ระดับ ISO** จาก markdown (source of truth) + mermaid diagrams แล้ว **ฝัง diagram ให้ตรงกัน**ทั้ง DOCX และ PPTX

## Preflight gate

`build-all.ps1` เรียก `../docs.ps1 preflight -Strict` ก่อนติดตั้ง dependency หรือสร้าง artefact ทุกครั้ง หาก inventory ต่างจาก accepted baseline หรือ validation ยังมี error/warning ระบบจะหยุดและให้อ่านรายงานใน `../reports/` ก่อน

> สถานะปัจจุบัน: generator ชุดนี้เป็น legacy candidate เท่านั้น DOCX/PPTX/PNG ที่สร้างได้ยังไม่ถือเป็น released record จนกว่าจะผ่าน visual QA, traceability และ release approval ของ pipeline รุ่นใหม่

## รันทั้งหมด

```powershell
./build-all.ps1
```
ติดตั้ง deps ให้อัตโนมัติใน **local cache** (`%LOCALAPPDATA%\wf-docgen`) — ไม่ลง Google Drive · `-SkipDiagrams` ข้ามการเรนเดอร์ diagram

## ขั้นตอน (5)

| # | ทำอะไร | ไฟล์ |
|---|--------|------|
| 1 | pip: `python-docx`, `mistune` | — |
| 2 | npm cache: `pptxgenjs`, `@mermaid-js/mermaid-cli` | — |
| 3 | เขียน `.mmd` (ตรงระบบจริง) + เรนเดอร์เป็น PNG @2x | `make_diagrams.py` → `../diagrams/*.png` |
| 4 | สร้าง DOCX matrix (ฝัง diagram + ISO doc-control + revision history) | `build_docx.py` → `../../01-DOCX/generated/` |
| 5 | สร้าง PPTX matrix (ฝัง diagram) | `build_pptx.js` → `../../02-PPTX/generated/` |

## Document Matrix

**DOCX** (`01-DOCX/generated/`)
- `SRS-v1.0` · `Technical-Spec-v1.0`
- `User-Guide-Full` · `User-Guide-Brief` · `User-Guide-Combined-Summary`
- `User-Guide-{Sales,Warehouse,Weighbridge,Accounting,Admin}` (แยก Role)

**PPTX** (`02-PPTX/generated/`)
- `Training-Overview` · `Training-{Sales,Warehouse-Weigh,Accounting,Admin}`
- `Support-Maintenance` (Workflow · Swimlane · SO State · Rebate Sequence · ERD · UML)

## Diagrams (mermaid → PNG, ตรงระบบจริง)

`01`–`08` เป็น authored domain diagrams ที่ยังต้อง review รายละเอียดกับ source ปัจจุบัน ส่วน `09-current-system-context`, `10-current-api-surface`, `11-document-evidence-flow` และ `12-source-alignment.drawio` สร้างจาก `source-inventory.json` พร้อม provenance

รัน `../source.ps1 preflight` แล้ว `node ../source-diagrams.js` เพื่อ refresh canonical Mermaid/Draw.io sources ก่อน build-all; ห้ามแก้ generated `09`–`12` ด้วยมือ

## แก้/เพิ่มเอกสาร

- แก้ **เนื้อหา** → แก้ที่ markdown ต้นทาง (`00-09/*.md`) แล้วรัน build-all — เอกสารอัปเดตตาม
- เพิ่ม **doc ใหม่** → เพิ่ม spec ใน `M`/`ROLES` (docx) หรือ `DECKS` (pptx)
- เพิ่ม **Role** → เพิ่มใน `ROLES` (build_docx.py) + `DECKS` (build_pptx.js)

## หมายเหตุ
- ต้องมี Node.js + Python 3; pipeline เลือก `%LOCALAPPDATA%\wf-docgen\tools\python\python.exe` ก่อน แล้วจึง fallback ไป `python`, Windows `py -3` หรือค่าจาก `-PythonExe` · ครั้งแรกจะโหลด Chromium (mermaid) ~นาที
- Windows runner เก็บ Mermaid/Puppeteer และ portable toolchain ไว้ใต้ `%LOCALAPPDATA%\wf-docgen`; `build-all.ps1` กำหนด Puppeteer cache ให้อัตโนมัติ และ `build-docs.ps1` ค้นหา Pandoc จาก `PATH` ก่อน fallback ไปยัง cache นี้
- Visual QA ใช้ `soffice`/LibreOffice แปลง DOCX/PPTX เป็น PDF หรือภาพเพื่อตรวจ layout; ยังต้องตรวจฟอนต์ไทยและเปิดยืนยันใน Microsoft Office ก่อน release
- E2E policy ปัจจุบันเป็น `REQUIRED`; strict build ตรวจ `PASSED_COMPLETE`, 10 tests/3 specs, environment health และ source/test hashes ก่อนสร้าง artefact แต่ยังต้องผ่าน document approval/baseline และ visual QA แยกต่างหาก
- ฟอนต์มาตรฐาน: Kanit สำหรับหัวเรื่อง/diagram และ Prompt สำหรับเนื้อหา DOCX/PPTX/Mermaid — ติดตั้งแบบ per-user จาก `C:\MyWork\WorldFert\th-fonts`
