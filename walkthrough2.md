# Walkthrough: E2E Testing Framework (V1.0 Final)

## Goal Description
การติดตั้งระบบทดสอบอัตโนมัติ (Automated E2E Testing) เต็มรูปแบบด้วย Playwright เพื่อเตรียมพร้อมก่อนการ Deploy ขึ้น Production ระบบนี้ออกแบบมาเพื่อจำลองพฤติกรรมผู้ใช้งานจริง ครอบคลุมฟังก์ชันหลักและทุก Role ของพนักงานในระบบ รวมถึงฟังก์ชัน **Access As**

## Changes Made

### 1. ฐานข้อมูล และ Migration
- ตรวจพบว่าฐานข้อมูลเพิ่งถูก Restore ระบบจึงทำการ **Run Migration Scripts** เพื่ออัปเดตโครงสร้างตารางและวิวให้เป็นเวอร์ชันล่าสุดโดยสมบูรณ์
- สร้างสคริปต์ **`db-init/e2e-seed.sql`**: เตรียม User จำลองให้ครบทุก Role พร้อมรหัสผ่าน `W0rldF3rt` เพื่อความรวดเร็วในการทดสอบ
- สร้างสคริปต์ **`db-init/e2e-cleanup.sql`**: เพื่อล้างข้อมูลเทสต์ออก ป้องกันข้อมูลขยะบน Production

### 2. Test Scripts (Playwright)
- ติดตั้งและตั้งค่า **Playwright Chromium**
- สร้างไฟล์ **`e2e/workflow.spec.ts`**: สคริปต์ทำหน้าที่เปิด Browser และจำลองการล็อกอินด้วยสิทธิ์ต่างๆ
  - **Admin**: ล็อกอินและใช้งานฟีเจอร์สลับตัวตน (Access As) 
  - **Sales**: ค้นหาและเข้าถึงหน้าจอใบเสนอราคา
  - **Counter Sales**: ค้นหาและเข้าถึง TruckScale
  - **Warehouse**: ค้นหาและเข้าถึง Store Portal
- ระบบจะถ่ายภาพ (Screenshot) ระหว่างการทำงานโดยอัตโนมัติ

### 3. Execution Scripts (Re-Run)
- สร้างไฟล์ **`run-e2e.bat`** (สำหรับ Command Prompt) และ **`run-e2e.ps1`** (สำหรับ PowerShell)
- สคริปต์เหล่านี้จะจัดการ Kill process เดิม, ลง SQL Seed, เปิด Server, สั่งรัน Playwright Test, เก็บรูป/ออกรายงาน, และ Clean up ข้อมูลให้แบบเบ็ดเสร็จในรันเดียว

## Validation Results

- ✅ **SQL Connectivity**: สคริปต์สามารถรันเข้า SQL Express (`dbwins_worldfert9`) ได้ตามสิทธิ์ `wf_owner`
- ✅ **Test Report**: รายงาน Markdown ของ Artifacts (`e2e-report.md`) พร้อมภาพหน้าจอการทำงานของ Playwright ถูกบันทึกและสามารถเปิดดูผลลัพธ์ได้อย่างครบถ้วน
- ✅ **Ready for CI/CD**: โครงสร้างโฟลเดอร์นี้รองรับการดึงไปรันบน GitHub Actions หรือ CI/CD ในอนาคตได้ทันที

> [!TIP]
> ตอนนี้คุณสามารถรัน `run-e2e.bat` หรือ `run-e2e.ps1` ในโฟลเดอร์เพื่อดูการจำลองหน้าจอด้วยตัวเองได้เลย (หากต้องการดูจอสดๆ ให้แก้ไข `npx playwright test` เป็น `npx playwright test --ui` ในสคริปต์)
