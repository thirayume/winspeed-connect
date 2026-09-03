---
documentId: "WF-UG-101"
title: "WS-Sale-App User Manual — Current Runtime"
version: "v1.0"
status: Approved
statusDetail: "Source-aligned learning candidate; reviewed and accepted 2026-07-25"
owner: "Business Process Owners / Training Lead / QA Lead"
normative: true
sourceRefs:
  - WSSale-App/src/App.tsx
  - docs/enterprise/02-REQUIREMENTS/CURRENT-SYSTEM-STATE.md
  - docs/enterprise/06-QUALITY-OPERATIONS/UAT-FULL-LOOP-RUN-PLAN.md
---
# WS-Sale-App User Manual — คู่มือผู้ใช้ฉบับปัจจุบัน

> 🖼️ **ภาพหน้าจอในเอกสารนี้ไม่ได้เก็บใน git** — สร้างบนเครื่องตัวเองด้วย `node docs/enterprise/pipeline/capture-screenshots.js` (เปิดแอปไว้ก่อน) เพราะภาพสร้างจากฐานข้อมูลจริงจึงมีชื่อลูกค้าและทะเบียนรถของจริง

| รายการ | รายละเอียด |
|---|---|
| Product / Runtime | WS-Sale-App / 1.0.1 |
| Audience | ผู้ใช้ 8 บทบาท, หัวหน้างาน, ผู้สอน, Helpdesk และผู้ตรวจสอบ |
| Scope | Sales, approval, counter/scale, warehouse, Paper Trail, finance, accounting, reporting และ administration |
| Status | Approved — ยังไม่เป็น Released user manual |
| Evidence date | 23 กรกฎาคม 2569 / 23 July 2026 |
| Data policy | ใช้ข้อมูลทดสอบหรือข้อมูลที่ปกปิด PII ในคู่มือและการฝึกอบรม |

> คู่มือนี้อธิบาย “วิธีทำงานและจุดควบคุม” สำหรับผู้ใช้ทั่วไป ส่วน SRS, Analysis and Design และ Technical Specification ใช้สำหรับรายละเอียดเชิงวิศวกรรม หากข้อความขัดกับ source code หรือหลักฐานที่ใหม่กว่า ให้หยุดและแจ้งผู้ดูแลเอกสารเพื่อทำ drift review

## 1. เริ่มต้นอย่างปลอดภัย

ก่อนเริ่มงาน ให้ตรวจ 4 เรื่อง: ชื่อผู้ใช้และบทบาทที่มุมขวาบน, สภาพแวดล้อมที่ได้รับมอบหมาย, สถานะ dependency ที่หน้าจอแสดง และเลขอ้างอิงงานที่กำลังทำ ห้ามใช้บัญชีผู้อื่น ห้ามบันทึกรหัสผ่านในภาพ และห้ามยืนยันข้อมูลน้ำหนักเมื่อหน้าจอแจ้งว่า dependency ไม่พร้อม

### 1.1 เข้าสู่ระบบ

![หน้าเข้าสู่ระบบ](../05-UI-SCREENSHOTS/generated/00-login.png)

1. เปิด URL ที่ IT/Operations ประกาศสำหรับสภาพแวดล้อมนั้น
2. เข้าด้วย username/password หรือ LINE Login ตามวิธีที่องค์กรเปิดใช้
3. ตรวจชื่อและ role ที่มุมขวาบนก่อนเริ่มทำรายการ
4. หาก LINE ยังไม่เชื่อม ระบบอาจให้ยืนยันบัญชี WS-Sale-App เดิมก่อน
5. เมื่อเลิกใช้งาน ให้ Stop Access As ถ้ามี แล้วออกจากระบบ

### 1.2 ใช้ Access As

บทบาท `ADMIN`, `MANAGER`, `ACCOUNTING`, `APPROVER` และ `COUNTER_SALES` อาจเห็นเมนู Access As เพื่อช่วยเหลือหรือทดสอบสิทธิ์ของผู้ใช้อื่น ขณะใช้งาน เมนู ข้อมูล และสิทธิ์จะยึด effective user แต่ระบบยังเก็บ real actor ใน audit trail

1. เปิด Access As จาก topbar และเลือกผู้ใช้ที่ได้รับอนุญาต
2. ตรวจแถบ/ชื่อ effective user ก่อนทำรายการ
3. ทำเฉพาะงานที่มี ticket หรือเหตุผลรองรับ
4. กด Stop Access As ทันทีเมื่อจบงาน
5. หากทำรายการผิด ให้จดเวลา เลขเอกสาร และแจ้ง Admin/QA; ห้ามลบ audit record

## 2. เมนูและบทบาท

| กลุ่มเมนู | หน้าที่ | ตัวอย่างเมนู |
|---|---|---|
| งานหลัก | งานประจำวันตั้งแต่ขายถึงติดตามเอกสาร | Dashboard, ขาย, เสนอราคา, คลัง, Paper Trail, ตั๋วคงค้าง |
| การเงิน | รีเบท แผน ใบลดหนี้ และของแถม | รีเบท, Rebate Plan, CN Rebate, ของแถม |
| บัญชี | การ post, กระทบยอด รายงาน และตั๋วคุม | บัญชี, กระทบยอด, รายงาน, ชุดตั๋วคุม |
| คลัง/ชั่ง | คิวคลัง ใบชั่ง และการจับคู่ SO | TruckScale, Weigh Inbox |
| ระบบ | ข้อมูลหลัก นโยบาย กำกับข้อมูล สุขภาพระบบ และผู้ใช้ | ข้อมูลหลัก, นโยบายอนุมัติ, กำกับข้อมูล, สถานะระบบ, User Management |

เมนูที่เห็นขึ้นกับ role และ policy ปัจจุบัน การไม่เห็นเมนูไม่ใช่ความผิดพลาดเสมอไป หากต้องใช้เมนูเพิ่ม ให้ขอผ่านผู้บังคับบัญชาและ Admin โดยไม่แชร์บัญชี

## 3. อ่าน Dashboard ให้ถูก

![Dashboard](../05-UI-SCREENSHOTS/generated/sales--dashboard.png)

Dashboard ใช้ดูภาพรวม SO และภาระงาน ไม่ใช่รายงานลูกหนี้ค้างชำระ ตัวเลขและแถบสถานะช่วยตอบว่า “งานอยู่ขั้นไหน” และ “รายการใดต้องเร่งติดตาม”

1. ตรวจเวลาที่ข้อมูลถูก refresh และตัวกรองวันที่
2. ใช้ช่องค้นหาด้วยชื่อลูกค้า ทะเบียนรถ หรือเลขเอกสาร
3. ตรวจ SO ค้างจัดส่ง โดยเฉพาะช่วงมากกว่า 30 และ 45 วัน
4. เปิดรายการต้นทางก่อนตัดสินใจ อย่าตีความจากตัวเลขสรุปเพียงอย่างเดียว
5. หากยอดผิดปกติ ให้บันทึก filter, เวลา และภาพหน้าจอ แล้วแจ้ง Process Owner

## 4. กระบวนการหลัก: Order-to-Cash operational loop

| ขั้น | ผู้รับผิดชอบหลัก | สิ่งที่ทำ | หลักฐาน/จุดควบคุม |
|---|---|---|---|
| 1. สร้างรายการ | SALES | สร้าง Quotation หรือ SO draft | เลขเอกสาร, ลูกค้า, สินค้า, ปริมาณ, รถ |
| 2. ตรวจและอนุมัติ | MANAGER / ADMIN / COUNTER_SALES | ตรวจราคา เงื่อนไข ของแถม และ verification gate | ผู้ตรวจ เวลา เหตุผล และสถานะ |
| 3. เตรียมส่ง | WAREHOUSE | pick/load ตามลำดับ | คิว สินค้า ปริมาณ รถ และผู้ปฏิบัติ |
| 4. ชั่งและส่งออก | WEIGHBRIDGE / WAREHOUSE | ตรวจ health จับคู่ใบชั่ง และ ship | แหล่งน้ำหนัก timestamp น้ำหนักสุทธิ |
| 5. ติดตามเอกสาร | ADMIN / ทุกบทบาทที่เกี่ยวข้อง | ตรวจ Paper Trail, copy, QR และ exception | สถานะสำเนา audit trail |
| 6. กระทบยอด | ACCOUNTING | ตรวจ invoice/CN/rebate/posting กับ WINSpeed | reference ID และ reconciliation result |

## 5. ขายและใบเสนอราคา

### 5.1 สร้าง Sales Order

![หน้าขาย (POS)](../05-UI-SCREENSHOTS/generated/sales--sales.png)

1. ไปที่ **ขาย** และเลือก prefix/ประเภทงานตามกระบวนการ
2. ค้นหาและเลือกลูกค้า ตรวจชื่อ รหัส ที่อยู่ และเงื่อนไขเครดิต
3. กรอกวันส่ง ทะเบียนรถ ประเภทรถ และ flags การขนส่งที่เกี่ยวข้อง
4. เพิ่มสินค้า ระบุปริมาณ หน่วย ราคา และตรวจสี/ระดับราคาเทียบ Set Price
5. ตรวจ rebate preview, ของแถม และตั๋วคุมเฉพาะที่ได้รับสิทธิ์
6. อ่านยอดรวมและหมายเหตุซ้ำก่อนบันทึก
7. กดบันทึกและจดเลข SO; สถานะเริ่มต้นต้องเป็น `DRAFT`
8. ส่งเลขอ้างอิงให้ผู้ตรวจตาม verification/approval policy

**อย่าทำ:** ใช้ลูกค้าคล้ายชื่อกันโดยไม่ตรวจรหัส, ใส่ทะเบียนรถสมมติในงานจริง, แยกบิลเพื่อเลี่ยงวงเงิน หรือยืนยันก่อนผ่าน control gate

### 5.2 สร้างและแปลง Quotation

![หน้าเสนอราคา](../05-UI-SCREENSHOTS/generated/sales--quotation.png)

1. ไปที่ **เสนอราคา** และสร้างรายการลูกค้า สินค้า ปริมาณ ราคา และอายุข้อเสนอ
2. ตรวจสถานะจาก DRAFT ไป SENT/ACCEPTED ตามขั้นตอนธุรกิจ
3. ตรวจ native WINSpeed references ที่หน้าจอแสดงเมื่อมี
4. Convert เป็น SO หลังเงื่อนไขครบเท่านั้น
5. เปิด SO ที่สร้างใหม่และตรวจว่าข้อมูลสำคัญครบ ไม่ใช้เลข Quotation แทนเลข SO

## 6. Verification, approval และการปลดล็อก

ผู้ตรวจต้องเป็นคนละบทบาทตาม policy เมื่อองค์กรกำหนด เพื่อคง segregation of duties

1. ค้น SO เดียวกันด้วยเลขอ้างอิง
2. เทียบลูกค้า สินค้า ปริมาณ ราคา รถ ของแถม เครดิต และหมายเหตุ
3. หากไม่ถูกต้อง ให้ Reject/ส่งกลับพร้อมเหตุผลที่ผู้สร้างแก้ได้
4. หากถูกต้อง ให้ Verify/Approve ตามสิทธิ์และตรวจ audit actor/time
5. ทดสอบว่ารายการที่ยังไม่ผ่าน gate ไม่สามารถข้ามไป confirm/ship

เมื่อขอปลดล็อก ให้ระบุเหตุผลที่ตรวจสอบได้ ไม่ใช้ข้อความสั้นแบบ “แก้” ผู้อนุมัติต้องตรวจผลกระทบต่อคลัง น้ำหนัก เอกสาร และบัญชีก่อนอนุมัติ

## 7. คลัง, TruckScale และ Weigh Inbox

### 7.1 WAREHOUSE: pick และ load

![หน้าคลัง](../05-UI-SCREENSHOTS/generated/warehouse--store.png)

1. เปิด **คลัง** และค้น SO/ลูกค้า/ทะเบียนรถ
2. ตรวจ tab หรือคิวว่าเป็นโหลดสินค้า หรือเครื่องชั่ง
3. ตรวจสินค้า ปริมาณ location และ prerequisite ก่อนเริ่มรับ/จัด
4. ทำ transition ตามลำดับที่หน้าจออนุญาต; ห้ามข้ามสถานะ
5. ตรวจยอดคงเหลือและสถานะหลังแต่ละ action

### 7.2 WEIGHBRIDGE / COUNTER_SALES: ตรวจน้ำหนัก

![หน้า Weigh Inbox](../05-UI-SCREENSHOTS/generated/warehouse--weigh-inbox.png)

1. เปิด **TruckScale** และอ่าน health banner ก่อนค้นหา
2. ค้นด้วยทะเบียนรถหรือ movebill และตรวจ timestamp/source
3. เทียบรถ สินค้า และคิวกับ SO ก่อนจับคู่
4. ตรวจชั่งเข้า ชั่งออก และน้ำหนักสุทธิ; หน่วยหลักเป็นกิโลกรัมตามหน้าจอ
5. หาก dependency down/stale/ambiguous ให้หยุดการยืนยันและใช้ fallback SOP
6. เมื่อจับคู่ถูกต้อง จึงบันทึก/ส่งต่อให้ขั้น ship

**จุดหยุดงาน:** health ไม่ชัด, ทะเบียนซ้ำ, timestamp เก่า, น้ำหนักสุทธิติดลบ/ผิดปกติ, สินค้าไม่ตรง หรือพบใบชั่งมากกว่าหนึ่งใบที่ตัดสินไม่ได้

## 8. Paper Trail และเอกสาร

![หน้า Paper Trail](../05-UI-SCREENSHOTS/generated/warehouse--papertrail.png)

Paper Trail เป็น Kanban ติดตามสถานะของ "แผ่นกระดาษ" (Physical Document) ซึ่งแยกต่างหากจากสถานะการทำงานใน ERP (เช่น รอจัดส่ง, ชั่งออก ฯลฯ) โดยเน้นไปที่การติดตาม **สำเนา 2 (ใบสีชมพู)** ที่ต้องให้ลูกค้าเซ็นรับและนำกลับมาเข้าแฟ้ม

### 8.1 แนวปฏิบัติต่อเอกสาร 4 Copy (เอกสาร D/O)
ชุดเอกสารใบส่งสินค้าจาก WINSpeed จะมี 4 ใบ:
1. **ต้นฉบับ (สีขาว)**: มอบให้ลูกค้าเก็บไว้เป็นหลักฐาน
2. **สำเนา 1 (สีฟ้า)**: ส่งให้ฝ่ายบัญชี/การเงินสำหรับเปิดบิล
3. **สำเนา 2 (สีชมพู)**: **ใบสำคัญสำหรับ Paper Trail** พนักงานขับรถต้องนำไปให้ลูกค้าเซ็นรับสินค้า และนำกลับมาคืนที่ออฟฟิศ
4. **สำเนา 3 (สีเหลือง)**: ติดเล่มไว้เป็นหลักฐานต้นทาง

### 8.2 การสแกน QR Code (Scan QR Workflow)
**ไม่จำเป็นต้องสแกนเอกสารในทุกสถานะของ ERP** การสแกนจะทำเฉพาะจุดส่งมอบเอกสาร **สำเนา 2 (ใบสีชมพู)** เท่านั้น ดังนี้:

- **สถานะ "ส่งเอกสารไปกับรถ" (IN_TRANSIT)**: เมื่อรถชั่งออกและรับเอกสารไป ถือว่าเอกสารอยู่ระหว่างการเดินทาง (มักถูกตั้งอัตโนมัติเมื่อกด "ส่งออก (Ship)" หรืออาจสแกน QR เพื่อยืนยันว่าคนขับรับใบชมพูไปแล้ว)
- **สถานะ "เซ็นรับแล้ว/นำส่งกลับ" (SIGNED)**: **(จุดสแกนบังคับที่ 1)** เมื่อพนักงานขับรถกลับมาถึงออฟฟิศ ให้นำ **ใบสีชมพู** ที่ลูกค้าเซ็นรับแล้วมาสแกน QR เพื่อบันทึกว่าเอกสารกลับมาถึงบริษัทแล้ว
- **สถานะ "เข้าแฟ้ม" (FILED)**: **(จุดสแกนบังคับที่ 2)** เมื่อแอดมินหรือบัญชีรับใบสีชมพูไปตรวจสอบและจัดเก็บเข้าแฟ้ม ให้สแกน QR อีกครั้งเพื่อปิดงาน (End of Lifecycle)
- **สถานะ "สูญหาย" (LOST)**: หากพนักงานขับรถทำใบสีชมพูหาย ให้สแกน/ค้นหาเลข SO เพื่อปรับสถานะเป็นสูญหาย โดยต้องระบุเหตุผล ผู้ดำเนินการ และเวลา (หากหาพบภายหลัง สามารถเปลี่ยนเป็น FOUND ได้)

*หมายเหตุ: QR Code บนแผ่นกระดาษมีไว้เพื่อลดเวลาค้นหาเอกสาร สามารถใช้กล้องหรือเครื่องอ่านบาร์โค้ดสแกนที่หน้า "สแกนเอกสาร (QR)" เพื่อบันทึกสถานะได้ทันทีโดยไม่ต้องพิมพ์ค้นหา*

## 9. Accounting, reconciliation และ finance

### 9.1 Accounting / Post Invoice / Reconciliation

![หน้าบัญชี](../05-UI-SCREENSHOTS/generated/admin--accounting.png)

1. เปิดรายการ SHIPPED ที่พร้อม post และเลือกช่วงวันที่
2. เทียบ SO, invoice, customer, item, quantity, amount และ reference ใน WINSpeed
3. แยกรายการ “พร้อม Post” และ “Post แล้ว” ตามหลักฐานที่ระบบแสดง
4. หากพบ invoice แล้ว ให้เคารพ lock ของ SO; ห้ามแก้ย้อนหลังเพื่อให้ยอดตรง
5. บันทึกผลกระทบยอด ชื่อผู้ตรวจ วันที่ และ exception reference

### 9.2 Rebate, Rebate Plan และ CN

![หน้ารีเบท](../05-UI-SCREENSHOTS/generated/manager--rebate.png)

1. ตรวจ pool/ledger และช่วงเวลาของ plan ก่อนทำ claim หรือ allocation
2. ผู้สร้าง plan ระบุสูตร ภาค ประเภทคืน ราคา NET ช่วงเวลา งบ และ priority
3. ผู้อนุมัติตรวจงบ policy และเอกสารอ้างอิงก่อนเปิดใช้งาน
4. Accounting ตรวจ calculation, claim, CN/posting และ official WINSpeed record
5. เมื่อข้อมูล app กับ WINSpeed ต่างกัน ให้หยุดและทำ reconciliation; ห้ามปรับตัวเลขโดยไม่มีหลักฐาน

### 9.3 Giveaway และ Control Ticket

![หน้าของแถม](../05-UI-SCREENSHOTS/generated/sales--giveaway.png)

ตรวจงบ/สิทธิ์/ยอดคงเหลือและ approval ต่อบรรทัด รายการเกินงบต้องเข้าสู่ warning/approval path ตาม policy การตัด Control Ticket ต้องตรวจประวัติการตัดเพื่อป้องกันใช้ยอดซ้ำ

## 10. Reports และการส่งออกข้อมูล

![หน้ารายงาน](../05-UI-SCREENSHOTS/generated/admin--reports.png)

1. เลือกรายงานและช่วงข้อมูลที่ตรงวัตถุประสงค์
2. ตรวจ filter/role visibility ก่อน Export Excel
3. เก็บไฟล์ในพื้นที่ควบคุมสิทธิ์ ตั้งชื่อตาม run/date และไม่ส่งต่อ PII เกินจำเป็น
4. ระบุเวลา export เพราะข้อมูลระบบอาจเปลี่ยนหลังจากนั้น
5. หากยอดรายงานต่างจากหน้าจอ ให้เก็บทั้งสองหลักฐานพร้อม filter และแจ้ง Data Owner

## 11. งานผู้ดูแลระบบ

![หน้าจัดการผู้ใช้](../05-UI-SCREENSHOTS/generated/admin--admin.png)

ADMIN ดูแลผู้ใช้ การ map พนักงาน ข้อมูลหลัก Price Book และสถานะระบบ ส่วน MANAGER/ACCOUNTING เห็นเฉพาะเมนูที่ source และ policy อนุญาต

- สร้างผู้ใช้ด้วย least privilege และทบทวนผู้ใช้ inactive
- เปลี่ยน role ต้องมีคำขอและผู้อนุมัติ
- แก้ข้อมูลหลัก/ราคาโดยมี effective date และหลักฐาน
- ตรวจ health/error/alert และไม่เปิดเผย secrets ใน ticket
- ใช้ Access As เฉพาะงาน support ที่ trace ได้

## 12. ปัญหาที่พบบ่อย

| อาการ | ตรวจทันที | การดำเนินการ |
|---|---|---|
| ยืนยัน SO ไม่ได้ | verification/approval, required field, role | เปิดรายการเดียวกันและแก้ prerequisite; ห้ามข้าม gate |
| ไม่เห็นเมนู | role/effective user | Stop Access As หรือขอทบทวนสิทธิ์ |
| TruckScale ไม่พร้อม | health banner, timestamp, MySQL status | หยุดยืนยันน้ำหนักและใช้ fallback SOP |
| ค้น SO ไม่พบ | เลขเอกสาร, prefix, filter/date | ล้าง filter และค้นด้วย SO/ทะเบียน; แจ้ง Support พร้อมเวลา |
| ข้อมูลหน้าจอกับ WINSpeed ต่าง | reference และเวลาซิงก์ | ห้ามแก้ย้อนหลัง; เปิด reconciliation incident |
| Export ไม่ดาวน์โหลด | browser download/popup policy | ตรวจ policy และลองใหม่หนึ่งครั้ง; แจ้ง IT หากยังล้มเหลว |
| หน้าจอค้าง loading | network/API health | รอ refresh ที่ปลอดภัย; ห้ามกด action ซ้ำหลายครั้ง |

## 13. Self-check ก่อนจบงาน

- ฉันใช้บัญชีและ role ที่ถูกต้อง
- ฉันจดเลข SO/เอกสาร/รถที่อ้างอิงได้
- ฉันตรวจสถานะ dependency ก่อนใช้น้ำหนักหรือข้อมูล integration
- ฉันไม่ข้าม verification, approval หรือ reconciliation gate
- ฉันตรวจผลหลัง action และไม่กดซ้ำเมื่อผลยังไม่ชัด
- ฉันเก็บ evidence โดยไม่เปิดเผยรหัสผ่าน secrets หรือ PII เกินจำเป็น
- ฉันรู้ว่าจะหยุดงานและ escalate เมื่อใด

## 14. ขอบเขตหลักฐานและการทบทวน

Automated E2E ปัจจุบันผ่าน 10/10 และใช้สนับสนุนคู่มือนี้ แต่ไม่แทน business UAT, TruckScale จริง, การพิมพ์/สแกนจริง, WINSpeed accounting reconciliation, backup/restore, performance, security review หรือผู้มีอำนาจลงนาม เอกสารต้องกลับเข้าสู่ Review เมื่อ source, role, menu, business rule หรือภาพหน้าจอเปลี่ยน
