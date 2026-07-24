---
documentId: "WF-UG-102"
title: "WS-Sale-App Role-based Quick Guides"
version: "v1.0-candidate"
status: Review
statusDetail: "Eight-role source-aligned quick-reference candidate"
owner: "Training Lead / Role Process Owners / QA Lead"
normative: true
sourceRefs:
  - WSSale-App/src/App.tsx
  - docs/enterprise/06-QUALITY-OPERATIONS/USER-MANUAL-CURRENT.md
  - docs/enterprise/06-QUALITY-OPERATIONS/UAT-FULL-LOOP-RUN-PLAN.md
  - test-results/e2e-evidence.json
---
# WS-Sale-App Role-based Quick Guides

| รายการ | รายละเอียด |
|---|---|
| Runtime | 1.0.1 |
| Roles | ADMIN, MANAGER, ACCOUNTING, APPROVER, COUNTER_SALES, SALES, WAREHOUSE, WEIGHBRIDGE |
| Use | Desk aid, role onboarding, refresher และ UAT operator prompt |
| Status | Review — ต้องให้ Process Owner ของแต่ละบทบาทตรวจรับ |

> Quick Guide ช่วยเตือนลำดับงาน แต่ไม่แทน User Manual, policy, SOP หรือการฝึกปฏิบัติ ผู้ใช้ต้องหยุดเมื่อข้อมูล รถ น้ำหนัก สิทธิ์ หรือผล action ไม่ชัดเจน

## 1. Role map

| Role | งานหลัก | Control ที่ต้องรักษา | Escalate ไปที่ |
|---|---|---|---|
| SALES | Quotation, SO, customer/item, rebate/giveaway request | ความถูกต้องก่อนส่งตรวจ | MANAGER / COUNTER_SALES |
| COUNTER_SALES | ตรวจซ้ำ, Paper Trail, scale health | verification gate และ trace | MANAGER / QA |
| MANAGER | ทบทวน, approve, exception, policy | segregation of duties และเหตุผล | Business Owner |
| APPROVER | approve unlock/plan ที่ได้รับมอบหมาย | authority/limit/evidence | MANAGER / Accounting |
| WAREHOUSE | pick/load/ship queue | quantity, sequence, vehicle | Warehouse Lead |
| WEIGHBRIDGE | ใบชั่งและการจับคู่รถ | health, freshness, correct ticket | Warehouse/IT |
| ACCOUNTING | post/recon/rebate/CN/report | financial integrity และ WINSpeed reference | Accounting Owner |
| ADMIN | user/master/health/support/access-as | least privilege, audit, change evidence | IT/Process Owner |

## 2. SALES — สร้างรายการที่ตรวจย้อนกลับได้

**ก่อนเริ่ม:** ตรวจ role, ลูกค้า, price/effective date, สินค้า, รถ และวันส่ง

1. สร้าง Quotation หรือ SO draft
2. ตรวจรหัสลูกค้า รายการ ปริมาณ ราคา flags และยอดรวม
3. เพิ่ม giveaway/rebate/control ticket เฉพาะที่มีสิทธิ์และหลักฐาน
4. บันทึก จดเลขอ้างอิง และตรวจ `DRAFT`
5. ส่งให้ผู้ตรวจตาม policy; ห้าม confirm เองเมื่อ control ต้องแยกบทบาท

**หยุดและแจ้ง:** ราคาผิดช่วง, ลูกค้าซ้ำ/ไม่พบ, วงเงินหรือเครดิตไม่ชัด, verification gate ถูกข้าม, บันทึกแล้วไม่ทราบผล

**Done when:** เลข SO trace ได้ ข้อมูลตรงต้นทาง สถานะถูกต้อง และผู้ตรวจได้รับ reference

## 3. COUNTER_SALES — ตรวจซ้ำก่อนรายการเดินต่อ

**ก่อนเริ่ม:** รับเลข SO และเอกสาร/ข้อมูลอ้างอิงจาก SALES

1. ค้น SO ใน Paper Trail/หน้าที่ได้รับมอบหมาย
2. เทียบลูกค้า สินค้า ปริมาณ ราคา รถ เงื่อนไข และของแถม
3. Reject พร้อมเหตุผลเมื่อข้อมูลผิด หรือ Verify เมื่อครบ
4. ตรวจ actor/time ใน audit และยืนยันว่า negative path ยังถูกบล็อก
5. ก่อนใช้ TruckScale ให้อ่าน health banner และ timestamp ทุกครั้ง

**หยุดและแจ้ง:** ผู้สร้างกับผู้ตรวจไม่แยกตาม policy, health ไม่พร้อม, มีหลายใบชั่งที่ตัดสินไม่ได้, audit ไม่แสดงผู้กระทำ

**Done when:** verification มีหลักฐานและ SO ไม่ข้าม control

## 4. MANAGER — ตัดสินใจบนข้อมูลและอำนาจที่ชัดเจน

1. เปิดรายการด้วยเลขอ้างอิง ไม่อนุมัติจากข้อความหรือภาพอย่างเดียว
2. ตรวจ scope อำนาจ วงเงิน ราคา เครดิต giveaway/rebate และเหตุผล exception
3. Confirm/Approve/Reject ตาม policy
4. ตรวจสถานะและ audit หลัง action
5. งาน Access As ต้องมีเหตุผลและ Stop Access As เมื่อจบ

**อย่าทำ:** อนุมัติรายการของตนเองเมื่อ policy ห้าม, แบ่งรายการเลี่ยงวงเงิน, อนุมัติปลดล็อกโดยไม่ประเมินผลต่อคลัง/บัญชี

**Done when:** decision, actor, time, reason และ evidence เชื่อมกันได้

## 5. APPROVER — อนุมัติ unlock และ plan อย่างมีเงื่อนไข

1. ตรวจว่าคำขออยู่ในหน้าที่และอำนาจอนุมัติ
2. อ่านเหตุผลและเปิดเอกสารต้นทาง
3. ตรวจผลกระทบด้านงบ ราคา เอกสาร คลัง และบัญชี
4. Approve/Reject พร้อมเหตุผลที่ audit ได้
5. รายการเกินอำนาจให้ escalate ห้ามให้ผู้ขอเปลี่ยนข้อความเพื่อหลบ policy

**Done when:** decision อยู่ใน authority และมีเงื่อนไข/หลักฐานครบ

## 6. WAREHOUSE — เคลื่อนสถานะตามสินค้าจริง

1. ค้น SO/ทะเบียนและตรวจ queue ที่ถูกต้อง
2. เทียบสินค้า ปริมาณ location รถ และเอกสาร
3. ทำ pick → load → scale/ship ตามลำดับ
4. ตรวจยอดและ status หลังแต่ละ action
5. ส่งต่อ WEIGHBRIDGE หรือ Accounting พร้อม reference เดิม

**หยุดและแจ้ง:** สินค้า/รถไม่ตรง, overship, สถานะข้ามลำดับ, queue ว่างทั้งที่คาดว่ามีงาน, action แล้วผลไม่ชัด

**Done when:** quantity balance ถูกต้อง สถานะ trace ได้ และไม่มีรายการค้างโดยไม่ทราบ owner

## 7. WEIGHBRIDGE — ใช้น้ำหนักที่สดและตรงรถ

1. อ่านสถานะเชื่อมต่อและจำนวนใบชั่ง
2. ค้นด้วยทะเบียนหรือ movebill
3. ตรวจ timestamp, รถ, สินค้า, ชั่งเข้า, ชั่งออก และสุทธิ
4. จับคู่ SO เมื่อข้อมูลเป็นเอกลักษณ์และตรงกัน
5. หากระบบล่ม/ข้อมูลคลุมเครือ ให้ใช้ fallback SOP และเก็บหลักฐาน

**ห้ามยืนยัน:** banner ไม่พร้อม, ข้อมูลเก่า, น้ำหนักผิดปกติ, รถไม่ตรง, มี ticket ซ้ำที่แยกไม่ได้

**Done when:** ticket/source/timestamp/SO และผู้ปฏิบัติ trace ถึงกันได้

## 8. ACCOUNTING — รักษาความตรงกันของ app และ WINSpeed

1. เปิด SHIPPED/recon queue ตามวันที่
2. เทียบ SO, invoice/CN, ลูกค้า รายการ ปริมาณ จำนวนเงิน และ reference
3. ตรวจ rebate claim/plan/allocation กับ calculation และ official record
4. บันทึกผล reconciliation และ exception
5. เมื่อ invoice/posting มีแล้ว ห้ามแก้ SO ย้อนหลังเพื่อบังคับให้ยอดตรง

**หยุดและแจ้ง:** duplicate/missing reference, ยอดไม่ตรง, period/effective date ผิด, app กับ WINSpeed ขัดกัน, audit ไม่ครบ

**Done when:** financial reference และผลกระทบยอดมีผู้ตรวจและหลักฐาน

## 9. ADMIN — สนับสนุนระบบโดยไม่ทำลาย audit

1. ตรวจ health/errors/alerts ก่อนเปลี่ยนข้อมูล
2. สร้าง/แก้ user ด้วย least privilege และ ticket ที่อนุมัติ
3. map พนักงาน/LINE/user อย่างระมัดระวังและทดสอบ login
4. แก้ master/price โดยมี effective date, owner และ rollback reference
5. ใช้ Access As เพื่อ support เท่านั้น; เก็บ actor/effective user
6. ไม่ลบ log หรือแก้ฐานข้อมูลโดยตรงนอก change procedure

**Done when:** การเปลี่ยนแปลงมี request, approver, before/after evidence และผู้ใช้ยืนยันผล

## 10. Cross-role handoff card

ทุก handoff ต้องมีอย่างน้อย: Run/Case ID (เมื่อทดสอบ), SO/Document ID, ลูกค้า/รถแบบไม่เปิดเผย PII เกินจำเป็น, current status, สิ่งที่ทำแล้ว, สิ่งที่ต้องทำต่อ, owner, due time และ evidence location

## 11. 60-second end-of-task check

1. ฉันอยู่ใน role/effective user ที่ถูกต้อง
2. ฉันทำกับ SO/รถ/เอกสารที่ถูกต้อง
3. ฉันไม่ข้าม control หรือ dependency warning
4. สถานะหลัง action ตรงที่คาด
5. มีเลขอ้างอิงและ audit actor/time
6. ส่งต่องานให้ owner ถัดไปแล้ว
7. Stop Access As/ออกจากระบบเมื่อจบ
