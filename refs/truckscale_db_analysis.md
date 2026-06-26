# TruckScale Database Analysis
**ระบบ:** db_truckscale | **Engine:** MySQL 5.7 (Ubuntu) | **Host:** 192.168.1.253

---

## ภาพรวม

ระบบชั่งน้ำหนักรถบรรทุก (TruckScale) ใช้ MySQL บน Local Network เป็นระบบแยกจาก Winspeed (SQL Server)  
บันทึกการชั่งน้ำหนักสินค้าเข้า/ออกคลังและท่าน้ำ รองรับเครื่องชั่ง 2 ตัว (COM port 1 & 3)

---

## ตารางหลัก (Core Tables)

### `tblscale` — **รายการชั่ง** *(ตารางหลัก)*
> ~403,908 rows | AUTO_INCREMENT=430507 | InnoDB utf8_bin

| คอลัมน์ | Type | หมายเหตุ |
|---|---|---|
| `s_id` | int PK AUTO | ลำดับที่ |
| `sequence` | varchar(10) | เลขที่ใบชั่ง เช่น `00000001` |
| `movebill` | varchar(50) | เลขใบเคลื่อนย้าย เช่น `54090001` (ปี+เดือน+ลำดับ) |
| `one_car_regis` | varchar(50) | ทะเบียนรถ |
| `Date_In` | varchar(50) | วันที่เข้า (string เช่น `10/09/2554`) |
| `Date_In2` | int(15) | วันที่เข้า (Excel serial เช่น 40796) |
| `Time_In` | time | เวลาเข้า |
| `Date_Out` | varchar(50) | วันที่ออก |
| `Date_Out2` | int(15) | วันที่ออก (Excel serial) |
| `Time_Out` | time | เวลาออก |
| `one_num` | int(50) | หมายเลขอ้างอิงลูกค้า |
| `one_cus_id` | varchar(50) | รหัสลูกค้า |
| `one_cus_name` | varchar(100) | ชื่อลูกค้า |
| `one_dri_id` | varchar(50) | รหัสผู้รับสินค้า |
| `one_dri_name` | varchar(100) | ชื่อผู้รับสินค้า/คนขับ |
| `one_dri_add` | varchar(100) | ที่อยู่ |
| `weight_in` | double | น้ำหนักรถเปล่า (กก.) |
| `weight_out` | double | น้ำหนักรถบรรทุก (กก.) |
| `weight_net` | double | น้ำหนักสุทธิ (กก.) = out − in |
| `Weigavg` | double | น้ำหนักเฉลี่ยต่อกระสอบ (ตัน) |
| `s_day` | int(10) | วันที่ (Excel serial) |
| `s_num` | int(10) | ลำดับที่ของวัน |
| `Computer_w` | int(10) | หมายเลขเครื่องชั่ง (1 หรือ 2) |
| `weight_Type` | int(10) | ประเภทการชั่ง (FK → tblweighttype) |
| `one_w_type` | varchar(50) | ประเภท เช่น `ชั่งขาย`, `ชั่งรับ` |
| `cust_type` | varchar(50) | ประเภทลูกค้า |
| `cust_Park` | varchar(50) | ภูมิภาค |
| `one_des` | varchar(100) | หมายเหตุ |

**หมายเหตุสำคัญ:**
- วันที่เก็บ 2 รูปแบบ: string Thai (`10/09/2554`) และ Excel serial int (40796 = 10 ก.ย. 2554)
- `weight_in` / `weight_out` ค่าเริ่มต้น = 1000 / 10000 (ตัวอย่าง test data) — ข้อมูลจริงอาจต่างกัน

---

### `tbl_keyone` — **ข้อมูลก่อนชั่ง** (Pre-weigh header)
> ~407,973 rows | AUTO_INCREMENT=431875 | InnoDB utf8_bin

| คอลัมน์ | Type | หมายเหตุ |
|---|---|---|
| `one_id` | int PK AUTO | ลำดับ |
| `one_move_id` | int | เลขที่เคลื่อนย้าย |
| `one_cus_id` | varchar(50) | รหัสลูกค้า |
| `one_cus_name` | varchar(100) | ชื่อลูกค้า |
| `one_dri_id` | varchar(50) | รหัสผู้รับสินค้า |
| `one_dri_name` | varchar(100) | ชื่อผู้รับสินค้า |
| `one_car_regis` | varchar(50) | ทะเบียนรถ |
| `one_des` | varchar(100) | หมายเหตุ |
| `one_type` | varchar(20) | ประเภทที่รับ เช่น `โกดัง`, `ท่าน้ำ` |
| `one_day` | int(10) | วัน (Excel serial) |
| `one_num` | int | ลำดับที่ใน session |
| `one_w_type` | varchar(50) | ประเภทการชั่ง |
| `one_App` | varchar(100) | ผู้อนุมัติจ่าย |
| `one_datetime` | varchar(50) | วันที่ (string Thai) |
| `weight_Type` | int | ชั่งครั้งที่ |

---

### `tblproduct_detail` — **รายละเอียดสินค้าต่อบิล**
> ~550,161 rows | AUTO_INCREMENT=581962 | InnoDB utf8_bin

| คอลัมน์ | Type | หมายเหตุ |
|---|---|---|
| `pd_id` | int PK AUTO | ลำดับ |
| `pd_pro_code` | varchar | รหัสสินค้า |
| `pd_pro_name` | varchar | ชื่อสินค้า |
| `pd_pro_formula` | varchar | สูตรสินค้า เช่น `รถเกษตร`, `เทกอง(Bulk)` |
| `pd_pro_weight` | float | น้ำหนักต่อถุง (กก.) |
| `pd_pro_bag` | float | จำนวนกระสอบ |
| `pd_pro_wantWeight` | float | น้ำหนักที่ต้องการ (ตัน) |
| `pd_pro_invoid` | varchar | เลขใบเสร็จ Winspeed (เช่น `K66467`) |
| `pd_pro_number` | varchar | เลขเอกสาร (เช่น `D80120`, `C01812`) |
| `pd_pro_Godown` | varchar | ชื่อคลัง |
| `one_cus_id` | varchar | รหัสลูกค้า |
| `cust_name` | varchar | ชื่อลูกค้า |
| `one_num` | int | ลำดับที่ |
| `pd_code_godown` | varchar | รหัสโกดัง (FK → tblstore.sto_code) |
| `one_type` | varchar | ประเภท เช่น `โกดัง`, `ท่าน้ำ` |
| `pd_Destination` | varchar | ปลายทาง เช่น `สายพาน`, `BULK`, `คลังสินค้า` |
| `year` | int | วัน (Excel serial) |
| `pd_auto` | varchar | ลำดับอัตโนมัติ |
| `sto_text` | varchar | ประเภทคลัง |
| `sto_des` | varchar | หมายเหตุ (`0`=ไม่มีสต็อค, `1`=มีสต็อค) |

---

## ตารางอ้างอิง (Reference Tables)

### `tblproduct` — สินค้า
> 491 rows | MyISAM tis620

| คอลัมน์ | หมายเหตุ |
|---|---|
| `proc_code` | รหัสสินค้า เช่น `7-1688 รถเกษตร` |
| `proc_name` | ชื่อสินค้า เช่น `16-8-8` |
| `proc_cost` | ราคา/หน่วย |
| `proc_unit` | หน่วย: `กิโลกรัม`, `ตัน`, `ลิตร` |
| `proc_weight` | น้ำหนัก/หน่วย |
| `brand_name` | ตรา เช่น `รถเกษตร`, `หัววัว`, `ตัวซี`, `ยาร่า` |

**รหัสสินค้า pattern:**
- `7-XXXX` = สินค้าถุง (กิโลกรัม)
- `9-XXXX` = สินค้ากระสอบ
- `5-XXXX` = เทกอง (Bulk, หน่วยตัน)

---

### `tblcustomer` — ลูกค้า
> ~5,394 rows | MyISAM tis620

| คอลัมน์ | หมายเหตุ |
|---|---|
| `one_cus_id` | รหัสลูกค้า (อ้างอิงกับ tblscale) |
| `cust_name` | ชื่อลูกค้า |
| `cust_province` | จังหวัด |
| `cust_Park` | ภูมิภาค |
| `cust_type` | ประเภทลูกค้า |

---

### `tbl_driver` — ผู้รับสินค้า/คนขับ
> ~33,685 rows | InnoDB utf8_bin

เก็บข้อมูลผู้รับสินค้า/คนขับรถ พร้อมที่อยู่และรหัสบัตรประชาชน

---

### `tblstore` — คลังสินค้า
> 18 rows | MyISAM tis620

| รหัส | ชื่อ | ประเภท |
|---|---|---|
| 01–06 | โกดัง 1–6 | เทกอง |
| 5/1, 5/2, 4/1, 4/2 | โกดัง ย่อย | เทกอง |
| คB | คลัง(B/B) | เชิงผสม |
| คH | คลัง(H/P) | แฮนแพ็ค |
| สB | สายพาน(B/B) | เชิงผสม |
| สH | สายพาน(H/P) | แฮนแพ็ค |
| ท่า | ท่าน้ำ | ท่าน้ำ |
| กส | ห้องกระสอบ | — |

---

### `tblweighttype` — ประเภทการชั่ง
| id | ชื่อ |
|---|---|
| 43 | ลูกค้า |
| 44 | จ่ายออก |
| 45 | รับเข้า |
| 46 | เคลื่อนย้าย |
| 48 | ย้ายออก |
| 49 | ย้ายเข้า |

---

### `tblseting` — ตั้งค่าเครื่องชั่ง
> 2 records (เครื่องชั่ง 2 ตัว)

| ช่อง | ค่า |
|---|---|
| COM Port | 1 และ 3 |
| Baud Rate | 2400 |
| Parity | None |
| Stop/Data Bits | 1/8 |
| Capacity | 80,000 กก. (80 ตัน) ต่อเครื่อง |

---

### `tbl_boat` — ท่าเรือ
> 8 แห่ง: จุฆามาศ, ดวงพรมารีน, พรปิยะ 24/39/68, อ่าวไทย 16/17/30

---

### `tblorder` — ใบสั่ง (Order Balance)
> ~5,890 rows | InnoDB utf8_bin

ติดตามยอดสั่งและยอดคงเหลือต่อใบสั่ง

| คอลัมน์ | หมายเหตุ |
|---|---|
| `O_numId` | เลขใบสั่ง เช่น `D78156`, `C01584` |
| `O_num` | จำนวนที่สั่ง (ตัน) |
| `O_numBalance` | ยอดคงเหลือ (ตัน) |
| `O_numLost` | ยอดที่หาย/ต่างจากที่สั่ง |

---

## Sequence เลขที่บิล

```
movebill format: YYMMNNNN
  YY   = ปี เช่น 54 = 2554
  MM   = เดือน เช่น 09 = กันยายน
  NNNN = ลำดับที่ภายในเดือน
ตัวอย่าง: 54090001 = บิลแรกของ กันยายน 2554
```

---

## ปัญหาคุณภาพข้อมูล

| ปัญหา | รายละเอียด |
|---|---|
| **วันที่หลายรูปแบบ** | เก็บทั้ง string Thai (`10/09/2554`) และ Excel serial int (40796) ในคอลัมน์คู่ |
| **Charset ผสม** | tblscale ใช้ utf8_bin, tblcustomer/tblproduct ใช้ tis620 |
| **ไม่มี FK constraints** | ความสัมพันธ์ระหว่างตารางทำผ่าน `one_cus_id`, `one_num` เท่านั้น ไม่ใช่ FK จริง |
| **ทะเบียนรถซ้ำ** | พบ `001.`, `001..` (trailing dot) ใน test data ช่วงแรก |
| **รหัสลูกค้าไม่ consistent** | บางรายใช้ชื่อเป็น ID (เช่น `รถทอย`), บางรายใช้รหัสจาก Winspeed |
| **Data เริ่มต้น** | weight_in=1000, weight_out=10000 ช่วง test run (ก.ย. 2554) อาจไม่ใช่ค่าจริง |

---

## ความสัมพันธ์กับ Winspeed

```
tblproduct_detail.pd_pro_invoid  ←→  dbo.SOHD.DocuNo  (เลขที่ invoice Winspeed)
tblproduct_detail.pd_pro_number  ←→  dbo.SODT.DocuNo  (เลขที่เอกสาร Control Ticket)
tblscale.one_car_regis           ←→  dbo.SOHD.TransRegistration (ทะเบียนรถ)
tblcustomer.one_cus_id           ←→  dbo.EMCust.CustID (รหัสลูกค้า - ต้องยืนยัน)
```

---

## การบันทึก Flow (Weighing Process)

```
1. เข้าระบบ (tbl_keyone) → บันทึกลูกค้า, รถ, สินค้าที่จะชั่ง
2. ชั่งครั้งที่ 1 (weight_in) → น้ำหนักรถเปล่า
3. บรรทุกสินค้า → บันทึก tblproduct_detail (รายละเอียดสินค้าแต่ละประเภท)
4. ชั่งครั้งที่ 2 (weight_out) → น้ำหนักรถ+สินค้า
5. คำนวณ weight_net = weight_out - weight_in
6. บันทึก tblscale (รายการชั่งสมบูรณ์)
7. อัพเดต tblorder.O_numBalance (ยอดคงเหลือ)
```

---

## สถิติข้อมูล

| ตาราง | จำนวน records (approx) |
|---|---|
| `tblscale` | 403,908 |
| `tbl_keyone` | 407,973 |
| `tblproduct_detail` | 550,161 |
| `tbl_driver` | 33,685 |
| `tblcustomer` | 5,394 |
| `tblproduct` | 491 |
| `tblorder` | 5,890 |
| `tblstore` | 18 |
| `tbl_boat` | 8 |

**ช่วงวันที่ข้อมูล:** กันยายน 2554 (2011) — ปัจจุบัน

---

## ข้อเสนอแนะสำหรับการ Integration กับ WSSale-App

### Approach 1 — Read-only Sync (แนะนำ)
- เปิด MySQL read replica หรือใช้ connection pool แยก
- API endpoint `/api/truckscale/weigh` เพื่อ lookup น้ำหนักชั่งออกจาก `tblscale` โดยใช้ทะเบียนรถ (`one_car_regis`) หรือ movebill เป็น key
- Map กับ Winspeed SO ผ่าน `pd_pro_invoid` ↔ `DocuNo`

### Approach 2 — ETL to SQL Server
- Pull ข้อมูลจาก MySQL ใส่ตาราง `wf.TruckScaleImport` ใน SQL Server ทุกวัน
- ง่ายกว่าในแง่ query เพราะ join กับ Winspeed ได้โดยตรง

### Key fields สำหรับ join
```sql
-- ดึงน้ำหนักชั่งออกสำหรับ Winspeed DocuNo
SELECT s.weight_net, s.Date_Out, s.one_car_regis
FROM tblscale s
JOIN tblproduct_detail pd ON pd.one_num = s.one_num AND pd.year = s.s_day
WHERE pd.pd_pro_invoid = 'K66467'  -- Winspeed DocuNo
```

### ข้อควรระวัง
- เครื่องชั่งอยู่ที่ 192.168.1.253 (local network เท่านั้น) — ต้อง VPN หรือ tunnel เพื่อ access จาก production server
- วันที่ต้องแปลง Excel serial → datetime: `DATE_ADD('1899-12-30', INTERVAL day_int DAY)`
- Charset tis620 อาจมีปัญหาเมื่ออ่านผ่าน Node.js driver — ต้องระบุ `charset=TIS620` ใน connection string
