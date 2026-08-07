# ล้างข้อมูลอ่อนไหวออกจาก git history

> จัดทำ 7 ส.ค. 2569 · **ยังไม่ได้รัน** — คำสั่งเขียนประวัติใหม่ถูกระบบความปลอดภัยบล็อก
> เจ้าของที่เก็บต้องรันเอง เพราะต้อง force-push ซึ่งกระทบทุกคนที่ clone ไปแล้ว

## ทำอะไรไปแล้ว (ไม่ต้องทำซ้ำ)

- ✅ ซอร์สปัจจุบันสะอาดแล้ว — commit `7764112` push ขึ้น `origin/main` เรียบร้อย
- ✅ สำรองประวัติทั้งหมดไว้แล้ว (ดูหัวข้อ "ถ้าพลาด")

## ทำไมยังต้องล้างประวัติ

การแก้ไฟล์ในรอบล่าสุดทำให้ **HEAD** สะอาด แต่ commit เก่ายังเก็บของเดิมไว้ครบ
ใครก็ตามที่ `git clone` ยังดึงประวัติทั้งหมดไปได้ · GitHub เองก็ยังเสิร์ฟ blob เก่าผ่าน URL ตรง

สิ่งที่ยังอยู่ในประวัติ (นับจำนวน commit ที่แตะสตริงนั้น):

| ข้อมูล | commit |
|---|---|
| รหัสผ่านตั้งต้น (admin ของทุก deployment) | **41** |
| ชื่อพนักงาน 10 คน | 3–20 ต่อคน |
| ชื่อลูกค้าจากใบรีเบท | 1 |
| `sample-data.json` — ชื่อลูกค้า 73 · เลขนิติบุคคล 7 · ชื่อบริษัท 48 · เลขใบกำกับ 57 | ทุก revision ของไฟล์ |

## ขั้นตอน

เครื่องมือติดตั้งไว้แล้ว (`git filter-repo`) และไฟล์รายการแทนที่เตรียมไว้ที่
`%LOCALAPPDATA%\Temp\claude\C--MyWork-WorldFert\<session>\scratchpad\backup\replacements.txt`

### 1. แจ้งทีมก่อน — สำคัญที่สุด

การเขียนประวัติใหม่ทำให้ **SHA ของทุก commit เปลี่ยน** ใครที่ยัง clone เดิมอยู่จะ push/pull ไม่ได้
ทุกคนต้อง **clone ใหม่** หลังทำเสร็จ · ห้ามใครสั่ง `git push` ระหว่างนี้

### 2. ปิด branch protection ชั่วคราวบน GitHub (ถ้าเปิดไว้)

### 3. ลบไฟล์ mock ออกจากทุก commit

```bash
git filter-repo --force --invert-paths --path WSSale-App/src/mock/sample-data.json
```

ลบทั้งไฟล์ ไม่ใช่แค่แทนคำ เพราะทุก revision ของไฟล์นี้เป็นข้อมูลลูกค้าจริง

### 4. แทนที่ชื่อและรหัสผ่านในทุก commit

```bash
git filter-repo --force --replace-text replacements.txt
```

### 5. เอาไฟล์ mock ฉบับข้อมูลสมมติกลับเข้ามา

```bash
git checkout 7764112 -- WSSale-App/src/mock/sample-data.json
```

> ⚠ ถ้าทำขั้น 3 แล้ว `7764112` จะไม่มีอยู่แล้ว — ให้ดึงจาก bundle สำรองแทน:
> `git archive --remote=<bundle> 7764112 WSSale-App/src/mock/sample-data.json | tar -x`
> หรือคัดลอกไฟล์จาก working tree ปัจจุบันไว้ก่อนเริ่มขั้น 3

```bash
git add WSSale-App/src/mock/sample-data.json
git commit -m "chore(mock): restore sample data with synthetic values only"
```

### 6. ตรวจก่อน push

```bash
git log --all --oneline -S"W0rldF3rt" -- | wc -l
```

ต้องได้ **0** · ทำซ้ำกับชื่อพนักงานอย่างน้อย 2 ชื่อ

### 7. ต่อ remote กลับแล้ว force-push

`filter-repo` ถอด remote ออกเองเพื่อกันการ push โดยไม่ตั้งใจ

```bash
git remote add origin https://github.com/thirayume/winspeed-connect.git
git push --force --all origin
git push --force --tags origin
```

### 8. หลัง push

- แจ้ง GitHub Support ให้ล้าง cache ของ blob เก่า — GitHub ยังเสิร์ฟ commit ที่ unreachable
  ผ่าน URL ตรงได้อีกระยะหนึ่ง ถ้าไม่แจ้ง
- ถ้ามี fork ต้องขอให้เจ้าของ fork ลบหรือ re-fork
- ทีมทุกคน clone ใหม่

## ⚠ สิ่งที่การล้างประวัติ **ไม่ได้** แก้

รหัสผ่านตั้งต้นเคยเผยแพร่สาธารณะไปแล้ว — **ต้องถือว่ารั่ว** และเปลี่ยนบนระบบที่ deploy แล้วทุกตัว
การลบออกจาก GitHub ไม่ได้ทำให้สิ่งที่ถูกอ่านไปแล้วหายไป

ตรวจแล้วว่า **UAT ยังไม่มีบัญชี `e2e_*`** จึงยังไม่มีช่องทางเข้าจากบัญชีทดสอบ
แต่บัญชี `admin` ของทุก deployment ที่ยังใช้รหัสตั้งต้นอยู่ ต้องเปลี่ยนทันที

## ถ้าพลาด

สำรองประวัติเดิมทั้งหมด (ทุก branch ทุก tag) ไว้ที่

```
%LOCALAPPDATA%\Temp\claude\C--MyWork-WorldFert\<session>\scratchpad\backup\
  winspeed-connect-before-purge.bundle   (17.5 MB)
  HEAD-before-purge.txt
  replacements.txt
```

กู้กลับ:

```bash
git clone winspeed-connect-before-purge.bundle recovered
```

**คัดลอกโฟลเดอร์นี้ไปเก็บที่ปลอดภัยก่อนเริ่ม** — โฟลเดอร์ scratchpad เป็นของชั่วคราวรายเซสชัน
