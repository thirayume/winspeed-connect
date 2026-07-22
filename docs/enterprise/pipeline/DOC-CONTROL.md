---
documentId: WF-PIPE-001
title: Documentation Inventory, Change Detection and Impact Control
version: 1.0-draft
status: Draft
owner: Solution Architect
normative: true
outputs:
  - document-inventory
  - document-change-report
  - document-impact-report
  - document-validation-report
  - source-inventory
  - source-alignment-report
  - source-drift-report
  - source-diagrams
---

# Documentation Inventory, Change Detection and Impact Control

เครื่องมือนี้เป็น preflight gate ก่อนการ validate, render หรือ release เอกสาร โดยไม่แก้ไข Markdown ต้นฉบับระหว่าง `scan`, `impact`, `validate`, `preflight` และ `status`

## คำสั่งหลัก

```powershell
cd docs/enterprise/pipeline

./docs.ps1 scan
./docs.ps1 impact
./docs.ps1 validate
./docs.ps1 preflight
./docs.ps1 status -NoWrite

# inspect source alignment independently
./source.ps1 preflight
./source.ps1 validate -Strict -NoWrite

# synchronize the generated endpoint block after Express routes change
./source.ps1 sync-api

# regenerate canonical Mermaid + editable Draw.io after source preflight
node ./source-diagrams.js
```

รายงาน candidate อยู่ใน `pipeline/reports/`:

- `document-inventory.json`
- `document-change-report.json` และ `.md`
- `document-impact-report.json` และ `.md`
- `document-validation-report.json` และ `.md`
- `source-inventory.json`
- `source-drift-report.json` และ `.md`
- `source-alignment-report.json` และ `.md`
- `source-diagram-manifest.json`
- `source-api-inventory.md`
- `source-data-boundary-report.md`
- `source-ui-rbac-inventory.md`

## Accepted baseline

Document baseline และ source baseline แยกจากกันเพื่อให้ trace ได้ว่าเอกสารอ้าง source snapshot ใด การรับ source baseline ต้องทำก่อน document baseline และทั้งสองคำสั่งต้องระบุผู้ตรวจ/เหตุผล:

```powershell
./source.ps1 accept -Actor "ชื่อผู้ตรวจ" -Reason "Reviewed source snapshot"
./docs.ps1 accept -Actor "ชื่อผู้ตรวจ" -Reason "Reviewed documentation baseline"
```

เมื่อ E2E policy เป็น `REQUIRED` source acceptance, document acceptance และ release-check จะถูกบล็อกหาก evidence หาย/ไม่ครบ/เก่าเกินกำหนด หรือ source/test hash เปลี่ยนหลังทดสอบ
Accepted baseline ไม่ถูกสร้างหรือเปลี่ยนอัตโนมัติ คำสั่งต่อไปนี้ใช้ได้เมื่อ validation ไม่มี blocking issue และต้องระบุผู้ดำเนินการกับเหตุผล โดย initial acceptance ยอมรับเฉพาะ warning `ACCEPTED_BASELINE_MISSING` และ `DIRTY_GIT_WORKTREE`; warning ด้าน version, metadata, link หรือ encoding จะบล็อกการรับ baseline:

```powershell
./docs.ps1 accept -Actor "ชื่อผู้ตรวจ" -Reason "Initial reviewed documentation baseline"
```

ไฟล์หลักอยู่ที่ `pipeline/baselines/accepted-document-inventory.json` และสำเนาประวัติอยู่ใต้ `pipeline/baselines/history/`

`release-check` จะผ่านเมื่อเอกสารตรงกับ accepted baseline, validation ผ่านแบบ strict, source commit ระบุได้ และ Git working tree สะอาดเท่านั้น

## Document identity

เอกสารควบคุมทุกไฟล์ต้องใช้ YAML front matter โดยมี `documentId`, `title`, `version`, `status`, `owner` และ `normative`; `documentId` ต้องคงเดิมแม้ย้ายหรือเปลี่ยนชื่อไฟล์:

```yaml
---
documentId: WF-SRS-001
title: Software Requirements Specification
version: 1.0-draft
status: Draft
owner: Product Owner
normative: true
sourceRefs:
  - backend/routes/so.js
dependsOn:
  - WF-BR-001
outputs:
  - srs-docx
---
```

เอกสาร legacy ที่ยังไม่มี front matter จะถูกอ่าน metadata จากตาราง `Document ID`, `Version`, `Status`, `Owner` ชั่วคราว หากไม่มี ID จะใช้ synthetic ID ตาม path และรายงาน warning เพื่อให้สามารถติดตามการเปลี่ยนแปลงได้โดยไม่หยุดงานพัฒนา

## Change classification

ระบบตรวจ `ADDED`, `REMOVED`, `RENAMED`, `MODIFIED`, `METADATA_MODIFIED`, `DOCUMENT_ID_CHANGED` รวมถึง `CONTROL_FILE_ADDED`, `CONTROL_FILE_MODIFIED`, `CONTROL_FILE_REMOVED` โดยเทียบกับ accepted baseline ล่าสุด จากนั้นคำนวณ severity, artefacts ที่ได้รับผลกระทบ และ reviewer ที่ควรตรวจตาม `doc-control.config.json`

การลบเอกสาร normative ถือเป็น `CRITICAL` โดยอัตโนมัติ การเปลี่ยน requirements, architecture, data/integration, security หรือ quality/UAT ถือเป็น `HIGH`

## Version merge policy

- ใช้ `latest-document-wins` โดยพิจารณาวันที่เอกสารและหลักฐาน source alignment; เลขเวอร์ชันสูงกว่าไม่ได้แปลว่าใหม่กว่าเมื่อมี version reset
- เอกสารเก่าที่มีคู่ใหม่กว่าจะคงไว้เป็น `Superseded` พร้อม `supersededBy`
- เนื้อหาเก่าที่ไม่มีคู่จะ rebase เป็น candidate ของเวอร์ชันปัจจุบันด้วยสถานะ `Review` พร้อม `sourceVersion`, `mergeDisposition` และ `mergedAt`
- `document-merge-report.md` เป็น conflict/provenance report ที่สร้างทุกครั้งจาก inventory
- accepted baseline จะถูกบล็อกตราบใดที่ normative merge candidate ยังเป็น `Draft` หรือ `Review`

## Policy

- ห้าม pipeline รับ baseline ใหม่เองหลัง scan/build
- ห้าม release จาก dirty working tree
- Generated reports ไม่ใช่ authored documentation และถูก exclude จาก inventory
- `source.ps1 sync-api` แก้เฉพาะ block ที่คั่นด้วย `GENERATED:SOURCE-API-INVENTORY` ใน API Reference; ตารางภายใน block ห้ามแก้ด้วยมือ
- Fingerprint ครอบคลุม Markdown และ source ของ documentation pipeline ได้แก่ config, script, Mermaid/Draw.io/YAML ภายใต้ `pipeline/`
- Source inventory ครอบคลุม runtime manifests, backend routes/services, migrations, frontend source และ deployment files พร้อม hash และ drift report แยกต่างหาก
- Canonical diagram sources `09`–`12` ต้องมี `sourceInventorySha256` ตรงกับ source report; PNG/DOCX/PPTX จะยังไม่ถูกสร้างเมื่อ strict gate ไม่ผ่าน
- E2E ต้องผ่าน policy `REQUIRED`: 10 tests/3 required specs, ไม่มี failed/flaky/skipped/not-run, health ที่กำหนดผ่าน และ source/test hashes ตรงกับ `test-results/e2e-evidence.json` จึงนับเป็น UAT/release evidence
- การไม่มี accepted baseline เป็น warning ใน development แต่ทำให้ `release-check` ล้มเหลว
- Generator ทุกชุดต้องเรียก `preflight -Strict` ผ่านก่อน cleanup, ติดตั้ง dependency หรือสร้าง DOCX/PPTX/PDF/Draw.io; generator เดิมและ artefact เดิมยังเป็น legacy candidate จนผ่าน visual QA และ release approval
