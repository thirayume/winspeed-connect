-- =============================================================
-- 078_drop_rebateledger_so_fk.sql
--
-- ถอด FK_RebateLedger_SalesOrder ที่ migration 075 ใส่กลับเข้ามา
--
-- ปัญหา
--   ใบสั่งขายที่ "ยืนยันแล้ว" ย้ายไปอยู่ dbo.SOHD และ `SoId` จะเก็บ **SOID ของ WINSpeed**
--   ไม่ใช่ Id ของ wf.SalesOrder · FK ที่ชี้ไป wf.SalesOrder(Id) จึงเป็นไปไม่ได้โดยการออกแบบ
--
--   migration 003 ถอด FK ตัวนี้ออกไปแล้วด้วยเหตุผลเดียวกัน (FK__RebateLed__SoId__403A8C7D)
--   แต่ 075 เขียน `IF NOT EXISTS ... ADD CONSTRAINT FK_RebateLedger_SalesOrder` ไว้
--   ชื่อไม่ตรงกับตัวเดิม เงื่อนไข NOT EXISTS จึงเป็นจริง และ FK ถูกใส่กลับ
--
-- อาการที่วัดได้ (6 ส.ค. 2569 · verify-rebate-full-loop)
--   ขั้นชั่งออกล้มด้วย 500:
--   "The INSERT statement conflicted with the FOREIGN KEY constraint FK_RebateLedger_SalesOrder"
--   ทำให้ตั้งยอดรีเบทค้างรับไม่ได้เลยสำหรับใบที่ยืนยันแล้วทุกใบ
--
--   ตัวอย่างจากการทดสอบ: ใบ I69-02421 ยืนยันแล้วได้ SOID 273121 ซึ่งไม่มีใน wf.SalesOrder
--
-- ไม่ย้อน 075 ทั้งไฟล์ — บันทึก migration แก้ย้อนหลังไม่ได้ และส่วนอื่นของ 075
-- (SoId เป็น NULL ได้) ยังจำเป็นอยู่
-- =============================================================

IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_RebateLedger_SalesOrder')
    ALTER TABLE wf.RebateLedger DROP CONSTRAINT FK_RebateLedger_SalesOrder;
GO

-- index บน SoId ยังมีประโยชน์สำหรับการกลับรายการตอนยกเลิกใบ จึงคงไว้
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_RebateLedger_SoId' AND object_id = OBJECT_ID('wf.RebateLedger'))
    CREATE INDEX IX_RebateLedger_SoId ON wf.RebateLedger(SoId);
GO

PRINT '✓ WF migration 078 complete (dropped impossible FK on wf.RebateLedger.SoId)'
GO
