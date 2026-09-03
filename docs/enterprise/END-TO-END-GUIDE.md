---
documentId: "WF-GUIDE-001"
title: "คู่มือฉบับสมบูรณ์ — วิเคราะห์ · ออกแบบ · ติดตั้ง · ทดสอบ · Deploy (v1.9.0)"
version: "v1.0"
status: Draft
statusDetail: "จัดทำ 3 กันยายน 2569 · ทุกตัวเลขและผลทดสอบรันจริงบนเครื่องจริงวันเดียวกัน"
owner: "Solution Architect"
normative: true
---

# คู่มือฉบับสมบูรณ์ — WS-Sale-App v1.9.0

> **เอกสารนี้เขียนให้คนสองกลุ่ม**
> **ผู้ใช้งาน** — อ่าน §1, §8, §9 (ข้ามส่วนเทคนิคได้)
> **นักพัฒนาที่เพิ่งเข้าทีม** — อ่านตามลำดับตั้งแต่ §2 และ **อย่าข้าม §10** ซึ่งเป็นกับดักที่เคยทำให้เสียเวลาไปแล้วจริง

---

## สารบัญ

| § | หัวข้อ | สำหรับ |
|---|---|---|
| 1 | ระบบนี้คืออะไร ตอบปัญหาอะไร | ทุกคน |
| 2 | สถาปัตยกรรม — ชิ้นส่วนและที่อยู่ | นักพัฒนา |
| 3 | ขั้นวิเคราะห์ — ข้อจำกัดที่กำหนดทุกอย่าง | นักพัฒนา |
| 4 | ขั้นออกแบบ — ตัดสินใจอะไรไว้บ้าง เพราะอะไร | นักพัฒนา |
| 5 | ขั้นติดตั้งเครื่องนักพัฒนา | นักพัฒนา |
| 6 | ขั้นทดสอบ — วิธีและผลจริง | นักพัฒนา · QA |
| 7 | ขั้น Deploy — 4 ปลายทาง | นักพัฒนา · IT |
| 8 | Flow การทำงานประจำวัน (หลังเลิกใช้ MySQL) | **ผู้ใช้งาน** |
| 9 | คู่มือรายหน้าจอ | **ผู้ใช้งาน** |
| 10 | กับดัก 10 ข้อที่เคยทำให้เสียเวลาจริง | นักพัฒนา |
| 11 | ตรวจรับ — รายการที่ต้องผ่านทั้งหมด | ทุกคน |

---

## 1. ระบบนี้คืออะไร

World Fert ใช้ **Prosoft WINSpeed 9.0** เป็นระบบ ERP หลัก — ขาย สต็อก บัญชี ครบ
แต่หน้าจอ WINSpeed เป็นโปรแกรม Windows ที่ต้องติดตั้งบนเครื่อง ใช้จากนอกโรงงานไม่ได้
และงานบางอย่าง (รีเบท ของแถม ตั๋วคุม การควบคุมเอกสาร) **ไม่มีที่เก็บใน WINSpeed เลย**

**WS-Sale-App คือชั้นที่คร่อมอยู่บน WINSpeed** ไม่ใช่ระบบที่มาแทน

```mermaid
flowchart TD
    U["ผู้ใช้ — เบราว์เซอร์ / มือถือ"]
    APP["WS-Sale-App<br/>schema wf"]
    WS[("WINSpeed<br/>schema dbo — ของเดิม")]
    SCALE["เครื่องชั่ง<br/>dbo.WGHD / WGDT"]
    U --> APP
    APP -->|"เขียนเฉพาะจุดที่อนุมัติ"| WS
    APP -->|"อ่านอย่างเดียว"| SCALE
    WS -.->|"เจ้าหน้าที่ใช้หน้าจอเดิมต่อไป"| WS
```

**กติกาข้อแรกที่กำหนดทุกอย่างที่เหลือ**

> **`dbo` เป็นของ WINSpeed — เขียนได้เฉพาะจุดที่ได้รับอนุมัติไว้เป็นรายการ**
> เพราะถ้าเราแก้โครงสร้าง `dbo` แล้ว WINSpeed อัปเดตรุ่น ระบบจะพังทั้งโรงงาน
> และเราจะไม่มีทางรู้ว่าพังเพราะอะไร

---

## 2. สถาปัตยกรรม

### 2.1 ชิ้นส่วน

| ชิ้น | เทคโนโลยี | หน้าที่ |
|---|---|---|
| Frontend | React + TypeScript + Vite + Tailwind | หน้าจอทั้งหมด |
| Backend | Node.js + Express | API · กติกาธุรกิจ · ด่านตรวจ |
| ฐานข้อมูล | SQL Server (`dbwins_worldfert9`) | `dbo` = WINSpeed · `wf` = ของเรา |
| ~~MySQL~~ | ~~`db_truckscale`~~ | 🔴 **ยกเลิกทั้งหมด 3 ก.ย. 2569** |

### 2.2 สภาพแวดล้อมทั้งหมด

| ชื่อ | Frontend | Backend | ฐานข้อมูล | บทบาท |
|---|---|---|---|---|
| **DEV** | Vite `:5173` | `:3000` | เลือกได้ด้วย `DB_MODE` | เครื่องนักพัฒนา |
| **UAT** | — | บน VPS | `dbwins_worldfert9_test` @ Hostinger | ทดสอบ |
| **PROD-A** | Vercel | Railway | **Azure** `20.255.185.14` | 🟢 **ใช้งานจริง** |
| **PROD-B** | Hostinger | Hostinger | **Hostinger** `76.13.190.104` | 🟡 **สำรอง — ยังไม่มีคนใช้** |

> PROD-A deploy **อัตโนมัติ** เมื่อ push ขึ้น `main` (Railway/Vercel ผูก Git ไว้)
> PROD-B **ต้อง deploy มือ** — `/opt/worldfert/app` ไม่ใช่ git repo

### 2.3 ที่เก็บความลับ

ดู [`CREDENTIALS-AND-SECRETS.md`](05-SECURITY-DEVOPS/CREDENTIALS-AND-SECRETS.md) — สรุปสั้น:
รหัสผู้ใช้เป็น **bcrypt cost 12** ใน `wf.AppUser.PasswordHash` · ความลับอื่นอยู่ใน `.env` และ
`.local-secrets/` ซึ่ง **ไม่มีอะไรอยู่ใน git เลย** (ตรวจแล้ว)

---

## 3. ขั้นวิเคราะห์ — ข้อจำกัดที่กำหนดทุกอย่าง

ก่อนเขียนโค้ดบรรทัดแรก ต้องเข้าใจ 6 ข้อนี้ ไม่งั้นจะออกแบบผิดตั้งแต่ต้น

### 3.1 `dbo` แก้ไม่ได้

เจ้าของระบบสั่งไว้ตรง ๆ:

> *"เราจะไม่แก้อะไรใน dbo schema ครับ ฉะนั้น ต้องปรับ App ให้ทำงานร่วมกับ dbo ให้ถูกต้อง
> หากจะเป็น สามารถเพิ่ม wf schema มาช่วยดำเนินการร่วมเพื่อให้ app ทำงานได้ถูกต้อง"*

ผลคือทุกอย่างที่เราต้องเก็บเพิ่มต้องไปอยู่ใน `wf` และต้องผูกกลับด้วยคีย์ของ WINSpeed

### 3.2 WINSpeed ไม่ได้ใช้ IDENTITY

`SOID` `CouponID` `audit_id` **มาจากบล็อกละ 1000 ต่อเครื่อง** ผ่าน `dbo.SMID`
ใช้ `MAX+1` จะไปนั่งทับบล็อกที่จองให้เครื่องอื่นไว้ แล้วชนกันภายหลัง

### 3.3 `DocuNo` ไม่ unique ข้าม `DocuType`

`K69-01039` เป็นทั้งใบสั่งจอง (103) และใบส่งขาย (104) — คนละใบ
**ทุก join ต้องระบุ `DocuType` เสมอ**

### 3.4 ข้อมูลหลัง 31 มี.ค. 2569 เชื่อไม่ได้

เจ้าของระบบแจ้งไว้ — ทุกคิวรีที่ใช้สรุปตัวเลขต้องกรอง `DocuDate < '2026-04-01'`

### 3.5 รีเบทลงบัญชีตอนรับชำระ ไม่ใช่ตอนออกใบ RB

ลงที่บัญชี `536201 ส่วนลด-รีเบท` ในใบรับชำระ 206
**ใบ RB ไม่ลง GL เลย** และไม่มีตัวนับเลขในระบบ

### 3.6 เครื่องชั่งไม่ได้ปิด SO ให้

ตรวจใบ SO ที่ชั่งครบทั้ง 11 ใบ — `SOHD` ยังเป็น `clearflag='N'` `CouponFlag='N'`
เหมือนใบที่ไม่เคยชั่ง **สิ่งที่ปิด SO จริงคือการตัดตั๋วปุ๋ย**

---

## 4. ขั้นออกแบบ — ตัดสินใจอะไรไว้ เพราะอะไร

| # | ตัดสินใจ | เหตุผล |
|---|---|---|
| D1 | เพิ่ม schema `wf` แทนการแก้ `dbo` | ข้อ 3.1 · WINSpeed อัปเดตรุ่นได้โดยไม่กระทบเรา |
| D2 | ไม่ทำ FK ข้ามไป `dbo` | FK จะล็อกตารางของ WINSpeed โดยไม่ตั้งใจ |
| D3 | แยก `SalesOrder` / `SalesOrderExt` | ก่อนยืนยันยังไม่มี `SOID` · PK ที่ว่างได้ครึ่งชีวิตทำ FK ไม่ได้ |
| D4 | ขอ id ผ่าน `usp_AllocateWinspeedId` | ข้อ 3.2 |
| D5 | เขียนรอยลง `dbo.SMAudit` screen `9900000xx` | ผู้ตรวจ ISO ต้องเห็นว่าเอกสารที่โผล่ใน WINSpeed มาจากไหน · ช่วงเลขนี้ WINSpeed ไม่ได้ใช้ |
| D6 | เดินตัวนับ `dbo.EMRunBrch` ตามหลังออกเลข | ไม่งั้นหน้าจอ WINSpeed เสนอเลขที่ถูกใช้ไปแล้ว |
| D7 | ตั้งรีเบทตอน `SHIPPED` ไม่ใช่ `CONFIRMED` | ของออกจากโรงงานจริงแล้วค่อยตั้งยอด |
| D8 | รีเบทเป็นของ `SalesUserId` | เคยผิดจนยอดไปเข้ากระเป๋าเจ้าหน้าที่เครื่องชั่ง |
| D9 | **อ่านการชั่งจาก `dbo.WGHD` อย่างเดียว ไม่เขียน** | เครื่องชั่งเป็นเจ้าของข้อมูล · มีปุ่มเขียนเมื่อไรจะได้แหล่งความจริงสองแหล่ง |
| D10 | **ยกเลิก MySQL ทั้งชั้นด้วยสวิตช์เดียว ไม่ลบไฟล์** | ถอยกลับได้ใน 2 บรรทัด |
| D11 | หน้าผังองค์กรไม่แก้ `Role` ให้เอง | เปลี่ยนบทบาท = เปลี่ยนสิทธิ์เข้าถึง ต้องเป็นการตัดสินใจของคน |

---

## 5. ขั้นติดตั้งเครื่องนักพัฒนา

### 5.1 ต้องมีอะไรก่อน

Node.js 22+ · SQL Server (หรือสิทธิ์เข้าถึงเครื่องระยะไกล) · Git

### 5.2 ขั้นตอน

```bash
git clone https://github.com/thirayume/winspeed-connect.git
cd winspeed-connect

# backend
cd backend
npm install
cp .env.example .env      # แล้วเติมค่าจริง — ดู CREDENTIALS-AND-SECRETS.md §4

# frontend
cd ../WSSale-App
npm install
cp .env.example .env.local
```

### 5.3 เตรียมฐานข้อมูล — **ลำดับนี้ห้ามสลับ**

```
1. RESTORE ฐานข้อมูลจาก .bak
2. สร้าง logins/users (wf_reader, wf_owner)   ← ห้ามข้าม
3. node run_migrations.js
4. node seed_admin.js
```

> 🔴 **ข้อ 2 ห้ามข้าม** — `RESTORE` ลบ database user ทิ้งทุกครั้ง
> migration 002 จะล้มด้วย `Cannot find the user 'wf_reader'` ถ้าไม่มี user มาก่อน

บน VPS มีสคริปต์ทำให้ครบแล้ว: `restore-mssql.sh` → `finalize-mssql.sh`

### 5.4 รัน

```bash
cd backend && npm start        # :3000
cd WSSale-App && npm run dev   # :5173
```

ตรวจว่าขึ้นจริง:

```bash
curl -s http://localhost:3000/api/health
```

ต้องได้ `"version":"1.9.0"` · `"sqlserver":"up"` · **`"mysql":"disabled"`** · `"weighing":"winspeed:WGHD"`

---

## 6. ขั้นทดสอบ — วิธีและผลจริง

### 6.1 เทสต์อัตโนมัติ

```bash
cd backend && node --test
```

**ผลจริง 3 ก.ย. 2569 — `# tests 19 · # pass 19 · # fail 0`**

ครอบคลุมอะไร: ตัวกันเขียนฐานเครื่องชั่ง 9 เคส · guard ของ migration runner · การคำนวณรายงาน

### 6.2 Typecheck และ build

```bash
cd WSSale-App && npm run build     # = tsc -b && vite build
```

**ผลจริง — `tsc -b --force` รายงาน 0 error · build ผ่าน**

> 🔴 **`npx tsc --noEmit` ไม่ได้ตรวจอะไรเลย**
> `tsconfig.json` ตั้ง `"files": []` กับ project references — คำสั่งนั้นตรวจศูนย์ไฟล์แล้วผ่านเงียบ ๆ
> ต้องใช้ `tsc -b` เท่านั้น · ก่อน 3 ก.ย. 2569 มี ~70 error สะสมเพราะเรื่องนี้

### 6.3 ตรวจสถานะฐานข้อมูลทั้ง 3 เครื่อง

```bash
cd backend
for M in local remote remote_b; do
  printf "%-9s " "$M"; DB_MODE=$M node run_migrations.js --plan | grep "unchanged:"
done
```

**ผลจริง**

```
local       unchanged: 101; pending: 0; drift: 0
remote      unchanged: 101; pending: 0; drift: 0
remote_b    unchanged: 101; pending: 0; drift: 0
```

### 6.4 ตรวจ API บนของจริง

| เส้นทาง | ต้องได้ | ความหมาย |
|---|---|---|
| `/api/weighing/live` · `/coverage` · `/anomalies` | **401** | มีเส้นทาง และบังคับ auth ถูกต้อง |
| `/api/auth/org-positions` | **401** | เหมือนกัน |
| `/api/scale-reports/*` | **404** | เส้นทาง MySQL ปิดสำเร็จ |
| `/api/truckscale/*` | **404** | เหมือนกัน |

**ผลจริง — ตรงทั้งหมดทั้ง PROD-A และ PROD-B**

### 6.5 ตรวจความครบถ้วนของสายเอกสาร

ใบส่งขาย 3,638 ใบ ช่วง 1 ต.ค. 2568 – 31 มี.ค. 2569

| ขั้น | เชื่อมติด | อัตรา |
|---|---|---|
| มีใบสั่งจอง 103 | 3,593 | 98.76 % |
| ออกตั๋วปุ๋ยแล้ว | 3,638 | **100 %** |
| ตัดตั๋วแล้ว | 3,612 | 99.29 % |
| มีบันทึกลูกหนี้ 202 | 3,638 | **100 %** |
| มีใบกำกับภาษี 107 | 3,612 | 99.29 % |
| รับชำระแล้ว 206 | 3,454 | 94.94 % |

วิธีตรวจซ้ำอยู่ใน [`DOCUMENT-FLOW-TRACEABLE.md`](08-APPENDICES/DOCUMENT-FLOW-TRACEABLE.md) §7

### 6.6 ทดสอบด้วยมือบนหน้าจอจริง

**ตัวอย่างที่ทำจริง 3 ก.ย. 2569 — หน้าผังองค์กร บน PROD-B**

| ขั้น | ผล |
|---|---|
| เปิดหน้า | แถบนับขึ้น `0/42` · 43 ตำแหน่งว่าง |
| ผูกตำแหน่งให้ 1 คน | ตัวเลขขยับเป็น `1/42` ทันที |
| ตรวจผู้อนุมัติ | ขึ้น `ผู้ช่วยกรรมการผู้จัดการ ฝ่ายการตลาด` — ไต่สายถูกต้อง |
| ตรวจการเตือน | บทบาท `C_LEVEL` vs ตำแหน่งกำหนด `APPROVER` → แถบแดงขึ้นเอง |
| ถอดกลับ | ยืนยัน **ทั้ง PROD-A และ PROD-B กลับเป็น 0** ไม่มีข้อมูลทดสอบค้าง |

> **หลักการทดสอบบนระบบจริง** — ทดสอบได้ แต่ต้องถอดกลับและ**ยืนยันด้วยคิวรีว่าถอดจริง**
> ไม่ใช่แค่เชื่อว่าหน้าจอกลับไปแล้ว

---

## 7. ขั้น Deploy

### 7.1 PROD-A — อัตโนมัติ

```bash
git push origin main
```

Railway และ Vercel ผูก Git ไว้ · deploy เองภายในไม่กี่นาที

**ตรวจ**

```bash
curl -s https://winspeed-connect-backend.up.railway.app/api/health
```

### 7.2 PROD-B — ทำมือ

```bash
cd WSSale-App && npm run build && cd ..

tar -czf /tmp/worldfert-release.tgz \
  --exclude=node_modules --exclude=.git --exclude=deliverables --exclude=backup \
  --exclude=backend/.env --exclude='backend/.env.*' \
  --exclude=WSSale-App/.env --exclude='WSSale-App/.env.*' \
  --exclude=deploy/cloud-vps/.env --exclude=deploy/cloud-vps/.local-secrets \
  --exclude=remote-config.bat --exclude=server-config.env \
  backend WSSale-App deploy
```

**ตรวจ archive ก่อนส่งเสมอ** — ต้องเจอแต่ไฟล์ `.example`

```bash
tar -tzf /tmp/worldfert-release.tgz | grep -iE "\.env$|local-secrets|\.pem$|\.key$"
```

```bash
K=deploy/cloud-vps/.local-secrets/worldfert-hostinger-deploy
scp -i $K /tmp/worldfert-release.tgz root@76.13.190.104:/tmp/

ssh -i $K root@76.13.190.104 '
  tar -xzf /tmp/worldfert-release.tgz -C /opt/worldfert/app
  chown -R root:root /opt/worldfert/app
  chmod 600 /opt/worldfert/app/deploy/cloud-vps/.env
  rm -f /tmp/worldfert-release.tgz
  chmod +x /opt/worldfert/app/deploy/cloud-vps/server/*.sh
  /opt/worldfert/app/deploy/cloud-vps/server/deploy-release.sh /opt/worldfert/app'
```

ต้องจบด้วย **`HEALTH CHECK OK`** แล้ว **`DEPLOY OK`**

> **ไม่แตะ `.env` บนเครื่อง** — ใช้เส้นทางปกติที่รักษาไฟล์เดิม
> **Downtime ~20 วินาที** เฉพาะ `wf-backend` และ `wf-frontend` · ฐานข้อมูลไม่ถูกแตะ
> ถ้าแก้แต่ frontend คอนเทนเนอร์ backend จะไม่ถูกสร้างใหม่เลย

### 7.3 ตรวจหลัง deploy ทั้งสองฝั่ง

```bash
for U in https://winspeed-connect-backend.up.railway.app/api https://api.thirayu.online/api; do
  curl -s $U/health | grep -oE '"version":"[^"]+"|"mysql":"[^"]+"'
done
```

---

## 8. Flow การทำงานประจำวัน (สำหรับผู้ใช้งาน)

**นี่คือสิ่งที่เปลี่ยนไปหลังเลิกใช้ MySQL เมื่อ 3 ก.ย. 2569**

```mermaid
flowchart TD
    S1["1 · พนักงานขายสร้างใบสั่งขาย<br/>หน้า ขาย (POS)"]
    S2["2 · Counter-Sales กด ตรวจแล้ว"]
    S3["3 · กดยืนยัน<br/>→ เกิดใบสั่งจอง 103 ใน WINSpeed"]
    S4["4 · ผู้มีอำนาจอนุมัติ<br/>ในหน้าจอ WINSpeed → ได้เลข AIyy"]
    S5["5 · เจ้าหน้าที่เปิดใบส่งขาย 104<br/>+ กด Calculate แท็บ Coupon"]
    S6["6 · รถมาถึง เครื่องชั่งลงทะเบียน<br/>WGHD สถานะ 1"]
    S7["7 · ชั่งเข้า → สถานะ 2"]
    S8["8 · โหลดสินค้า · ตัดตั๋วปุ๋ย"]
    S9["9 · ชั่งออก → สถานะ 3<br/>= ส่งของแล้ว"]
    S10["10 · ออกใบกำกับ 107 · รับชำระ 206"]
    S1 --> S2 --> S3 --> S4 --> S5 --> S6 --> S7 --> S8 --> S9 --> S10
```

### 8.1 อะไรเปลี่ยนไปบ้าง

| เดิม | ตอนนี้ |
|---|---|
| ดูผลชั่งจากรายงานที่อ่าน MySQL ของ TruckScale | **หน้า "สถานะการชั่งรถ" อ่านจาก WINSpeed โดยตรง** |
| แอปเขียนใบชั่งกลับเข้า MySQL | **ไม่เขียนแล้ว** — เครื่องชั่งเป็นเจ้าของข้อมูลฝ่ายเดียว |
| ต้องรอ sync | **รีเฟรชเองทุก 1 นาที** |

### 8.2 ⚠ สิ่งที่ผู้ใช้ต้องรู้

1. **ข้อมูลในตารางชั่งยังเป็นชุดทดสอบ** — 181 ใบ ได้น้ำหนักสุทธิจริงเพียง 5 ใบ
   ชั่งออกครั้งล่าสุด 26 พ.ค. 2569 · **ยังใช้ตัดสินใจไม่ได้**
2. **สถานะ 3 ไม่ได้ปิด SO ใน WINSpeed** — เป็นการตีความของแอป
   สิ่งที่ปิด SO จริงคือการตัดตั๋วปุ๋ย
3. **ทิศทางน้ำหนักกลับกันระหว่างขายออกกับซื้อเข้า**

| ชนิด | รถขาเข้า | รถขาออก | น้ำหนักสินค้า |
|---|---|---|---|
| ขายออก (SO) | เปล่า | หนัก | ชั่งออก − ชั่งเข้า |
| ซื้อเข้า (PO) | หนัก | เปล่า | ชั่งเข้า − ชั่งออก |

หน่วยเป็นกิโลกรัม · **1 กระสอบ = 50 กก.**

---

## 9. คู่มือรายหน้าจอ

| เมนู | ใช้ทำอะไร | ใครเข้าได้ |
|---|---|---|
| **ขาย (POS)** | สร้างใบสั่งขาย · ยืนยัน | SALES · COUNTER_SALES · ADMIN · C_LEVEL |
| **เสนอราคา** | ใบเสนอราคา → แปลงเป็น SO | ทุกบทบาท |
| **คลัง** | รับสินค้า · จัดสินค้า · โหลด | WAREHOUSE · ADMIN · C_LEVEL |
| **Paper Trail** | ติดตามสำเนาเอกสาร 4 ชุด | ทุกบทบาท |
| **ตั๋วคงค้าง** | SO ค้าง · ค้นหา | ทุกบทบาท |
| **รีเบท (App)** | กระเป๋าเงิน · เคลม | C_LEVEL · ADMIN · MANAGER · ACCOUNTING · APPROVER · SALES |
| **Rebate Plan** | แผนจัดสรรงบ | C_LEVEL · ADMIN · MANAGER · APPROVER · ACCOUNTING |
| **CN Rebate** | ใบลดหนี้ | C_LEVEL · ACCOUNTING · ADMIN · MANAGER |
| **ของแถม** | งบรายภาค · เบิก | ทุกบทบาท |
| **บัญชี · กระทบยอด · รายงาน** | งานบัญชี | C_LEVEL · ACCOUNTING · ADMIN · MANAGER |
| 🆕 **สถานะการชั่งรถ** | คิวรถสด · ใบชั่ง · สรุป 8 แท็บ | + WAREHOUSE · WEIGHBRIDGE |
| **ชุดตั๋วคุม** | คงเหลือ · ตัดออก | ทุกบทบาท |
| **ข้อมูลหลัก** | สินค้า · ลูกค้า · ราคา | C_LEVEL · ADMIN |
| **นโยบายอนุมัติ** | อำนาจ · วงเงิน | C_LEVEL · ADMIN · MANAGER |
| **สถานะระบบ** | health · error · alert | C_LEVEL · ADMIN · MANAGER |
| **User Management** | ผู้ใช้งาน | ADMIN · MANAGER · ACCOUNTING |
| 🆕 **ผังองค์กร** | ผูกผู้ใช้ ↔ ตำแหน่ง | ADMIN · MANAGER · ACCOUNTING |

### 9.1 หน้า "สถานะการชั่งรถ"

| แท็บ | ตอบอะไร |
|---|---|
| **สถานะสด** (หน้าหลัก) | ตอนนี้มีรถกี่คันในลาน อยู่ขั้นไหน ผูกกับใบสั่งจองใบไหน |
| ผิดปกติ | ใบที่ตัวเลขขัดกันเอง — ต้องเคลียร์ก่อนเชื่อยอดรวม |
| ใบชั่ง · ตามวัน · ตามสินค้า · ตามคลัง · ตามลูกค้า · ตามใบสั่งขาย | สรุปย้อนหลัง |

**รีเฟรชเองทุก 1 นาที** · หยุดชั่วคราวได้ · ไม่ยิงคิวรีตอนแท็บเบราว์เซอร์ถูกซ่อน
**แท็บสถานะสดไม่มีช่องเลือกวันที่โดยตั้งใจ** — รถที่ค้างจากเมื่อวานต้องยังอยู่ในคิว

### 9.2 หน้า "ผังองค์กร"

ผูกผู้ใช้เข้ากับตำแหน่งใน `wf.OrgPosition` (43 ตำแหน่ง)
เลือกจาก dropdown แล้วบันทึกทันที · ระบบคำนวณผู้อนุมัติให้เอง

> **ระบบเตือนเมื่อบทบาทไม่ตรงกับตำแหน่ง แต่ไม่แก้ให้เอง**
> สิทธิ์จริงที่ระบบใช้ตรวจคือ **บทบาท** ไม่ใช่ตำแหน่ง — ถ้าต้องการแก้ให้ไปที่ User Management

---

## 10. กับดัก 10 ข้อที่เคยทำให้เสียเวลาจริง

| # | กับดัก | อาการ | ทางที่ถูก |
|---|---|---|---|
| 1 | **`DB_TARGET` ไม่ใช่สวิตช์ — ตัวจริงคือ `DB_MODE`** | ตั้ง `DB_TARGET=local` แล้ว migration ลง **production** เงียบ ๆ | อ่านบรรทัด `Migration preflight for <TARGET>` ก่อนเสมอ |
| 2 | **`tsc --noEmit` ตรวจศูนย์ไฟล์** | ผ่านเงียบ ๆ แต่ build จริงพัง | ใช้ `tsc -b` · ตอนนี้ต่อเข้า `npm run build` แล้ว |
| 3 | **กฎไฟร์วอลล์ hPanel ไม่มีผลจนกดปุ่ม Synchronize** | ตารางกฎถูกทุกอย่าง แต่ต่อไม่ติด | กด Synchronize · `allowlist.sh` (ufw) ไม่ใช่ตัวคุมบนเครื่องนี้ |
| 4 | **IP ผู้ดูแลเป็น dynamic** | โดนล็อกออกทั้งทีม (เกิดแล้ว 2 ครั้ง) | `curl https://api.ipify.org` ทุกครั้งก่อนสรุปว่าอะไรพัง |
| 5 | **`WGHD.DocuNo` ไม่ใช่ตัวเชื่อม** | join ได้ 117/141 แล้วสรุปผิด | ใช้ `SPID = SOHD.SOID` (100 %) |
| 6 | **`WGHD.Status` กลับมาเป็นสตริง** | เทียบ `=== 1` แล้วตกไป unknown ทั้ง 166 แถว | `Number(r.Status)` |
| 7 | **`GLDT.AccID` ไม่ใช่รหัสบัญชี** | อ่านผังบัญชีผิดทั้งรายงาน | join `dbo.EMAcc` เอา `AccCode` |
| 8 | **`SOInvHD.RefNo` เป็น NULL ทั้งคอลัมน์** | สรุปว่าใบกำกับไม่ผูกกับใบส่งขาย | ใช้ `SOInvHD.SONo` |
| 9 | **RESTORE ลบ schema `wf` และ database user** | migration 002 ล้ม | ลำดับ logins → migrate → seed_admin |
| 10 | **`PortalKey` ประกาศไว้สองที่** | เพิ่มหน้าใหม่แล้ว build พัง | แก้ทั้ง `App.tsx` และ `store/app-store.ts` |

**ข้อที่ 11 ที่ไม่ใช่เรื่องเทคนิค** — เคยมีการแก้ไฟล์ด้วย `replace` โดยไม่ตรวจว่าแก้ติดจริง
แล้วสตริงไม่ตรง จึงไม่ทำอะไรเลยแบบเงียบ ๆ · และเคยเชื่อว่า API รีสตาร์ทแล้วทั้งที่พอร์ตถูกจับอยู่
ตัวเก่าจึงเสิร์ฟต่อ **ทั้งสองกรณีคือการเชื่อว่าคำสั่งสำเร็จโดยไม่ตรวจผล**

---

## 11. ตรวจรับ

| # | ตรวจ | ค่าที่ต้องได้ |
|---|---|---|
| 1 | `node --test` (backend) | **19 pass · 0 fail** |
| 2 | `npm run build` (frontend) | ผ่าน · 0 type error |
| 3 | migration ทั้ง 3 เครื่อง | `unchanged: 101; pending: 0; drift: 0` เลขเท่ากัน |
| 4 | `/api/health` ทุกปลายทาง | `version 1.9.0` · `sqlserver: up` · **`mysql: disabled`** · `weighing: winspeed:WGHD` |
| 5 | `/api/weighing/*` · `/api/auth/org-positions` | **401** |
| 6 | `/api/scale-reports/*` · `/api/truckscale/*` | **404** |
| 7 | frontend bundle | มี `WeighingReportsPage` · `OrgAssignmentPage` · **ไม่มี `ScaleReportsPage`** |
| 8 | `check_triggers_raiserror.sql` | `0` |
| 9 | recovery model | `SIMPLE` |
| 10 | ไม่มีความลับใน git | `git ls-files \| grep -iE "\.env$\|local-secrets\|\.pem$"` → ว่าง |

---

## เอกสารที่ควรอ่านต่อ

| เอกสาร | เมื่อไร |
|---|---|
| [`DOCUMENT-FLOW-TRACEABLE.md`](08-APPENDICES/DOCUMENT-FLOW-TRACEABLE.md) | ต้องสืบย้อนเอกสารใบใดใบหนึ่ง |
| [`WF-SCHEMA-AND-ERD.md`](04-DATA-INTEGRATION/WF-SCHEMA-AND-ERD.md) | ต้องแก้หรือเพิ่มตาราง |
| [`CREDENTIALS-AND-SECRETS.md`](05-SECURITY-DEVOPS/CREDENTIALS-AND-SECRETS.md) | ต้องหาว่ารหัสอยู่ที่ไหน |
| [`SOP-CURRENT.md`](06-QUALITY-OPERATIONS/SOP-CURRENT.md) | ขั้นตอนปฏิบัติงานรายกระบวนการ |
| [`CONTEXT-PACK.md`](CONTEXT-PACK.md) | เริ่มงานใหม่ ต้องการภาพรวมเร็ว |
