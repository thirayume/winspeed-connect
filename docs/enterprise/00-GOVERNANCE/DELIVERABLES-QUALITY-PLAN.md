---
documentId: "WF-GOV-006"
title: "Solution Development Deliverables and Documentation Quality Plan"
version: "v1.0-candidate"
status: Review
statusDetail: "Pipeline redesign candidate; approval and accepted baseline required"
owner: "QMR / Product Owner / Solution Architect / QA Lead"
normative: true
---
# Solution Development Deliverables and Documentation Quality Plan

| รายการ | รายละเอียด |
|---|---|
| Document ID | `WF-GOV-006` |
| Product | WS-Sale-App — Sales Order, Warehouse Execution & Rebate Management |
| Client | World Fert Co., Ltd. |
| Runtime baseline | 1.0.1; source commit and hash must be recorded by each build |
| Status | Review — ยังไม่ใช่ Approved/Released baseline |
| Classification | Confidential — Client / Authorized Partner Use Only |

> เอกสารนี้กำหนดวิธีสร้าง ตรวจ และอนุมัติเอกสารจาก Markdown และ source code ปัจจุบัน ไม่ได้ประกาศว่าองค์กรได้รับการรับรอง ISO และไม่อนุญาตให้ generator เปลี่ยนสถานะเอกสารเป็น Approved/Released โดยอัตโนมัติ

## 1. วัตถุประสงค์

สร้าง documentation system ที่ตอบโจทย์พร้อมกันสามกลุ่ม:

1. **ผู้อนุมัติและผู้ตรวจ ISO** — เห็นขอบเขต ผู้รับผิดชอบ revision, traceability, evidence และ sign-off ชัดเจน
2. **Software/IT team** — เห็น requirement, architecture, API, data, security, deployment, test และ operational controls ที่ย้อนกลับไปยัง source ได้
3. **End users และผู้ฝึกอบรม** — ทำงานได้จากขั้นตอนทีละข้อ ภาพหน้าจอ callout ตัวอย่างข้อมูล จุดตรวจสอบ และวิธีแก้ปัญหาเบื้องต้น

## 2. หลักการควบคุม

- Markdown และ machine-readable inventories เป็น source of truth; DOCX, XLSX, PPTX, PNG และ PDF เป็น generated/released artefacts
- ก่อน build ทุกครั้งต้องตรวจรายการไฟล์, SHA-256, source commit, API/RBAC/migration inventory และผล E2E ที่ผูกกับ source เดียวกัน
- หากเนื้อหาขัดกัน ให้ใช้หลักฐานที่ใหม่กว่าและ trace ได้ ไม่ใช้วันที่ไฟล์อย่างเดียว และบันทึก merge disposition
- Generated artefact ต้องคงสถานะ Draft/Review ของต้นทาง ห้าม hardcode `Released`
- ทุก artefact ต้อง render เพื่อตรวจภาพจริงก่อน publish; การสร้างไฟล์สำเร็จไม่เท่ากับผ่าน visual QA
- Human approval, business UAT, security review, reconciliation และ Go/No-Go เป็น manual gates ที่ automation ห้ามข้าม

## 3. Standards alignment

ชุดควบคุมนี้จัดโครงสร้างให้สอดคล้องกับมาตรฐานที่เกี่ยวข้อง โดยใช้ฉบับปัจจุบัน ณ วันที่ build และบันทึก edition ใน release record:

| มาตรฐาน/กรอบ | การประยุกต์ใช้ |
|---|---|
| ISO/IEC/IEEE 12207 | lifecycle processes, roles, transition, operation, maintenance และ disposal |
| ISO/IEC/IEEE 15289 | ชนิดและเนื้อหาของ lifecycle information items |
| ISO/IEC/IEEE 29148 | stakeholder/system/software requirements และ traceability |
| ISO/IEC/IEEE 29119-3 | test plan, test specification, execution record, incident และ completion report |
| ISO/IEC 25010 | quality model และ non-functional acceptance criteria |
| ISO 9001 | documented information, change control, competence, evidence และ improvement |
| ISO/IEC 27001 | information-security controls, access, logging, risk และ evidence handling |
| ISO 22301 | continuity, recovery, exercises และ business-impact decisions |
| ISO 9241-210 | user-centred design, context of use และ usability validation |

การอ้างอิงมาตรฐานต้องใช้เพื่อทำ control mapping ไม่คัดลอกข้อความมาตรฐาน และไม่ตีความเป็น certification statement

## 4. Deliverable map

| Lifecycle | Controlled source | Generated artefacts | ผู้ใช้หลัก | Gate |
|---|---|---|---|---|
| Governance | Document Control, Quality Plan, RACI, records/evidence registers | Master index, revision history, approval pack | QMR, Sponsor, Auditor | G0/G6 |
| Discover/Analyse | BAD, process inventory, scope, glossary | Business Analysis & Design overview, workshop deck | Business owners, BA | G1 |
| Specify | SRS, requirement catalogue, acceptance criteria, NFR, RTM | SRS DOCX/PDF, requirements workbook | PO, QA, Engineering | G2 |
| Design | SAD, ADR, C4, ERD, UML, workflow, data/API contracts | Technical Spec, Draw.io/Mermaid/PNG packs | Engineering, IT, Auditor | G2/G3 |
| Build/Integrate | source inventory, API/RBAC/migration snapshots, CI/CD | Build/release notes, deployment runbook | Engineering, Operations | G3 |
| Verify/Validate | test strategy, test cases, UAT cases, defects | UAT Master Script XLSX, Full Loop Plan DOCX, test report | QA, Process owners | G4/G5 |
| Train/Adopt | role journeys, screen catalogue, SOP, FAQ | User Manual, role guides, training decks, exercises | End users, Trainers | G5 |
| Release/Operate | readiness, BCP/DR, rollback, support, SLA | Go-Live pack, contingency plan, support handbook | Release board, IT, Sponsor | G6 |
| Improve/Retire | incident/PIR, backlog, metrics, records register | PIR, improvement plan, archival record | Owners, QMR | G7 |

## 5. Pipeline gates

### G0 — Change discovery

1. Capture repository HEAD, worktree state, Markdown inventory and SHA-256.
2. Compare against accepted document baseline and last successful build manifest.
3. Classify additions, modifications, deletions, renames and conflicts.
4. Stop for destructive/ambiguous changes; merge only with recorded provenance.

### G1 — Source and content validation

- Front matter must contain document ID, version, status, owner and normative flag.
- Required cross-references must resolve; duplicate document IDs and broken links fail the gate.
- Thai/English text must be valid UTF-8; mojibake patterns fail the gate.
- Claims about endpoints, roles, migrations, tests and runtime must reconcile with generated source inventories.

### G2 — Traceability and design completeness

- Business goal → requirement → design component/API/data → test case → evidence → decision must be queryable.
- Every critical requirement has acceptance criteria, owner and positive/negative test.
- Diagrams include title, purpose, legend, scope boundary, source provenance and readable export size.
- Draw.io/Mermaid source is retained alongside PNG/SVG/PDF render.

### G3 — Deterministic build

- Build from a clean, recorded input manifest using pinned tool versions.
- Use Prompt for body text and Kanit for headings/diagram labels unless the template specifies another approved Thai font.
- Do not edit generated artefacts by hand; corrections return to Markdown/data/template source.
- Output manifest records generator version, source commit, input/output hashes, tool versions and timestamp.

### G4 — Automated verification

- Validate package/openability, page/sheet/slide count, internal links, formula errors and missing media.
- E2E evidence must be current for the same tracked source/test hashes, with zero failed/flaky/skipped/not-run for required specs.
- Automated E2E is supporting evidence only; it does not replace business UAT or production reconciliation.

### G5 — Visual and usability QA

Render and inspect every page, slide and worksheet. Fail whenพบ:

- clipped/overlapping text, broken Thai glyph, mojibake, blank or near-blank page
- diagram content occupies too little of the canvas or labels are unreadable at 100% view
- screenshot lacks context, callout, step number, caption or expected-result note
- tables exceed page width, repeat headers incorrectly, or use font smaller than the approved minimum
- workbook formulas show `#REF!`, `#DIV/0!`, `#VALUE!`, `#NAME?` or validation lists are missing

### G6 — Approval and release

Required reviewers sign the source/artefact manifest. Release requires all critical tests pass, business UAT decision, reconciliation, security/operations gates, rollback readiness and named risk acceptance. Only this gate may change status to Approved/Released.

### G7 — Post-release control

Archive immutable release artefacts/evidence, retain superseded versions, record incidents/PIR, and feed approved changes back through G0.

## 6. Visual specification

| Artefact | Minimum quality rule |
|---|---|
| DOCX/PDF | A4, controlled header/footer, page number, revision/approval table, captioned figures, repeated table headers, no orphan heading |
| PPTX | 16:9, one teaching objective per section, readable at presentation distance, speaker notes/exercise/evidence where applicable |
| Diagram | Source + PNG/SVG/PDF, logical page size, ≥16 px equivalent labels in exported view, legend and boundary |
| Screenshot | Current build, masked data, 16:9 or intentional crop, numbered callouts, action + expected result + common error |
| XLSX | Freeze panes, filters/table, validation lists, formulas, conditional status colours, print/view setup and protected control cells where needed |

## 7. Candidate versus released outputs

| Location | ความหมาย |
|---|---|
| `*/candidate/` | generator output ที่ผ่าน technical checks หรือกำลัง visual review; แก้ซ้ำได้ |
| `*/generated/` | legacy/generated output; ห้ามถือเป็น released โดยอัตโนมัติ |
| `*/released/<version>/` | immutable artefact ที่ผ่าน G6 พร้อม manifest/signatures |

## 8. Immediate remediation backlog

1. สร้าง UAT Master Script และ UAT Full Loop Run Plan จาก `pipeline/docgen/uat-cases.json`
2. สร้าง screen catalogue และ capture script ที่ผูก screenshot กับ route/role/build/hash
3. ปรับ SRS และ Analysis & Design ให้มี requirement/design/test traceability และภาพประกอบที่อ่านได้
4. สร้าง role-based User Manual/Training resources จาก task journey ไม่ใช่รายชื่อหน้าจอ
5. เพิ่ม visual-quality audit และ release manifest แล้วค่อย rebuild DOCX/PPTX/diagram pack ทั้งชุด

## 9. Approval record

| Role | Name | Decision | Date | Evidence/Signature |
|---|---|---|---|---|
| Document Owner |  |  |  |  |
| Solution Architect |  |  |  |  |
| QA Lead |  |  |  |  |
| Business Owner |  |  |  |  |
| QMR/ISO Representative |  |  |  |  |

