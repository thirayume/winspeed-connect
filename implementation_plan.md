# V1.0 Implementation Plan - Enterprise Alignment & Final Integration

แผนการปรับปรุงระบบ WS-Sale-App ให้สอดคล้องกับเอกสารระดับ Enterprise V1.0 ล่าสุด (`WF-DATA-012`, `WF-DATA-013`, `WF-INT-003`) โดยเน้นความสมบูรณ์ของระบบ Rebate, การส่งข้อมูล TruckScale ทันทีเมื่อยืนยัน SO, และวงจร Quotation ↔ SO.

## User Review Required
> [!IMPORTANT]
> **การส่งข้อมูลกลับ TruckScale (Write-back):** ตามเอกสารก่อนหน้าระบุว่าเราไม่มีสิทธิ์เขียน (no write endpoint) แต่เพื่อตอบสนอง Requirement ใหม่ที่ให้ "TruckScale ควรจะมีข้อมูลของ SO เข้าไปทันทีเมื่อได้รับการยืนยัน" เราจะทำการ Insert ข้อมูล SO (ทะเบียนรถ, ลูกค้า, สินค้า, ปริมาณ) เข้าตาราง `tbl_keyone` (Pre-weigh) ใน MySQL ของ TruckScale โดยตรง — *โปรดยืนยันว่า TruckScale เปิดสิทธิ์ Write สำหรับตารางนี้แล้ว และขอโครงสร้างตาราง `tbl_keyone` ที่แน่นอน*

> [!WARNING]
> **Rebate Mirror Sync:** เราจะสร้างตาราง `wf.CouponMirror` และ `wf.CouponRedemptionMirror` เพื่อดึงข้อมูลคูปองจาก `dbo` มาที่ App (ตามเอกสารระบบคูปอง-รีเบท) เพื่อให้ข้อมูลใน Dashboard แม่นยำที่สุดตามระบบ WINSpeed — *โปรดยืนยันให้สร้าง Migration นี้เพื่อเป็น Source of Truth ใน App*

## Open Questions
1. โครงสร้างตาราง `tbl_keyone` ใน TruckScale มี Column บังคับ (Primary Key/Not Null) อะไรบ้างที่เราต้องส่งไปตอน Confirm SO? (เช่น `one_car_regis`, `one_cus_name`, `one_num`, `weight_net`)
2. การ "แปลง Quotation กลับเป็น SO" ปัจจุบัน API `/api/quotations/:id/status` รองรับการ Cancel Quote แล้วทำการปลดล็อค SO (Draft) กลับมา (เรียกใช้ `restoreSourceSalesOrdersToDraft`) — ต้องการให้ปรับปรุงและตรวจสอบ UI/UX ให้สมบูรณ์แบบร้อยเปอร์เซ็นต์ในฝั่ง Frontend ด้วยหรือไม่?

---

## Proposed Changes

### 1. ระบบ Rebate & Coupon Mirroring (V1.0 Alignment)
อ้างอิงเอกสาร `WF-DATA-013` (ระบบ Rebate / Coupon) หมวด 7

- สร้าง SQL Migration `054_rebate_coupon_mirror.sql` เพื่อสร้างตาราง:
  - `wf.CouponMirror` (สำหรับเก็บข้อมูล WFCoupon)
  - `wf.CouponRedemptionMirror` (สำหรับเก็บข้อมูลการใช้งานคูปอง)
- แก้ไข API `backend/routes/rebate.js` เพื่อเพิ่ม Job สำหรับดึงข้อมูลจาก `dbo.WFCoupon` และ `dbo.WFRedemtionDT` มาบันทึกลง Mirror Tables (MERGE / UPSERT)
- ปรับ Dashboard ให้แสดงยอด Rebate คงเหลือจาก `wf.CouponMirror` แทนการคำนวณแบบเดิมที่ไม่ได้ Sync กับ WINSpeed จริง.

#### [NEW] `backend/migrations/054_rebate_coupon_mirror.sql`
#### [MODIFY] `backend/routes/rebate.js`

---

### 2. TruckScale Push Data (tbl_keyone)
ตอบโจทย์ให้ระบบชั่งรับรู้ข้อมูลทันทีที่ SO ถูกยืนยันจากแอปพลิเคชัน.

- เพิ่มฟังก์ชันใน `backend/services/truckscale-db.js` หรือสร้าง Service ใหม่ สำหรับการ Insert เข้า `tbl_keyone`.
- เรียกใช้งานใน API เมื่อมีการเปลี่ยนสถานะเป็น `CONFIRMED` (ในขั้นตอน Confirm SO ที่ `backend/routes/so.js` หรือ `sp_ConfirmSalesOrder`).

#### [MODIFY] `backend/services/truckscale-db.js`
#### [MODIFY] `backend/routes/so.js`

---

### 3. Quotation <-> SO Conversion
อ้างอิงเอกสาร `WF-DATA-012` หมวด 3.1
- **ตรวจสอบความสมบูรณ์:** ระบบปัจจุบันรองรับการลบ Draft SO ตัวต้นฉบับเมื่อแปลงเป็น SO ใหม่หลัง Quote Accepted (ผ่าน Frontend API/UI) และคลาย Lock เมื่อ Quote Cancelled
- **ปรับปรุง Frontend Sync:** ตรวจสอบว่า UI ของหน้า Quotation สามารถนำทาง (Navigation) ไปยัง SO ที่ถูกสร้างใหม่ได้อย่างถูกต้อง และดึงค่า Flag ต่างๆ (เช่น ตั๋วคุม, คิวขึ้นของ) กลับมาได้อย่างสมบูรณ์เมื่อกด Convert to SO.

#### [MODIFY] `WSSale-App/src/components/sales/CreateSODialog.tsx` (ตรวจสอบและปรับปรุงหากจำเป็น)

---

## Verification Plan

### Automated Tests
- รัน Backend Migration ล่าสุด (054).
- สร้าง SO ใหม่ -> แปลงเป็น Quotation -> กดยกเลิก Quotation -> ตรวจสอบสถานะว่า SO กลับมาเป็น Draft.
- สร้าง Quotation -> กด Accept -> กดสร้าง SO ใหม่ (Convert) -> ตรวจสอบว่า Draft เก่าถูกลบ และ Flag ต่างๆ ครบถ้วน.

### Manual Verification
1. **TruckScale Sync:** หลังจากกด Confirm SO สังเกตข้อมูลใน MySQL ฝั่ง TruckScale (ตาราง `tbl_keyone`) ว่ามีข้อมูลส่งเข้าไปรอชั่งเข้าหรือไม่.
2. **Rebate Mirror:** ดูตาราง `wf.CouponMirror` ว่าอัปเดตข้อมูลตรงกับ `dbo.WFCoupon` หลังจากรัน API Sync หรือไม่.
3. **Walkthrough:** ปรับปรุง `walkthrough.md` ให้สะท้อนสถานะ V1.0 ที่แก้ไขเสร็จสิ้นสมบูรณ์.
