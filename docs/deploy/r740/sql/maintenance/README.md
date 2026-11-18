# ดูแลฐานข้อมูล R740-SRV\SQL2008 (สำหรับ IT)

จากการประเมินความช้า 18 พ.ย. 2569 ไฟล์ทุกไฟล์ใช้ Windows login (`-E`) ห้ามใส่รหัสผ่าน SQL ในไฟล์ใด ๆ

## สิ่งที่พบ

- SQL Server 2008 R2 **Express** (cache สูงสุดราว 1 GB) ใช้ร่วมกันระหว่าง PROD, UAT, worldfert2 และ ReportServer เครื่องมี RAM 32 GB
- ฐาน WinSpeed ทุกฐานเปิด `AUTO_CLOSE` และ `AUTO_SHRINK` และปิดการตรวจหน้าข้อมูลเสีย (`PAGE_VERIFY NONE`)
- PROD และ UAT เป็น recovery FULL แต่ไม่มี log backup ไฟล์ log จึงโต 18 GB ขณะใช้จริงราว 135 MB
- ไม่มีงานดูแลฐานเลย (Express ไม่มี SQL Agent) สถิติของตาราง SOHD เก่าตั้งแต่ มิ.ย.–ส.ค. 2569 ทำให้ SQL Server เลือกแผนที่ช้า เช่น ตัวเลข Dashboard ใช้ 30 วินาทีแทน 0.3 วินาที
- `run_backup.bat` ในโฟลเดอร์ Backup มีรหัสผ่าน sa เขียนไว้เป็นข้อความธรรมดา ควรเปลี่ยนรหัส sa และให้ไฟล์ใช้ `-E` แทน

## ลำดับที่ทำ

| ลำดับ | ไฟล์ | ทำเมื่อ | ผลกระทบ |
|---|---|---|---|
| 1 | `01-database-settings.sql` | ครั้งเดียว ทำได้ระหว่างใช้งาน | ปิด AUTO_CLOSE / AUTO_SHRINK, เปิด CHECKSUM, ขยายไฟล์ทีละ 128–256 MB |
| 2 | `02-transaction-log.sql` | ครั้งเดียว (เจ้าของเลือกทางเลือก A: SIMPLE เมื่อ 18 พ.ย. 2569) | แก้ต้นเหตุ log โต แล้วลดไฟล์ log ครั้งเดียวเหลือ 2 GB (ไม่แตะไฟล์ข้อมูล) |
| 3 | `03-log-backup.cmd` | ไม่ต้องใช้ (ใช้เฉพาะทางเลือก B) | สำรอง log ของ PROD เก็บ 3 วัน |
| 4 | `05-run-maintenance.cmd` → `04-nightly-maintenance.sql` | ทุกคืน 02:00 | จัดเรียง index ที่แตกกระจาย และปรับสถิติ (บน laptop ใช้ราว 100 วินาทีต่อฐาน) |
| 5 | `06-proposed-winspeed-indexes.sql` | **รอเจ้าของอนุมัติก่อน** | เพิ่ม index 4 ตัวบนตาราง WinSpeed (ไม่แก้คอลัมน์) ถอดได้ด้วย `07-drop-proposed-winspeed-indexes.sql` |

ตั้ง Task Scheduler: "Run whether user is logged on or not", บัญชี Windows ที่เป็น sysadmin ของ SQL Server, ไม่ชนกับงานสำรองเดิม 21:00 และการ refresh UAT

## สถานะบน R740 (18 พ.ย. 2569)

- `01` รันแล้ว: ปิด AUTO_CLOSE / AUTO_SHRINK, เปิด CHECKSUM, ขยายไฟล์แบบคงที่ ทั้ง worldfert9, worldfert9_uat และ worldfert2
- `02` รันแล้ว 21:41 (ทางเลือก A): PROD และ UAT เป็น SIMPLE, log ลดจาก 21,522 MB เหลือ 2,067 MB ต่อฐาน, ไฟล์ข้อมูลไม่ถูกแตะ
- `05` ตั้งเป็นงาน `\SaleApp\SaleApp DB Maintenance` ทุกวัน 02:00 รันด้วย `NT AUTHORITY\SYSTEM` (เป็น sysadmin ของ SQL Server อยู่แล้ว ไม่ต้องเก็บรหัสผ่าน) จำกัดเวลา 2 ชั่วโมง, log อยู่ที่ `D:\SaleApp\maintenance-logs\maintenance-YYYYMMDD.log` เก็บ 30 วัน
- `06` ยังไม่รัน รอเจ้าของอนุมัติ

## หมายเหตุทางเลือก A

- จุดกู้ข้อมูลคือไฟล์สำรองเต็มทุกคืน 21:00 (งาน "AUTO Backup SQL2008") เท่ากับที่กู้ได้ในปัจจุบัน
- UAT ถูก restore จากไฟล์สำรองของ PROD ทุกคืน จึงได้ค่า SIMPLE และค่าจาก `01` ตามไปเองหลัง IT ตั้งค่าที่ PROD

## ทดสอบแล้ว

- `04` รันจริงบนสำเนาฐานในเครื่องทดสอบ (SQL Server 2008 R2 เดียวกัน) ผ่าน, รอบสองไม่มี index ต้องจัดใหม่
- `01`, `02`, `06`, `07` ตรวจไวยากรณ์ผ่าน, `06` สร้างใน transaction แล้ว rollback: หาตั๋วของใบสั่งขายปี 2569 จาก 76 เหลือ 6 ms, หาใบสั่งขายของใบจองจาก 53 เหลือ 23 ms (cache ว่าง)

## ระยะกลาง (สถาปัตยกรรม)

- ย้าย UAT และ worldfert2 ไปอีก instance ของ Express (ฟรี) ให้ PROD ได้ cache 1 GB เต็ม
- ระยะยาว: SQL Server 2008 R2 **Standard** เพื่อใช้ RAM ที่มี (WinSpeed ต้องใช้ compatibility 80 ซึ่งมีถึงรุ่น 2008 R2 เท่านั้น)
