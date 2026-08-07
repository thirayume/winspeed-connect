-- =============================================================
-- 077_rebate_claim_pool_optional.sql
--
-- ใบขอเคลียร์ไม่ต้องผูกกับ "กระเป๋าเงินรายเดือนของพนักงานขาย" อีกต่อไป
--
-- ยอดสะสมย้ายไปอ่านจาก WINSpeed แล้ว (migration 076) ส่วน wf.RebatePool คือ
-- "งบที่ผู้บริหารจัดสรรให้พนักงานขายรายเดือน" ซึ่งเป็นคนละเรื่อง — ใบขอเคลียร์
-- ที่อ้างการขนจริงจึงยื่นได้แม้ยังไม่มีการจัดสรรงบ
--
-- ยังบังคับ FK ไว้เหมือนเดิมสำหรับใบที่ผูกกับงบ เพื่อไม่ให้ชี้ไปที่งบที่ไม่มีอยู่
-- =============================================================

DECLARE @fk NVARCHAR(200);
SELECT @fk = fk.name
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
JOIN sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
WHERE fk.parent_object_id = OBJECT_ID('wf.RebateClaim') AND c.name = 'PoolId';
IF @fk IS NOT NULL EXEC('ALTER TABLE wf.RebateClaim DROP CONSTRAINT ' + @fk);
GO

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('wf.RebateClaim') AND name = 'PoolId' AND is_nullable = 0
)
    ALTER TABLE wf.RebateClaim ALTER COLUMN PoolId INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_RebateClaim_Pool')
    ALTER TABLE wf.RebateClaim ADD CONSTRAINT FK_RebateClaim_Pool
        FOREIGN KEY (PoolId) REFERENCES wf.RebatePool(Id);
GO

PRINT '✓ WF migration 077 complete (RebateClaim.PoolId is optional)'
GO
