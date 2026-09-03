---
documentId: "WF-REL-002"
title: "ส่วนต่างเอกสาร v1.6.1 → v1.9.0 — แก้ 14 ฉบับที่ผิดข้อเท็จจริง"
version: "v1.0"
status: Draft
statusDetail: "จัดทำ 3 กันยายน 2569 · ทาง ก. ตามที่เจ้าของระบบเลือก — แก้เฉพาะที่ผิด ไม่แก้ฐานในที่เดิม"
owner: "Solution Architect"
normative: true
supersedes: "ไม่ superseded — ใช้คู่กับชุด v1.0 เป็นตัวแก้"
---

# ส่วนต่างเอกสาร v1.6.1 → v1.9.0

> **วิธีใช้เอกสารนี้**
> ชุดเอกสาร v1.0 ใน `docs/docs/enterprise/` **ไม่ถูกแก้ในที่เดิม** ตามกติกาควบคุมเอกสาร
> เมื่ออ่านฉบับใดในรายการข้างล่าง **ให้ถือว่าข้อความในเอกสารนี้แทนที่ข้อความในฉบับนั้น**
>
> ที่มา: [`DOC-CURRENCY-AUDIT-2026-09-02.md`](DOC-CURRENCY-AUDIT-2026-09-02.md) พบว่ามี 14 ฉบับ
> ที่ **ผิดข้อเท็จจริงแล้ว ไม่ใช่แค่เก่า** เจ้าของระบบเลือก **ทาง ก. แก้เฉพาะที่ผิด** เมื่อ 3 ก.ย. 2569

---

## สรุปสิ่งที่เปลี่ยนตั้งแต่ 18 ส.ค. 2569

| # | เปลี่ยนอะไร | เมื่อไร |
|---|---|---|
| 1 | v1.7.x → **1.8.0** → **1.9.0** | 31 ส.ค. – 3 ก.ย. |
| 2 | **ยกเลิก MySQL TruckScale ทั้งหมด** | 3 ก.ย. |
| 3 | การชั่งย้ายไป `dbo.WGHD`/`WGDT`/`WGDTReport` — **อ่านอย่างเดียว** | 2–3 ก.ย. |
| 4 | โครงสร้างองค์กร 2568 เข้าระบบ (migration 102) | 3 ก.ย. |
| 5 | หน้าผูกผู้ใช้ ↔ ตำแหน่ง | 3 ก.ย. |
| 6 | `tsc -b` ต่อเข้า build · แก้ ~70 type error | 3 ก.ย. |
| 7 | ย้ายฐานขึ้นคลาวด์ Hostinger (PROD-B) | 31 ส.ค. |
| 8 | migration guard `assertNoDatabaseSwitch()` · แก้ 074 | 1 ก.ย. |

---

## 1. `03-SOLUTION-ARCHITECTURE/ADR-004-TRUCKSCALE-INTEGRATION`

**สถานะเดิม: ตัดสินใจใช้ MySQL `db_truckscale` เป็นแหล่งข้อมูลการชั่ง**

### 🔴 แทนที่ทั้งฉบับด้วย ADR ใหม่

> **ADR-004 (แก้ไข 3 ก.ย. 2569) — แหล่งข้อมูลการชั่งคือ WINSpeed ไม่ใช่ MySQL**
>
> **บริบท** — TruckScale เขียนข้อมูลลง MySQL `db_truckscale` และเราเคยดึงมาเก็บที่ `wf.WeighInbox`
> ต่อมาพบว่า WINSpeed มีโมดูลชั่งของตัวเองอยู่แล้ว (`dbo.WGHD` / `WGDT` / `WGDTReport`)
>
> **ตัดสินใจ** — เจ้าของระบบสั่งยกเลิกงานทุกอย่างที่ทำร่วมกับ MySQL TruckScale
> ใช้สามตารางของ WINSpeed เป็นแหล่งเดียว **อ่านอย่างเดียว 100 %**
>
> **เหตุผล**
> 1. อยู่ฐานเดียวกับ SO/Invoice จึง join ได้ ไม่ต้องข้ามเครื่อง
> 2. `WGDT.GoodName` เป็นชื่อไทยจริง (MySQL ได้รหัสสินค้าเพราะแอปเขียนรหัสลงไป)
> 3. `WGHD.SPID → SOHD.SOID` เชื่อมได้ **141/141 = 100 %**
> 4. ลดชิ้นส่วนที่ต้องดูแลไปหนึ่งฐานข้อมูล
>
> **ผลที่ตามมา**
> - แอป **ไม่เขียน** สามตารางนั้นเลย — เครื่องชั่งเป็นเจ้าของฝ่ายเดียว
> - `wf.WeighInbox` และ `wf.TruckScaleSync` กลายเป็นข้อมูลตาย
> - ชั้น MySQL ปิดด้วยสวิตช์เดียว `TRUCKSCALE_MYSQL` · **ไม่ลบไฟล์** เพื่อให้ถอยกลับได้
>
> **ข้อจำกัดที่ยังอยู่** — สถานะ 3 (ชั่งออก) **ไม่ได้ปิด SO ใน WINSpeed**
> เป็นการตีความของแอป · สิ่งที่ปิด SO จริงคือการตัดตั๋วปุ๋ย

---

## 2. `04-DATA-INTEGRATION/TRUCKSCALE-INTEGRATION-CONTRACT`

**ทั้งฉบับใช้ไม่ได้แล้ว** — สัญญาข้อมูลกับ MySQL ไม่มีผลอีกต่อไป

**สัญญาข้อมูลใหม่**

| | |
|---|---|
| แหล่ง | `dbo.WGHD` (หัว) · `dbo.WGDT` (บรรทัด) · `dbo.WGDTReport` (มุมมอง) |
| ทิศทาง | **อ่านอย่างเดียว** — ไม่มี endpoint ใดเขียน |
| จุดเชื่อม | `WGHD.SPID = SOHD.SOID` (SO) · `= POHD.POID` (PO) |
| คนขับ | `WGHD.EMDriverId → dbo.EMDriver.Id` |
| คลัง | `WGDT.STOCode → dbo.EMSTOType` (16 คลัง) |
| API | `/api/weighing` 10 endpoint |
| ความถี่ | หน้าจออ่านใหม่ทุก **1 นาที** |

รายละเอียดครบใน [`DOCUMENT-FLOW-TRACEABLE.md`](DOCUMENT-FLOW-TRACEABLE.md) §9

---

## 3. `03-SOLUTION-ARCHITECTURE/ADR-002-DATABASE-TOPOLOGY`

**ไม่มีคำว่า Hostinger เลย** และไม่รู้ว่ามี 4 ปลายทาง

### แทนที่ด้วยตารางนี้

| ชื่อ | ฐานข้อมูล | บทบาท |
|---|---|---|
| DEV | SQL Server ในเครื่อง หรือชี้ระยะไกลด้วย `DB_MODE` | พัฒนา |
| UAT | `dbwins_worldfert9_test` @ Hostinger | ทดสอบ |
| **PROD-A** | **Azure** `20.255.185.14` | 🟢 ใช้งานจริง |
| **PROD-B** | **Hostinger** `76.13.190.104` | 🟡 สำรอง ยังไม่มีคนใช้ |

**เจ้าของระบบตัดสิน 31 ส.ค. 2569** — เป้าหมายคือย้ายไปคลาวด์ 100 % ที่ Hostinger
Coolify/Hetzner **เลิกใช้แล้ว**

> 🔴 สวิตช์เลือกฐานคือ **`DB_MODE`** ไม่ใช่ `DB_TARGET` · ค่าเริ่มต้น `remote` = **Azure production**

---

## 4. `05-SECURITY-DEVOPS/DEPLOYMENT-AND-CI-CD`

**เพิ่มสามข้อที่ขาด**

**4.1 ลำดับบังคับหลัง RESTORE — ห้ามสลับ**

```
RESTORE → สร้าง logins/users → run_migrations.js → seed_admin.js
```

`RESTORE` ลบ database user ทิ้งทุกครั้ง · migration 002 จะล้มด้วย
`Cannot find the user 'wf_reader'` ถ้าไม่มี user มาก่อน
บน VPS `restore-mssql.sh` → `finalize-mssql.sh` ทำให้ครบแล้วอัตโนมัติ

**4.2 วิธี deploy ต่างกันสองแบบ**

| ปลายทาง | วิธี |
|---|---|
| PROD-A | **อัตโนมัติ** — Railway/Vercel ผูก Git · `git push origin main` |
| PROD-B | **มือ** — `/opt/worldfert/app` ไม่ใช่ git repo · tar → scp → `deploy-release.sh` |

**4.3 กฎ migration**

- `checksumPolicy=immutable-after-apply` — แก้ไฟล์ที่รันแล้ว runner หยุดทั้งชุด
- **ห้ามมี `USE <database>` ในไฟล์** — guard `assertNoDatabaseSwitch()` ดักไว้
  เคยทำให้ migration 074 เขียนผิดฐาน
- ฐานเป้าหมายอ่านจาก `SELECT DB_NAME()` ไม่ใช่ `pool.config.database` (ค่านั้นเป็น `undefined`)

---

## 5. `05-SECURITY-DEVOPS/BACKUP-DR-BCP`

**เพิ่มเครื่องมือที่ใช้จริง**

| เครื่องมือ | ใช้เมื่อไร |
|---|---|
| `deploy/db-rebuild/rebuild-remote-mssql.js` | สร้างฐานใหม่จาก `.bak` ผ่าน TCP 1433 ล้วน |
| `deploy/cloud-vps/server/restore-mssql.sh` | RESTORE บน VPS · ต้องมี `--confirm-replace` |
| `deploy/cloud-vps/server/finalize-mssql.sh` | สร้าง user → migrate → seed (เรียกอัตโนมัติ) |
| `deploy/cloud-vps/server/backup-databases.sh` | backup + cron ทุกอาทิตย์ 02:00 |

**การซิงค์ PROD-A → PROD-B** อยู่ใน [`SYNC-PROD-A-TO-PROD-B.md`](../05-SECURITY-DEVOPS/SYNC-PROD-A-TO-PROD-B.md)
🛑 **สถานะ HOLD** — อาจใช้ private network + VPN แทน

---

## 6. `04-DATA-INTEGRATION/API-REFERENCE`

**เพิ่ม / เอาออก**

| เส้นทาง | สถานะ |
|---|---|
| `/api/weighing/*` (10 endpoint) | 🆕 **เพิ่ม** — `live` `anomalies` `coverage` `tickets` `tickets/:id` `by-date` `by-product` `by-godown` `by-customer` `by-so` |
| `/api/auth/org-positions` | 🆕 **เพิ่ม** |
| `/api/trips/*` | 🆕 เพิ่มตั้งแต่ 1.8.0 — `GET /` `GET /:id` `POST /` `PUT /:id` |
| `/api/scale-reports/*` | 🔴 **ปิด** — ตอบ 404 |
| `/api/truckscale/*` | 🔴 **ปิด** — ตอบ 404 |
| `PATCH /api/auth/users/:id` | รับ `positionCode` เพิ่ม |
| `GET /api/auth/users` | คืนคอลัมน์ตำแหน่งและผู้อนุมัติเพิ่ม 9 คอลัมน์ |
| `/api/health` · `/api/ops/status` | คืน `mysql: "disabled"` และ `weighing: "winspeed:WGHD"` |

---

## 7. `04-DATA-INTEGRATION/PAGES-SQL-MAP`

**หน้าจอใหม่ที่ยังไม่อยู่ในแผนที่**

| หน้าจอ | แหล่งข้อมูล |
|---|---|
| **สถานะการชั่งรถ** | `dbo.WGHD` · `dbo.WGDT` · `dbo.EMSTOType` · `dbo.EMDriver` · `dbo.SOHD` (ผ่าน `SPID`) |
| **ผังองค์กร** | `wf.OrgPosition` · `wf.AppUser` · `wf.v_NearestApprover` |
| Sale Trip | `wf.SalesTrip` · `wf.SalesOrder` |
| Incentive & Retained | `wf.RebateClaim` |
| Budget Expenditure | `wf.BudgetPlan` · `wf.GiveawayBudget` |

**หน้าที่ถูกซ่อน** — `ScaleReportsPage` (อ่าน MySQL) ยังอยู่ในรีโปแต่ไม่ถูก import

---

## 8. `02-REQUIREMENTS/SRS` และ `01-BUSINESS-ANALYSIS/REQUIREMENTS-CATALOG`

**ความสามารถที่เพิ่มและยังไม่อยู่ในขอบเขต**

| ความสามารถ | รุ่น |
|---|---|
| จัดเที่ยวรถ (Sale Trip) | 1.8.0 |
| สัดส่วนรีเบทลูกค้า/บริษัท + เคลมเอง | 1.8.0 |
| ส่งออก CSV/Excel ภาษาไทย | 1.8.0 |
| ใบจ่ายสินค้าสำหรับพิมพ์ | 1.8.0 |
| **ติดตามสถานะการชั่งจาก WINSpeed** | 1.9.0 |
| **โครงสร้างองค์กรและสายอนุมัติ** | 1.9.0 |
| **ผูกผู้ใช้กับตำแหน่ง** | 1.9.0 |

---

## 9. `02-REQUIREMENTS/IMPLEMENTATION-STATUS`

หยุดที่ 4 ส.ค. 2569 · **สถานะจริง ณ 3 ก.ย. 2569**

| | |
|---|---|
| รุ่น | 1.9.0 |
| migration | 101 ไฟล์ · ตรงกันทั้ง 3 ฐาน |
| เทสต์ | 19/19 ผ่าน |
| typecheck | 0 error |
| deploy | ครบ 4 ปลายทาง |

---

## 10. `06-QUALITY-OPERATIONS/SOP-DETAIL` 🔴 เร่งด่วนที่สุด

**เอกสารนี้พนักงานใช้ทำงานจริง และตอนนี้บอกขั้นตอนที่ระบบปฏิเสธไปแล้ว**

### ให้ใช้ [`SOP-CURRENT.md`](../06-QUALITY-OPERATIONS/SOP-CURRENT.md) แทนทั้งฉบับ

จุดที่ต่างและสำคัญที่สุด:

| หัวข้อ | SOP-DETAIL (เดิม) | ของจริงตอนนี้ |
|---|---|---|
| ชั่งออก | ไม่ตรวจน้ำหนัก | 🔴 **บังคับต้องมี gross และ tare · สุทธิต้อง > 0** ไม่งั้นระบบปฏิเสธ |
| ตรวจซ้ำก่อนยืนยัน | ไม่มี | 🔴 **บังคับ** (FR-022) — ไม่กด "ตรวจแล้ว" จะยืนยันไม่ได้ |
| รีเบท | ตั้งตอน CONFIRMED | ตั้งตอน **SHIPPED** และเป็นของ **เจ้าของใบสั่งขาย** |
| รายงานการชั่ง | จาก MySQL | จาก **WINSpeed** — หน้า "สถานะการชั่งรถ" |
| SOP-09 · SOP-10 | ไม่มี | เพิ่มแล้ว — ติดตามการชั่ง · จัดเที่ยวรถ |

---

## 11. `04-DATA-INTEGRATION/DATA-QUALITY-AND-MIGRATION`

**เพิ่มกฎที่บังคับใช้จริงแล้ว**

1. `checksumPolicy=immutable-after-apply` — runner หยุดทั้งชุดเมื่อเจอ drift
2. **ห้ามมี `USE <database>`** — `assertNoDatabaseSwitch()` ดักไว้
   migration 074 เคยมีบรรทัดนี้ฝังอยู่และเขียนผิดฐาน
   **อาการที่บอกใบ้คือชื่อ constraint ใน error ไม่ตรงกับ constraint บนตารางที่คิวรี** = คนละฐาน
3. ฐานเป้าหมายอ่านจาก `SELECT DB_NAME()`
4. รันด้วย `DB_MODE` เท่านั้น

---

## 12. `03-SOLUTION-ARCHITECTURE/C4-ARCHITECTURE` และ `SAD`

**เพิ่ม** — โมดูลชั่งของ WINSpeed (`WGHD`/`WGDT`/`WGDTReport`) เป็นแหล่งข้อมูลขาเข้า **อ่านอย่างเดียว**
**เอาออก** — MySQL `db_truckscale` และ worker ที่ซิงค์
**เพิ่ม** — PROD-B (Hostinger) เป็นปลายทางที่สอง

---

## 13. `06-QUALITY-OPERATIONS/TEST-CASES-DETAIL` และ `TEST-CATALOG-CURRENT`

**เทสต์ที่มีจริงตอนนี้ — 19 เคส ผ่านทั้งหมด**

| กลุ่ม | เคส |
|---|---|
| ตัวกันเขียนฐานเครื่องชั่ง | 9 |
| guard ของ migration runner | ตรวจ `USE` และการสลับฐาน |
| การคำนวณรายงาน | — |

**เพิ่มการตรวจที่ไม่ใช่ unit test** — `tsc -b` ต้อง 0 error · migration ทั้ง 3 ฐานต้องเลขเท่ากัน
รายละเอียดใน [`END-TO-END-GUIDE.md`](../END-TO-END-GUIDE.md) §6

---

## 14. `06-QUALITY-OPERATIONS/USER-MANUAL-CURRENT`

**เมนูที่เปลี่ยน**

| เดิม | ตอนนี้ |
|---|---|
| "รายงานเครื่องชั่ง" (อ่าน MySQL) | **"สถานะการชั่งรถ"** (อ่าน WINSpeed · 8 แท็บ · รีเฟรชทุก 1 นาที) |
| — | 🆕 **"ผังองค์กร"** ใต้ ตั้งค่าระบบ |

คู่มือรายหน้าจอฉบับปัจจุบันอยู่ใน [`END-TO-END-GUIDE.md`](../END-TO-END-GUIDE.md) §9

---

## เอกสารใหม่ที่ออกพร้อมส่วนต่างนี้

| เอกสาร | เนื้อหา |
|---|---|
| [`END-TO-END-GUIDE.md`](../END-TO-END-GUIDE.md) | วิเคราะห์ → ออกแบบ → ติดตั้ง → ทดสอบ → deploy พร้อมผลจริง |
| [`CONTEXT-PACK.md`](../CONTEXT-PACK.md) | อ่านแผ่นเดียวเริ่มงานต่อได้ (แทน `V1.7.0-CONTEXT-PACK.md`) |
| [`WF-SCHEMA-AND-ERD.md`](../04-DATA-INTEGRATION/WF-SCHEMA-AND-ERD.md) | 60 ตาราง · 62 FK · ERD |
| [`CREDENTIALS-AND-SECRETS.md`](../05-SECURITY-DEVOPS/CREDENTIALS-AND-SECRETS.md) | ความลับอยู่ที่ไหน (ไม่มีค่าจริงในเอกสาร) |
| [`SOP-CURRENT.md`](../06-QUALITY-OPERATIONS/SOP-CURRENT.md) | SOP ฉบับใช้งานจริง |
| [`DOCUMENT-FLOW-TRACEABLE.md`](DOCUMENT-FLOW-TRACEABLE.md) | สายเอกสารที่สืบย้อนได้ |
