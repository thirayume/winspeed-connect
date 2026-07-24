# Project Memory — World Fert / WS-Sale-App

> Repository working memory สำหรับการพัฒนาและจัดทำเอกสาร ไม่ใช่ accepted source baseline, ISO certification, business UAT sign-off หรือ production approval

## Freshness metadata

| Field | Current value |
|---|---|
| Refreshed at | 2026-07-23 17:47:52 +07:00 (Asia/Bangkok) |
| Repository | `C:\MyWork\WorldFert\winspeed-frontend` |
| Git commit | `79a10a28e6a2fba9b65dc85101ff8ab6d784b91c` (`chore: release v1.0.1`) |
| Git state | dirty — มี source/deployment additions ของผู้ใช้, E2E evidence, Markdown/pipeline changes และ generated Review candidates; ยังไม่ได้ commit/accept baseline |
| Runtime version | `1.0.1` in root, backend and frontend packages |
| Source inventory | 220 files; `12B9F964C7C90341859EDD6CDDE9B92BA35D797347F2AA64A1134E1E885FC343` |
| Document inventory | 86 documents + 50 control files; `74D45716F6F373BF9A5A5B3DCDC6B27983404C4C1B27495F20116C52240B2745` |
| E2E evidence | `PASSED_COMPLETE`; 10/10 passed; source stable; SQL Server/MySQL up |
| Technical Core QA | run `20260723-final2`; 3 documents; 83 pages; 45 checks; 0 failed |

หาก `HEAD`, Git status, รายการไฟล์, source inventory หรือ document inventory เปลี่ยน ค่าในไฟล์นี้ถือว่าหมดอายุและต้อง refresh ก่อนใช้อ้างอิงต่อ

## Authority and merge rules

1. ข้อเท็จจริงการทำงานของระบบให้ยึด source code, runtime manifests, migrations และหลักฐานทดสอบที่ source-bound ล่าสุด.
2. เนื้อหาเอกสารให้ยึด Markdown ปัจจุบันใต้ `docs/enterprise/`; เมื่อเนื้อหาขัดกันให้ใช้หลักฐาน/เอกสารล่าสุดตามนโยบาย `latest-document-wins` และส่ง conflict ให้ review.
3. DOCX, PPTX, PDF, PNG และ Draw.io เป็น generated/review artifacts จนกว่าจะผ่าน source/document gates, visual QA และ human approval.
4. `docs/enterprise/_archive/` เป็นประวัติสำหรับ traceability เท่านั้น; ห้ามใช้เป็น current specification เมื่อขัดกับ source/Markdown ล่าสุด.
5. ห้ามคัดลอก credential จาก `.env` หรือ archived DB notes มาไว้ใน Memory หรือเอกสารที่ commit.
6. ห้าม accept baseline, apply migration, restore database หรือประกาศ release/UAT/ISO completion อัตโนมัติโดยไม่มีผู้ตรวจและเหตุผลที่ระบุได้.

## Current repository snapshot

- Source scan เสถียร: 220 files, 17 Express route mounts, 160 endpoints, 22 frontend portal keys และ 8 roles.
- Migration inventory: 55 sequenced files, latest sequence `055`, ไม่มี duplicate/unsequenced migration ใน source report.
- Detected external writes: WINSpeed `dbo` 33 statements; TruckScale 2 statementsและจำกัด target ที่ `tbl_keyone`.
- Source alignment review mapping 40/40; validation 0 errors / 2 warnings.
- Source warnings คือ accepted source baseline missing และ dirty Git worktree.
- Documentation control: 86 documents + 50 control files, scan stable, 136 changes, impact `HIGH`, 0 errors / 44 warnings.
- Document warnings เป็น governance state: accepted baseline missing, dirty worktree, mixed active versions และ normative documents ที่ยังไม่ Approved.
- Source baseline และ document baseline ยังไม่มี; strict release-check จึงยังไม่ควรผ่าน.
- User additions ที่ต้องรักษา: `backend/.env.coolify.example`, `backend/scripts/preflight-check.js`, `deploy/coolify/backup-databases.sh`, `deploy/coolify/docker-compose.yml` และไฟล์อื่นใต้ `deploy/`.

## Architecture and functional scope

- Frontend: React/Vite/TypeScript ใน `WSSale-App/`.
- Middleware/backend: Express/Node.js ใน `backend/`, Socket.IO realtime, auth/RBAC, audit, outbox, policy, observability และ TruckScale synchronization.
- Data topology: SQL Server `dbwins_worldfert9` สำหรับ WINSpeed `dbo` และ operational extension `wf`; TruckScale ใช้ MySQL.
- Source-of-record boundary: WINSpeed `dbo` เป็นระบบบัญชีหลักแต่ runtime มี controlled write flows; TruckScale completed-weigh/reference data เป็น read-only และ pre-weigh queue เขียนเฉพาะ `tbl_keyone`.
- Main flows: Sales Order, quotation, approval, picking/loading/shipping, Paper Trail, TruckScale/Weigh Inbox, rebate/coupon/CN, giveaway, reporting, reconciliation, master data, policy, operations และ PDPA/governance.
- Canonical implementation references: `02-REQUIREMENTS/CURRENT-SYSTEM-STATE.md`, `IMPLEMENTATION-STATUS.md`, `04-DATA-INTEGRATION/API-REFERENCE.md`, `03-SOLUTION-ARCHITECTURE/TECHNICAL-SPECIFICATION.md` และ source-alignment reports.

## Test and current evidence

- Machine-readable evidence: `test-results/e2e-evidence.json`, run `2026-07-23T09-56-59-217Z`.
- Result: 10/10 passed; failed/flaky/skipped/timed-out/interrupted/not-run เป็น 0; required specs ครบ 3/3.
- Source start/end commit ตรงกันที่ `79a10a28e6a2fba9b65dc85101ff8ab6d784b91c`; changed during run 0.
- Environment: frontend 200, API health 200/runtime 1.0.1, SQL Server `up`, TruckScale MySQL `up`.
- Automated E2E เป็น engineering evidence เท่านั้น ไม่ใช่ manual/business UAT sign-off, production hardware certification หรือ accounting reconciliation approval.

## Documentation pipeline state

- Authored source of truth คือ Markdown ภายใต้ `docs/enterprise/`.
- Control entry points: `docs/enterprise/pipeline/docs.ps1` และ `source.ps1`.
- UAT build entry: `docs/enterprise/pipeline/docgen/build-uat-candidates.ps1`.
- Technical Core entry: `docs/enterprise/pipeline/docgen/build-technical-core.ps1`.
- Python dependencies ตรึงใน `requirements-technical-core.txt`; fonts ใช้ Kanit headings และ Prompt body/tables.
- Technical Core manifest: `pipeline/docgen/technical-core-manifest.json`.
- Integrated report: `pipeline/reports/technical-core-pipeline-report.json`.
- Structure/accessibility/page report: `pipeline/reports/technical-core-validation-report.json`.
- Editable diagram sourcesอยู่ใน `pipeline/diagrams/`; rendered PNG อยู่ใน `04-DIAGRAMS-PNG/candidate/`.
- Generator สร้าง Review/Candidate เท่านั้นและไม่เขียน approval/baseline.

## Technical Core candidate set

Run `20260723-final2` สร้างและตรวจแล้ว:

| Document | Pages | SHA-256 |
|---|---:|---|
| `01-DOCX/candidate/technical-core/SRS-v1.0-candidate.docx` | 24 | `08EEA17A7ED9A5B7C37FECC32DBFFD231E0FAAE31A3029436F2E0CBE06EB884B` |
| `01-DOCX/candidate/technical-core/Analysis-and-Design-v1.0-candidate.docx` | 23 | `2EE398918CE699E939D6AFA6F871618CA1BFA64216567EE810B75CE640A1D853` |
| `01-DOCX/candidate/technical-core/Technical-Specification-v1.0-candidate.docx` | 36 | `0D2D655F8A719219889D7FE154725E489A60EFE0A5117E2EDBF9CCCA581147EA` |

QA facts:

- Render method: Microsoft Word hidden/read-only PDF export + PDFium.
- 83 pages, 45 automated structure/accessibility/provenance/render checks, 0 failed.
- ตรวจ visual QA ครบ 14 contact sheets; ไม่พบ blank page, edge clipping, table overflow หรือ cropped diagram.
- Fixed-layout tables, repeated table-header semantics, image alt text, Prompt/Kanit presence, source hashes และ Review markers ผ่าน.
- พื้นที่ว่างบนหน้าคั่นบางหน้าเป็น chapter/source boundary ไม่ใช่ blank page.
- Status ยังคง `Review`; approval tables ยัง Pending.

## UAT candidate state

- UAT Full Loop Run Plan DOCX: 18 cases, 22 rendered pages.
- UAT Master Script XLSX: 9 worksheets, 18 cases.
- Automated cases 10; manual/business gates 8.
- Manual gates ที่ยังเปิด: production-like TruckScale, WINSpeed accounting reconciliation, Rebate/CN, giveaway exception, paper/unlock exception, backup/restore/BCP, negative RBAC/security และ performance/SLO.
- ทุก manual Pass ต้องมี evidence reference; Fail ต้องมี defect, severity, owner, retest และ closure evidence.

## Migration incident and database safety

- Engineering audit วันที่ 2026-07-22 ระบุว่า runner รุ่นเดิมเคย rerun historical migrations และ migration 003 มี destructive data/table operations.
- Fail-closed runner, immutable ledger controls และ forward-only migration `055_restore_all_sales_orders_contract.sql` ถูกเพิ่มเพื่อ restore object contract โดยไม่แก้ historical migration.
- Migration 055 ช่วย restore schema/view/procedure contract แต่ไม่ได้พิสูจน์หรือกู้ข้อมูลที่อาจสูญหายจาก destructive rerun.
- การกู้ข้อมูลต้อง restore backup แบบ side-by-side แล้ว compare/export เท่านั้น ห้าม restore ทับ active database.
- Audit รายละเอียดอยู่ที่ `docs/enterprise/08-APPENDICES/MIGRATION-LEDGER-AUDIT-2026-07-22.md`; ตัวเลขเก่าในรายงานนั้นเป็น historical snapshot ไม่ใช่ current file count.

## Mandatory refresh protocol

1. บันทึก `git rev-parse HEAD` และ `git status --short`; หาก snapshot เปลี่ยนระหว่างงานให้เริ่ม scan ใหม่.
2. รัน `docs/enterprise/pipeline/source.ps1 preflight -NoWrite`.
3. รัน `docs/enterprise/pipeline/docs.ps1 status -NoWrite`; เมื่อจะอัปเดตรายงานให้รัน `validate`.
4. ตรวจ `test-results/e2e-evidence.json` จาก status, complete, counts, coverage, environment, commit และ source stability; อย่าตัดสินจาก HTML report เพียงอย่างเดียว.
5. หลัง source/E2E เปลี่ยน ให้ sync API, regenerate diagrams/candidates และตรวจ Git diff.
6. ก่อนงาน database ให้รัน migration plan แบบ read-only; หยุดเมื่อพบ pending/drift/ledger-only/checksum mismatch.
7. หลัง package manifest/lockfile เปลี่ยน ให้รัน audits/build/tests ที่เกี่ยวข้อง.
8. รับ source baseline ก่อน document baseline; release-check เป็นขั้นตอนหลัง approvals และ clean worktree.

## Immediate next actions

1. ให้ Business owner, Architect, QA, Security, DBA/Integration และ Operations review Technical Core ทั้ง 3 ฉบับ พร้อมบันทึก correction/decision.
2. สร้าง role-based User Manual, User Guide และ Training Resources พร้อม screenshot/callout ตาม scenario และ role.
3. ดำเนิน manual/business UAT 8 gates และเติมผล/evidence ใน UAT workbook.
4. จัดทำ BCP/Contingency drill evidence, Go-live Readiness และ presentation/training deck.
5. Review/commit candidate changes โดยรักษา user deployment additions และแยก source, evidence, Markdown/pipeline, generated artifacts ให้ตรวจได้.
6. หลัง approval และเลือก clean commit แล้ว จึง accept source baseline, document baseline และรัน strict release-check.
