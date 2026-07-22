# Project Memory — World Fert / WS-Sale-App

> Repository working memory สำหรับการพัฒนาและจัดทำเอกสาร ไม่ใช่ accepted source baseline, ISO certification, business UAT sign-off หรือ production approval

## Freshness metadata

| Field | Current value |
|---|---|
| Refreshed at | 2026-07-23 01:27:10 +07:00 (Asia/Bangkok) |
| Repository | `C:\MyWork\WorldFert\winspeed-frontend` |
| Git commit | `4fc55b269b558877e5876a25ed64357656d4e987` |
| Git state | dirty — intentional source/dependency/E2E/pipeline changes, current evidence, synchronized documentation/diagrams, readiness packet และ `MEMORY.md` |
| Runtime version | `1.0.0` in root, backend, and frontend packages |
| Source inventory | 213 files; `AF8F72840C1F5CFAAEB44B8D247C8DFAF0B3DBF19F30916AB895724DA25F95EB` |
| Document inventory | 81 documents + 29 control files; `6D71DB098DD773E7BEC07DBAD8544F6F452E0F77761CB65212726BC546BFA647` |
| E2E evidence | `PASSED_COMPLETE`; 10/10 passed, 3/3 required specs, source stable |

หาก `HEAD`, Git status, รายการไฟล์, source inventory หรือ document inventory เปลี่ยน ค่าในไฟล์นี้ถือว่าหมดอายุและต้อง refresh ก่อนใช้อ้างอิงต่อ

## Authority and merge rules

1. ข้อเท็จจริงการทำงานของระบบให้ยึด source code, runtime manifests, migrations และหลักฐานทดสอบที่ source-bound ล่าสุด
2. เนื้อหาเอกสารให้ยึด Markdown ปัจจุบันใต้ `docs/enterprise/`; เมื่อเนื้อหาขัดกันให้ใช้หลักฐาน/เอกสารล่าสุดตามนโยบาย `latest-document-wins` และส่งรายการ conflict ให้ review
3. DOCX, PPTX, PDF, PNG และ Draw.io ที่ generate หรืออยู่ใน archive ยังไม่ใช่ release evidence จนผ่าน source/document gates และ visual QA
4. `docs/enterprise/_archive/` เป็นประวัติสำหรับ traceability เท่านั้น รวมถึง `_archive/wf-out-ki/ki/MEMORY.md` ซึ่งเป็น DB study เดือนมิถุนายน 2026 และอาจล้าสมัย
5. ห้ามคัดลอก credential จาก `.env` หรือ archived DB notes มาไว้ใน Memory หรือเอกสารที่ commit
6. ห้าม accept baseline, apply migration, restore database หรือประกาศ release/UAT/ISO completion อัตโนมัติโดยไม่มีผู้ตรวจและเหตุผลที่ระบุได้

## Current repository snapshot

- Source scan เสถียร: 213 source files, 17 Express route mounts, 160 endpoints, 22 frontend portal keys และ 8 roles
- Source pipeline รายงาน migration 55 files และ latest numeric sequence `055`
- บน disk มี SQL 56 ไฟล์: runner local plan เลือก 54 active และ exclude 2 (`000_logins.sql`, `uat_create_admin.sql` ผ่าน policy/pattern)
- Read-only local migration plan: 54 unchanged, 0 pending, 0 drift; ไม่มี schema/data/ledger write
- `backend/migration-policy.json` ใช้ immutable-after-apply, exclude `000_logins.sql` และ `^uat_`; ไม่มี duplicate numeric sequence ที่อนุมัติค้างอยู่
- Source preflight: 0 errors / 2 warnings; warnings คือ accepted source baseline missing และ dirty Git worktree
- Documentation control: 81 documents + 29 control files, scan stable, 110 changes, impact `HIGH`, 0 errors / 40 warnings
- Document warnings คือ normative documents ยังไม่ Approved 38 รายการ, accepted document baseline missing 1 รายการ และ dirty-worktree 1 รายการ
- API generated block และ canonical Mermaid/Draw.io sources ถูก sync กับ source inventory `AF8F7284...A25F95EB`
- Release-readiness/approval packet ปัจจุบันอยู่ที่ `docs/enterprise/08-APPENDICES/RELEASE-CANDIDATE-READINESS-2026-07-23.md`; เป็น Draft/non-normative และไม่ได้อนุมัติ release หรือ baseline

## Architecture and functional scope

- Frontend: React/Vite/TypeScript ใน `WSSale-App/`
- Middleware/backend: Express/Node.js ใน `backend/`, Socket.IO realtime, auth/RBAC, audit, outbox, policy, observability และ TruckScale synchronization
- Data topology: SQL Server `dbwins_worldfert9` สำหรับ WINSpeed `dbo` และ operational extension `wf`; TruckScale ใช้ MySQL
- Source-of-record boundary: WINSpeed `dbo` เป็นระบบบัญชีหลัก แต่ runtime มี controlled write flows; TruckScale completed-weigh data เป็น read-oriented และ pre-weigh queue เขียนเฉพาะ target ที่ประกาศ (`tbl_keyone`)
- Main flows: Sales Order, quotation, approval, picking/loading/shipping, Paper Trail, TruckScale/weigh inbox, rebate/coupon/CN, giveaway, reporting, reconciliation, master data, policy, operations และ PDPA/governance
- Canonical implementation references: `docs/enterprise/02-REQUIREMENTS/CURRENT-SYSTEM-STATE.md`, `IMPLEMENTATION-STATUS.md`, `04-DATA-INTEGRATION/API-REFERENCE.md` และ source-alignment pipeline

## Migration incident and database safety

- Engineering audit วันที่ 2026-07-22 ยืนยันว่า runner รุ่นเดิมเคย rerun historical migrations และทำให้ schema contract ถอยหลัง; migration 003 มี destructive data/table operations
- Fail-closed runner, immutable ledger controls และ forward-only migration `055_restore_all_sales_orders_contract.sql` ถูกเพิ่มเพื่อ restore object contract โดยไม่แก้ historical migration
- Migration 055 ช่วย restore schema/view/procedure contract แต่ไม่ได้พิสูจน์หรือกู้ข้อมูลที่อาจสูญหายจาก destructive rerun
- หลัง repository consolidation ชื่อ/เนื้อหา migration บาง sequence ถูก merge; local read-only plan ปัจจุบันยืนยัน 54 unchanged, 0 pending และ 0 drift
- การกู้ข้อมูลต้อง restore backup แบบ side-by-side แล้ว compare/export เท่านั้น ห้าม restore ทับ active database; ยังไม่มีคำสั่งอนุมัติให้ทำ data recovery
- Audit รายละเอียดอยู่ที่ `docs/enterprise/08-APPENDICES/MIGRATION-LEDGER-AUDIT-2026-07-22.md`; ตัวเลข 61/63 ในรายงานนั้นเป็น historical snapshot ก่อน migration consolidation ไม่ใช่ current file count

## Test, dependency and release evidence

- Current machine-readable evidence อยู่ที่ `test-results/e2e-evidence.json`: run `2026-07-22T14-44-01-798Z`, `PASSED_COMPLETE`, `complete=true`, Playwright passed
- Full E2E ผ่าน 10/10 จาก required specs ครบ 3/3: `comprehensive-sales`, `uat-full-loop` และ `workflow`; failed/flaky/skipped/timed-out/interrupted/not-run เป็น 0 ทั้งหมด
- Environment evidence: frontend `http://localhost:5174`, API `http://localhost:3100/api`, SQL Server `up`, MySQL `up`
- Source stability: start/end commit ตรงกันที่ `4fc55b269b558877e5876a25ed64357656d4e987`, changed during run 0 และ file hashes 210 รายการ
- E2E แยกจาก dev server ของผู้ใช้บน `3000/5173`; runner ใช้ `3100/5174`, cleanup ด้วย `predev:e2e` และ terminate process tree ของตนเองใน `finally`
- รอบวิเคราะห์พบ stale `npm run dev:e2e` 9 roots/116 process targets และ Query timeout; หลังปิดเฉพาะ test trees แล้ว Full E2E ผ่านครบ และไม่มี `dev:e2e` ค้าง โดย dev server เดิมยังทำงาน
- Navigation race ถูกแก้โดยให้ E2E รอ `GlobalLoader` idle, ยกเลิก forced click, scroll/click แบบ actionability และตั้ง workflow suite timeout 60 วินาที
- Production build ผ่านด้วย Vite 8.1.5 จำนวน 2,280 modules; pipeline unit tests ผ่าน 23/23 และ migration-policy tests ผ่าน 5/5
- `npm audit` ล่าสุด: root 0/72 dependencies, backend 0/241 และ frontend 0/249; ไม่มี low/moderate/high/critical vulnerabilities
- backend SheetJS ใช้ official CDN tarball 0.20.3 และ export smoke ผ่าน (XLSX ZIP header `504b`); root-level `xlsx` ที่ซ้ำซ้อนถูกลบ
- E2E/UAT automation ที่ผ่านไม่เท่ากับ business UAT sign-off, accepted baseline หรือ production release approval

## Documentation pipeline state

- Authored source of truth คือ Markdown ภายใต้ `docs/enterprise/`
- Pipeline entry points อยู่ที่ `docs/enterprise/pipeline/docs.ps1` และ `source.ps1`
- Current source reports, API generated block, Mermaid sources และ editable Draw.io source manifest ผูกกับ `AF8F72840C1F5CFAAEB44B8D247C8DFAF0B3DBF19F30916AB895724DA25F95EB`
- Source gate ไม่มี error แล้ว แต่ยังมี baseline-missing และ dirty-worktree warnings
- Document validation ไม่มี error แต่ยังมี 38 normative approval warnings รวมเป็น 40 เมื่อรวม accepted-baseline-missing และ dirty worktree
- DOCX/PPTX/PDF/PNG ที่มีอยู่ยังไม่น่าเชื่อถือในฐานะ released artefacts; ต้อง regenerate จาก approved Markdown baseline ด้วย Kanit หรือ Prompt แล้วทำ visual QA
- สถานะ `Released` ใน README บางส่วนเป็น document claim; machine release gate ยังไม่ผ่านเพราะ baselines missing และ worktree dirty

## Mandatory refresh protocol

1. บันทึก `git rev-parse HEAD` และ `git status --short`; หาก snapshot เปลี่ยนระหว่างงานให้หยุดและเริ่ม scan ใหม่
2. รัน `docs/enterprise/pipeline/source.ps1 preflight -NoWrite` และบันทึก source hash/count/gaps
3. รัน `docs/enterprise/pipeline/docs.ps1 preflight -NoWrite` หรือรัน source/document validators แยกกัน และบันทึก document hash/count/gaps
4. ก่อนงาน database ให้รัน `npm run migrate:plan:local` หรือ target ที่เกี่ยวข้องแบบ read-only; หยุดเมื่อพบ pending/drift/ledger-only/checksum mismatch
5. ตรวจ `test-results/e2e-evidence.json` จาก `status`, `complete`, coverage, counts, environment, commit และ file hashes; อย่าตัดสินจาก HTML report เพียงอย่างเดียว
6. หลัง source/E2E เปลี่ยน ให้ sync API, regenerate controlled reports/diagrams และตรวจ Git diff ก่อนเสนอ baseline
7. หลัง package manifest/lockfile เปลี่ยน ให้รัน npm audit ทั้งสาม tree, production build และ export smoke ที่เกี่ยวข้อง
8. รับ source baseline ก่อน document baseline; release-check และ artifact rendering เป็นขั้นตอนถัดไปหลัง approval เท่านั้น

## Immediate next actions

1. Review และจัดชุด/commit candidate changes โดยแยก source fixes, dependency remediation, E2E evidence และ documentation-control artefacts ให้ตรวจสอบได้
2. ให้ reviewer ปิด normative approval warnings 38 รายการตาม readiness packet และตัดสิน migration incident/data-recovery disposition
3. รับ source baseline ด้วย actor/reason หลังเลือก clean commit แล้ว จากนั้นจึงรับ document baseline
4. รัน strict release-check จาก clean worktree
5. Regenerate DOCX/PPTX/PDF/PNG/Draw.io จาก approved Markdown baseline ด้วย Kanit หรือ Prompt และทำ render/visual QA
6. ดำเนิน business UAT sign-off, User Manual, User Guide และ Training Resources ตาม approved document baseline