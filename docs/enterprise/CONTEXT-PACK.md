---
documentId: "WF-CTX-001"
title: "Context Pack — อ่านแผ่นเดียวแล้วเริ่มงานต่อได้ (v1.9.0)"
version: "v1.9.0"
status: Draft
statusDetail: "จัดทำ 3 กันยายน 2569 · แทน V1.7.0-CONTEXT-PACK.md · ตัวเลขทุกตัววัดจากเครื่องจริงวันเดียวกัน"
owner: "Solution Architect"
normative: true
---

# Context Pack — v1.9.0

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
| 4 | **ห้ามเขียน `dbo.WGHD` / `WGDT` / `WGDTReport`** — อ่านอย่างเดียว เครื่องชั่งเป็นเจ้าของ |
| 5 | **repo เป็นสาธารณะ** — ห้ามมีชื่อพนักงาน · ความลับ · IP ส่วนบุคคล ในไฟล์ใด |
| 6 | **deploy production ต้องได้รับอนุญาตทุกครั้ง** — ไม่มีการอนุมัติล่วงหน้าแบบถาวร |

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

## 4. สถานะ ณ 3 ก.ย. 2569

| | |
|---|---|
| รุ่น | **1.9.0** · commit `main` |
| migration | **101 ไฟล์** · ตรงกันทั้ง 3 ฐาน (`unchanged: 101; pending: 0; drift: 0`) |
| เทสต์ | **19/19 ผ่าน** |
| typecheck | **0 error** · `npm run build` = `tsc -b && vite build` |
| MySQL TruckScale | 🔴 **ยกเลิกทั้งหมด** · `/api/health` ต้องขึ้น `mysql: "disabled"` |
| แหล่งข้อมูลการชั่ง | `dbo.WGHD` / `WGDT` / `WGDTReport` — **อ่านอย่างเดียว** |
| `wf` schema | 60 ตาราง · 62 FK · 24 view · 6 procedure |

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
| 1 | **ผูกผู้ใช้ 42 คนเข้ากับตำแหน่ง** | 📌 หน้าจอพร้อมแล้ว — งานของเจ้าของระบบ |
| 2 | **ย้ายผู้ใช้ไปเขตการขายใหม่** | 📌 `SaleRegion` มีทั้งชุดเก่า (01–06) และใหม่ (10–16) |
| 3 | **ซิงค์ข้อมูล PROD-A → PROD-B / SSH key Azure** | 🛑 **PENDING & HOLD** — อาจใช้ private network + VPN แทน |
| 4 | ให้ปุ่มชั่งออกดึงน้ำหนักจาก `WGHD` อัตโนมัติ | 🟡 เสนอไว้ ยังไม่ทำ |
| 5 | `WGDT.CouponNo` ว่างทั้ง 311 บรรทัด | 🟡 รอข้อมูลจริงจากโรงงาน |

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
