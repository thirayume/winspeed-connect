# TruckScale — ย้ายฐานขึ้นคลาวด์

อ่าน [PLAN-move-to-cloud.md](PLAN-move-to-cloud.md) ก่อน — มีสองทางเลือกและต้องเลือกก่อนเริ่ม

| ไฟล์ | ใช้ทำอะไร | ใช้กับทาง |
|---|---|---|
| `Set-TruckScaleDSN.ps1` | ย้าย DSN ของเครื่องลูกข่ายไปฐานใหม่ (ไม่แตะตัวโปรแกรม) | ก. ย้าย 100% |
| `Harden-CloudMySQL.sql` | เตรียมบัญชีที่ปลายทางให้ปลอดภัยเท่าที่ทำได้ | ก. ย้าย 100% |
| `push-agent/` | ตัวผลักข้อมูลออกจากโรงงานขึ้นคลาวด์ | ข. คงฐานที่โรงงาน |
| `docker-compose.yml` + `Setup-Replication.ps1` | ชุดทดสอบ replication บน localhost | ข. (ทางเลือกเมื่อมีอุโมงค์) |

## ย้าย DSN ของเครื่องลูกข่าย

`WorldFerth.exe` ไม่มี IP หรือชื่อโฮสต์อยู่ในไบนารีเลย ปลายทางฐานถูกกำหนดโดย ODBC DSN ล้วน ๆ
เปลี่ยน DSN = ย้ายฐาน โดยไม่ต้องแก้ source หรือ config ของ TruckScale

```powershell
.\Set-TruckScaleDSN.ps1 -TestOnly                              # ดูว่าตอนนี้ชี้ไปไหน
.\Set-TruckScaleDSN.ps1 -Server ts.example.com -Scope Machine  # ย้าย (ต้องรันแบบผู้ดูแล)
.\Set-TruckScaleDSN.ps1 -Restore                               # ถอยกลับสภาพก่อนแตะเครื่อง
```

ต้องติดตั้ง MySQL Connector/ODBC **แบบ 32 บิต** ก่อน เพราะ `WorldFerth.exe` เป็น x86
สคริปต์สำรองค่าเดิมแบบประทับเวลาทุกครั้ง และคงไดรเวอร์กับ CHARSET เดิมของเครื่องไว้

---

## ชุดทดสอบ replication

ยก MySQL สองตัวบน localhost แล้วต่อสาย replication ให้เหมือนของจริง
เพื่อพิสูจน์ขั้นตอนก่อนเอาไปใช้กับเครื่องชั่งจริงและ Railway

```powershell
cd deploy\truckscale-replica
.\Setup-Replication.ps1 -Fresh     # ยก + ต่อสาย + ตรวจ
.\Check-Replication.ps1            # ตรวจซ้ำเมื่อไรก็ได้
docker compose down -v             # เก็บกวาด
```

| ตัว | บทบาทจริง | พอร์ตบนโฮสต์ |
|---|---|---|
| `ts-source` | MySQL ที่เครื่องชั่ง — `WorldFerth.exe` เขียนผ่าน ODBC | `33061` |
| `ts-replica` | MySQL ปลายทางบนคลาวด์ (Railway) | `33062` |

`init/01-schema.sql` **สร้างจาก schema จริงของ Railway** ไม่ได้เขียนเอง
สร้างใหม่เมื่อ schema เปลี่ยน แล้ว commit ไฟล์ที่ได้

## ผลการทดสอบ 31/08/2569

MySQL 9.7.2 ทั้งสองฝั่ง (ตรงรุ่นกับ Railway ที่เป็น 9.7.1)

```
Replica_IO_Running     Yes
Replica_SQL_Running    Yes
Seconds_Behind_Source  0
ฐานตั้งต้น              tbl_keyone 1 = 1 ตรง
เขียนสดที่ source       โผล่ที่ replica ใน ~0.7 วินาที
```

## ทำไมต้องมีขั้น "ฐานตั้งต้น"

replica ที่ว่างเปล่าต่อสายแล้วจะล้มทันที เพราะ binlog ที่ส่งมาเป็น `INSERT`
ลงตารางที่ยังไม่มี ขั้นที่ 4 ของสคริปต์จึงดัมป์แบบ `--single-transaction --set-gtid-purged=ON`
ซึ่งได้ทั้งข้อมูลและ **ตำแหน่ง GTID ณ ขณะดัมป์** พอโหลดเสร็จ replica จึงรู้ว่าต้องเริ่มอ่านต่อจากตรงไหน

ใช้ GTID ไม่ใช่ชื่อไฟล์ binlog + offset เพราะเครื่องชั่งเน็ตหลุดบ่อย
พอกลับมา `SOURCE_AUTO_POSITION=1` ต่อจากจุดเดิมได้เอง — วิธีเดิมต้องจำตำแหน่งเองและพังบ่อยที่สุดตรงนี้

## ⚠ ข้อจำกัดที่ต้องแก้ก่อนขึ้นของจริง

**replica เป็นฝ่ายต่อไปหา source** ไม่ใช่ทางกลับกัน แปลว่า MySQL บน Railway
ต้องเข้าถึงเครื่องชั่งที่โรงงานได้ ซึ่งอยู่หลัง NAT — ต่อตรงไม่ได้

ทางเลือก เรียงตามที่แนะนำ:

1. **อุโมงค์ขาออกจากโรงงาน** (Cloudflare Tunnel / autossh) เปิดพอร์ต MySQL ของเครื่องชั่ง
   ให้ Railway เข้าถึงได้ โดยไม่ต้องเปิดพอร์ตขาเข้าที่โรงงาน — ปลอดภัยและตรงกับสถาปัตยกรรมนี้ที่สุด
2. **ตัวส่งขาออก** ที่เครื่องชั่งอ่าน binlog เองแล้วเขียนขึ้น Railway
   ทำงานหลัง NAT ได้โดยไม่ต้องเปิดอะไรเลย แต่ต้องเขียน/ดูแลเพิ่ม
3. **ให้แอปเป็นตัวซิงก์** — `services/truckscale-sync.js` ทำอยู่แล้ว (ไล่ตาม `s_id` watermark ทุก 60 วินาที)
   ถ้ายอมรับความหน่วงระดับนาทีและซิงก์เฉพาะตารางที่ใช้ ก็ไม่ต้องทำ replication เลย

**ข้อ 3 คือสิ่งที่ระบบทำอยู่แล้ววันนี้** — เลือก replication ต่อเมื่อต้องการข้อมูลครบทุกตาราง
และหน่วงระดับวินาที ไม่ใช่แค่ตารางที่แอปใช้

## ชี้ไป Railway จริง

แก้ `Setup-Replication.ps1` ขั้นที่ 5 ให้ `SOURCE_HOST` เป็นที่อยู่เครื่องชั่ง
แล้วรัน `CHANGE REPLICATION SOURCE` บน Railway แทน `ts-replica`
ต้องมีสิทธิ์ `REPLICATION_SLAVE_ADMIN` บนอินสแตนซ์ปลายทาง — ตรวจก่อนว่า Railway ให้

## เรื่องรหัสผ่านที่ต้องแก้แยกต่างหาก

`WorldFerth.exe` ฝัง `UID=root;PWD=...` ไว้ในตัวโปรแกรม และค่านี้**ทับสิ่งที่ตั้งใน DSN**
DSN ที่ใช้ชื่อ `TruckScales` (สำรอง `TruckScaleV5_Backup`) ตั้งที่ **ODBC 32-bit**
(`C:\Windows\SysWOW64\odbcad32.exe`) เพราะตัวโปรแกรมเป็น x86

แปลว่าปลายทางใดก็ตามที่จะให้โปรแกรมต่อตรง ต้องรับ `root` ด้วยรหัสเดิม
ซึ่งเป็นเหตุผลหลักที่ควรใช้ replication แทนการชี้ DSN ไปคลาวด์
บัญชี `repl` ในชุดนี้จึงแยกจาก root และทำได้อย่างเดียวคืออ่าน binlog
