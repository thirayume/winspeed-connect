---
documentId: "WF-CTX-001"
title: "Context Pack — อ่านแผ่นเดียวแล้วเริ่มงานต่อได้ (v1.9.7)"
version: "v1.9.7"
status: Draft
statusDetail: "จัดทำ 3 กันยายน 2569 · แทน V1.7.0-CONTEXT-PACK.md · ตัวเลขทุกตัววัดจากเครื่องจริงวันเดียวกัน"
owner: "Solution Architect"
normative: true
---

# Context Pack — v1.9.7

> **เอกสารนี้มีไว้ให้เปิดเป็นอันดับแรกทุกครั้งที่เริ่มงานใหม่**
> ไม่ว่าจะเป็นคนหรือ AI · อ่านจบแล้วต้องรู้พอที่จะไม่ทำพลาดซ้ำรอยเดิม
> **แทนที่ `V1.7.0-CONTEXT-PACK.md` ซึ่งชื่อไม่ตรงรุ่นแล้ว**

---

## 1. ระบบคืออะไร — 5 บรรทัด

World Fert ใช้ **Prosoft WINSpeed 9.0** เป็น ERP หลัก
**WS-Sale-App** เป็นชั้นเว็บที่คร่อมอยู่บน WINSpeed ไม่ใช่ระบบที่มาแทน
ฐานข้อมูลเดียวกัน — `dbo` เป็นของ WINSpeed · `wf` เป็นของเรา
เพิ่มงานที่ WINSpeed ไม่มีที่เก็บ: รีเบท · ของแถม · ตั๋วคุม · Paper Trail · การชั่ง
รุ่นปัจจุบัน **1.9.0** (3 ก.ย. 2569)

---

## 2. กติกาเหล็ก 6 ข้อ — ผิดข้อใดข้อหนึ่งคือพังทั้งระบบ

| # | กติกา |
|---|---|
| 1 | **ห้าม `CREATE/ALTER/DROP` บน `dbo`** — เพิ่ม object ใหม่ให้ไปอยู่ใน `wf` |
| 2 | **ห้าม `DELETE FROM dbo.SOHD`** ไม่ว่ากรณีใด |
| 3 | **แก้ schema ผ่าน migration ใหม่เท่านั้น** — `checksumPolicy=immutable-after-apply` · ห้ามมี `USE` ในไฟล์ |
| 4 | `dbo.WGHD`/`WGDT`/`WGDTReport` **เขียนข้อมูลได้แล้ว** (04/09/2569) — แต่เครื่องชั่งยังเป็นเจ้าของ state machine 1→2→3 อย่าใส่ปุ่มให้ผู้ใช้เลื่อนสถานะเอง |
| 5 | **repo เป็นสาธารณะ** — ห้ามมีชื่อพนักงาน · ความลับ · IP ส่วนบุคคล ในไฟล์ใด |
| 6 | **deploy production ต้องได้รับอนุญาตทุกครั้ง** — ไม่มีการอนุมัติล่วงหน้าแบบถาวร |
| 7 | **ห้ามอักขระไทยในไฟล์ `.bat`/`.cmd`** — cmd.exe ตีความเพี้ยนแล้วรันคำสั่งขยะ เคยทำไฟล์หาย 19 ไฟล์ |
| 8 | **ห้าม `===` เทียบค่าที่มาจาก DB driver** — คืนชนิดไม่สม่ำเสมอ ด่านความปลอดภัยเคยพังเงียบ |

---

## 3. สภาพแวดล้อม — 4 ปลายทาง

| ชื่อ | ที่อยู่ | บทบาท | deploy |
|---|---|---|---|
| DEV | เครื่องตัวเอง `:5173` / `:3000` | พัฒนา | — |
| UAT | `dbwins_worldfert9_test` @ Hostinger | ทดสอบ | มือ |
| **PROD-A** | Vercel + Railway + **Azure** `20.255.185.14` | 🟢 **ใช้งานจริง** | **อัตโนมัติจาก `git push`** |
| **PROD-B** | Hostinger ทั้งกอง `76.13.190.104` | 🟡 **สำรอง ยังไม่มีคนใช้** | **มือ** (tar → scp → `deploy-release.sh`) |

> 🔴 **สวิตช์เลือกฐานคือ `DB_MODE` ไม่ใช่ `DB_TARGET`** — ค่าเริ่มต้น `remote` = **Azure production**
> `DB_TARGET` ถูกเพิกเฉยเงียบ ๆ · **อ่านบรรทัด `Migration preflight for <TARGET>` ก่อนปล่อยให้เดินต่อเสมอ**

---

## 4. สถานะ ณ 4 ก.ย. 2569

| | |
|---|---|
| รุ่น | **1.9.7** · ขึ้นครบ PROD-A และ PROD-B |
| migration | **105 ไฟล์** · ตรงกันทั้ง 3 ฐาน (`unchanged: 105; pending: 0; drift: 0`) |
| เทสต์ | **8/8 ผ่าน** (ชุดเดิม 19 ตัวมีเทส MySQL ที่ถูกลบไปพร้อมฟีเจอร์) |
| typecheck | **0 error** · `npm run build` = `tsc -b && vite build` |
| MySQL TruckScale | 🔴 **ลบออกจากระบบแล้ว** ไม่ใช่แค่ปิด · `/api/health` **ไม่มีคีย์ `mysql`** อีกต่อไป |
| แหล่งข้อมูลการชั่ง | `dbo.WGHD`/`WGDT`/`WGDTReport` — **อ่าน-เขียนได้** |
| ข้อมูลชั่ง | ทั้ง 3 ฐานมีชุดทดสอบ WGHD 6 · เที่ยว 3 (`UpdateBy='SEED-TEST'`) |
| `wf` schema | ลบ `WeighInbox` · เพิ่ม `EditReason`/`EditRequest`/`TruckHoldLog`/`CouponRedemptionRef` + view |

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
| `DB_TARGET` ไม่ทำงาน | ใช้ `DB_MODE` |
| `tsc --noEmit` ตรวจศูนย์ไฟล์ (`"files": []`) | ใช้ `tsc -b` |
| กฎไฟร์วอลล์ hPanel ต้องกด **Synchronize** ถึงมีผล | `allowlist.sh` (ufw) ไม่ใช่ตัวคุมบนเครื่องนี้ |
| IP ผู้ดูแลเป็น dynamic — โดนล็อกออกมาแล้ว 2 ครั้ง | `curl https://api.ipify.org` ก่อนสรุปว่าอะไรพัง |
| `DocuNo` ไม่ unique ข้าม `DocuType` | ใส่ `DocuType` ในทุก join |
| `SOInvHD.RefNo` NULL ทั้งคอลัมน์ | ใช้ `SONo` |
| `SOHD.RefSOID` NULL ทั้ง 60,038 ใบ | 103→104 เชื่อด้วย `DocuNo` |
| `WGHD.DocuNo` ตรง SOHD แค่ 117/141 | ใช้ `SPID` |
| `WGHD.Status` เป็นสตริง | `Number(r.Status)` |
| `GLDT.AccID` ไม่ใช่รหัสบัญชี | join `EMAcc` เอา `AccCode` |
| `SMID` ไม่ใช่ IDENTITY | ขอ id ผ่าน `usp_AllocateWinspeedId` |
| RESTORE ลบ `wf` + database user | ลำดับ **logins → migrate → seed_admin** |
| `PortalKey` ประกาศไว้ 2 ที่ | แก้ทั้ง `App.tsx` และ `store/app-store.ts` |
| ข้อมูลหลัง 31 มี.ค. 2569 เชื่อไม่ได้ | กรอง `DocuDate < '2026-04-01'` |
| **อักขระไทยในไฟล์ `.bat`** ทำ cmd.exe รันคำสั่งขยะ (ไฟล์หาย 19 ตัว) | คอมเมนต์อังกฤษล้วน · ตรวจ `grep -P '[-ÿ]'` ก่อนรัน |
| **driver คืนชนิดไม่สม่ำเสมอ** — `===` ทำด่านความปลอดภัยพังเงียบ | `Number()` เทียบ id · `String()` เป็นคีย์ Map |
| `query()` คืน array ส่วน `wfQuery()` คืน `.recordset` | ดูบรรทัด `require('../db')` ของไฟล์นั้นก่อนใช้ |
| `npm run deploy` ไม่ใช่คำสั่งตรวจสอบ (bump+push ถาวร) | ตรวจด้วย `npm run migrate:plan` |
| `tar` ที่ PROD-B ไม่ลบไฟล์ที่หายจากต้นทาง | แก้แล้วใน `03-remote-deploy.bat` (ล้าง src ก่อนแตก) |
| Vite เอา `api.ts` ไปไว้ใน chunk ชื่อ `jsx-runtime-*.js` | grep ให้ถูกไฟล์ตอนตรวจ bundle จริง |
| ฟีเจอร์ที่อ่านตารางภายนอกอาจเป็นหมันบน production | เช็คก่อนว่าตารางนั้น**มีข้อมูลจริง**ไหม (`WGHD` เคยเป็น 0 แถว) |

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
| 1 | **ผูกผู้ใช้เข้ากับตำแหน่ง (0/43)** | 📌 **งานของเจ้าของระบบ** — ระบบทำเองไม่ได้ ดู WF-REL-010 · หน้าจอมีตัวช่วยกรองเหลือ ~7.9 ตัวเลือก/คน |
| 2 | **ทดสอบ Hold กับรถจริง** | 📌 กลไกพร้อม สวิตช์ปิดอยู่ · ทดสอบแล้วตั้ง `TRUCK_HOLD_VERIFIED=true` |
| 3 | **สำรอง `.local-secrets` ออกนอกเครื่อง** | 🔴 **ยังไม่มีสำเนาเลย** — ใช้ `windows/15-backup-secrets.bat` |
| 4 | **ถอด `wf-mysql` container ออกจาก PROD-B** | 🟡 แอปไม่ใช้แล้ว แต่ container ยังรัน — เป็นการเปลี่ยน infra |
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
