---
documentId: "WF-UG-102"
title: "WS-Sale-App Role-based Quick Guides"
version: "v1.0"
status: Approved
statusDetail: "Nine-role source-aligned quick-reference; reviewed and accepted 2026-07-25"
owner: "Training Lead / Role Process Owners / QA Lead"
normative: true
sourceRefs:
  - WSSale-App/src/App.tsx
  - docs/enterprise/06-QUALITY-OPERATIONS/USER-MANUAL-CURRENT.md
  - docs/enterprise/06-QUALITY-OPERATIONS/UAT-FULL-LOOP-RUN-PLAN.md
---
# WS-Sale-App Role-based Quick Guides

> 🖼️ **ภาพหน้าจอในเอกสารนี้ไม่ได้เก็บใน git** — สร้างบนเครื่องตัวเองด้วย `node docs/enterprise/pipeline/capture-screenshots.js` (เปิดแอปไว้ก่อน) เพราะภาพสร้างจากฐานข้อมูลจริงจึงมีชื่อลูกค้าและทะเบียนรถของจริง

| รายการ | รายละเอียด |
|---|---|
| Runtime | 1.0.1 |
| Roles | ADMIN, C_LEVEL, MANAGER, ACCOUNTING, APPROVER, COUNTER_SALES, SALES, WAREHOUSE, WEIGHBRIDGE |
| Use | Desk aid, role onboarding, refresher และ UAT operator prompt |
| Status | Approved — ต้องให้ Process Owner ของแต่ละบทบาทตรวจรับ |
> Quick Guide ช่วยเตือนลำดับงาน แต่ไม่แทน User Manual, policy, SOP หรือการฝึกปฏิบัติ ผู้ใช้ต้องหยุดเมื่อข้อมูล รถ น้ำหนัก สิทธิ์ หรือผล action ไม่ชัดเจน

## 1. Role map

| Role | งานหลัก | Control ที่ต้องรักษา | Escalate ไปที่ |
|---|---|---|---|
| SALES | Quotation, SO, customer/item, rebate/giveaway request | ความถูกต้องก่อนส่งตรวจ | MANAGER / COUNTER_SALES |
| COUNTER_SALES | ตรวจซ้ำ, Paper Trail, scale health | verification gate และ trace | MANAGER / QA |
| MANAGER | ทบทวน, approve, exception, policy | segregation of duties และเหตุผล | Business Owner |
| APPROVER | approve unlock/plan ที่ได้รับมอบหมาย | authority/limit/evidence | MANAGER / Accounting |
| WAREHOUSE | pick/load/ship queue | quantity, sequence, vehicle | Warehouse Lead |
| WEIGHBRIDGE | ใบชั่ง จับคู่รถ ชั่งออกและออกใบส่งของ | health, freshness, correct ticket · ไม่ทำงานคลัง | Warehouse/IT |
| ACCOUNTING | post/recon/rebate/CN/report | financial integrity และ WINSpeed reference | Accounting Owner |
| ADMIN | user/master/health/support/access-as | least privilege, audit, change evidence | IT/Process Owner |
| C_LEVEL | ภาพรวมทั้งบริษัท, นโยบาย, ราคา, อนุมัติระดับสูง | ใช้อำนาจเต็มเท่าที่จำเป็น และทิ้งเหตุผลไว้เสมอ | Business Owner |

## 2. SALES — สร้างรายการที่ตรวจย้อนกลับได้

![หน้าขายของบทบาท SALES](../05-UI-SCREENSHOTS/generated/sales--sales.png)

**ก่อนเริ่ม:** ตรวจ role, ลูกค้า, price/effective date, สินค้า, รถ และวันส่ง

1. สร้าง Quotation หรือ SO draft
2. ตรวจรหัสลูกค้า รายการ ปริมาณ ราคา flags และยอดรวม
3. เพิ่ม giveaway/rebate/control ticket เฉพาะที่มีสิทธิ์และหลักฐาน
4. บันทึก จดเลขอ้างอิง และตรวจ `DRAFT`
5. ส่งให้ผู้ตรวจตาม policy; ห้าม confirm เองเมื่อ control ต้องแยกบทบาท

**หยุดและแจ้ง:** ราคาผิดช่วง, ลูกค้าซ้ำ/ไม่พบ, วงเงินหรือเครดิตไม่ชัด, verification gate ถูกข้าม, บันทึกแล้วไม่ทราบผล

**Done when:** เลข SO trace ได้ ข้อมูลตรงต้นทาง สถานะถูกต้อง และผู้ตรวจได้รับ reference

## 3. COUNTER_SALES — ตรวจซ้ำก่อนรายการเดินต่อ

![หน้า Paper Trail ของบทบาท COUNTER_SALES](../05-UI-SCREENSHOTS/generated/counter-sales--papertrail.png)

**ก่อนเริ่ม:** รับเลข SO และเอกสาร/ข้อมูลอ้างอิงจาก SALES

1. ค้น SO ใน Paper Trail/หน้าที่ได้รับมอบหมาย
2. เทียบลูกค้า สินค้า ปริมาณ ราคา รถ เงื่อนไข และของแถม
3. Reject พร้อมเหตุผลเมื่อข้อมูลผิด หรือ Verify เมื่อครบ
4. ตรวจ actor/time ใน audit และยืนยันว่า negative path ยังถูกบล็อก
5. ก่อนใช้ TruckScale ให้อ่าน health banner และ timestamp ทุกครั้ง

**หยุดและแจ้ง:** ผู้สร้างกับผู้ตรวจไม่แยกตาม policy, health ไม่พร้อม, มีหลายใบชั่งที่ตัดสินไม่ได้, audit ไม่แสดงผู้กระทำ

**Done when:** verification มีหลักฐานและ SO ไม่ข้าม control

## 4. MANAGER — ตัดสินใจบนข้อมูลและอำนาจที่ชัดเจน

![Dashboard ของบทบาท MANAGER](../05-UI-SCREENSHOTS/generated/manager--dashboard.png)

1. เปิดรายการด้วยเลขอ้างอิง ไม่อนุมัติจากข้อความหรือภาพอย่างเดียว
2. ตรวจ scope อำนาจ วงเงิน ราคา เครดิต giveaway/rebate และเหตุผล exception
3. Confirm/Approve/Reject ตาม policy
4. ตรวจสถานะและ audit หลัง action
5. งาน Access As ต้องมีเหตุผลและ Stop Access As เมื่อจบ

**อย่าทำ:** อนุมัติรายการของตนเองเมื่อ policy ห้าม, แบ่งรายการเลี่ยงวงเงิน, อนุมัติปลดล็อกโดยไม่ประเมินผลต่อคลัง/บัญชี

**Done when:** decision, actor, time, reason และ evidence เชื่อมกันได้

## 5. APPROVER — อนุมัติ unlock และ plan อย่างมีเงื่อนไข

![หน้าคำขอปลดล็อกของบทบาท APPROVER](../05-UI-SCREENSHOTS/generated/approver--control-ticket.png)

1. ตรวจว่าคำขออยู่ในหน้าที่และอำนาจอนุมัติ
2. อ่านเหตุผลและเปิดเอกสารต้นทาง
3. ตรวจผลกระทบด้านงบ ราคา เอกสาร คลัง และบัญชี
4. Approve/Reject พร้อมเหตุผลที่ audit ได้
5. รายการเกินอำนาจให้ escalate ห้ามให้ผู้ขอเปลี่ยนข้อความเพื่อหลบ policy

**Done when:** decision อยู่ใน authority และมีเงื่อนไข/หลักฐานครบ

## 6. WAREHOUSE — เคลื่อนสถานะตามสินค้าจริง

![หน้าคลังของบทบาท WAREHOUSE](../05-UI-SCREENSHOTS/generated/warehouse--store.png)

1. ค้น SO/ทะเบียนและตรวจ queue ที่ถูกต้อง
2. เทียบสินค้า ปริมาณ location รถ และเอกสาร
3. ทำ pick → load → scale/ship ตามลำดับ
4. ตรวจยอดและ status หลังแต่ละ action
5. ส่งต่อ WEIGHBRIDGE หรือ Accounting พร้อม reference เดิม

**หยุดและแจ้ง:** สินค้า/รถไม่ตรง, overship, สถานะข้ามลำดับ, queue ว่างทั้งที่คาดว่ามีงาน, action แล้วผลไม่ชัด

**Done when:** quantity balance ถูกต้อง สถานะ trace ได้ และไม่มีรายการค้างโดยไม่ทราบ owner

## 7. WEIGHBRIDGE — ใช้น้ำหนักที่สดและตรงรถ

![หน้า TruckScale ของบทบาท WEIGHBRIDGE](../05-UI-SCREENSHOTS/generated/weighbridge--truckscale.png)

1. อ่านสถานะเชื่อมต่อและจำนวนใบชั่ง
2. ค้นด้วยทะเบียนหรือ movebill
3. ตรวจ timestamp, รถ, สินค้า, ชั่งเข้า, ชั่งออก และสุทธิ
4. จับคู่ SO เมื่อข้อมูลเป็นเอกลักษณ์และตรงกัน
5. บันทึกน้ำหนักและปิดการชั่งออก ระบบจะเขียนน้ำหนักกลับเข้า TruckScale ให้เอง
6. หากระบบล่ม/ข้อมูลคลุมเครือ ให้ใช้ fallback SOP และเก็บหลักฐาน

**ขอบเขตสิทธิ์:** ทำได้ถึงชั่งออก ออกใบส่งของ sync TruckScale และจับคู่ Weigh Inbox — **ไม่มีสิทธิ์จัดของ (pick) และขึ้นของ (load)** ซึ่งเป็นงานของ WAREHOUSE เพื่อคงการแบ่งแยกหน้าที่ระหว่างผู้เตรียมของกับผู้ปิดน้ำหนัก

**ห้ามยืนยัน:** banner ไม่พร้อม, ข้อมูลเก่า, น้ำหนักผิดปกติ, รถไม่ตรง, มี ticket ซ้ำที่แยกไม่ได้

**Done when:** ticket/source/timestamp/SO และผู้ปฏิบัติ trace ถึงกันได้

## 8. ACCOUNTING — รักษาความตรงกันของ app และ WINSpeed

![หน้ากระทบยอดของบทบาท ACCOUNTING](../05-UI-SCREENSHOTS/generated/accounting--recon.png)

1. เปิด SHIPPED/recon queue ตามวันที่
2. เทียบ SO, invoice/CN, ลูกค้า รายการ ปริมาณ จำนวนเงิน และ reference
3. ตรวจ rebate claim/plan/allocation กับ calculation และ official record
4. บันทึกผล reconciliation และ exception
5. เมื่อ invoice/posting มีแล้ว ห้ามแก้ SO ย้อนหลังเพื่อบังคับให้ยอดตรง

**หยุดและแจ้ง:** duplicate/missing reference, ยอดไม่ตรง, period/effective date ผิด, app กับ WINSpeed ขัดกัน, audit ไม่ครบ

**Done when:** financial reference และผลกระทบยอดมีผู้ตรวจและหลักฐาน

## 9. ADMIN — สนับสนุนระบบโดยไม่ทำลาย audit

![หน้าสถานะระบบ](../05-UI-SCREENSHOTS/generated/admin--ops.png)

1. ตรวจ health/errors/alerts ก่อนเปลี่ยนข้อมูล
2. สร้าง/แก้ user ด้วย least privilege และ ticket ที่อนุมัติ
3. map พนักงาน/LINE/user อย่างระมัดระวังและทดสอบ login
4. แก้ master/price โดยมี effective date, owner และ rollback reference
5. ใช้ Access As เพื่อ support เท่านั้น; เก็บ actor/effective user
6. ไม่ลบ log หรือแก้ฐานข้อมูลโดยตรงนอก change procedure

**Done when:** การเปลี่ยนแปลงมี request, approver, before/after evidence และผู้ใช้ยืนยันผล

## 10. C_LEVEL — ใช้อำนาจเต็มโดยไม่ทำลายร่องรอย

![หน้าภาพรวมของบทบาท C_LEVEL](../05-UI-SCREENSHOTS/generated/c-level--dashboard.png)

C_LEVEL เป็นบทบาทที่ระบบให้สิทธิ์กว้างที่สุดรองจาก ADMIN โดยเน้นด้าน "ธุรกิจ" ไม่ใช่ด้านระบบ
เห็นภาพรวมทั้งบริษัท อนุมัติแผนรีเบท ราคา และนโยบายอนุมัติได้ แต่ไม่ได้ทำหน้าที่ดูแลผู้ใช้และระบบแทน ADMIN

1. เริ่มจาก Dashboard เพื่อดูภาพรวม แล้วกดลงไปที่เอกสารต้นทางก่อนตัดสินใจทุกครั้ง
2. ใช้รายงานและหน้ากระทบยอดเพื่อดูว่าตัวเลขในระบบกับ WINSpeed ตรงกันหรือไม่
3. อนุมัติแผนรีเบทและ Price Book ตามอำนาจ พร้อมระบุเหตุผลที่ตรวจย้อนได้
4. ใช้หน้านโยบายอนุมัติเพื่อกำหนดวงเงินและเงื่อนไข ไม่ใช่ไปแก้รายการรายตัว
5. หลีกเลี่ยงการลงมือแก้รายการปฏิบัติการเอง ให้ส่งกลับไปที่เจ้าของงานเพื่อคงการแบ่งแยกหน้าที่

**อย่าทำ:** ใช้สิทธิ์ C_LEVEL ข้าม verification gate เพื่อความรวดเร็ว, แก้รายการของหน้างานเองโดยไม่แจ้งเจ้าของงาน, อนุมัติโดยอ้างอิงรายงานสรุปอย่างเดียวโดยไม่เปิดเอกสารต้นทาง

**Done when:** การตัดสินใจอ้างอิงเอกสารต้นทางได้ และมีเหตุผลบันทึกไว้ใน audit

## 11. Cross-role handoff card

ทุก handoff ต้องมีอย่างน้อย: Run/Case ID (เมื่อทดสอบ), SO/Document ID, ลูกค้า/รถแบบไม่เปิดเผย PII เกินจำเป็น, current status, สิ่งที่ทำแล้ว, สิ่งที่ต้องทำต่อ, owner, due time และ evidence location

## 12. 60-second end-of-task check

1. ฉันอยู่ใน role/effective user ที่ถูกต้อง
2. ฉันทำกับ SO/รถ/เอกสารที่ถูกต้อง
3. ฉันไม่ข้าม control หรือ dependency warning
4. สถานะหลัง action ตรงที่คาด
5. มีเลขอ้างอิงและ audit actor/time
6. ส่งต่องานให้ owner ถัดไปแล้ว
7. Stop Access As/ออกจากระบบเมื่อจบ
