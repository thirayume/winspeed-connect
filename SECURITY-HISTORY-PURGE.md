# ล้างข้อมูลอ่อนไหวออกจาก git history

> 7 ส.ค. 2569 · **มีสคริปต์ให้แล้ว รันสองคำสั่งจบ** — ดูหัวข้อ "วิธีทำ" ด้านล่าง
>
> ผู้ช่วยรันคำสั่งเขียนประวัติใหม่เองไม่ได้ (ระบบความปลอดภัยบล็อก) จึงเตรียมทุกอย่างไว้ให้
> เหลือแค่คุณกดรัน

---

## สรุปสถานะ

### เตรียมไว้ให้แล้ว — ไม่ต้องทำเอง

| | |
|---|---|
| ซอร์สปัจจุบันสะอาด | push ขึ้น `origin/main` แล้ว |
| ลบ `WSSale-App/src/mock/` | ไม่มีโค้ดไหนอ่านไฟล์นี้ · ถอด `VITE_USE_MOCKUP_DATA` ที่ตายแล้วออกจาก 7 config |
| รหัสผ่านตั้งต้นออกจากซอร์ส 23 จุด | `seed_admin.js` สุ่มให้และพิมพ์ครั้งเดียวตอนติดตั้ง |
| **สำรองประวัติเดิมทั้งหมด** | `C:\MyWork\_backup\winspeed-connect-purge-20260807\` (bundle 16.7 MB) |
| **รายการแทนที่ 13 บรรทัด** | อยู่ในโฟลเดอร์สำรองเดียวกัน |
| **สคริปต์ล้างประวัติ** | `tools\purge-history.ps1` |

### ยังเหลือในประวัติ — คือสิ่งที่สคริปต์นี้ล้าง

| ข้อมูล | commit ที่แตะ |
|---|---|
| รหัสผ่านตั้งต้น (admin ของทุก deployment) | **41** |
| ชื่อพนักงาน 10 คน | 3–20 ต่อคน |
| ชื่อลูกค้าจากใบรีเบท | 1 |
| `sample-data.json` — ชื่อลูกค้า 73 · เลขนิติบุคคล 7 · ชื่อบริษัท 48 · เลขใบกำกับ 57 | ทุก revision |

การแก้ไฟล์ทำให้ `HEAD` สะอาด แต่ commit เก่ายังเก็บของเดิมครบ — `git clone` ยังได้ประวัติทั้งหมดไป

---

## ตรวจแล้ว: สองเรื่องที่เคยกังวล แทบไม่ต้องทำ

เดิมเขียนไว้ว่าต้อง "แจ้งทีม" และ "ปิด branch protection" — ตรวจของจริงบน GitHub แล้วพบว่า

| เรื่อง | ผลตรวจ | ต้องทำไหม |
|---|---|---|
| **Branch protection ของ `main`** | ไม่ได้เปิดไว้เลย (API ตอบ 404) | ❌ **ไม่ต้องทำ** — ข้ามได้ |
| **Fork ของที่เก็บนี้** | 0 fork | ❌ **ไม่ต้องทำ** — ไม่มีใครต้องตาม |
| **คนที่ commit เข้ามา 6 เดือนล่าสุด** | `thirayu.m` **คนเดียว** 433 commit (+ bot 9) | ⚠️ ดูด้านล่าง |

**เรื่องเดียวที่ยังต้องตัดสินใจ:** ไม่มีใครนอกจากคุณ commit เข้ามาเลย แต่ถ้าในทีมมีใคร
`git clone` ไปไว้ในเครื่อง (ถึงจะยังไม่เคย push) **เขาจะ pull ต่อไม่ได้หลังล้างประวัติ**

- ถ้าไม่มีใคร clone ไปเลย → **ข้ามได้ทั้งข้อ** รันสคริปต์ได้เลย
- ถ้ามี → ส่งข้อความในหัวข้อ "คำสั่งสำหรับทีม" ท้ายเอกสารให้เขาก่อน

---

## วิธีทำ

เปิด **PowerShell** แล้ว

### ขั้นที่ 1 — ซ้อมก่อน (ไม่แตะ GitHub เลย)

```powershell
cd C:\MyWork\WorldFert\winspeed-frontend
.\tools\purge-history.ps1
```

สคริปต์จะ clone สำเนาใหม่ไปที่ `C:\MyWork\_purge-work` ล้างประวัติในสำเนานั้น แล้วตรวจให้ว่าเหลือ 0 จริง
**ยังไม่ push อะไรทั้งสิ้น** · ถ้าขั้นไหนไม่ผ่านจะหยุดและบอกเหตุผล

ต้องเห็นท้ายผลลัพธ์ประมาณนี้

```
[6] ตรวจว่าไม่เหลืออะไรในประวัติ
    ok   รหัสผ่านตั้งต้น = 0 commit
    ok   ชื่อพนักงาน (1) = 0 commit
    ok   ชื่อพนักงาน (2) = 0 commit
    ok   ชื่อลูกค้า = 0 commit
    ok   ไฟล์ mock = 0 commit

  ซ้อมผ่านทุกขั้น — ยังไม่ได้ push
```

### ขั้นที่ 2 — ทำจริง

```powershell
.\tools\purge-history.ps1 -Execute
```

ทำซ้ำทั้งหมดอีกรอบ แล้ว**ถามยืนยันหนึ่งครั้ง** ก่อน force-push — ต้องพิมพ์ `PUSH` ตัวใหญ่
พิมพ์อย่างอื่นคือยกเลิก ไม่มีอะไรเปลี่ยนบน GitHub

เสร็จแล้วสคริปต์ clone ใหม่จาก GitHub มาตรวจซ้ำให้เอง แล้วบอกขั้นต่อไป

---

## หลังสคริปต์ทำงานเสร็จ

### ก. ตั้งโฟลเดอร์ทำงานเดิมใหม่

โฟลเดอร์ `C:\MyWork\WorldFert\winspeed-frontend` ยังชี้ประวัติเก่า ใช้ต่อไม่ได้

```powershell
cd C:\MyWork\WorldFert
Rename-Item winspeed-frontend winspeed-frontend-old
git clone https://github.com/thirayume/winspeed-connect.git winspeed-frontend
Copy-Item winspeed-frontend-old\backend\.env winspeed-frontend\backend\.env
Copy-Item -Recurse winspeed-frontend-old\docs winspeed-frontend\docs -ErrorAction SilentlyContinue
cd winspeed-frontend\backend
npm install
cd ..\WSSale-App
npm install
npm run build
```

> ⚠️ `backend\.env` ไม่ได้อยู่ใน git และมีรหัสผ่านฐานข้อมูล — **ต้องคัดลอกกลับ** ไม่งั้นระบบไม่ทำงาน
> `docs\` ก็เช่นกัน (gitignore ไว้)

ใช้ได้แล้วค่อยลบของเก่า

```powershell
Remove-Item -Recurse -Force C:\MyWork\WorldFert\winspeed-frontend-old
Remove-Item -Recurse -Force C:\MyWork\_purge-work, C:\MyWork\_purge-work-verify
```

### ข. คำสั่งสำหรับทีม (ถ้ามีใคร clone ไปแล้ว)

ส่งข้อความนี้ให้

> ประวัติ git ของ winspeed-connect ถูกเขียนใหม่เพื่อลบข้อมูลลูกค้าและรหัสผ่านที่หลุด
> **`git pull` จะใช้ไม่ได้แล้ว ต้อง clone ใหม่ครับ**
>
> 1. เช็คงานค้างก่อน: `git status` และ `git log origin/main..HEAD`
>    ถ้ามี เก็บเป็น patch ไว้: `git format-patch origin/main`
> 2. เปลี่ยนชื่อโฟลเดอร์เดิมเก็บไว้ อย่าเพิ่งลบ
> 3. `git clone https://github.com/thirayume/winspeed-connect.git`
> 4. คัดลอก `backend/.env` จากของเดิมมาใส่ แล้ว `npm install` ทั้ง `backend` และ `WSSale-App`
> 5. ถ้ามี patch จากข้อ 1 ให้ `git am *.patch` แล้วตรวจว่าไม่ได้ดึงชื่อ/รหัสเก่ากลับเข้ามา

ถ้าใครยืนยันว่าไม่มีงานค้าง สั่งแบบสั้นได้ (ทับงานในเครื่องทั้งหมด)

```powershell
git fetch origin
git reset --hard origin/main
git clean -fd
```

---

## ⚠️ สิ่งที่การล้างประวัติ **ไม่ได้** แก้

**รหัสผ่านตั้งต้นเคยเผยแพร่สาธารณะไปแล้ว ต้องถือว่ารั่ว** — การลบออกจาก GitHub
ไม่ได้ทำให้สิ่งที่ถูกอ่านไปแล้วหายไป

| # | ต้องทำเพิ่ม |
|---|---|
| 1 | เปลี่ยนรหัส `admin` บนระบบที่ deploy แล้วทุกตัว (UAT · on-prem · ของลูกค้าทุกราย) |
| 2 | ตั้ง `ENFORCE_PASSWORD_CHANGE=true` บนเซิร์ฟเวอร์ บังคับพนักงานที่ยังใช้รหัสตั้งต้น |
| 3 | แจ้ง GitHub Support ให้ล้าง cache ของ commit ที่ unreachable — ไม่งั้นยังเสิร์ฟผ่าน URL ตรงได้อีกระยะ |
| 4 | พิจารณาแจ้งลูกค้าตาม PDPA — ข้อมูลที่หลุดมีชื่อ เบอร์โทร และเลขนิติบุคคลของลูกค้าจริง |

ตรวจแล้วว่า **UAT ไม่มีบัญชี `e2e_*`** จึงยังไม่มีช่องเข้าจากบัญชีทดสอบ
แต่บัญชี `admin` ของทุก deployment ที่ยังใช้รหัสตั้งต้น ต้องเปลี่ยนทันที

---

## ถ้าพลาด — กู้กลับ

```powershell
cd C:\MyWork
git clone "C:\MyWork\_backup\winspeed-connect-purge-20260807\winspeed-connect-before-purge.bundle" recovered
cd recovered
git log --oneline -1
```

เทียบกับเลขใน `HEAD-before-purge.txt` — ตรงกันคือกู้ครบ แล้ว force-push กลับขึ้น GitHub ได้

**อย่าลบโฟลเดอร์สำรองจนกว่าจะมั่นใจว่าทุกอย่างเรียบร้อยแล้วอย่างน้อยหนึ่งสัปดาห์**
