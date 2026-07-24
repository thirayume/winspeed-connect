---
documentId: WF-PIPE-003
title: Source-driven Candidate Artifact Pipeline
version: 1.1-candidate
status: Review
owner: Solution Architect / QA Lead
normative: false
sourceRefs:
  - docs/enterprise/pipeline/docs.ps1
  - docs/enterprise/pipeline/source.ps1
  - docs/enterprise/pipeline/source-diagrams.js
  - docs/enterprise/pipeline/docgen/build-uat-candidates.ps1
  - docs/enterprise/pipeline/docgen/build-technical-core.ps1
  - docs/enterprise/pipeline/docgen/technical-core-manifest.json
outputs:
  - uat-docx-candidate
  - uat-xlsx-candidate
  - technical-core-docx-candidates
  - source-aligned-diagram-candidates
  - qa-render-and-validation-reports
---

# Source-driven Candidate Artifact Pipeline

Pipeline นี้ใช้ Markdown, source inventory, source-bound E2E evidence, structured UAT data และ version-controlled Mermaid/Draw.io เป็นข้อมูลต้นทาง ห้ามใช้ DOCX, PPTX, PDF, PNG หรือ Draw.io รุ่นเก่าเป็น source of truth

## Quality gates

1. **Detect drift** — ตรวจรายการเอกสารและ source ก่อนทุก build.
2. **Align source facts** — refresh API reference, current-system facts และ canonical diagrams เมื่อ source hash เปลี่ยน.
3. **Verify evidence** — E2E evidence ต้องเป็น `PASSED_COMPLETE`, current for HEAD และ source stable.
4. **Build candidates** — สร้างเฉพาะสถานะ Review/Candidate; generator ห้ามอนุมัติแทนมนุษย์.
5. **Render and inspect** — ตรวจทุกหน้า/worksheet/diagram พร้อมบันทึก hash, page count, renderer และ contact sheets.
6. **Prove stability** — scan ซ้ำหลัง build และหยุดทันทีเมื่อ tracked source เปลี่ยนระหว่าง run.
7. **Human approval** — business UAT, technical review, baseline acceptance และ release decision เป็นคนละ gate.

## Commands

จาก repository root:

```powershell
# Read-only drift/status gate
./docs/enterprise/pipeline/docs.ps1 status -NoWrite

# Refresh source-derived facts after source changes
./docs/enterprise/pipeline/source.ps1 preflight
./docs/enterprise/pipeline/source.ps1 sync-api
node ./docs/enterprise/pipeline/source-diagrams.js
./docs/enterprise/pipeline/docgen/render-source-diagrams.ps1

# Rerun isolated full E2E when tracked source/test hashes changed
./run-e2e.ps1

# Build UAT DOCX/XLSX and render QA
./docs/enterprise/pipeline/docgen/build-uat-candidates.ps1

# Build SRS, Analysis & Design and Technical Specification end-to-end
./docs/enterprise/pipeline/docgen/build-technical-core.ps1
```

Python dependencies ของ Technical Core ถูกตรึงใน `requirements-technical-core.txt`:

```powershell
& <python.exe> -m pip install -r ./docs/enterprise/pipeline/docgen/requirements-technical-core.txt
```

บนเครื่อง Windows ปัจจุบัน orchestrator ใช้ Microsoft Word hidden/read-only + PDFium เป็น default ที่พิสูจน์แล้ว หากต้องการทดลอง LibreOffice ก่อนจึง fallback ให้เพิ่ม `-TryLibreOffice`.

`-AllowKnownDrift` ใช้ได้เฉพาะ UAT Review candidate ระหว่างพัฒนา เมื่อผู้รันได้อ่าน preflight report แล้วเท่านั้น ตัวเลือกนี้ไม่ accept baseline และไม่ทำให้ release-check ผ่าน

```powershell
./docs/enterprise/pipeline/docgen/build-uat-candidates.ps1 -AllowKnownDrift
```

## Inputs and outputs

| ประเภท | Path |
|---|---|
| UAT structured source | `pipeline/docgen/uat-cases.json` |
| UAT Markdown plan | `06-QUALITY-OPERATIONS/UAT-FULL-LOOP-RUN-PLAN.md` |
| UAT DOCX/XLSX | `01-DOCX/candidate/UAT-Full-Loop-Run-Plan-v1.0.docx`; `06-XLSX/candidate/UAT-Master-Script-v1.0.xlsx` |
| Technical Core manifest | `pipeline/docgen/technical-core-manifest.json` |
| Technical Core DOCX | `01-DOCX/candidate/technical-core/*.docx` |
| Technical Core QA pages | `01-DOCX/candidate/technical-core/qa-render/<run-id>/` |
| Source-aligned diagrams | `04-DIAGRAMS-PNG/candidate/source-aligned/` |
| Domain diagrams | `04-DIAGRAMS-PNG/candidate/domain/` |
| Editable diagram sources | `pipeline/diagrams/09-*` ถึง `18-*` |
| Integrated Technical Core report | `pipeline/reports/technical-core-pipeline-report.json` |
| Structure/accessibility/page validation | `pipeline/reports/technical-core-validation-report.json` |
| Candidate UAT build report | `pipeline/reports/uat-candidate-build-report.json` |

## Current verified Technical Core run

Run `20260723-final2` ผ่าน 3 documents, 83 rendered pages, 45 checks และ 0 failed checks:

- SRS: 24 pages.
- Analysis and Design: 23 pages.
- Technical Specification: 36 pages.
- Render method: Microsoft Word hidden/read-only PDF export + PDFium.
- Visual QA: ตรวจ 14 contact sheets ครบทุกหน้า; ไม่พบ blank page, edge clipping หรือ cropped diagram.
- Source stability: 220 files; SHA-256 `12B9F964C7C90341859EDD6CDDE9B92BA35D797347F2AA64A1134E1E885FC343` ก่อนและหลัง build ตรงกัน.

## Renderer and font policy

- DOCX ใช้ Kanit สำหรับหัวเรื่องและ Prompt สำหรับเนื้อหา/ตาราง; Arial เป็น fallback.
- Mermaid CLI 11.16.0 render PNG ที่ scale 2 และบันทึก pixel size/SHA-256.
- LibreOffice 26.2.4.2 เคย fail/timeout กับ candidate ใน environment นี้; Word/PDFium จึงเป็น controlled fallback.
- Workbook preview ต้องเปิดตรวจได้ครบ 9 worksheets และ artifact validator ต้องผ่าน แม้ native preview process บน Windows จะคืน exit ผิดปกติหลังสร้างภาพ.

## Release safeguards

- ห้ามแก้ generated Mermaid `09`–`11`, domain PNG หรือ Draw.io `12` ด้วยมือ; ให้แก้ generator/source แล้ว regenerate.
- ห้ามถือ automated E2E เป็น business UAT sign-off.
- ห้ามใช้ screenshot ที่เป็น loading/empty state เป็นหลักฐานความสำเร็จ; หากคงไว้เป็นตัวอย่าง UI ต้องระบุ evidence boundary ชัดเจน.
- ห้าม accept source/document baseline หรือเปลี่ยนสถานะเป็น Approved/Released โดยไม่มี actor, reason และ approval record จริง.
- Deployment evidence scope รวม `backend/.env.coolify.example` และไฟล์ `.yml/.yaml/.sh/.ps1/.md` ใต้ `deploy/`; การเพิ่ม/ลบ/แก้ไขไฟล์เหล่านี้ทำให้ E2E evidence เดิม stale.
- เมื่อ source, E2E, Markdown หรือรายการเอกสารเปลี่ยน ให้เริ่มจาก drift/status gate ใหม่เสมอ.
