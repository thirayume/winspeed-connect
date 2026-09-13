---
documentId: "WF-CTX-001"
title: "Context Pack — อ่านแผ่นเดียวแล้วเริ่มงานต่อได้ (v1.9.11)"
version: "v1.9.11"
status: Archived
statusDetail: "ปรับ 5 กันยายน 2569 · Single Source of Truth ฉบับสมบูรณ์ · ตัวเลขทุกตัววัดจากเครื่องจริง"
owner: "Solution Architect"
normative: false
---

> สถานะ: เอกสารย้อนหลัง/รอทบทวนรายหัวข้อ ณ 2026-09-06 — ไม่ใช่ข้อกำหนดปัจจุบัน โปรดเริ่มที่ [เอกสารกลาง](../README.md). เนื้อหาเดิมคงไว้เพื่อสืบย้อน; คำอ้าง Released/SSOT ภายในเป็นสถานะเดิม.


# Context Pack — v1.9.11

> **เอกสารนี้คือ Single Source of Truth (SSOT) ประจำโปรเจกต์**
> สำหรับให้ทีมงานและ AI เปิดอ่านเป็นอันดับแรกทุกครั้งที่เริ่มเซสชันใหม่
> รวบรวมข้อเท็จจริง สถาปัตยกรรม กฎเหล็ก และจุดเชื่อมต่อของรุ่นที่ Release ล่าสุด (**v1.9.11**)

---

## 1. ระบบคืออะไร — 5 บรรทัด

World Fert ใช้ **Prosoft WINSpeed 9.0** เป็น ERP หลัก
**WS-Sale-App** เป็นชั้นเว็บที่คร่อมอยู่บน WINSpeed ไม่ใช่ระบบที่มาแทน
ฐานข้อมูลเดียวกัน — `dbo` เป็นของ WINSpeed · `wf` เป็นของเรา
เพิ่มงานที่ WINSpeed ไม่มีที่เก็บ: รีเบท · ของแถม · ตั๋วคุม · Paper Trail · การชั่ง
รุ่นปัจจุบัน **1.9.11** (5 ก.ย. 2569)

---

## 2. กติกาเหล็ก 8 ข้อ — ผิดข้อใดข้อหนึ่งคือพังทั้งระบบ

| # | กติกา |
|---|---|
| 1 | **ห้าม `CREATE/ALTER/DROP` บน `dbo`** — เพิ่ม object ใหม่ให้ไปอยู่ใน `wf` เท่านั้น |
| 2 | **ห้าม `DELETE FROM dbo.SOHD`** ไม่ว่ากรณีใด |
| 3 | **แก้ schema ผ่าน migration ใหม่เท่านั้น** — `checksumPolicy=immutable-after-apply` · ห้ามมี `USE` ในไฟล์ |
| 4 | **การชั่งอ่านสดจาก `dbo.WGHD`/`WGDT`** — API `/api/weighing` เป็น Read-only 100% เชื่อมด้วย `SPID = SOHD.SOID` |
| 5 | **TruckScale ไม่ได้อ่าน `dbo.SOHD.OnHold`** — การ Hold ในแอปเป็นการแจ้งเตือนในระบบเท่านั้น การหยุดรถจริงต้องเป็นขั้นตอนทางกายภาพของคน |
| 6 | **repo เป็นสาธารณะ** — ห้ามมีชื่อพนักงานจริง · ความลับ · IP ส่วนบุคคล ในไฟล์ใด |
| 7 | **ห้ามอักขระไทยในไฟล์ `.bat`/`.cmd`** — cmd.exe ตีความเพี้ยนแล้วรันคำสั่งขยะ |
| 8 | **ห้าม `===` เทียบค่าที่มาจาก DB driver** — คืนชนิดไม่สม่ำเสมอ (`Number()` สำหรับ id, `String()` สำหรับ key) |

---

## 3. สภาพแวดล้อม — ปลายทางที่เปิดใช้

> 🔴 **5 ก.ย. 2569 — เจ้าของสั่งปิด Railway + Azure + Vercel ชั่วคราว**
> เหลือใช้งานจริงแค่ **Local · Docker (on-prem) · Hostinger (PROD-B)** จะแจ้งเมื่อพร้อมเปิดกลับ
> `npm run migrate` และ `npm run deploy` **ข้าม `remote` (Azure) ให้อัตโนมัติแล้ว**
> เปิดกลับ: ลบ `'remote'` ออกจาก `SUSPENDED_TARGETS` ใน `backend/scripts/migrate-targets.js` บรรทัดเดียว

| ชื่อ | ที่อยู่ | บทบาท | deploy |
|---|---|---|---|
| **DEV** | เครื่องตัวเอง `:5173` / `:3000` · `DB_MODE=local` | 🟢 ใช้งาน | — |
| **Docker (on-prem)** | `deploy/onprem/` · `up.ps1` / `up.sh` | 🟢 ใช้งาน | มือ (`up.ps1`) |
| **PROD-B (Hostinger)** | ทั้งกอง `76.13.190.104` | 🟢 **ใช้งานจริง** | GitHub Actions Runner (`prod-b-hostinger`) เมื่อ push `main` |
| ~~PROD-A~~ | ~~Vercel + Railway + Azure~~ | ⏸️ **ปิดชั่วคราว** | ข้ามอัตโนมัติ |
| UAT | `dbwins_worldfert9_test` @ Hostinger | 🟢 ทดสอบ | deploy v1.9.11 แล้ว |

> 🔴 **สวิตช์เลือกฐานคือ `DB_MODE` ไม่ใช่ `DB_TARGET`** — ค่าเริ่มต้น `local` (บนเครื่อง) / `remote` (บนโฮสต์)

---

## 4. สถานะ ณ 5 ก.ย. 2569 (v1.9.11)

| รายการ | ค่าปัจจุบัน |
|---|---|
| รุ่นแอป | **1.9.11** (ทั้ง Root, Backend, Frontend packages) |
| migration | **107 ไฟล์** · ล่าสุด `107_truck_hold_field_not_read.sql` (ตรงกัน local + remote_b) |
| เทสต์ | unit **8/8** · e2e Document Flow **19/19** ผ่านครบทั้ง local และ PROD-B |
| typecheck | **0 error** · `npm run build` = `tsc -b && vite build` |
| MySQL TruckScale | 🔴 **ลบออกจากระบบถาวรแล้ว** · migration 106 ลบ `wf.WeighInbox` และ settings ทิ้ง |
| แหล่งข้อมูลการชั่ง | `dbo.WGHD`/`WGDT`/`WGDTReport` — อ่านสดผ่าน `SPID = SOHD.SOID` (DocuType 103) |
| การแจ้งเตือน Hold | Hold ในแอปเท่านั้น (`wf.TruckHoldLog`) — เครื่องชั่งไม่อ่านฟิลด์นี้ |
| การตรวจเครดิต | แก้ไข bug `SUM()` over subquery ใน `backend/routes/so.js` ด้วย `OUTER APPLY` |
| ตำแหน่งผู้ใช้ | ผูกผู้ใช้ 41 คนกับตำแหน่งใน `wf.UserPosition` — สายอนุมัติเดินได้ 39 สาย |

---

## 5. สายเอกสาร — จำ 6 จุดเชื่อมนี้ให้ได้

| จาก | ไป | เชื่อมด้วย | อัตรา |
|---|---|---|---|
| `SOHD` 103 | `SOHD` 104 | **`DocuNo` เท่ากัน · `DocuType` ต่างกัน** | 98.76 % |
| `SOHD` 104 | `WFCoupon` | `WFCoupon.DocuID = SOHD.SOID` | 100 % |
| `WFCoupon` | `WFRedemtionHD` (116) | `WFRedemtionDT.CouponID` | 100 % |
| `SOHD` 104 | `SOInvHD` 202 | **`SOInvHD.SONo = SOHD.DocuNo`** | 100 % |
| `SOHD` 104 | `SOInvHD` 107 | **`SOInvHD.SONo = SOHD.DocuNo`** | 100 % |
| `SOInvHD` | `ARReceHD` 206 | `ARReceDT.SOInvID` | 100 % |
| `WGHD` | `SOHD` 103 | **`WGHD.SPID = SOHD.SOID`** | 100 % |

**กฎเล่ม** ใบส่งขาย I → ใบกำกับ **J** · K → **N** · บันทึกลูกหนี้ 202 ใช้เลขเดียวกับใบส่งขาย

---

## 6. กับดักที่เคยเสียเวลาไปแล้วจริง

| กับดัก | ทางที่ถูก |
|---|---|
| `DB_| 1 | ผูกผู้ใช้เข้ากับตำแหน่ง | 🟡 **41/41 ใช้งานแล้ว** · สายอนุมัติเดินได้ 39 (อีก 2 คือกรรมการบริหารที่อยู่บนสุด = ถูกต้อง) · 17 คนมาจากการสุ่มเพื่อเริ่มสายอนุมัติได้ — ต้องให้หัวหน้าฝ่ายขายยืนยันก่อนใช้ตัดสินใจจริง |
| 2 | ~~ทดสอบ Hold กับรถจริง~~ | ✅ **ปิดเคสแล้ว 5 ก.ย. 2569** — ทีม TruckScale ยืนยันว่า**ไม่ได้อ่าน** `dbo.SOHD.OnHold` · Hold = แจ้งเตือนในแอปเท่านั้น การหยุดรถจริงเป็นขั้นตอนของคน · `TRUCK_HOLD_VERIFIED` เลิกใช้ |
| 3 | สำรอง `.local-secrets` ออกนอกเครื่อง | 🟢 แก้สคริปต์ตรวจขนาดไฟล์ก่อนรายงานผล (แก้บั๊ก NTFS stream บน Win 11 24H2) แล้วนำสำเนาเก็บออฟไลน์ปลอดภัย |
| 4 | ~~UAT ค้างที่ v1.8.0 / unhealthy~~ | ✅ **ปิดเคสแล้ว 5 ก.ย. 2569** — แก้ไข healthcheck ที่เคยบังคับ `db.mysql` และ deploy ใหม่เป็น **v1.9.11** เรียบร้อยแล้ว |
| 5 | **ย้ายผู้ใช้ไปเขตการขายใหม่** | 📌 `SaleRegion` มีทั้งชุดเก่า (01–06) และใหม่ (10–16) |
| 6 | ซิงค์ PROD-A → PROD-B / SSH key Azure | 🛑 **PENDING & HOLD** — PROD-A ปิดชั่วคราว |
| 7 | `WGDT.CouponNo` ว่าง | 🟡 รอข้อมูลจริงจากโรงงาน |
| 8 | งานใหม่นอกแผนเดิม (Quotation ↔ SO · pricelist รายเดือน · rebate pool) | 🟡 แผนในอนาคต — ไม่ใช่เฟส 6 |

> **ที่ทำเสร็จแล้วใน v1.9.11** — เฟส 2/3/4/5/6 ของ Sale Trip · Master Settings เหตุผล ·
> กลไก Hold พร้อมข้อเท็จจริงเครื่องชั่ง · ลบ MySQL ทั้งหมด (รวม container บน PROD-B) · CI/CD self-hosted runner `prod-b-hostinger` บน VPS · แก้คำเตือนเครดิต `OUTER APPLY`
>
> **เฟส 6 = ทดสอบทั้งเส้น (Document Flow)**
> `backend/scripts/e2e-sale-trip-flow.js` ตรวจครบจุดตั้งแต่เที่ยวว่างจนชั่งออก **ผ่าน 19/19**
> รันก่อน deploy ทุกครั้ง: `DB_MODE=local node scripts/e2e-sale-trip-flow.js`�ต์อังกฤษล้วน · ตรวจ `grep -n '[^ -~]' file.bat` ต้องไม่เจออะไร |
| **driver คืนชนิดไม่สม่ำเสมอ** — `===` ทำด่านความปลอดภัยพังเงียบ | `Number()` เทียบ id · `String()` เป็นคีย์ Map |
| `query()` คืน array ส่วน `wfQuery()` คืน `.recordset` | ดูบรรทัด `require('../db')` ของไฟล์นั้นก่อนใช้ |
| `npm run deploy` ไม่ใช่คำสั่งตรวจสอบ (bump+push ถาวร) | ตรวจด้วย `npm run migrate:plan` |
| `tar` ที่ PROD-B ไม่ลบไฟล์ที่หายจากต้นทาง | แก้แล้วใน `03-remote-deploy.bat` (ล้าง src ก่อนแตก) |
| Vite เอา `api.ts` ไปไว้ใน chunk ชื่อ `jsx-runtime-*.js` | grep ให้ถูกไฟล์ตอนตรวจ bundle จริง |
| ฟีเจอร์ที่อ่านตารางภายนอกอาจเป็นหมันบน production | เช็คก่อนว่าตารางนั้น**มีข้อมูลจริง**ไหม (`WGHD` เคยเป็น 0 แถว) |
| **Caddy แยกเส้นทางด้วยโดเมน ไม่ใช่ path** | ตั้ง `APP_DOMAIN` + `API_DOMAIN` · ยิง `host/api/...` ตรง ๆ ไม่ถึง backend |
| พอร์ต 80/443 ถูก PID 4 (`http.sys`) จับบน Windows | ตั้ง `HTTP_PORT` / `HTTPS_PORT` เป็นพอร์ตอื่น |
| Git Bash แปลง path ใน `docker exec /opt/...` | นำหน้าด้วย `MSYS_NO_PATHCONV=1` |
| **`networkidle` ไม่มีวันเกิดกับ Vite dev server** (HMR เปิด websocket ค้าง) | อย่ารอ networkidle · เชื่อตัวชี้วัดการโหลดของแอปแทน |
| **"กำลังโหลด" เป็นคำศัพท์ของงาน** ไม่ใช่แค่ spinner — "กำลังโหลดสินค้า" = `WGHD.Status=2` | เครื่องมือที่ค้นคำนี้แบบ substring จะเข้าใจผิดตลอดกาล |
| `\.` ในสตริง JS กลายเป็นจุดธรรมดา = "อักษรใดก็ได้" | เขียน `\.` เมื่อ regex อยู่ในสตริง |
| **`SUM(x - (SELECT SUM(...)))` SQL Server ปฏิเสธ** | ดึงค่าออกมาด้วย `OUTER APPLY` ก่อนแล้วค่อย `SUM` |
| หน้า POS แสดง overlay เต็มจอ `z-[9999]` คลุมแถบเมนู | รอให้หน้าปัจจุบันนิ่งก่อนกดเมนูถัดไป |

---

## 7. คำสั่งที่ใช้บ่อย

```bash
# ตรวจสุขภาพทั้งระบบ
cd backend && node --test
cd WSSale-App && npm run build

# ตรวจฐานทั้ง 3 เครื่อง
cd backend
for M in local remote remote_b; do
  printf "%-9s " "$M"; DB_MODE=$M node run_migrations.js --plan | grep "unchanged:"
done

# ตรวจของจริง
curl -s https://winspeed-connect-backend.up.railway.app/api/health
curl -s https://api.thirayu.online/api/health

# IP ปัจจุบัน (ก่อนแตะไฟร์วอลล์)
curl -sS https://api.ipify.org
```

---

## 8. งานที่ค้างอยู่

| # | งาน | สถานะ |
|---|---|---|
| 1 | ผูกผู้ใช้เข้ากับตำแหน่ง | 🟡 **41/41 ใช้งานแล้ว** · สายอนุมัติเดินได้ 39 (อีก 2 คือกรรมการบริหารที่อยู่บนสุด = ถูกต้อง) · **แต่ 17 คนมาจากการสุ่ม** เจ้าของอนุมัติให้ใช้เป็นค่าตั้งต้น 5 ก.ย. 2569 — ต้องให้หัวหน้าฝ่ายขายยืนยันก่อนใช้ตัดสินใจจริง · ดู `C:\MyWork\WorldFert\org-mapping-บันทึกการผูกตำแหน่ง.csv` |
| 2 | ~~ทดสอบ Hold กับรถจริง~~ | ✅ **ปิดเคสแล้ว 5 ก.ย. 2569** — ทีม TruckScale ยืนยันว่า**ไม่ได้อ่าน** `dbo.SOHD.OnHold` · Hold = แจ้งเตือนในแอปเท่านั้น การหยุดรถจริงเป็นขั้นตอนของคน · `TRUCK_HOLD_VERIFIED` เลิกใช้ |
| 3 | **สำรอง `.local-secrets` ออกนอกเครื่อง** | 🔴 **ยังไม่มีสำเนาเลย** — ใช้ `windows/15-backup-secrets.bat` |
| 4 | **UAT (`wf-backend-test`) ค้างที่ v1.8.0** | 🔴 unhealthy มา 3 วัน · healthcheck ยังบังคับ `db.mysql==="up"` ซึ่งเป็นไปไม่ได้แล้ว · ตัวแอปเองปกติ (`ok:true`) — ต้อง deploy ใหม่หรือปิดถ้าไม่ใช้ |
| 5 | **ย้ายผู้ใช้ไปเขตการขายใหม่** | 📌 `SaleRegion` มีทั้งชุดเก่า (01–06) และใหม่ (10–16) |
| 6 | ซิงค์ PROD-A → PROD-B / SSH key Azure | 🛑 **PENDING & HOLD** — อาจใช้ private network + VPN แทน |
| 7 | `WGDT.CouponNo` ว่าง | 🟡 รอข้อมูลจริงจากโรงงาน |
| 8 | งานใหม่นอกแผนเดิม (Quotation ↔ SO · pricelist รายเดือน · rebate pool) | 🟡 ยังไม่เริ่ม — **ไม่ใช่เฟส 6** ตามที่เคยเขียนผิดไว้ |

> **ที่ทำเสร็จแล้วในรอบ 3–5 ก.ย.** — เฟส 2/3/4/5/**6** ของ Sale Trip · Master Settings เหตุผล ·
> กลไก Hold ถึง WINSpeed · ลบ MySQL ทั้งหมด (รวม container บน PROD-B) · seed ข้อมูลชั่งครบ 3 ฐาน
>
> **เฟส 6 = ทดสอบทั้งเส้น** (ไม่ใช่ Quotation/pricelist ตามที่เคยสรุปผิด)
> `backend/scripts/e2e-sale-trip-flow.js` ตรวจ 15 จุดตั้งแต่เที่ยวว่างจนชั่งออก **ผ่าน 15/15**
> รันก่อน deploy ทุกครั้ง: `DB_MODE=local node scripts/e2e-sale-trip-flow.js`

---

## 9. ข้อมูลการชั่งยังเชื่อไม่ได้ — ต้องรู้ก่อนใช้ตัวเลข

| | ค่า |
|---|---|
| ใบชั่งทั้งหมด | 181 (SO 141 · PO 32 · MO 4 · ไม่ระบุ 4) |
| แยกสถานะ | รอเข้าชั่ง 160 · ชั่งเข้าแล้ว 6 · ชั่งออกแล้ว 15 |
| **มีน้ำหนักสุทธิ > 0** | **5** |
| `CouponNo` ที่มีค่า | **0 จาก 311** |
| ชั่งออกครั้งล่าสุด | **26 พ.ค. 2569** |
| แถวที่ตัวเลขขัดกันเอง | **11** |

**สถานะ 3 ไม่ได้ปิด SO ใน WINSpeed** — ใบ SO ที่ชั่งครบทั้ง 11 ใบยังเป็น `clearflag='N'`
`CouponFlag='N'` เหมือนใบที่ไม่เคยชั่ง · "3 = SHIPPED" เป็นการตีความของแอป
สิ่งที่ปิด SO จริงคือ **การตัดตั๋วปุ๋ย** (`WFRedemtionHD` DocuType 116)

**ทิศทางน้ำหนักกลับกันตามชนิด** — SO: `ออก − เข้า` · PO: `เข้า − ออก` · 1 กระสอบ = 50 กก.

---

## 10. เอกสารทั้งชุด

| เอกสาร | เมื่อไร |
|---|---|
| [`END-TO-END-GUIDE.md`](END-TO-END-GUIDE.md) | ภาพรวมทั้งหมด วิเคราะห์ → deploy |
| [`08-APPENDICES/DOCUMENT-FLOW-TRACEABLE.md`](08-APPENDICES/DOCUMENT-FLOW-TRACEABLE.md) | สืบย้อนเอกสารใบใดใบหนึ่ง |
| [`04-DATA-INTEGRATION/WF-SCHEMA-AND-ERD.md`](04-DATA-INTEGRATION/WF-SCHEMA-AND-ERD.md) | แก้หรือเพิ่มตาราง |
| [`05-SECURITY-DEVOPS/CREDENTIALS-AND-SECRETS.md`](05-SECURITY-DEVOPS/CREDENTIALS-AND-SECRETS.md) | หารหัสผ่าน/ความลับ |
| [`06-QUALITY-OPERATIONS/SOP-CURRENT.md`](06-QUALITY-OPERATIONS/SOP-CURRENT.md) | ขั้นตอนปฏิบัติงาน |
| [`08-APPENDICES/CHANGELOG-APP.md`](08-APPENDICES/CHANGELOG-APP.md) | ประวัติรุ่น (ทะเบียนเดียว) |
| [`08-APPENDICES/CHANGES-v1.6.1-TO-v1.9.0.md`](08-APPENDICES/CHANGES-v1.6.1-TO-v1.9.0.md) | ส่วนต่างที่แก้เอกสารชุด v1.0 |
| [`08-APPENDICES/DOC-CURRENCY-AUDIT-2026-09-02.md`](08-APPENDICES/DOC-CURRENCY-AUDIT-2026-09-02.md) | เอกสารฉบับไหนยังเชื่อไม่ได้ |
| [`05-SECURITY-DEVOPS/SYNC-PROD-A-TO-PROD-B.md`](05-SECURITY-DEVOPS/SYNC-PROD-A-TO-PROD-B.md) | 🛑 HOLD |

> ⚠ **มีเอกสารสองชุดในรีโป** — `docs/docs/enterprise/` (ชุด v1.0 · 84 ฉบับ · หยุดที่ 18 ส.ค.)
> และ `docs/enterprise/` (ชุดทำงาน · ปัจจุบัน) · **ชุดทำงานคือชุดที่เชื่อได้**
> ดู `DOC-CURRENCY-AUDIT-2026-09-02.md` ว่าฉบับไหนในชุดเก่ายังผิดอยู่
