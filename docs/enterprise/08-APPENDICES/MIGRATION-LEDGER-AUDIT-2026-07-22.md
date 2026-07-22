---
documentId: WF-AUD-MIG-001
title: Migration Ledger and Schema Drift Audit
version: 1.0-draft
status: Draft
owner: Solution Architect / DBA
normative: false
runtimeVersion: 1.0.0
sourceMigrationSequence: 55
auditedCommit: c1e834d7c7fbdb27d061b517159cf0e023b3eca8
sourceRefs:
  - backend/run_migrations.js
  - backend/migration-policy.json
  - backend/migrations/055_restore_all_sales_orders_contract.sql
  - e2e/evidence-reporter.cjs
  - test-results/e2e-evidence.json
outputs:
  - migration-audit-evidence
---

# Migration Ledger and Schema Drift Audit

วันที่ตรวจ: 22 กรกฎาคม 2026  
ขอบเขต: repository `winspeed-frontend`, local SQL Server `dbwins_worldfert9`, migration runner, ledger, source-alignment gate และ E2E evidence  
ข้อจำกัด: รายงานนี้เป็น engineering audit ของ local/test environment ไม่ใช่การรับรอง ISO หรือ production sign-off

## Executive outcome

ก่อนแก้ไข ไฟล์ SQL ที่ runner เดิมเลือกใช้และ ledger มี checksum ตรงกันทั้งหมด แต่สถานะดังกล่าว **ไม่ได้ยืนยันว่า database objects ตรงกับ migration ล่าสุด** เพราะ runner เดิมรัน historical migration ซ้ำเมื่อ checksum เปลี่ยน และเขียนทับ checksum/เวลาเดิมใน ledger

พบหลักฐานว่า migration 003, 007 และ 009 ถูกนำกลับมารันเวลาโดยประมาณ 17:24 น. หลัง migration 039–054 เคย apply แล้ว ส่งผลให้ extension tables และ views กลับเป็น contract รุ่นเก่า ขณะที่ ledger ของ migrations รุ่นหลังยังถูกมองว่า unchanged และถูกข้าม

ได้ติดตั้ง fail-closed runner, migration policy, source-stable E2E evidence และ forward-only migration 055 แล้ว ผลหลังแก้ไขคือ migration plan มี 61 active files ที่ unchanged ทั้งหมด, 0 pending, 0 checksum/batch drift และ Full E2E ผ่าน 10/10

## Snapshot and change-control evidence

- ระหว่าง audit มีการเปลี่ยน `HEAD` ต่อเนื่องจาก `14c7bb1` ผ่าน UI-fix commits หลายชุดจนถึง candidate `c1e834d`
- ทุกครั้งที่ `HEAD` เปลี่ยน ได้ยกเลิกการอ้าง snapshot เก่าและรัน source/evidence check ใหม่
- E2E evidence schema 2 บันทึก start/end commit และ hash ของ source 218 ไฟล์
- Final E2E run: start commit = end commit = `c1e834d7c7fbdb27d061b517159cf0e023b3eca8`, `changedFiles=[]`, `sourceStability.stable=true`
- ไฟล์ migration 055 ถูก hash ใน evidence แม้ยังเป็นไฟล์ใหม่ใน worktree ณ เวลาทดสอบ

## Ledger findings before remediation

| รายการ | ผลตรวจ |
|---|---:|
| SQL files บน disk | 63 |
| Files ที่ runner เดิมใช้ | 61 (รวม UAT SQL) |
| Ledger rows | 61 |
| Checksum + batch count ตรงกับ disk | 61 |
| Checksum drift ที่ตรวจพบ ณ เวลาสแกน | 0 |
| Orphaned ledger rows | 0 |
| Duplicate numeric sequences | 1, 2, 10, 16, 19, 49, 50 |
| UAT SQL ที่ถูก apply ใน ledger หลัก | `uat_create_admin.sql` |

ความเสี่ยงสำคัญของ runner เดิม:

1. `loadApplied()` จับ error แล้วคืน empty map ทำให้ ledger failure ถูกตีความเป็น “ยังไม่เคย apply”
2. checksum ต่างจาก ledger ทำให้ historical file ถูกรันซ้ำแทนที่จะหยุด
3. `MERGE` เขียนทับ checksum, AppliedAt และ AppliedBy เดิม ทำให้สูญเสียหลักฐาน checksum ก่อนหน้า
4. ทำงานทีละ batch โดยไม่มี file transaction และเดินต่อหลัง non-ignorable error
5. เลือกทุก `*.sql` รวม `uat_create_admin.sql`
6. ไม่บังคับ duplicate sequence policy และไม่ตรวจ missing historical files

## Confirmed schema-drift incident

หลักฐานจาก local database:

- `wf.v_AllSalesOrders.modify_date = 2026-07-22 17:24:48.100`
- ledger ของ `007_store_weigh_out.sql` ถูกอัปเดตที่ `2026-07-22 10:24:48Z` ซึ่งตรงกับเวลาท้องถิ่นประมาณ 17:24:48
- ledger ของ 039/040 ยังคงเวลา apply เดิมจากวันที่ 21 กรกฎาคม และ runner จึงข้ามไฟล์เหล่านั้น
- view เหลือ 18 columns และไม่มี `RequestedAt` ขณะที่ API route เรียก `r.RequestedAt`
- `wf.SalesOrderExt` เหลือ 14 columns และมี 0 rows ตอนตรวจ หลัง 003 drop/recreate table
- `wf.SalesOrderLineExt` เหลือ 8 columns

Migration 003 มี destructive statements ได้แก่ล้าง `RebateLedger`, `GiveawayWithdrawal`, `SalesOrderAudit` และ drop/recreate `SalesOrderExt`/`SalesOrderLineExt` การกู้ข้อมูลที่สูญหายต้องใช้ backup หรือ transaction-log/PITR เท่านั้น รายงานนี้ไม่สร้างข้อมูลทดแทนจากการคาดเดา

Migration 002 ยังมีการ drop giveaway tables ก่อนสร้างใหม่ จึงจัดเป็น historical destructive migration ที่ห้ามแก้และห้าม rerun

## Implemented controls

### Migration execution

- เพิ่ม `backend/migration-policy.json`
- exclude `000_logins.sql`, `001_wf_schema_backup.sql` และ `^uat_`
- ยอมรับ duplicate sequences เฉพาะ exact legacy groups ที่ระบุใน policy
- applied migration เป็น immutable: checksum หรือ batch-count ต่างต้องหยุด
- ledger bootstrap/read/write failure เป็น fatal error
- ledger record ใช้ insert-only; ไม่ overwrite ประวัติเดิม
- ตรวจ ledger-only/missing historical file ก่อน apply
- non-ignorable SQL error หยุด file ทันที
- เพิ่ม `--plan`/`--verify-only` สำหรับ read-only verification

### Source and E2E evidence

- source-alignment ยอมรับ duplicate sequence เฉพาะกลุ่มที่ตรง policy ทุกชื่อไฟล์
- E2E evidence hash ครอบคลุม runtime backend, migrations, frontend, E2E specs และ deployment control files รวม 218 ไฟล์ใน final run
- evidence ถูกปฏิเสธเมื่อ source หรือ Git commit เปลี่ยนระหว่าง run
- E2E dev server ใช้ Vite force re-optimization เพื่อป้องกัน lazy import `504 Outdated Optimize Dep`
- เพิ่ม stable test contract `store-queue-scale` และ browser error diagnostics

### Forward repair

Migration `055_restore_all_sales_orders_contract.sql` ทำงาน 20 batches และ:

- เติม columns ที่หายจาก `SalesOrderExt` และ `SalesOrderLineExt` แบบ conditional
- restore `wf.v_AllSalesOrders` จาก current 27-column contract
- restore `wf.v_AllSalesOrderLines` จาก current 22-column contract
- restore `wf.sp_ConfirmSalesOrder` จาก migration 052
- บันทึก ledger ใหม่โดยไม่แก้ historical migration

## Verification results

| Gate | ผล |
|---|---|
| Migration policy/unit tests | ผ่าน 5/5 |
| Documentation/source pipeline tests | ผ่าน; รวมทั้งหมด 28/28 |
| Vite production build | ผ่าน; 2,280 modules |
| Migration plan หลัง repair | 61 unchanged, 0 pending, 0 drift, 3 excluded |
| `v_AllSalesOrders` | 27 columns; required contract 8/8 |
| `v_AllSalesOrderLines` | 22 columns; required contract 6/6 |
| UAT 5-step diagnostic | ผ่าน 5/5 |
| Full E2E | `PASSED_COMPLETE`, 10/10, 0 failed/flaky/skipped/timed-out/not-run |
| E2E source stability | true; start/end commit ตรงกัน; changed files = 0 |

หลักฐานเครื่องอ่านได้อยู่ที่ `test-results/e2e-evidence.json`, `test-results/playwright-results.json`, `test-results/junit.xml` และ `playwright-report/index.html`

## Residual risks and required decisions

1. **Data recovery:** SQL Server backup history มี full backup วันที่ 21 กรกฎาคม 2026 เวลา 23:23 ที่ `C:\Program Files\Microsoft SQL Server\MSSQL16.SQLEXPRESS\MSSQL\Backup\wf.bak`; ไม่พบ log-backup row ในผลตรวจ ขณะที่ database ใช้ recovery model `FULL` และ `log_reuse_wait_desc=LOG_BACKUP`. ก่อน recovery ให้เก็บ current full/log backup, restore `wf.bak` เป็นฐานข้างเคียง และ compare/export เฉพาะข้อมูลที่ต้องกู้ ห้าม restore ทับ active database โดยตรง
2. **Production safety:** ห้ามรัน migration ต่อ production จนกว่าจะทำ read-only plan, object-contract comparison และ backup verification บน production target
3. **UAT identity:** query ปัจจุบันพบ `admin` role `ADMIN`, active, created เวลาเดียวกับ UAT migration และไม่พบ `uat_admin`; `uat_create_admin.sql` ตรวจชื่อ `uat_admin` แต่ insert `admin`. ต้อง review account/security state และออก forward security migration หากต้องลบหรือปิดบัญชี ห้ามแก้ไฟล์เดิม
4. **Baseline acceptance:** source/document accepted baselines ยังไม่ควรถูกรับอัตโนมัติ จน reviewer ยืนยัน incident, migration 055, data-recovery disposition และ normative document statuses
5. **Legacy generated artefacts:** DOCX/PPTX/Draw.io เดิมยังเป็น untrusted candidates จนผ่าน strict source/doc gate และ visual QA

## Mandatory next-run protocol

1. บันทึก `HEAD`, Git status, source inventory hash และ document inventory hash
2. หาก `HEAD` หรือรายการไฟล์เปลี่ยน ให้หยุดและสร้าง candidate snapshot ใหม่
3. รัน `npm run migrate:plan:local` หรือ target ที่ต้องการแบบ read-only
4. ห้าม apply หากมี checksum drift, batch drift, ledger-only file หรือ unapproved duplicate
5. รัน source preflight และตรวจ E2E evidence source stability
6. รับ source baseline ด้วยผู้ตรวจและเหตุผลที่ระบุได้
7. review/approve normative Markdown ก่อนรับ document baseline
8. จึงเริ่ม render DOCX/PPTX/PDF/Draw.io และทำ visual QA
