-- Migration 181: เพิ่มฟิลด์ IsDeleted และ DeletedAt ในตาราง wf.SalesOrderExt เพื่อรองรับการลบทริปและบิลที่ยกเลิกแล้ว
IF COL_LENGTH('wf.SalesOrderExt', 'IsDeleted') IS NULL
BEGIN
    ALTER TABLE wf.SalesOrderExt ADD IsDeleted BIT NOT NULL CONSTRAINT DF_SalesOrderExt_IsDeleted DEFAULT 0;
END;

IF COL_LENGTH('wf.SalesOrderExt', 'DeletedAt') IS NULL
BEGIN
    ALTER TABLE wf.SalesOrderExt ADD DeletedAt DATETIME2 NULL;
END;

