/* ============================================================
   107 — บันทึกข้อเท็จจริง: TruckScale ไม่ได้อ่าน dbo.SOHD.OnHold

   ที่มา
     migration 105 สร้างสวิตช์ TRUCK_HOLD_WRITE_WINSPEED / TRUCK_HOLD_VERIFIED
     ไว้ตอนที่เรา "ยังพิสูจน์ไม่ได้" ว่าเครื่องชั่งอ่านฟิลด์นี้หรือไม่
     ทุกแถวใน dbo.SOHD เป็น OnHold='N' มาตลอด จึงไม่มีพฤติกรรมให้สังเกต
     และเราอ่าน source ของ TruckScale ไม่ได้

     5 ก.ย. 2569 สอบถามทีม TruckScale โดยตรง ได้คำตอบว่า **ไม่ได้ใช้ฟิลด์นี้**

   ผลที่ตามมา
     - การเขียน OnHold='Y' ไม่ได้หยุดรถที่เครื่องชั่ง
     - Hold ในระบบนี้คือ "การแจ้งเตือนในแอป" เท่านั้น
     - TRUCK_HOLD_VERIFIED หมดความหมาย เพราะต่อให้ตั้ง true รถก็ไม่หยุด

   ทำอะไรใน migration นี้
     แก้เฉพาะ "คำอธิบาย" ที่แสดงในหน้า Master Settings ให้ตรงความจริง
     ไม่แตะค่าที่ตั้งไว้ และไม่ลบสวิตช์ เพราะกลไกยังอาจมีประโยชน์วันหนึ่ง
     ถ้า WINSpeed หรือ TruckScale เริ่มอ่านฟิลด์นี้

   ⚠ ไม่แตะ dbo ใด ๆ · ไม่มี USE statement
   ============================================================ */

UPDATE wf.SystemSetting
SET Description = N'true = ตั้ง dbo.SOHD.OnHold=Y เมื่อ Hold รถ · false = ไม่เขียน (ค่าเริ่มต้น) '
                + N'🔴 ทีม TruckScale ยืนยัน 5 ก.ย. 2569 ว่าเครื่องชั่งไม่ได้อ่านฟิลด์นี้ '
                + N'เปิดแล้วรถก็ไม่หยุดเอง ได้แต่ความเสี่ยงจากการเขียนตาราง WINSpeed — แนะนำให้ปิดไว้',
    UpdatedAt = SYSUTCDATETIME()
WHERE SettingKey = N'TRUCK_HOLD_WRITE_WINSPEED';

UPDATE wf.SystemSetting
SET Description = N'⛔ เลิกใช้แล้ว — มีไว้รอผลทดสอบกับรถจริง ซึ่งได้คำตอบทางอื่นแล้วว่า '
                + N'TruckScale ไม่อ่าน dbo.SOHD.OnHold (5 ก.ย. 2569) '
                + N'ค่านี้ไม่ถูกใช้ตัดสินใจอะไรในโค้ดอีก ตั้งเป็น true ก็ไม่ทำให้รถหยุด',
    UpdatedAt = SYSUTCDATETIME()
WHERE SettingKey = N'TRUCK_HOLD_VERIFIED';

UPDATE wf.SystemSetting
SET Description = N'คำนำหน้าที่เขียนลง dbo.SOHD.StatusRemark เพื่อให้รู้ว่าใครเป็นคนสั่งพัก '
                + N'(ใช้เมื่อเปิด TRUCK_HOLD_WRITE_WINSPEED เท่านั้น)',
    UpdatedAt = SYSUTCDATETIME()
WHERE SettingKey = N'TRUCK_HOLD_REMARK_PREFIX';
