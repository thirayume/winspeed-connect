-- ==========================================
-- 003_schema_ext.sql
-- สร้างตาราง Extension สำหรับเก็บข้อมูลของ Web App
-- ที่ผูกกับเอกสาร SOHD ฝั่ง Winspeed
-- ==========================================

-- 1. ลบ Foreign Key ที่ผูกกับ wf.SalesOrder
IF EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK__RebateLed__SoId__403A8C7D')
    ALTER TABLE wf.RebateLedger DROP CONSTRAINT FK__RebateLed__SoId__403A8C7D;
IF EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK__GiveawayIs__SoId__4BAC3F29')
    ALTER TABLE wf.GiveawayIssue DROP CONSTRAINT FK__GiveawayIs__SoId__4BAC3F29;
IF EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK__SalesOrde__SoId__398D8EEE')
    ALTER TABLE wf.SalesOrderAudit DROP CONSTRAINT FK__SalesOrde__SoId__398D8EEE;

-- ลบ Index ที่ผูกกับ SoId ก่อน Alter
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_RebateLedger_SoId' AND object_id=OBJECT_ID('wf.RebateLedger'))
    DROP INDEX IX_RebateLedger_SoId ON wf.RebateLedger;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_RebateLedger_SOID' AND object_id=OBJECT_ID('wf.RebateLedger'))
    DROP INDEX IX_RebateLedger_SOID ON wf.RebateLedger;

-- ลบข้อมูล Rebate/Giveaway เก่าทั้งหมดก่อนเปลี่ยน type (เพราะมีข้อมูล Integer เก่าตกค้าง)
DELETE FROM wf.RebateLedger;
DELETE FROM wf.GiveawayIssue;
DELETE FROM wf.SalesOrderAudit;
GO

-- 2. เปลี่ยน Data Type ของ SoId เป็น VARCHAR(50) ให้ตรงกับ Winspeed
ALTER TABLE wf.RebateLedger ALTER COLUMN SoId VARCHAR(50) NOT NULL;
ALTER TABLE wf.GiveawayIssue ALTER COLUMN SoId VARCHAR(50) NULL;
ALTER TABLE wf.SalesOrderAudit ALTER COLUMN SoId VARCHAR(50) NOT NULL;
GO

-- สร้าง Index กลับมา
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_RebateLedger_SoId' AND object_id=OBJECT_ID('wf.RebateLedger'))
    CREATE INDEX IX_RebateLedger_SoId ON wf.RebateLedger(SoId);
GO

-- 3. สร้างตาราง Ext สำหรับเก็บข้อมูล Web App ที่ไม่มีใน Winspeed
IF EXISTS (SELECT * FROM sys.tables WHERE schema_id = SCHEMA_ID('wf') AND name = 'SalesOrderLineExt')
    DROP TABLE wf.SalesOrderLineExt;
IF EXISTS (SELECT * FROM sys.tables WHERE schema_id = SCHEMA_ID('wf') AND name = 'SalesOrderExt')
    DROP TABLE wf.SalesOrderExt;
GO

CREATE TABLE wf.SalesOrderExt (
        SOID VARCHAR(50) PRIMARY KEY, -- ตรงกับ dbo.SOHD.SOID
        WfRef NVARCHAR(30) NOT NULL UNIQUE,
        SoPrefix NVARCHAR(5) NOT NULL,
        SalesUserId INT NULL,
        ControlTicketNo NVARCHAR(50) NULL,
        DeliveryDate DATE NULL,
        ImportFilePath NVARCHAR(500) NULL,
        ImportedDocuNo VARCHAR(50) NULL,
        ImportedAt DATETIME NULL,
        CreatedAt DATETIME NOT NULL DEFAULT GETUTCDATE(),
        UpdatedAt DATETIME NOT NULL DEFAULT GETUTCDATE()
);
GO

CREATE TABLE wf.SalesOrderLineExt (
        SOID VARCHAR(50) NOT NULL,
        ListNo INT NOT NULL,
        NetPricePerTon DECIMAL(12, 2) NOT NULL DEFAULT 0,
        IsGiveaway BIT NOT NULL DEFAULT 0,
        RebateBooked BIT NOT NULL DEFAULT 0,
        PRIMARY KEY (SOID, ListNo),
    CONSTRAINT FK_wf_SalesOrderLineExt_SOID FOREIGN KEY (SOID) REFERENCES wf.SalesOrderExt(SOID) ON DELETE CASCADE
);
GO
