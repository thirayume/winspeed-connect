# AGENTS.md

## Scope และ Source of Truth

- Repository ที่ Git ติดตามและ `origin/main` เป็น Source of Truth ของ behavior
- เอกสาร Canonical อยู่ที่ `M:\My Drive\World Fert\docs\enterprise`; generated/rendered/archive เป็น derivative หรือ historical จนกว่าจะพิสูจน์เป็น Current
- Application version คือ `1.5.0`; Node.js policy คือ `22.x`

## Git Safety

- ก่อนแก้ไขให้ fetch, ตรวจ branch, HEAD, worktree และ divergence
- ห้าม reset, merge, rebase, commit, push หรือ force-push โดยไม่มีคำสั่งชัดเจน
- รักษา unrelated changes และห้ามแก้/ลบ archive, superseded, backup หรือ historical โดยไม่มี inventory และ approval
- Commit ที่ได้รับอนุมัติต้องมี scope เดียว อธิบาย root cause/test และไม่มี generated noise หรือ secret

## Database และ Migration

- ห้ามแก้ ledger, applied checksum หรือ migration history โดยตรง
- ห้าม apply migration โดยไม่มี approval, backup และ rollback plan; เริ่มด้วย `--plan`
- Plan/preflight/definition diff ต้องใช้ reader connection และ SELECT-only probes
- Legacy alias ต้องตรวจ exact old filename/checksum, required objects และ consolidated identity; หลักฐานไม่ครบต้อง fail closed
- ห้ามใช้ Production/Shared Database สำหรับ smoke API, E2E หรือ TruckScale write-back

## Test Side Effects

- Read-only: `npm run test:migrations`, frontend lint, migration `--plan`, preflight และ definition diff
- Filesystem-only: frontend build สร้าง `WSSale-App/dist`; ต้องรายงานและ cleanup เมื่อเหมาะสม
- Potential database writes: `smoke:api`, `smoke:api:local`, E2E, seed, migration apply และ TruckScale write-back; ต้องขออนุมัติพร้อม target/cleanup
- ห้ามแก้ source เพียงเพื่อทำให้ test ผ่าน; เมื่อ fail ให้บันทึก exit code, duration, evidence และ root cause

## Documentation และ Artifact

- Markdown/structured source ที่กำหนดเป็น Canonical; DOCX/PPTX/XLSX/DRAWIO ต้องสร้างจากข้อมูลชุดเดียวกัน
- Artifact ใหม่เป็น `Draft` จนได้รับอนุมัติ; Owner/Reviewer/Approver ที่ไม่ยืนยันให้ใช้ `รอยืนยัน`
- ห้ามเขียนทับ Approved/Released artifact; สร้าง version ใหม่และเก็บ previous approved ตาม policy
- Revised artifact ของ Platform ปัจจุบันใช้ `<Artifact-Name>-v1.5.0-Rev01-DRAFT.<ext>`; Governance revision ต้องแยกจาก Platform version
- `C_LEVEL` และ `WEIGHBRIDGE` เป็น Proposed/Pending Business Approval จนกว่าจะอนุมัติครบทุก layer; ห้ามเปลี่ยน behavior หรืออ้างว่าพร้อมใช้งานครบ
- TruckScale ต้องแยก AS-IS, Current Code, Isolated-UAT Validated, Production Validated และ Future State; ห้ามเรียก write-back ว่า Production Ready โดยไม่มีหลักฐาน
- ภาษาไทยเป็นภาษาหลัก ใช้ศัพท์ตาม glossary; คง API/table/field/file/command identifiers ตาม source
- ห้ามใช้ TODO/TBD/XXX/Lorem ipsum หรือผลทดสอบที่แต่งขึ้น; ข้อมูลไม่ครบใช้ `รอยืนยันข้อมูล` พร้อม owner ใน remarks
- ใช้คำว่า “ISO-ready enterprise documentation” หรือ “จัดทำเพื่อรองรับระบบบริหารเอกสารระดับองค์กร” เท่านั้น
- ตรวจ structural, functional, visual และ Thai QA ตามชนิด artifact ก่อนส่ง

## Definition of Done และ Checkpoint

- Version/runtime/paths ตรงกัน, tests ที่อนุมัติถูกรันจริง, ไม่มี secret/PII, broken current link หรือ untracked generated noise
- รายงานทุก checkpoint ต้องมีสิ่งที่ตรวจ, คำสั่ง, ไฟล์, diff, test/QA, risk, blocker, approval ที่ต้องการ และ next step
- ใช้สถานะที่โครงการกำหนดเท่านั้น และห้ามใช้ `PASSED` หากยังไม่ได้รันทดสอบจริง
