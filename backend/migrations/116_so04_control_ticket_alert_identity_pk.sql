-- Migration 116: Add AlertId IDENTITY primary key and adjust legacy constraints on wf.ControlTicketAlert
-- Enables SO-04 deduplicated alert lifecycle and backward compatibility with legacy columns

-- 1. Drop legacy primary key if exists on (CouponNo, AlertKind)
IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = 'PK_ControlTicketAlert' AND parent_object_id = OBJECT_ID('wf.ControlTicketAlert'))
BEGIN
    ALTER TABLE wf.ControlTicketAlert DROP CONSTRAINT PK_ControlTicketAlert;
END
GO

-- 2. Drop legacy check constraint if exists
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CTAlert_Kind' AND parent_object_id = OBJECT_ID('wf.ControlTicketAlert'))
BEGIN
    ALTER TABLE wf.ControlTicketAlert DROP CONSTRAINT CK_CTAlert_Kind;
END
GO

-- 3. Make legacy columns nullable
IF COL_LENGTH('wf.ControlTicketAlert', 'CouponNo') IS NOT NULL
BEGIN
    ALTER TABLE wf.ControlTicketAlert ALTER COLUMN CouponNo VARCHAR(50) NULL;
END
GO

IF COL_LENGTH('wf.ControlTicketAlert', 'AlertKind') IS NOT NULL
BEGIN
    ALTER TABLE wf.ControlTicketAlert ALTER COLUMN AlertKind VARCHAR(20) NULL;
END
GO

-- 4. Add AlertId IDENTITY column and set as Primary Key if not present
IF COL_LENGTH('wf.ControlTicketAlert', 'AlertId') IS NULL
BEGIN
    ALTER TABLE wf.ControlTicketAlert ADD AlertId INT IDENTITY(1,1) NOT NULL;
    ALTER TABLE wf.ControlTicketAlert ADD CONSTRAINT PK_ControlTicketAlert_AlertId PRIMARY KEY CLUSTERED (AlertId);
END
GO

-- 5. Create DedupHash Index if not exists
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_wf_ControlTicketAlert_Dedup' AND object_id = OBJECT_ID('wf.ControlTicketAlert'))
BEGIN
    CREATE UNIQUE INDEX UX_wf_ControlTicketAlert_Dedup ON wf.ControlTicketAlert(DedupHash, Status) WHERE DedupHash IS NOT NULL;
END
GO
