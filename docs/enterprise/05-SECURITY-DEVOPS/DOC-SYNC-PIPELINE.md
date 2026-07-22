---
documentId: "WF-SEC-013"
title: "Doc-Sync Pipeline (การซิงก์เอกสารกับ Markdown + Source Code)"
version: "v1.0"
status: Review
statusDetail: "Updated for deterministic source inventory; E2E evidence deferred"
owner: "Security / DevOps Lead"
normative: true
sourceRefs:
  - docs/enterprise/pipeline/doc-control.js
  - docs/enterprise/pipeline/source-alignment.js
  - docs/enterprise/pipeline/source-diagrams.js
---
> **World Fert · WS-Sale-App — Enterprise Documentation v1.0**
> Document ID: `WF-SEC-013` · Version: v1.0 · Date: 22 กรกฎาคม 2569 · Status: Review
> Classification: Confidential — Client / Authorized Partner Use Only

# Doc-Sync Pipeline

Markdown ภายใต้ `docs/enterprise/` เป็น authored source of truth ส่วนข้อเท็จจริงจากระบบต้องอ้าง deterministic source inventory ห้ามถือ DOCX, PPTX, PNG หรือ Draw.io รุ่นเก่าเป็นหลักฐานปัจจุบันจนกว่าจะผ่าน source alignment, visual QA และ release gate

## Control flow

1. `source-alignment.js` อ่าน runtime manifests, backend, migrations, frontend และ deployment files แล้วสร้าง SHA-256 inventory
2. ระบบสกัด API mounts/endpoints, roles, portal keys, migration sequence และ SQL write boundaries จาก source โดยไม่รันแอปหรือ E2E
3. `doc-control.js` ตรวจ document identity, lifecycle, links, merge provenance และการเปลี่ยนเทียบ accepted document baseline
4. gap report เชื่อม review candidates กับ source sets และบล็อก claim ที่ขัดกับ source
5. `source-diagrams.js` สร้าง canonical Mermaid และ editable Draw.io พร้อม `sourceInventorySha256`
6. DOCX/PPTX/PNG generation เปิดได้เมื่อ combined strict gate ผ่านเท่านั้น

## Commands

```powershell
cd docs/enterprise/pipeline

# combined source + document reports
./docs.ps1 preflight

# source-only investigation
./source.ps1 preflight
./source.ps1 validate -Strict -NoWrite

# canonical Mermaid + Draw.io review sources
node ./source-diagrams.js
```

## Generated evidence

| Report/source | Purpose |
|---|---|
| `reports/source-inventory.json` | รายการและ hash ของ source snapshot |
| `reports/source-drift-report.md` | source changes เทียบ accepted source baseline |
| `reports/source-alignment-report.md` | facts, conflicts และ mapping เอกสาร Review |
| `reports/source-api-inventory.md` | endpoint inventory พร้อม source file/line |
| `reports/source-data-boundary-report.md` | dbo/TruckScale writes และ migration duplicates |
| `reports/source-ui-rbac-inventory.md` | roles และ portal keys จาก TypeScript |
| `reports/document-merge-report.md` | merge provenance / supersession |
| `diagrams/09-current-system-context.mmd` | current source context |
| `diagrams/10-current-api-surface.mmd` | Express API mount surface |
| `diagrams/11-document-evidence-flow.mmd` | evidence-to-release workflow |
| `diagrams/12-source-alignment.drawio` | editable Draw.io 3 หน้า |

## Current review facts (22 July 2026)

- packages ทั้งสามตำแหน่งเป็น `1.0.0`
- source scan พบ 17 Express route modules, 160 endpoints, 22 portal keys และ 8 roles
- migration ล่าสุดมี numeric sequence 055; duplicate sequence ต้อง review แยก
- source ปัจจุบันมี controlled writes ไป WINSpeed `dbo` และ pre-weigh writes ไป TruckScale `tbl_keyone`; boundary documents ถูก reconcile และประกาศ `truckScaleWriteTargets` แล้ว แต่ยังคงสถานะ Review จนกว่าจะตรวจ E2E/อนุมัติ
- review candidates จาก merge เดิมถูก map กับ source sets ครบ 40/40

ตัวเลขข้างต้นเป็น snapshot ที่ต้องตรวจจาก `source-alignment-report.md` ทุกครั้ง ไม่ใช่ค่าคงที่สำหรับ release ถัดไป

## E2E/UAT hold

ผล E2E รอบ 22 July 2026 ถูกยกระดับเป็น policy `REQUIRED`: pipeline อ่าน `test-results/e2e-evidence.json`, ตรวจ 10 tests/3 required specs, zero failed/flaky/skipped/not-run, environment health, อายุหลักฐาน และ source/test hashes ผลปัจจุบันเป็น `PASSED_COMPLETE`; ระบบยังไม่สร้าง business UAT sign-off, production readiness หรือ accepted/released baseline โดยอัตโนมัติ

## Baseline order

1. ปิด source/document gaps และตรวจ E2E evidence
2. รับ source baseline ด้วย `source.ps1 accept -Actor ... -Reason ...`
3. รับ document baseline ด้วย `docs.ps1 accept -Actor ... -Reason ...`
4. รัน `docs.ps1 release-check` จาก clean working tree
5. สร้างและทำ visual QA สำหรับ DOCX/PPTX/PDF/PNG ก่อน release
