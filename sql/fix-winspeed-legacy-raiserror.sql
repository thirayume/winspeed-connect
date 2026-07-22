/*==============================================================================
  fix-winspeed-legacy-raiserror.sql
  ------------------------------------------------------------------------------
  ปัญหา   : WINSpeed แสดง "Database error code: 102 — Incorrect syntax near '@errno'"
            เมื่อ INSERT/UPDATE/DELETE (เช่น INSERT INTO SOHD)

  สาเหตุ  : trigger ของ WINSpeed (ERwin generate ปี 2003) ปิดท้ายด้วย
                error:
                    raiserror @errno @errmsg
                    rollback transaction
            ซึ่งเป็น syntax ของ SQL Server 2000 และถูก "discontinued"
            ตั้งแต่ SQL Server 2012 — parser รุ่นใหม่ไม่รู้จักอีกต่อไป
            *** ไม่เกี่ยวกับ compatibility level *** (ตั้ง 100 ก็ยังพัง)
            ฐานข้อมูลนี้ถูกย้ายมารันบน SQL Server 2022 จึงเริ่มมีอาการ

  วิธีแก้ : เปลี่ยนเป็น syntax ปัจจุบัน
                raiserror @errno @errmsg      -->  raiserror(@errmsg, 16, 1)

  ขอบเขต  : ตรวจพบ 1,283 triggers ทั้งฐานข้อมูล (ณ 22 ก.ค. 2569)

  ⚠ คำเตือน
     1. triggers เหล่านี้เป็นออบเจ็กต์ของ Prosoft/WINSpeed (vendor)
        ควรแจ้ง Prosoft ด้วย เผื่อมี patch ทางการสำหรับ SQL Server 2012+
     2. BACKUP ฐานข้อมูลก่อนเสมอ + ทดลองบนสำเนาที่ restore มาก่อนทำจริง
     3. รันในช่วง maintenance (ALTER TRIGGER ใช้ schema lock)

  หมายเหตุ: error number จะเปลี่ยนจาก 30002 -> 50000 (ข้อความเดิม)
            trigger เหล่านี้เป็น FK guard ที่ปกติแทบไม่ยิง จึงไม่กระทบการใช้งาน
            ถ้าต้องคงเลข 30002 ให้ใช้ sp_addmessage แล้วเรียก
            raiserror(30002, 16, 1, @errmsg) แทน

  ผู้จัดทำ: 22 กรกฎาคม 2569
==============================================================================*/

USE dbwins_worldfert9;
GO
SET NOCOUNT ON;
GO

/*------------------------------------------------------------------------------
  STEP 0 — BACKUP (บังคับ) : แก้ path ให้ตรงกับเครื่องเซิร์ฟเวอร์
------------------------------------------------------------------------------*/
-- BACKUP DATABASE dbwins_worldfert9
-- TO DISK = 'D:\Backup\dbwins_worldfert9_beforeTriggerFix.bak'
-- WITH INIT, COMPRESSION, STATS = 5;
-- GO


/*------------------------------------------------------------------------------
  STEP 1 — สำรอง definition เดิมของ trigger ที่จะแก้ (ไว้ rollback)
           คัดลอกผลลัพธ์เก็บเป็นไฟล์ .sql ก่อนไปขั้นถัดไป
------------------------------------------------------------------------------*/
SELECT o.name AS TriggerName, m.definition AS OriginalDefinition
FROM sys.sql_modules m
JOIN sys.objects   o ON o.object_id = m.object_id
WHERE o.type = 'TR'
  AND m.definition LIKE '%raiserror @errno @errmsg%'
ORDER BY o.name;
GO


/*------------------------------------------------------------------------------
  STEP 2 — ตรวจขอบเขตก่อนแก้
------------------------------------------------------------------------------*/
SELECT
    COUNT(*)                                                            AS TotalLegacyTriggers,
    SUM(CASE WHEN CHARINDEX('create trigger', LOWER(m.definition)) > 0
             THEN 1 ELSE 0 END)                                         AS FixableByThisScript
FROM sys.sql_modules m
JOIN sys.objects   o ON o.object_id = m.object_id
WHERE o.type = 'TR'
  AND m.definition LIKE '%raiserror @errno @errmsg%';
GO


/*------------------------------------------------------------------------------
  STEP 3A — แก้เฉพาะตารางขาย (ปลดล็อกให้เปิดบิลได้ก่อน)
            SOHD / SODT : insert, update, delete
------------------------------------------------------------------------------*/
DECLARE @name sysname, @sql nvarchar(max), @ok int = 0, @fail int = 0;

DECLARE curFix CURSOR LOCAL FAST_FORWARD FOR
    SELECT o.name,
           REPLACE(
               STUFF(m.definition,
                     CHARINDEX('create trigger', LOWER(m.definition)), 14, 'ALTER TRIGGER'),
               'raiserror @errno @errmsg', 'raiserror(@errmsg, 16, 1)')
    FROM sys.sql_modules m
    JOIN sys.objects   o ON o.object_id = m.object_id
    WHERE o.type = 'TR'
      AND o.name IN ('tI_SOHD','tU_SOHD','tD_SOHD','tI_SODT','tU_SODT','tD_SODT')
      AND m.definition LIKE '%raiserror @errno @errmsg%'
      AND CHARINDEX('create trigger', LOWER(m.definition)) > 0;

OPEN curFix;
FETCH NEXT FROM curFix INTO @name, @sql;
WHILE @@FETCH_STATUS = 0
BEGIN
    BEGIN TRY
        EXEC sp_executesql @sql;
        SET @ok += 1;   PRINT '  OK      : ' + @name;
    END TRY
    BEGIN CATCH
        SET @fail += 1; PRINT '  FAILED  : ' + @name + ' -> ' + ERROR_MESSAGE();
    END CATCH
    FETCH NEXT FROM curFix INTO @name, @sql;
END
CLOSE curFix; DEALLOCATE curFix;

PRINT '--- STEP 3A done: fixed=' + CAST(@ok AS varchar(10)) + ' failed=' + CAST(@fail AS varchar(10));
GO
-- ทดสอบ: เปิดบิลขายใน WINSpeed ต้องผ่านแล้ว


/*------------------------------------------------------------------------------
  STEP 3B — แก้ทั้งฐานข้อมูล (triggers ที่เหลือทั้งหมด)
            รันหลังจากยืนยันว่า STEP 3A ใช้งานได้จริง
------------------------------------------------------------------------------*/
DECLARE @name2 sysname, @sql2 nvarchar(max), @ok2 int = 0, @fail2 int = 0;

DECLARE curAll CURSOR LOCAL FAST_FORWARD FOR
    SELECT o.name,
           REPLACE(
               STUFF(m.definition,
                     CHARINDEX('create trigger', LOWER(m.definition)), 14, 'ALTER TRIGGER'),
               'raiserror @errno @errmsg', 'raiserror(@errmsg, 16, 1)')
    FROM sys.sql_modules m
    JOIN sys.objects   o ON o.object_id = m.object_id
    WHERE o.type = 'TR'
      AND m.definition LIKE '%raiserror @errno @errmsg%'
      AND CHARINDEX('create trigger', LOWER(m.definition)) > 0;

OPEN curAll;
FETCH NEXT FROM curAll INTO @name2, @sql2;
WHILE @@FETCH_STATUS = 0
BEGIN
    BEGIN TRY
        EXEC sp_executesql @sql2;
        SET @ok2 += 1;
    END TRY
    BEGIN CATCH
        SET @fail2 += 1; PRINT '  FAILED  : ' + @name2 + ' -> ' + ERROR_MESSAGE();
    END CATCH
    FETCH NEXT FROM curAll INTO @name2, @sql2;
END
CLOSE curAll; DEALLOCATE curAll;

PRINT '--- STEP 3B done: fixed=' + CAST(@ok2 AS varchar(10)) + ' failed=' + CAST(@fail2 AS varchar(10));
GO


/*------------------------------------------------------------------------------
  STEP 4 — ตรวจผล (ต้องได้ 0)
------------------------------------------------------------------------------*/
SELECT COUNT(*) AS RemainingLegacyTriggers
FROM sys.sql_modules
WHERE definition LIKE '%raiserror @errno @errmsg%';
GO


/*------------------------------------------------------------------------------
  STEP 5 — ตรวจรูปแบบอื่นที่สคริปต์นี้ไม่ครอบคลุม (ถ้ามี ให้แก้มือ)
           เช่น raiserror ที่เว้นวรรค/ชื่อตัวแปรต่างออกไป
------------------------------------------------------------------------------*/
SELECT o.name AS TriggerName, m.definition
FROM sys.sql_modules m
JOIN sys.objects   o ON o.object_id = m.object_id
WHERE m.definition LIKE '%raiserror%@errno%'
  AND m.definition NOT LIKE '%raiserror(@errmsg, 16, 1)%';
GO


/*------------------------------------------------------------------------------
  ROLLBACK — ถ้าต้องย้อนกลับ
     ใช้ไฟล์ที่บันทึกไว้จาก STEP 1 (หรือ sql/_rollback/winspeed-triggers-ORIGINAL-*.sql)
     แต่ละ trigger เป็น CREATE TRIGGER ให้ DROP ตัวปัจจุบันก่อนแล้วรัน CREATE เดิม:

         DROP TRIGGER dbo.tI_SOHD;
         GO
         <วาง CREATE TRIGGER เดิม>
         GO

     หมายเหตุ: การย้อนกลับจะทำให้ error 102 กลับมาอีกครั้ง
------------------------------------------------------------------------------*/
