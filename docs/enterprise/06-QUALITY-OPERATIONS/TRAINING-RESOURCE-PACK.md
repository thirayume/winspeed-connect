---
documentId: "WF-TRN-101"
title: "WS-Sale-App Training Resource Pack"
version: "v1.0-candidate"
status: Review
statusDetail: "Facilitator and learner resource candidate aligned to runtime 1.0.1"
owner: "Training Lead / Process Owners / QA Lead"
normative: true
sourceRefs:
  - docs/enterprise/06-QUALITY-OPERATIONS/USER-MANUAL-CURRENT.md
  - docs/enterprise/06-QUALITY-OPERATIONS/ROLE-BASED-QUICK-GUIDES.md
  - docs/enterprise/06-QUALITY-OPERATIONS/UAT-FULL-LOOP-RUN-PLAN.md
  - docs/enterprise/pipeline/docgen/uat-cases.json
  - test-results/e2e-evidence.json
---
# WS-Sale-App Training Resource Pack

| รายการ | รายละเอียด |
|---|---|
| Runtime | 1.0.1 |
| Audience | ผู้สอน ผู้เรียน Process Owner Floor-walker Helpdesk และ UAT facilitators |
| Delivery | Role-based workshop + guided practice + assessment + hypercare |
| Status | Review — ห้ามใช้ประกาศ competency อย่างเป็นทางการก่อน Process Owner ตรวจรับ |

> เป้าหมายการสื่อสาร: เมื่อจบการฝึก ผู้ใช้แต่ละบทบาทต้องสามารถทำ scenario ของตนโดยไม่ข้าม control รู้วิธีหยุดเมื่อข้อมูลไม่เชื่อถือ และส่งมอบหลักฐานให้บทบาทถัดไปได้

## 1. Learning outcomes

ผู้เรียนต้องสามารถ:

1. เข้าระบบและตรวจ role/effective user ได้ถูกต้อง
2. อธิบาย full loop ตั้งแต่ Sales ถึง Accounting ได้
3. ทำ happy path ของบทบาทตนโดยไม่ต้องมีผู้สอนบอกทีละคลิก
4. ระบุ control gate และ evidence ที่ต้องเก็บ
5. ตอบสนองต่อ loading, dependency down, ambiguous data, rejection และ unlock request ได้
6. ใช้ข้อมูลทดสอบโดยไม่เปิดเผย PII/secrets
7. รู้ escalation owner และไม่แก้ข้อมูลย้อนหลังเพื่อปกปิดปัญหา

## 2. Audience and recommended duration

| Cohort | เวลา | Scenario หลัก | Competency evidence |
|---|---:|---|---|
| SALES | 2.5 ชม. | Quotation → SO draft → handoff | SO trace + checklist |
| COUNTER_SALES | 2.5 ชม. | verification + Paper Trail + health | verify/reject evidence |
| MANAGER / APPROVER | 2 ชม. | approval, exception, unlock, Access As | decision audit |
| WAREHOUSE | 2 ชม. | pick/load/ship queue | status/quantity evidence |
| WEIGHBRIDGE | 2 ชม. | health, lookup, match, fallback | ticket/source evidence |
| ACCOUNTING | 3 ชม. | post/recon/rebate/CN | signed reconciliation |
| ADMIN / IT | 3.5 ชม. | user/master/health/support/audit | change record |
| Cross-role full loop | 3–4 ชม. | one traceable transaction across roles | run pack + debrief |

## 3. Instructor preparation checklist

- รัน drift/status gate และจด source/document inventory hash
- ยืนยัน build/runtime, environment URL และ E2E evidence freshness
- เตรียม user ครบ 8 roles โดยใช้บัญชีทดสอบ
- เตรียม Test Data ID สำหรับลูกค้า สินค้า ราคา รถ plan และเอกสาร
- ตรวจ frontend/API/SQL Server/MySQL health ตาม scenario
- เตรียม fallback scenario โดยไม่ทำลายระบบจริง
- เปิด defect tracker, attendance, assessment และ evidence folder
- ยืนยันว่า screenshot ไม่มี password, secret หรือ PII เกินจำเป็น
- แจ้งกติกา Stop Work และ escalation ก่อนเริ่ม hands-on

## 4. Standard workshop agenda

| ช่วง | เวลา | วิธี | ผลลัพธ์ |
|---|---:|---|---|
| Context and controls | 20 นาที | อธิบาย full loop และ role map | รู้เหตุผลของแต่ละ gate |
| Guided tour | 25 นาที | แสดง Dashboard, nav, search, status | อ่านหน้าจอได้ |
| Instructor demo | 35 นาที | ทำ happy path พร้อม think-aloud | เห็น action/evidence/handoff |
| Role practice | 45–90 นาที | ผู้เรียนทำตาม case card | ได้หลักฐานของตน |
| Exception drill | 30 นาที | reject/down/ambiguous/duplicate | รู้จุดหยุดงาน |
| Assessment | 20–30 นาที | ทำงานโดยไม่ช่วยทีละขั้น | Pass/needs coaching |
| Debrief | 15 นาที | ทบทวน defect และ control | action owner ชัดเจน |

## 5. Full-loop facilitator script

### Module A — SALES creates traceable work

**Prompt:** สร้าง SO จาก Test Data ID ที่กำหนด ตรวจราคาและรถ แล้วส่งเลขอ้างอิงให้ผู้ตรวจ

**Observe:** role, customer ID, item/quantity, price level, requested date, vehicle, giveaway flags, save result, `DRAFT`, handoff

**Ask:** ถ้ากดบันทึกแล้วหน้าจอค้าง loading ผู้เรียนจะทำอย่างไรเพื่อไม่สร้างรายการซ้ำ

### Module B — MANAGER/COUNTER verifies and ADMIN confirms

**Prompt:** ตรวจ SO เดิม ทำ negative attempt ก่อน verify แล้วจึงดำเนินการตาม policy

**Observe:** same SO, independent review, reject reason, verification gate, actor/time, confirm prerequisite

**Ask:** หลักฐานใดพิสูจน์ว่าระบบบล็อกก่อนผ่าน control และใครเป็น real actor เมื่อใช้ Access As

### Module C — TruckScale health and matching

**Prompt:** ตรวจ health ก่อนค้นทะเบียน เปรียบเทียบ ticket และเลือกว่าจะ proceed หรือ stop

**Observe:** banner, timestamp, plate/movebill, uniqueness, weight units, fallback decision

**Inject:** dependency down หรือมี ticket สองรายการคล้ายกัน ผู้เรียนต้องไม่เดา

### Module D — WAREHOUSE picks, loads and ships

**Prompt:** ค้น SO เดิมและทำ transition ตามลำดับ

**Observe:** queue/tab, item/quantity/vehicle, blocked transition, status after action, handoff

**Ask:** ถ้าคิวว่างแต่ผู้สอนคาดว่ามีรายการ ผู้เรียนควรเก็บหลักฐานอะไร

### Module E — Paper Trail and Accounting closure

**Prompt:** ตรวจ Paper Trail/audit และกระทบยอดกับ reference ที่เตรียมไว้

**Observe:** search, card state, copy/exception, audit chain, invoice/CN/rebate reference, reconciliation result

**Boundary:** Automated screenshot ที่เป็น empty state ไม่พิสูจน์ business completion; ผู้เรียนต้องใช้ transaction evidence จริงในรอบ UAT

## 6. Exception drill cards

| Card | Situation | Required learner response | Pass evidence |
|---|---|---|---|
| EX-01 | Confirm ก่อน verify | หยุด อ่าน error เปิด prerequisite | blocked response + correct retry |
| EX-02 | หน้าจอ loading หลัง action | ไม่กดซ้ำ ตรวจ search/API/status | one transaction + incident note |
| EX-03 | TruckScale down/stale | ไม่ยืนยัน ใช้ fallback/escalate | health/time + decision |
| EX-04 | ทะเบียนหรือ ticket คลุมเครือ | หยุดและขอข้อมูลเพิ่ม | comparison + owner |
| EX-05 | Giveaway เกินงบ | ใช้ warning/approval path | request + approval audit |
| EX-06 | App กับ WINSpeed ยอดไม่ตรง | เปิด reconciliation incident | reference pair + owner |
| EX-07 | ไม่เห็นเมนู | ตรวจ role/Access As ไม่แชร์บัญชี | effective role + request |
| EX-08 | Paper copy สูญหาย | บันทึก LOST/escalate ตาม SOP | event + actor/time |

## 7. Learner practice case card

| Field | ผู้สอนกำหนด / ผู้เรียนบันทึก |
|---|---|
| Session / Case ID | |
| Learner / Role | |
| Environment / Build | |
| Test Data ID | |
| SO / Document / Vehicle reference | |
| Expected starting status | |
| Actions completed | |
| Actual ending status | |
| Evidence location | |
| Exception / Defect ID | |
| Handoff recipient | |

## 8. Competency assessment

| Dimension | Weight | Pass behavior |
|---|---:|---|
| Task accuracy | 30% | ทำข้อมูลและลำดับถูกต้อง |
| Control compliance | 25% | ไม่ข้าม verify/approve/health/recon |
| Evidence and traceability | 20% | มี reference, actor/time, result |
| Exception response | 15% | หยุดงานและ escalate ถูก |
| Data protection | 10% | ไม่เปิดเผย credentials/secrets/PII |

เกณฑ์แนะนำ: คะแนนรวมอย่างน้อย 80%, Control compliance และ Data protection ต้องไม่เป็นศูนย์ และ critical safety question ต้องตอบถูกทั้งหมด ผู้ที่ยังไม่ผ่านให้ coaching และ retest ด้วย case ใหม่

## 9. Knowledge check

1. Dashboard aging ต่างจาก AR aging อย่างไร
2. ทำไมต้องตรวจ role/effective user ก่อน action
3. เมื่อบันทึกแล้วหน้าจอ loading ควรตรวจอะไร ก่อนกดอีกครั้ง
4. verification gate ป้องกันความเสี่ยงอะไร
5. health banner และ timestamp สำคัญต่อ TruckScale อย่างไร
6. เมื่อ app กับ WINSpeed ต่างกัน ใครเป็น owner และต้องเก็บ reference ใด
7. เมื่อใดต้อง Stop Access As
8. automated E2E 10/10 ยังไม่ครอบคลุม acceptance เรื่องใดบ้าง

## 10. Training records and evidence

เก็บ agenda, version/source hash, attendance, instructor, environment, case assignment, assessment, screenshots, defects, retest และ feedback ตาม retention policy ห้ามแก้ผล assessment เดิม; ให้บันทึก retest เป็น record ใหม่

## 11. Hypercare and refresher

- จัด floor-walker รายบทบาทในช่วงเริ่มใช้
- triage รายวันโดยแยก defect, data issue, training gap และ change request
- ทบทวน reconciliation และ unresolved handoff ทุกสิ้นวัน
- อัปเดต FAQ จากปัญหาที่เกิดจริง แต่ต้องผ่าน source review ก่อนรวมในคู่มือ
- retrain เมื่อ role/menu/business rule/control/integration เปลี่ยน หรือเมื่อ incident ชี้ว่าผู้ใช้ไม่เข้าใจจุดหยุดงาน

## 12. Release boundary

Training pack นี้ยังเป็น Review candidate การลงชื่อเข้าอบรมไม่เท่ากับ UAT sign-off, การผ่าน automated E2E ไม่เท่ากับ business acceptance และการมีเอกสารไม่เท่ากับ ISO certification ต้องมีผู้อนุมัติที่มีอำนาจ หลักฐานตามขอบเขต และ baseline ที่ยอมรับแยกต่างหาก
