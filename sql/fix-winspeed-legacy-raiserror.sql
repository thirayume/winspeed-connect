/*==============================================================================
  fix-winspeed-legacy-raiserror.sql          (สคริปต์เดียวจบ · รันซ้ำได้)
  ------------------------------------------------------------------------------
  ปัญหา
      WINSpeed ขึ้น "Database error code: 102 — Incorrect syntax near '@errno'"
      เวลาบันทึกข้อมูล (เช่น INSERT INTO SOHD) — เกิดได้ทุกโมดูล

  สาเหตุ
      trigger ของ WINSpeed (ERwin generate ปี 2002–2003) ปิดท้ายด้วย
          error:
              raiserror @errno @errmsg
              rollback transaction
      ซึ่งเป็น syntax ของ SQL Server 2000 และถูก "discontinued" ตั้งแต่
      SQL Server 2012 — parser รุ่นใหม่ไม่รู้จักอีกต่อไป
      *** ไม่เกี่ยวกับ compatibility level *** (ตั้ง 100 ก็ยังพัง)
      ฐานข้อมูลนี้ย้ายมารันบน SQL Server 2022 จึงเริ่มมีอาการ

  วิธีแก้
      raiserror @errno @errmsg   -->   raiserror(@errmsg, 16, 1)

  สคริปต์นี้ทำอะไร
      1) สร้างตาราง wf.LegacyTriggerBackup แล้วสำรอง definition เดิม (ก่อนแก้)
      2) ไล่แก้ทุก trigger ที่ยังใช้ syntax เก่า (ทีละตัว มี error handling)
      3) สรุปผล + ตรวจว่าเหลือ 0
      * รันซ้ำได้ ถ้าไม่มีอะไรค้างจะไม่ทำอะไรเลย

  ⚠ ก่อนรัน
      1) BACKUP ฐานข้อมูลก่อนเสมอ (ดู STEP 0)
      2) trigger เหล่านี้เป็นของ Prosoft/WINSpeed (vendor) — ควรแจ้ง Prosoft
         และถ้าอัปเกรด WINSpeed ในอนาคต อาจถูก deploy ทับกลับ ให้รันสคริปต์นี้ซ้ำ
      3) รันในช่วง maintenance (ALTER TRIGGER ใช้ schema lock)

  หมายเหตุ
      error number เปลี่ยนจาก 30002 -> 50000 (ข้อความเดิม)
      trigger เหล่านี้เป็น FK guard ที่ปกติแทบไม่ยิง จึงไม่กระทบการใช้งาน

  ผลการรันจริงบน REMOTE (dbwins_worldfert9) — ตรวจซ้ำ 23 ก.ค. 2569
      trigger ทั้งหมด (user) ....... 1,289
      ใช้ syntax ใหม่ .............. 1,283
      เหลือ legacy syntax .......... 0
      ถูก disable / หายไป .......... ไม่มี
      wf.LegacyTriggerBackup ....... 1,283 แถว (ต้นฉบับก่อนแก้ ครบทุกตัว)

  ⚠ ขอบเขต: การแก้รอบนี้ทำบน REMOTE เท่านั้น — ฐานข้อมูล LOCAL (dev) เป็นคนละตัว
      และยังไม่ถูกแก้ ถ้าจะใช้กับ environment อื่นให้รันสคริปต์นี้ที่นั่นอีกครั้ง
      (สคริปต์จะ backup ต้นฉบับลง wf.LegacyTriggerBackup ของ DB นั้นเองก่อนแก้)

  หมายเหตุ rollback: ต้นฉบับทั้ง 1,283 ตัวถูกย้ายจากไฟล์ .sql เข้ามาเก็บใน
      ตาราง wf.LegacyTriggerBackup เรียบร้อยแล้ว จึงไม่ต้องพึ่งไฟล์ภายนอกอีก
      (ดูวิธี rollback ท้ายไฟล์)
==============================================================================*/

USE dbwins_worldfert9;      -- << แก้ชื่อฐานข้อมูลให้ตรงถ้าใช้ที่อื่น
GO
SET NOCOUNT ON;
GO

/*------------------------------------------------------------------------------
  STEP 0 — BACKUP ฐานข้อมูล (บังคับ) : แก้ path ให้ตรงกับเครื่องเซิร์ฟเวอร์
           เอาคอมเมนต์ออกแล้วรันก่อน
------------------------------------------------------------------------------*/
-- BACKUP DATABASE dbwins_worldfert9
-- TO DISK = 'D:\Backup\dbwins_worldfert9_beforeTriggerFix.bak'
-- WITH INIT, COMPRESSION, STATS = 5;
-- GO


/*------------------------------------------------------------------------------
  STEP 1 — เตรียมตารางสำรอง definition เดิม (ใช้ rollback ได้)
------------------------------------------------------------------------------*/
IF SCHEMA_ID('wf') IS NULL
    EXEC('CREATE SCHEMA wf');
GO

IF OBJECT_ID('wf.LegacyTriggerBackup','U') IS NULL
BEGIN
    CREATE TABLE wf.LegacyTriggerBackup (
        Id                 INT IDENTITY(1,1) PRIMARY KEY,
        SchemaName         sysname       NOT NULL,
        TriggerName        sysname       NOT NULL,
        OriginalDefinition nvarchar(max) NOT NULL,
        BackedUpAt         datetime2     NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_LegacyTriggerBackup UNIQUE (TriggerName)
    );
    PRINT 'created wf.LegacyTriggerBackup';
END
GO


/*------------------------------------------------------------------------------
  STEP 2 — สำรอง + แก้ทุก trigger ที่ยังใช้ syntax เก่า
------------------------------------------------------------------------------*/
DECLARE @sch sysname, @name sysname, @def nvarchar(max), @sql nvarchar(max), @pos int;
DECLARE @ok int = 0, @fail int = 0, @manual int = 0, @total int = 0;

SELECT @total = COUNT(*)
FROM sys.sql_modules m
JOIN sys.objects   o ON o.object_id = m.object_id
WHERE o.type = 'TR' AND m.definition LIKE '%raiserror @errno @errmsg%';

PRINT '--- legacy triggers found: ' + CAST(@total AS varchar(10));

DECLARE curFix CURSOR LOCAL FAST_FORWARD FOR
    SELECT SCHEMA_NAME(o.schema_id), o.name, m.definition
    FROM sys.sql_modules m
    JOIN sys.objects   o ON o.object_id = m.object_id
    WHERE o.type = 'TR'
      AND m.definition LIKE '%raiserror @errno @errmsg%'
    ORDER BY o.name;

OPEN curFix;
FETCH NEXT FROM curFix INTO @sch, @name, @def;
WHILE @@FETCH_STATUS = 0
BEGIN
    /* 2.1 สำรองของเดิมก่อน (ครั้งเดียวต่อ trigger) */
    IF NOT EXISTS (SELECT 1 FROM wf.LegacyTriggerBackup WHERE TriggerName = @name)
        INSERT wf.LegacyTriggerBackup (SchemaName, TriggerName, OriginalDefinition)
        VALUES (@sch, @name, @def);

    /* 2.2 หาตำแหน่ง CREATE TRIGGER "ตัวจริง"
           ต้องค้นแบบมีชื่อ trigger ต่อท้ายด้วย เพราะบาง trigger มีแบนเนอร์คอมเมนต์
           เช่น  /**********  Create Trigger ****************/
           อยู่ข้างบน ถ้าค้นแค่ 'create trigger' จะไปโดนในคอมเมนต์
           (เคสจริงที่เจอ: tI_ICCountHD -> Msg 2714 There is already an object named ...) */
    SET @pos = CHARINDEX('create trigger ' + LOWER(@name), LOWER(@def));

    IF @pos = 0
    BEGIN
        SET @manual += 1;
        PRINT '  MANUAL : ' + @name + '  (หา CREATE TRIGGER ตัวจริงไม่เจอ — ต้องแก้มือ)';
    END
    ELSE
    BEGIN
        SET @sql = STUFF(@def, @pos, 14, 'ALTER TRIGGER');                       -- create trigger -> ALTER TRIGGER
        SET @sql = REPLACE(@sql, 'raiserror @errno @errmsg', 'raiserror(@errmsg, 16, 1)');

        BEGIN TRY
            EXEC sp_executesql @sql;
            SET @ok += 1;
        END TRY
        BEGIN CATCH
            SET @fail += 1;
            PRINT '  FAILED : ' + @name + ' -> ' + ERROR_MESSAGE();
        END CATCH
    END

    FETCH NEXT FROM curFix INTO @sch, @name, @def;
END
CLOSE curFix;
DEALLOCATE curFix;

PRINT '';
PRINT '=== SUMMARY ===';
PRINT '  fixed  : ' + CAST(@ok     AS varchar(10));
PRINT '  failed : ' + CAST(@fail   AS varchar(10));
PRINT '  manual : ' + CAST(@manual AS varchar(10));
GO


/*------------------------------------------------------------------------------
  STEP 3 — ตรวจผล (ต้องได้ RemainingLegacy = 0)
------------------------------------------------------------------------------*/
SELECT
    (SELECT COUNT(*) FROM sys.sql_modules m JOIN sys.objects o ON o.object_id=m.object_id
      WHERE o.type='TR' AND m.definition LIKE '%raiserror @errno @errmsg%')      AS RemainingLegacy,
    (SELECT COUNT(*) FROM sys.sql_modules
      WHERE definition LIKE '%raiserror(@errmsg, 16, 1)%')                        AS UsingNewSyntax,
    (SELECT COUNT(*) FROM sys.triggers WHERE is_ms_shipped = 0)                   AS TotalUserTriggers,
    (SELECT COUNT(*) FROM sys.triggers WHERE is_ms_shipped = 0 AND is_disabled=1) AS DisabledTriggers,
    (SELECT COUNT(*) FROM wf.LegacyTriggerBackup)                                 AS BackedUpOriginals;
GO

-- ถ้ายังเหลือ ให้ดูรายชื่อ แล้วแก้มือ (ดู STEP 4)
SELECT o.name AS StillLegacy
FROM sys.sql_modules m
JOIN sys.objects   o ON o.object_id = m.object_id
WHERE o.type = 'TR' AND m.definition LIKE '%raiserror @errno @errmsg%';
GO


/*------------------------------------------------------------------------------
  STEP 4 — แก้มือ (เฉพาะกรณีที่ STEP 2 รายงานว่า MANUAL / FAILED)
           ดู definition แล้วเปลี่ยน 'create trigger' ตัวที่เป็น statement จริง
           (ไม่ใช่ตัวในคอมเมนต์) เป็น 'ALTER TRIGGER' + แก้ raiserror แล้วรัน
------------------------------------------------------------------------------*/
-- SELECT m.definition
-- FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
-- WHERE o.name = '<ชื่อ trigger>';
-- GO


/*------------------------------------------------------------------------------
  ROLLBACK — ย้อน trigger กลับเป็นของเดิม (จาก wf.LegacyTriggerBackup)
             ⚠ ย้อนแล้ว error 102 จะกลับมา

  ตัวเดียว:
      DECLARE @d nvarchar(max);
      SELECT @d = OriginalDefinition FROM wf.LegacyTriggerBackup WHERE TriggerName = 'tI_SOHD';
      DROP TRIGGER dbo.tI_SOHD;
      EXEC sp_executesql @d;

  ทั้งหมด:
      DECLARE @n sysname, @d nvarchar(max);
      DECLARE c CURSOR LOCAL FAST_FORWARD FOR
          SELECT TriggerName, OriginalDefinition FROM wf.LegacyTriggerBackup;
      OPEN c; FETCH NEXT FROM c INTO @n, @d;
      WHILE @@FETCH_STATUS = 0
      BEGIN
          BEGIN TRY
              EXEC('DROP TRIGGER dbo.' + @n);
              EXEC sp_executesql @d;
          END TRY
          BEGIN CATCH PRINT 'rollback failed: ' + @n + ' -> ' + ERROR_MESSAGE(); END CATCH
          FETCH NEXT FROM c INTO @n, @d;
      END
      CLOSE c; DEALLOCATE c;
------------------------------------------------------------------------------*/
