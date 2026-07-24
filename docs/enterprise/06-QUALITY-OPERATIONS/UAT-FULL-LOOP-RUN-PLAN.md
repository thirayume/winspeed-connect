---
documentId: "WF-QA-022"
title: "UAT Full Loop Run Plan and Master Test Script"
version: "v1.0-candidate"
status: Review
statusDetail: "Evidence-driven candidate; rerun current E2E and obtain business sign-off before release"
owner: "QA Lead / Business Process Owners"
normative: true
---
# UAT Full Loop Run Plan and Master Test Script

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-QA-022` |
| Product | WS-Sale-App |
| Runtime | 1.0.1 |
| Scope | Sales → verification/approval → counter/scale → warehouse/shipping → Paper Trail/reconciliation |
| Status | Review — ยังไม่ใช่ business UAT sign-off |
| Test data | Synthetic/masked; ห้ามใช้ PII ที่ไม่จำเป็นในภาพหรือ evidence |

## 1. เป้าหมาย

พิสูจน์ว่าผู้ใช้หลายบทบาทสามารถจบกระบวนการขายหนึ่งรอบโดยข้อมูลไม่ขาดหาย สิทธิ์ไม่รั่ว สถานะเปลี่ยนตามกฎ เอกสาร/น้ำหนัก/บัญชีตรวจย้อนกลับได้ และมีแผนรับมือเมื่อ dependency ล่ม

UAT นี้แบ่งเป็นสองชั้น:

- **Automated supporting evidence** — Playwright 10 cases สำหรับ verification gate, 5-role full loop และ role navigation
- **Business/manual acceptance** — integration กับ TruckScale จริง, WINSpeed/accounting reconciliation, rebate/CN, giveaway, paper exception, BCP/restore, security/RBAC และ performance

## 2. Entry criteria

- ระบุ build, repository commit, source/test hash, environment และ configuration baseline
- Frontend/API/SQL Server health ผ่าน; ระบุ TruckScale/WINSpeed connectivity ตามจริง
- Test users ครบ SALES, MANAGER, ADMIN, COUNTER_SALES, WAREHOUSE และผู้ตรวจ Accounting/IT
- Test customer/product/price/plan/vehicle data ผ่านการอนุมัติและ reset ได้
- Defect tracker, evidence location, communication channel และ rollback owner พร้อม
- Automated evidence ต้องถูกสร้างใหม่หลัง source change; ห้ามใช้ผล `PASSED_COMPLETE` ที่ hash ไม่ตรง

## 3. Exit and decision criteria

| Decision | เกณฑ์ |
|---|---|
| Accept | Critical 100% Pass; overall ≥90%; ไม่มี Sev-1/Sev-2 เปิด; reconciliation, security critical, restore และ evidence/signatures ครบ |
| Conditional Accept | Critical ผ่านทั้งหมด; มีเฉพาะความเสี่ยงต่ำ พร้อม owner/due date/mitigation และ Business Owner ลงนามรับความเสี่ยง |
| Reject/No-Go | Critical fail, data/accounting integrity ไม่ตรง, unauthorized access, restore/rollback ใช้ไม่ได้ หรือหลักฐานตรวจย้อนกลับไม่ได้ |

## 4. Roles and decision authority

| Role | Responsibility | Decision |
|---|---|---|
| QA Lead | เปิดรอบทดสอบ, ควบคุม script/evidence/defect, สรุปผล | แนะนำ Pass/Fail |
| Sales Process Owner | ตรวจข้อมูลลูกค้า ราคา รายการขาย และ usability | Accept Sales scope |
| Manager/Admin | ตรวจ approval, override, audit trail | Accept control scope |
| Counter/Weighbridge | ตรวจคิวรถ น้ำหนัก health/fallback | Accept scale scope |
| Warehouse | ตรวจ pick/load/ship และ exception | Accept warehouse scope |
| Accounting/WINSpeed Owner | ตรวจ posting, reference, rebate/CN และ reconciliation | Accept financial integrity |
| IT/Operations | ตรวจ health, security, backup/restore, rollback | Accept operational readiness |
| Business Sponsor | ตัดสิน Go/No-Go จากผลรวมและความเสี่ยง | Final approval |

## 5. Test run control

บันทึก Run ID, environment, build, commit, source hash, test-data batch, start/end, tester, dependency health และ evidence root ใน workbook `06-XLSX/candidate/UAT-Master-Script-v1.0.xlsx` ก่อนเริ่มทุกครั้ง

## 6. Automated full loop — operator view

### Step 1 — SALES creates a traceable draft

1. เข้า Sales Portal ด้วยผู้ใช้ SALES และยืนยันชื่อ/role ที่มุมผู้ใช้
2. เลือกลูกค้าทดสอบ รายการสินค้า ปริมาณ และทะเบียนรถตาม Test Data ID
3. บันทึก Sales Order และจด SO number/correlation ID
4. ตรวจสถานะ `DRAFT`, ยอด/หน่วย/ลูกค้า/ทะเบียน และข้อมูล audit ผู้สร้าง
5. แนบภาพหน้าจอหลังบันทึกและ API/test attachment

Expected: Sales Order trace ได้จาก SO/ทะเบียน/ผู้สร้างและยังไม่ข้าม verification gate

### Step 2 — MANAGER verifies and ADMIN confirms

1. MANAGER เปิดรายการเดียวกันและตรวจ customer/item/quantity/price/vehicle
2. บันทึก verification พร้อมเหตุผล/ผู้ตรวจตามที่ระบบรองรับ
3. ADMIN ตรวจ prerequisite แล้ว confirm
4. ตรวจสถานะใหม่และ audit actor/time; ทดสอบ negative path โดย confirm ก่อน verify อย่างน้อยหนึ่งรายการ

Expected: confirm ก่อน verify ถูกปฏิเสธ; รายการที่ผ่าน verify จึงยืนยันได้ และ audit trail ระบุตัวผู้กระทำ

### Step 3 — COUNTER SALES checks TruckScale health

1. เปิด TruckScale/queue view และตรวจ health banner ก่อนใช้ข้อมูลน้ำหนัก
2. เมื่อ MySQL online ให้เลือกข้อมูลจริงของทะเบียนทดสอบและตรวจ timestamp/source
3. เมื่อ dependency down ให้ยืนยัน degraded UI, ห้ามแสดงน้ำหนักเก่าว่าเป็นข้อมูลสด และทำ fallback ตาม SOP
4. เก็บ response/health evidence ทั้งกรณี online และ degraded

Expected: ผู้ใช้ทราบสถานะ dependency อย่างชัดเจนและไม่ยืนยันน้ำหนักจากข้อมูลที่ไม่น่าเชื่อถือ

### Step 4 — WAREHOUSE picks, loads and ships

1. WAREHOUSE เปิด pick/load queue และค้น SO เดิม
2. ตรวจ location/quantity/vehicle/document prerequisites
3. ทำ pick → load → ship ตามลำดับ; ทดสอบ blocked transition หนึ่งรายการ
4. ตรวจ quantity balance, status, timestamp และผู้ปฏิบัติ

Expected: สถานะเปลี่ยนเฉพาะลำดับที่อนุญาต ไม่มี overship และ trace ถึงผู้ปฏิบัติได้

### Step 5 — ADMIN verifies Paper Trail and final state

1. ADMIN เปิด Paper Trail และค้น SO เดิม
2. ตรวจสถานะสุดท้าย `SHIPPED`, actor/time และ reference ที่เกี่ยวข้อง
3. ตรวจจำนวน/ประเภทสำเนาและเหตุการณ์สูญหาย/unlock ตามกรณีทดสอบ
4. ส่งรายการให้ Accounting ตรวจเทียบกับ WINSpeed/posting และลงผล reconciliation

Expected: มี end-to-end audit chain และไม่มีข้อมูลสำคัญขัดกันระหว่าง WS-Sale-App, เอกสาร และระบบบัญชี

## 7. Manual extensions required before sign-off

| Case | สิ่งที่ต้องพิสูจน์ | Evidence ขั้นต่ำ |
|---|---|---|
| UAT-MAN-001 | TruckScale online integration และ freshness/vehicle mapping | screenshot + query/response + timestamp |
| UAT-MAN-002 | WINSpeed/accounting reconciliation | signed reconciliation sheet + reference IDs |
| UAT-MAN-003 | Rebate plan/claim/CN | plan snapshot + calculation + CN/posting evidence |
| UAT-MAN-004 | Giveaway over-budget approval | request, blocked/warning path, approval audit |
| UAT-MAN-005 | Four-colour paper loss/unlock | copy/audit evidence + exception approval |
| UAT-MAN-006 | Backup/restore/BCP | restore log, RTO/RPO result, tabletop decision |
| UAT-MAN-007 | Negative RBAC/security | denied responses, role matrix, security review |
| UAT-MAN-008 | Performance with representative data | workload, volume, percentile latency, errors |

รายละเอียด precondition, test data, steps, expected result และ automation reference อยู่ใน `pipeline/docgen/uat-cases.json` ซึ่งเป็นข้อมูลต้นทางเดียวของ XLSX/DOCX candidate

## 8. Suggested run schedule

| Window | Activity | Primary owner | Hold point |
|---|---|---|---|
| T-2 days | baseline/config/data/evidence preparation | QA + IT | entry review |
| T-1 day | automated regression/E2E on frozen candidate | QA | hash/evidence review |
| Day 1 AM | Sales + approval + negative verification gate | Sales/Manager | SO control review |
| Day 1 PM | Counter/TruckScale + Warehouse | Factory/Warehouse | scale/ship review |
| Day 2 AM | Paper, WINSpeed, rebate/CN, giveaway | Admin/Accounting | reconciliation review |
| Day 2 PM | RBAC, performance, restore/BCP | IT/Security/QA | operational review |
| Day 3 | defect retest and final sign-off | All owners | Go/No-Go |

## 9. Defect and retest rule

| Severity | Definition | Required response |
|---|---|---|
| Sev-1 | data loss/corruption, security breach, process cannot continue | Stop run; No-Go until fixed and full impacted regression |
| Sev-2 | critical control/integration incorrect; workaround unsafe | Fix before sign-off; targeted + end-to-end retest |
| Sev-3 | function incorrect with safe workaround | owner/due date; Conditional only with risk acceptance |
| Sev-4 | cosmetic/documentation/usability minor | backlog allowed; evidence and owner required |

ทุก Fail ต้องมี defect ID, actual result, evidence, owner, target date, retest result และ reviewer; ห้ามเปลี่ยน Fail เป็น Pass โดยไม่มี retest evidence

## 10. Evidence package

- Controlled workbook and exported PDF snapshot of run results
- Playwright HTML/JSON/JUnit reports, screenshots and attachments
- Manual screenshots with step/case/run ID, actor, timestamp and expected-result caption
- API/query/log extracts with secrets/PII masked
- Reconciliation, security, performance and restore records
- Defect/retest log and signed decision matrix
- Output manifest containing source commit, input/output hashes and generator/tool versions

## 11. Sign-off

Signatures in the workbook and released UAT report must cover Sales, Manager/Admin, Counter/Weighbridge, Warehouse, Accounting/WINSpeed, IT/Operations, QA and Business Sponsor. Blank name/date/evidence means the gate is not passed.

