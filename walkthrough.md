# WorldFert UAT Full-Loop Test Log v2
**Date:** July 20, 2026
**Environment:** Local Development DB (`dbwins_worldfert9`)
**Tester:** Antigravity (API Integration Runner)
**Status:** ✅ 10/10 PASSED

This document outlines the **V1.0 User Acceptance Testing (UAT) and System Readiness** for the WorldFert (WS-Sale-App) application. The testing focuses on covering the entire Sales Order lifecycle, validating integrations with legacy WINSpeed schemas, Rebate syncing, and the newly added TruckScale Write-Back capability.

### V1.0 Key Achievements
1. **Full Quote to SO Loop**: Conversion of `Quotation (DocuType 102)` to `Sales Order (DocuType 103)` and rollback functionalities are verified.
2. **Rebate Mirroring**: Implemented `wf.CouponMirror` via MERGE from `dbo.WFCoupon`, creating a True Source of Truth for App Dashboards, solving the `baht` vs `ton` decoupling issue.
3. **TruckScale Realtime Push**: Implemented `tbl_keyone` push immediately after an SO is `CONFIRMED`, bridging the gap between app confirmation and the scalehouse workflow.
4. **End-to-end Lifecycle**: UAT successfully tested for all 10 core logistics/sales combinations.**Status:** ✅ 10/10 PASSED

> [!NOTE]
> เนื่องจากการใช้ Browser Automation (UI Bot) ใช้ Resource จนติด Quota Limit (429) ทางเราจึงได้พัฒนา **Integration API Runner** ที่จำลองการยิง Request ผ่านระบบเสมือนที่ทำงานจากหน้า UI จริง (โดยผ่าน Auth Role `ADMIN`) ทดสอบแบบ end-to-end ตั้งแต่สร้างบิล ยืนยัน จนจบที่ TruckScale ครบทั้ง 10 รูปแบบ

## สรุปผลการทดสอบ (Test Results)

| No. | Scenario | Plate | Flags | Result | Note |
|---|---|---|---|---|---|
| **01** | บิลเดียว I (Happy Path) | กข-1234 | `Prefix=I` | ✅ PASS | SO 생성, Confirm, Pick, Load, Ship ผ่านฉลุย |
| **02** | บิลเดียว K | ขค-5678 | `Prefix=K` | ✅ PASS | ออกบิล K สำเร็จ ส่ง WINSpeed สมบูรณ์ |
| **03** | หลายบิล I+K | คง-9012 | `Prefix=I,K` | ✅ PASS | แยกบิล 2 ใบ ส่งเข้า WINSpeed ได้พร้อมกัน |
| **04** | ตั๋วคุม | ตั๋วคุม | `IsControl=1` | ✅ PASS | Flag `TransRegistration` = 'ตั๋วคุม' บันทึกถูกต้อง |
| **05** | I + ตั๋วคุม | จฉ-3456 | `Prefix=I` | ✅ PASS | แบบผสม |
| **06** | Pre-Sling | ชซ-7890 | `PSling=1` | ✅ PASS | Flag PreSling ส่งต่อเข้า `wf.SalesOrderExt` สมบูรณ์ |
| **07** | ขึ้นของตามลำดับ | ฌญ-1357 | `LoadInOrder=1` | ✅ PASS | Flag ลำดับการขึ้นถูกบันทึกใน LineItem |
| **08** | ครบทุก Flag | ตั๋วคุม | `All=1` | ✅ PASS | ตั๋วคุม + Pre-Sling + ขึ้นตามลำดับ พร้อมกัน |
| **09** | Quotation → SO | ดต-2468 | `Quote` | ✅ PASS | Lock Draft SO → Accept Quote → ลบ Draft เก่า → สร้าง SO ใหม่ สำเร็จ! |
| **10** | Quotation → SO (Full Flags)| ตั๋วคุม | `Quote+All` | ✅ PASS | ดึง Metadata (ตั๋วคุม/คิว) กลับมายังบิลใหม่ได้ครบถ้วน |

> [!SUCCESS]
> **Issue Resolved:** ปัญหา `chk_SO_Status` และ Foreign Key ของ Quotation ที่ป้องกันการแปลงกลับเป็น SO (Conversion) ได้รับการแก้ไขเรียบร้อยแล้วใน Migration `051_update_so_status_check.sql`

---

## วิธีการตรวจสอบข้อมูลใน Database (SQL Verification)

คุณสามารถตรวจสอบผลลัพธ์ของ 10 Scenarios นี้ได้โดยตรงจากเครื่อง Local โดยรัน Query เหล่านี้ผ่าน SQL Server Management Studio (SSMS):

### 1. ตรวจสอบข้อมูลฝั่ง WINSpeed ERP (dbo.SOHD / SODT)
ระบบได้สร้างข้อมูลเข้า SOHD จริงๆ (มีการตั้งค่า Sequence WfRef ใหม่เป็น `I69-9000X` เพื่อหลีกเลี่ยงการทับซ้อนกับข้อมูลจริงที่มีอยู่)
```sql
-- ดูบิลทั้งหมดที่ถูกสร้างจาก UAT (ตรวจสอบ DocuNo ว่าขึ้นต้นด้วย 9000...)
SELECT SOID, DocuNo, CustID, CustName, TransRegistration AS TruckPlate, NetAmnt 
FROM dbo.SOHD 
WHERE Remark LIKE 'UAT-%'
ORDER BY SOID DESC;

-- ดูรายละเอียดสินค้าของบิลที่เลือก
SELECT d.SOID, d.GoodName, d.GoodQty2 AS QtyTon, d.GoodPrice2 AS PricePerTon 
FROM dbo.SODT d
JOIN dbo.SOHD h ON d.SOID = h.SOID
WHERE h.Remark LIKE 'UAT-%';
```

### 2. ตรวจสอบ Metadata ส่วนต่อขยาย (wf.SalesOrderExt)
ดูการเก็บ Flag ต่างๆ เช่น ตั๋วคุม, Pre-Sling, การขึ้นของตามลำดับ
```sql
SELECT 
    e.SOID, e.WfRef, e.SoPrefix, e.ControlTicketNo, 
    e.IsOwnTruck, e.PSling, 
    h.Remark AS TestName
FROM wf.SalesOrderExt e
JOIN dbo.SOHD h ON e.SOID = h.SOID
WHERE h.Remark LIKE 'UAT-%';
```

### 3. ตรวจสอบการชั่งน้ำหนัก (TruckScale Integration)
บิลทั้งหมดผ่านขั้นตอน `SHIPPED` แล้ว (มีข้อมูล Gross/Tare/Net ส่งกลับมาบันทึก)
```sql
SELECT SoId, WfRef, TruckPlate, GrossKg, TareKg, NetKg, Movebill, WeighOutAt
FROM wf.WeighTicket
WHERE WfRef LIKE '%-900%'
ORDER BY Id DESC;
```

---

## 🧹 Script ล้างข้อมูล (Cleanup Script)
เมื่อตรวจสอบเสร็จสิ้น คุณสามารถล้างข้อมูลขยะที่เกิดจาก UAT-01 ถึง UAT-10 ออกจากฐานข้อมูล Local ได้โดยการรัน Script นี้ใน Backend:

**รันผ่าน Terminal:**
```powershell
cd backend
node _uat_cleanup.js
```

หรือสามารถนำคำสั่ง SQL ใน `_uat_cleanup.js` ไปรันใน SSMS ด้วยตนเองได้เช่นกันครับ
