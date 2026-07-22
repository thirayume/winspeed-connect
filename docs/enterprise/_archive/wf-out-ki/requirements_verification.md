# Requirements Verification — cross-check เอกสารทีม ↔ SRS v3.0
ตรวจ: 2026-06-09 | เทียบเอกสารใน Requirements/, WS Comment Update 9-6-69/, drawio/, Database/

## สรุป: ✅ SRS v3.0 + Workflow.pptx ถูกต้องและสอดคล้องกับเอกสารทีมทุกฉบับ
แกนหลัก (WINSpeed = ระบบบัญชี, ไม่แก้ WINSpeed, ส่งเอกสารเข้าให้ WINSpeed ลงบัญชี) = ตรงกัน
ชื่อระบบทีมเรียก **WS-Sale-App** (= WSSALE-APP ใน SRS)

---

## 1. Traceability — Pain Point/Requirement ↔ FR

| เอกสารทีม | ความต้องการ | FR ใน SRS | สถานะ |
|---|---|---|---|
| ปัญหาฯ.pdf #1 | ตันพ่วงแม่-ลูก เรียงลำดับ ไม่ต้องแยกเอง | FR-019 Mother/Baby Load Seq | ✅ ตรง |
| ปัญหาฯ.pdf #2 | รายงานเฉพาะชุดตั๋วคุม (WS ได้แค่ภาพรวม) | FR-021 Control Ticket | ✅ ตรง |
| ปัญหาฯ.pdf #3 | ของแถม (เสื้อ/กระเป๋า/กระสอบเปล่า) + เห็นสต็อก | FR-020 Giveaway | ✅ ตรง |
| ปัญหาฯ.pdf #4 | รับเฉพาะชุดตั๋ว/พร้อมใบสั่งจอง + ยอดคงเหลือ | FR-021 (receiveMode) | ✅ ตรง |
| ปัญหาฯ.pdf #5 | Counter-Sales ตรวจซ้ำก่อนส่งโรงงาน | FR-022 Verification Gate | ✅ ตรง |
| ความต้องการ.txt | Rebate ตั้งทีละบิล ตัด FIFO แยก Sales | FR-008/009/010/011 | ✅ ตรง |
| ความต้องการ.txt | "บันทึกบัญชีตาม WINSpeed ดังเดิม" | D-03 แนวทาง B | ✅ ตรง |
| drawio (9 ปัญหา Sales) | quotation/stock/history/souvenir/rebate/bag/truck/ticket | F1-F7 + dashboards | ✅ ตรง |

→ **ทุก pain point ของทีมถูกครอบคลุมใน FR ของ SRS แล้ว**

---

## 2. รายละเอียดเฉพาะเจาะจงจากทีม (ต้องเติมให้ SRS สมบูรณ์)

### 2.1 Master Data classification (ยืนยันกับ DB จริงแล้ว)
| ชนิด | filter EMGood | จำนวน (active) |
|---|---|---|
| **ปุ๋ย FG (ขายได้)** | `StockFlag='Y' AND MainGoodUnitID=1002` | 193 |
| **ของแถม/Souvenir** | `GoodGroupID IS NULL AND MainGoodUnitID<>1002` (เช่น P00001 เสื้อยืดรถเกษตร) | ~99 (รวม misc) |
| **กระสอบ** | `GoodGroupID=1000` | (เช็คกระสอบใกล้หมด) |
> WF เป็น Trade → ไม่มี real-time stock ใน WS (track ได้แค่ที่ขายไป); stock จริงรอ DB โรงงาน/จัดใน wf

### 2.2 Dashboard ที่ Sales ขอ (real-time ผ่าน WS-Sale-App)
1. สต๊อก FG (StockFlag='Y') + ยอดขายจริง
2. สต๊อกของแจก (ของใครของมัน รายคน)
3. **ตั๋วคงค้าง + aging: >30 วัน = สีเหลือง, >45 วัน = สีแดง** (SOHD 103 รอชั่ง)
4. Rebate คงเหลือ (ดูอย่างเดียว, "อั๋น" เป็นคนตัด)
5. สต๊อกกระสอบ (GoodGroupID=1000)
6. **สถานะรถ 3 สถานะ**: มาถึง-รอคิว / กำลังรับสินค้า / รถออกจากโรงงาน
   (WS ไม่มี timestamp → ดึงจากเครื่องชั่ง; ใกล้สุด=SOHD.AppvFlag) → wf.WeighTicket + status

### 2.3 UX — Historical autocomplete
- พิมพ์ทะเบียนรถ "ก" → dropdown โชว์ทะเบียนที่เคยเข้า (SOHD.TransRegistration) คลิกใช้ซ้ำได้
- เลือกสูตรจากประวัติ (SODT.GoodID↔EMGood.GoodName1); **สูตรที่ไม่เคยซื้อ → สีแดง**
- ปุ่มเลือกรับสินค้า: จาก **"โม่" (grinding/mixing)** หรือ **สต๊อก** (ถ้าไม่พบใน stock → โชว์ที่เครื่องโม่)

### 2.4 ★ เงื่อนไขราคา + Approval Levels (เพิ่มจาก WF Sales Comment #4-5)
- **ราคา/ต้นทุน แยกระดับสิทธิ์**: ช่องต้นทุนกรอกโดยผู้รับผิดชอบ, ช่องราคาขายกรอกโดยผู้มีอำนาจ, บางรายการ**กรรมการเท่านั้นที่ดูได้**
- **Approval rules เฉพาะ (สำคัญ — เติมใน FR-006/007 + Price Book):**
  | กรณี | ผู้อนุมัติ | flag |
  |---|---|---|
  | แก้ไขตอนรถกำลังรับสินค้า (Picking) | **คุณสุรชัย คนเดียว** | ApproveFlagPicking |
  | ขาย**เกิน**ราคาตั้ง (set price) | **คุณรุ่งนิรันดร์ (1 คน)** | ApproveFlag SO |
  | ขาย**ต่ำกว่า**ราคาตั้ง ไม่เกิน 500 บาท | **ผจก. 3 ท่าน** อนุมัติ | ApproveFlag SO |

---

## 3. ข้อมูลที่ยังขาด (ทีมระบุ "รอ")
- DB เครื่องชั่ง (truck scale) — สำหรับ timestamp รถเข้า-ออก (ระบบใหม่ดีเลย์)
- DB โรงงาน/เครื่องโม่ — สำหรับ stock real-time + "หน้าโม่"
- Rebate: ไม่มีใน WS → สร้าง schema wf ใหม่ (ตรงกับ D-02/wf.Rebate*)

## 4. เอกสารหลักฐานจริง (ตรวจแล้ว)
- ใบสั่งจอง I69-01539/K69-01448 (ขนพร้อมทะเบียน นว71-1457/1458, หมายเหตุ "รับพร้อม...ตัดตั๋ว")
- Order Form L62452 (กระดาษ): เสื้อ 100 ตัว, กระเป๋า 50 ใบ — ของแถมไม่อยู่ใน WS
- ชุดเอกสารคืนรีเบท / สรุปเบิกเสื้อ-กระเป๋ารายภาค

## สรุปการปรับ SRS/เอกสาร
เพิ่ม: master-data classification (2.1), dashboard aging/truck-status (2.2), historical autocomplete (2.3),
**approval levels เฉพาะ (2.4)** เข้า FR-003/006/007/017/020/021/023 + CLAUDE.md
