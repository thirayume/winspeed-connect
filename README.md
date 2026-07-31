# winspeed-connect

ระบบเชื่อมต่อกระบวนการขายของ World Fert ระหว่างหน้าเว็บสำหรับผู้ใช้งาน, REST API, ฐานข้อมูล WINSpeed/SQL Server และงานเชื่อมต่อ TruckScale ระบบปัจจุบันใช้ Application version `1.5.0` และกำหนดมาตรฐาน runtime เป็น Node.js `22.x`

> สถานะความพร้อม: อยู่ระหว่าง Production Readiness Review เอกสารและผลตรวจในงานนี้จัดทำเพื่อรองรับระบบบริหารเอกสารระดับองค์กร และไม่ใช่คำรับรองมาตรฐาน ISO

## ภาพรวมสถาปัตยกรรม

- `WSSale-App` — React + TypeScript + Vite frontend และ Nginx image สำหรับ production
- `backend` — Express API, Socket.IO, background polling, outbox และ TruckScale sync
- SQL Server — อ่านข้อมูล WINSpeed ใน `dbo` และจัดเก็บข้อมูลของระบบใน schema `wf`
- MySQL — แหล่งข้อมูล TruckScale แยกจาก SQL Server
- `deploy` และ Docker Compose — การติดตั้ง Coolify และ on-premises
- `e2e` และ smoke scripts — ใช้เฉพาะ environment ที่แยกจาก Production/Shared Database ตามระดับ side effect

## โครงสร้าง Repository

| Path | หน้าที่ |
|---|---|
| `backend/` | API, middleware, services, database access และ migration tooling |
| `backend/migrations/` | SQL migration source; ห้ามแก้ applied history หรือ apply โดยไม่มีอนุมัติ |
| `WSSale-App/` | Frontend application |
| `deploy/` | Coolify/on-premises configuration และ runbook |
| `e2e/` | End-to-end tests ที่อาจเขียนข้อมูล |
| `scripts/` | เครื่องมือระดับ repository |
| `db-init/` และ `sql/` | Database bootstrap/reference scripts |

เอกสารองค์กรฉบับ Canonical อยู่ที่ [`M:\My Drive\World Fert\docs\enterprise`](<M:\My Drive\World Fert\docs\enterprise>) ไม่ใช่โฟลเดอร์ generated หรือ archive

## ข้อกำหนดเบื้องต้น

- Node.js `22.x`; ใช้ `.nvmrc` และ `engines.node` เป็น runtime policy
- npm ที่รองรับ Node.js 22
- SQL Server ตาม environment ที่ได้รับอนุมัติ
- MySQL เมื่อทดสอบ TruckScale
- Docker และ Docker Compose เมื่อใช้ container deployment

ห้ามติดตั้ง package เพิ่มหรือ upgrade dependency เพื่อแก้ปัญหาเฉพาะหน้าโดยไม่มี change approval

## การตั้งค่า Environment

1. เลือก template ที่ตรงกับเป้าหมาย เช่น `.env.example`, `backend/.env.example`, `backend/.env.coolify.example` หรือ `deploy/onprem/.env.example`
2. สร้างไฟล์ `.env` เฉพาะเครื่องและกรอกค่าจาก secret manager หรือผู้ดูแลระบบ
3. ตรวจ `DB_MODE`, database name และ host ทุกครั้งก่อนรันคำสั่งที่เชื่อมฐานข้อมูล
4. ห้าม commit password, token, connection string, private key หรือข้อมูลส่วนบุคคล

## คำสั่งพัฒนา

ติดตั้ง dependency จาก lockfile ที่มีอยู่:

```powershell
npm ci
cd backend
npm ci
cd ..\WSSale-App
npm ci
```

เริ่ม backend และ frontend จาก repository root:

```powershell
npm run start:backend
npm run start:frontend
```

หรือเริ่มพร้อมกัน:

```powershell
npm run dev
```

## Lint, Build และ Test

| คำสั่ง | ระดับผลกระทบ | หมายเหตุ |
|---|---|---|
| `cd WSSale-App; npm run lint` | อ่านอย่างเดียว | ไม่ควรสร้าง artifact |
| `cd WSSale-App; npm run build` | เขียนเฉพาะ `WSSale-App/dist` | ลบ `dist` หลังเก็บผลตรวจเมื่อไม่ต้องส่ง artifact |
| `npm run test:migrations` | อ่านอย่างเดียว | Unit tests ไม่เชื่อมฐานข้อมูล |
| `npm run migrate:plan:local` | อ่านฐานข้อมูล | ใช้ metadata probes; อาจ exit 1 เมื่อพบ safety blocker |
| `$env:DB_MODE='local'; npm run migrate:preflight` | อ่านฐานข้อมูล | ตรวจ required objects ของ migration 046–061 |
| `$env:DB_MODE='local'; npm run migrate:definitions` | อ่านฐานข้อมูล | เปรียบเทียบ normalized object definition โดยไม่แสดง definition body |
| `npm run smoke:queries` | ต้องยืนยัน target ก่อน | ใช้เฉพาะฐานข้อมูลที่ได้รับอนุมัติ |
| `npm run smoke:api`, `npm run smoke:api:local` | มี side effect | อาจสร้าง audit/access-as/test records; ห้ามใช้กับ Production/Shared Database |
| E2E | มี side effect | ใช้เฉพาะ isolated UAT พร้อม cleanup plan |

## Migration Safety Policy

- เริ่มด้วย `--plan` เสมอ; ห้ามเรียก `node backend/run_migrations.js` โดยไม่มี `--plan` เว้นแต่มี change approval, backup และ rollback plan
- ห้ามแก้ migration ledger, checksum ที่ apply แล้ว หรือประวัติ migration โดยตรง
- Legacy alias ใช้เพื่อพิสูจน์ old ledger entries + checksum + required objects เท่านั้น และไม่เขียน alias กลับเข้า ledger
- `CHECKSUM_DRIFT`, `PARTIALLY_APPLIED` และ `UNSAFE` ต้องหยุดแบบ fail-closed
- Migration 046–061 ห้าม batch apply จนกว่าจะอนุมัติ additive remediation แยกรายไฟล์
- Migration 050 ต้องแยก destructive data cleanup ออกจาก object remediation
- Migration 011 ต้องคงหลักฐาน drift และแยก existing-database reconciliation จาก new-install identity policy

## Docker และ Deployment

- `backend/Dockerfile` และ `WSSale-App/Dockerfile` ใช้ Node.js 22
- `docker-compose.yml` รองรับ external database และ self-host profile
- `deploy/coolify/` และ `deploy/onprem/` เป็น configuration เฉพาะ deployment
- ทุก deployment ต้อง pin Application version `1.5.0`, ตรวจ environment target, run migration plan, สำรองข้อมูล และมี rollback evidence ก่อน apply

## Security และข้อจำกัด UAT

- การอ่าน/เขียน `dbo` และ `wf` ต้องเป็นไปตาม integration contract และสิทธิ์ฐานข้อมูลที่อนุมัติเท่านั้น; Source ปัจจุบันยังมี stored procedure และ migration บางส่วนที่เกี่ยวข้องกับ `dbo` จึงห้ามสรุปว่า `dbo` เป็น read-only ทั้งหมดโดยไม่มีการตรวจ path รายกรณี
- ห้ามบันทึก query string หรือ artifact ที่มี secret/ข้อมูลส่วนบุคคล
- ไฟล์ที่มีลักษณะเป็น credential record ใน repository ต้องได้รับการตรวจและตัดสินใจจาก Security Owner ก่อน release; ห้ามนำค่าในไฟล์ดังกล่าวไปใช้เป็น shared/default credential
- C_LEVEL และ WEIGHBRIDGE ยังรอ Business approval ของ role definition ก่อนเปลี่ยน behavior
- API smoke, local API smoke, E2E และ TruckScale write-back ต้องรันใน isolated UAT เท่านั้น
- Migration checksum drift และ object-definition mismatch ที่รายงานจาก read-only tooling เป็น production blocker จนกว่าจะมี remediation approval

## เอกสารที่เกี่ยวข้อง

- [Enterprise documentation root](<M:\My Drive\World Fert\docs\enterprise>)
- [Enterprise document control pilot — Governance reference v1.0](<M:\My Drive\World Fert\docs\enterprise\00-GOVERNANCE\ENTERPRISE-DOCUMENT-CONTROL-PROCEDURE-v1.0-DRAFT.md>)
- [Thai terminology pilot — Governance reference v1.0](<M:\My Drive\World Fert\docs\enterprise\00-GOVERNANCE\THAI-TERMINOLOGY-AND-WRITING-STYLE-GUIDE-v1.0-DRAFT.md>)
- [Role definition decision sheet — Draft reference; C_LEVEL/WEIGHBRIDGE pending approval](<M:\My Drive\World Fert\docs\enterprise\02-REQUIREMENTS\ROLE-DEFINITION-DECISION-SHEET-v1.0-DRAFT.md>)

Artifact revision ใหม่ของ Platform ปัจจุบันต้องใช้รูปแบบ `<Artifact-Name>-v1.5.0-Rev01-DRAFT.<ext>` และห้ามเขียนทับไฟล์ baseline เดิม
