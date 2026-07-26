-- =============================================================
-- 061_weighticket_scale_writeback_result.sql
-- เก็บผลการเขียนกลับ TruckScale ลง wf.WeighTicket
--
-- writeBackWeighOutTicket() คืนค่า { success, action, s_id/insertId } อยู่แล้ว
-- แต่เดิมถูกทิ้ง ระบบจึงไม่รู้ว่าใบสั่งขายใดทำให้เกิดใบชั่งที่แอปสร้างเอง
-- (sequence ขึ้นต้น WF) ซึ่งเป็นข้อมูลที่รายงานกระทบยอด R-3 ต้องใช้
--
-- Safe to re-run (idempotent)
-- =============================================================

IF COL_LENGTH('wf.WeighTicket', 'ScaleWriteAction') IS NULL
  ALTER TABLE wf.WeighTicket ADD ScaleWriteAction VARCHAR(10) NULL;   -- updated | inserted | failed
GO
IF COL_LENGTH('wf.WeighTicket', 'ScaleSid') IS NULL
  ALTER TABLE wf.WeighTicket ADD ScaleSid INT NULL;                   -- s_id ของแถวใน tblscale
GO
IF COL_LENGTH('wf.WeighTicket', 'ScaleSequence') IS NULL
  ALTER TABLE wf.WeighTicket ADD ScaleSequence VARCHAR(10) NULL;      -- sequence ที่เขียนลงไป
GO
IF COL_LENGTH('wf.WeighTicket', 'ScaleWrittenAt') IS NULL
  ALTER TABLE wf.WeighTicket ADD ScaleWrittenAt DATETIME2 NULL;
GO
IF COL_LENGTH('wf.WeighTicket', 'ScaleError') IS NULL
  ALTER TABLE wf.WeighTicket ADD ScaleError NVARCHAR(500) NULL;
GO

-- รายงานกระทบยอดกรองด้วยวันชั่งออกและสถานะการเขียนกลับเป็นหลัก
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_WeighTicket_ScaleWriteAction')
  CREATE INDEX IX_WeighTicket_ScaleWriteAction
    ON wf.WeighTicket (WeighOutAt, ScaleWriteAction) INCLUDE (SoId, ScaleSid, ScaleSequence);
GO

GRANT SELECT ON SCHEMA::wf TO wf_reader;
GO
PRINT '✓ WF migration 061 complete (WeighTicket scale write-back result columns)';
GO
