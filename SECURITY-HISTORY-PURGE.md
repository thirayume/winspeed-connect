# ล้างข้อมูลอ่อนไหวออกจาก git history — คู่มือรันเอง

> จัดทำ 7 ส.ค. 2569 · คำสั่งเขียนประวัติใหม่ถูกระบบความปลอดภัยของผู้ช่วยบล็อก
> เจ้าของที่เก็บต้องรันเอง เพราะจบด้วย **force-push** ซึ่งกระทบทุกคนที่ clone ไปแล้ว
>
> **คัดลอกทีละบล็อก วางใน Terminal ตามลำดับ** · บล็อกไหนผลลัพธ์ไม่ตรงที่เขียนไว้ ให้หยุดแล้วถามก่อน

---

## สรุปก่อนเริ่ม

**ทำไปแล้ว — ไม่ต้องทำซ้ำ**

| | |
|---|---|
| ซอร์สปัจจุบันสะอาดแล้ว | push ขึ้น `origin/main` เรียบร้อย |
| ลบ `WSSale-App/src/mock/` ทั้งโฟลเดอร์ | ไม่มีโค้ดไหนอ่านไฟล์นี้เลย · ถอด `VITE_USE_MOCKUP_DATA` ที่ตายแล้วออกจาก 7 ไฟล์ config ด้วย |
| รหัสผ่านตั้งต้นออกจากซอร์ส 23 จุด | `seed_admin.js` สุ่มให้และพิมพ์ครั้งเดียวตอนติดตั้ง |
| สำรองประวัติทั้งหมด | ดูขั้นที่ 0 |

**ยังเหลือในประวัติ — คือสิ่งที่คู่มือนี้ล้าง**

| ข้อมูล | จำนวน commit ที่แตะ |
|---|---|
| รหัสผ่านตั้งต้น (admin ของทุก deployment) | **41** |
| ชื่อพนักงาน 10 คน | 3–20 ต่อคน |
| ชื่อลูกค้าจากใบรีเบท | 1 |
| `sample-data.json` — ชื่อลูกค้า 73 · เลขนิติบุคคล 7 · ชื่อบริษัท 48 · เลขใบกำกับ 57 | ทุก revision |

**ทำไมยังต้องล้าง** — การแก้ไฟล์ทำให้ `HEAD` สะอาด แต่ commit เก่ายังเก็บของเดิมครบ
ใครก็ตามที่ `git clone` ยังได้ประวัติทั้งหมดไป และ GitHub ยังเสิร์ฟ blob เก่าผ่าน URL ตรงได้

---

## ⚠️ ก่อนเริ่ม — สองอย่างที่ต้องทำก่อน

**1. แจ้งทีมและหยุด push ทุกคน**

การเขียนประวัติใหม่ทำให้ **SHA ของทุก commit เปลี่ยน** — ใครที่ยัง clone เดิมอยู่จะ push/pull ไม่ได้
ทุกคนต้อง clone ใหม่หลังทำเสร็จ (คำสั่งอยู่ท้ายเอกสาร) · **ห้ามใคร push ระหว่างทำ**

**2. ปิด branch protection ของ `main` บน GitHub ชั่วคราว** (ถ้าเปิดไว้)
`Settings → Branches → main → Edit` แล้วปิด *Require a pull request* / *Do not allow force pushes*

---

## ขั้นที่ 0 — สำรองไว้ก่อน (ทำแล้ว แต่ให้ย้ายที่เก็บ)

สำรองประวัติเดิมทั้งหมด (ทุก branch ทุก tag) ไว้แล้วที่โฟลเดอร์ชั่วคราวของเซสชัน
**ย้ายออกมาเก็บที่ปลอดภัยก่อน** เพราะโฟลเดอร์นั้นถูกล้างเมื่อไรก็ได้

```powershell
$src = "$env:LOCALAPPDATA\Temp\claude\C--MyWork-WorldFert\03dc0041-0676-4340-9ac4-9bb2b037c722\scratchpad\backup"
$dst = "D:\Backup\winspeed-connect-purge-20260807"
New-Item -ItemType Directory -Force $dst | Out-Null
Copy-Item "$src\*" $dst -Force
Get-ChildItem $dst
```

ต้องเห็น 3 ไฟล์ — `winspeed-connect-before-purge.bundle` (~17.5 MB) · `HEAD-before-purge.txt` · `replacements.txt`

ถ้าโฟลเดอร์ต้นทางหายไปแล้ว สร้าง bundle ใหม่จาก repo ปัจจุบันได้:

```powershell
cd C:\MyWork\WorldFert\winspeed-frontend
git bundle create "D:\Backup\winspeed-connect-before-purge.bundle" --all
```

---

## ขั้นที่ 1 — ทำในสำเนาใหม่ ไม่ใช่ของที่ทำงานอยู่

`git filter-repo` ออกแบบมาให้รันบน clone สด และมันจะ **ถอด remote ออก** เพื่อกัน push พลาด
ทำในสำเนาแยกจึงปลอดภัยกว่า และถ้าพลาดก็แค่ลบโฟลเดอร์ทิ้ง

```powershell
cd C:\MyWork
git clone https://github.com/thirayume/winspeed-connect.git purge-work
cd purge-work
git log --oneline -1
```

จดเลข commit ล่าสุดไว้ — จะใช้ตรวจตอนท้าย

---

## ขั้นที่ 2 — เก็บไฟล์รายการแทนที่ไว้ในเครื่อง

```powershell
Copy-Item "D:\Backup\winspeed-connect-purge-20260807\replacements.txt" C:\MyWork\replacements.txt
Get-Content C:\MyWork\replacements.txt
```

ต้องเห็น 13 บรรทัด รูปแบบ `ของเดิม==>ของใหม่` — ชื่อพนักงาน 10 · ชื่อลูกค้า 2 · รหัสผ่าน 1

ถ้าไฟล์หาย สร้างใหม่ได้ (ไฟล์ต้องเป็น UTF-8):

```powershell
@'
ศรายุทธ==>EMP-00027
ชูชาติ==>EMP-00035
สมะแอน==>EMP-00037
เดโช==>EMP-00034
จักรพงษ์==>EMP-00021
ภัคเกษม==>EMP-00033
ต้นฉัตร==>EMP-00042
สุรินทร์==>EMP-00030
ชัยชนะ==>EMP-00041
มนัส==>EMP-00036
สุทธิรักษ์การเกษตร==>CUST-23037
สุทธิรักษ์==>CUST-23037
W0rldF3rt==>***REMOVED-PASSWORD***
'@ | Set-Content -Encoding utf8 C:\MyWork\replacements.txt
```

---

## ขั้นที่ 3 — ลบไฟล์ mock ออกจากทุก commit

ลบทั้งไฟล์ ไม่ใช่แค่แทนคำ เพราะ**ทุก revision** ของไฟล์นี้เป็นข้อมูลลูกค้าจริง

```powershell
cd C:\MyWork\purge-work
git filter-repo --force --invert-paths --path WSSale-App/src/mock/sample-data.json
```

รอจนขึ้น `Completely finished after ...` (ประมาณ 1–3 นาที)

---

## ขั้นที่ 4 — แทนชื่อและรหัสผ่านในทุก commit

```powershell
git filter-repo --force --replace-text C:\MyWork\replacements.txt
```

---

## ขั้นที่ 5 — ตรวจว่าสะอาดจริง

```powershell
git log --all --oneline -S"W0rldF3rt" -- | Measure-Object -Line
git log --all --oneline -S"มนัส" -- | Measure-Object -Line
git log --all --oneline -S"ศรายุทธ" -- | Measure-Object -Line
git log --all --oneline -- WSSale-App/src/mock/sample-data.json | Measure-Object -Line
```

**ทั้ง 4 คำสั่งต้องได้ `Lines : 0`** · ถ้ายังไม่ใช่ 0 หยุดที่นี่ อย่า push

---

## ขั้นที่ 6 — ต่อ remote กลับแล้ว force-push

`filter-repo` ถอด remote ออกไปแล้ว ต้องต่อกลับเอง

```powershell
git remote add origin https://github.com/thirayume/winspeed-connect.git
git remote -v
git push --force --all origin
git push --force --tags origin
```

---

## ขั้นที่ 7 — ยืนยันบน GitHub

```powershell
cd C:\MyWork
git clone https://github.com/thirayume/winspeed-connect.git verify-clone
cd verify-clone
git log --all --oneline -S"W0rldF3rt" -- | Measure-Object -Line
Test-Path WSSale-App\src\mock\sample-data.json
```

ต้องได้ `Lines : 0` และ `False` · เสร็จแล้วลบโฟลเดอร์ตรวจทิ้ง

```powershell
cd C:\MyWork
Remove-Item -Recurse -Force verify-clone, purge-work
```

---

## ขั้นที่ 8 — เอาโฟลเดอร์ทำงานเดิมให้ตรงกับของใหม่

โฟลเดอร์ `C:\MyWork\WorldFert\winspeed-frontend` ยังชี้ประวัติเก่าอยู่ · **วิธีที่ปลอดภัยที่สุดคือ clone ใหม่**

```powershell
cd C:\MyWork\WorldFert
Rename-Item winspeed-frontend winspeed-frontend-old
git clone https://github.com/thirayume/winspeed-connect.git winspeed-frontend
```

แล้วคัดลอกไฟล์ที่ไม่ได้อยู่ใน git กลับมา (สำคัญ — มีรหัสผ่านฐานข้อมูลอยู่ในนี้)

```powershell
Copy-Item winspeed-frontend-old\backend\.env winspeed-frontend\backend\.env
Copy-Item -Recurse winspeed-frontend-old\docs winspeed-frontend\docs -ErrorAction SilentlyContinue
cd winspeed-frontend\backend
npm install
cd ..\WSSale-App
npm install
npm run build
```

ตรวจว่าใช้ได้แล้วค่อยลบของเก่า

```powershell
cd C:\MyWork\WorldFert
Remove-Item -Recurse -Force winspeed-frontend-old
```

---

## ขั้นที่ 9 — คำสั่งสำหรับทีม (ส่งข้อความนี้ให้ทุกคน)

> ประวัติ git ของ winspeed-connect ถูกเขียนใหม่เพื่อลบข้อมูลลูกค้าและรหัสผ่านที่หลุด
> **`git pull` จะใช้ไม่ได้** — ต้อง clone ใหม่ครับ
>
> 1. เช็คว่ามีงานค้างที่ยังไม่ push หรือไม่: `git status` และ `git log origin/main..HEAD`
>    ถ้ามี ให้เก็บเป็นไฟล์ patch ไว้ก่อน: `git format-patch origin/main`
> 2. เปลี่ยนชื่อโฟลเดอร์เดิมเก็บไว้ อย่าเพิ่งลบ
> 3. clone ใหม่:
>    ```
>    git clone https://github.com/thirayume/winspeed-connect.git
>    ```
> 4. คัดลอก `backend/.env` จากโฟลเดอร์เดิมมาใส่ แล้ว `npm install` ทั้ง `backend` และ `WSSale-App`
> 5. ถ้ามี patch จากข้อ 1 ให้ `git am *.patch` แล้วตรวจว่าไม่ได้ดึงชื่อ/รหัสเก่ากลับเข้ามา

**ถ้าใครยืนยันว่าไม่มีงานค้าง** สั่งให้ตรงกับ remote ได้เลย (ยังต้องระวัง — ทับงานในเครื่องทั้งหมด)

```powershell
git fetch origin
git reset --hard origin/main
git clean -fd
```

---

## ⚠️ สิ่งที่การล้างประวัติ **ไม่ได้** แก้

**รหัสผ่านตั้งต้นเคยเผยแพร่สาธารณะไปแล้ว ต้องถือว่ารั่ว** — การลบออกจาก GitHub ไม่ได้ทำให้สิ่งที่ถูกอ่านไปแล้วหายไป

ต้องทำเพิ่ม:

| # | เรื่อง |
|---|---|
| 1 | เปลี่ยนรหัส `admin` บนระบบที่ deploy แล้วทุกตัว (UAT · on-prem · ของลูกค้าทุกราย) |
| 2 | บังคับพนักงานที่ยังใช้รหัสตั้งต้นเปลี่ยนรหัส — ตั้ง `ENFORCE_PASSWORD_CHANGE=true` บนเซิร์ฟเวอร์ |
| 3 | แจ้ง GitHub Support ให้ล้าง cache ของ commit ที่ unreachable — ไม่งั้น GitHub ยังเสิร์ฟผ่าน URL ตรงได้อีกระยะ |
| 4 | ถ้ามี fork ต้องขอให้เจ้าของลบหรือ re-fork |
| 5 | พิจารณาแจ้งลูกค้าตาม PDPA — ข้อมูลที่หลุดมีชื่อ เบอร์โทร และเลขนิติบุคคลของลูกค้าจริง |

ตรวจแล้วว่า **UAT ไม่มีบัญชี `e2e_*`** จึงยังไม่มีช่องเข้าจากบัญชีทดสอบ
แต่บัญชี `admin` ของทุก deployment ที่ยังใช้รหัสตั้งต้น ต้องเปลี่ยนทันที

---

## ถ้าพลาด — กู้กลับ

```powershell
cd C:\MyWork
git clone "D:\Backup\winspeed-connect-purge-20260807\winspeed-connect-before-purge.bundle" recovered
cd recovered
git log --oneline -1
```

เทียบกับเลขใน `HEAD-before-purge.txt` · ถ้าตรงคือกู้ครบ แล้ว force-push กลับขึ้น GitHub ได้
