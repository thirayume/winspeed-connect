-- =============================================================================
-- fix_triggers_raiserror.sql
-- แก้ trigger ERwin ทั้ง 1,282 ตัวใน dbwins_worldfert9 ที่ใช้ syntax เก่า
--     raiserror @errno @errmsg          (SQL Server 2000 — ถูกตัดทิ้งตั้งแต่ SQL 2012)
-- เปลี่ยนเป็น
--     raiserror(@errmsg, 16, 1)         (พฤติกรรมเดิม: แจ้ง error + rollback เหมือนเดิม)
--
-- ก่อนรัน: มี backup definition เดิมครบทุกตัวที่ wf\out\triggers_backup_original.sql
-- รันด้วย: Windows Authentication (sysadmin) บน .\SQLEXPRESS, database dbwins_worldfert9
-- Idempotent: รันซ้ำได้ (ตัวที่แก้แล้วจะไม่ match pattern อีก)
-- =============================================================================
SET NOCOUNT ON;
SET XACT_ABORT OFF;

DECLARE @name sysname, @def nvarchar(max), @pos int;
DECLARE @ok int = 0, @fail int = 0;

DECLARE cur CURSOR LOCAL FAST_FORWARD FOR
    SELECT t.name, m.definition
    FROM sys.triggers t
    JOIN sys.sql_modules m ON m.object_id = t.object_id
    WHERE m.definition LIKE '%raiserror @errno @errmsg%';

OPEN cur;
FETCH NEXT FROM cur INTO @name, @def;
WHILE @@FETCH_STATUS = 0
BEGIN
    -- 1) แทน raiserror syntax เก่าทุกจุด (collation CI → ไม่สนตัวพิมพ์)
    SET @def = REPLACE(@def, 'raiserror @errno @errmsg', 'raiserror(@errmsg, 16, 1)');

    -- 2) เปลี่ยน "create trigger <ชื่อ>" เป็น ALTER TRIGGER <ชื่อ>
    --    ต้อง anchor ด้วยชื่อ trigger เพราะบาง trigger (เช่น tI_ICCountHD)
    --    มี comment "/* Create Trigger */" นำหน้า ทำให้ match ผิดจุด
    SET @pos = CHARINDEX('create trigger ' + @name, @def);
    IF @pos > 0
    BEGIN
        SET @def = STUFF(@def, @pos, LEN('create trigger ' + @name), 'ALTER TRIGGER ' + @name);
        BEGIN TRY
            EXEC (@def);
            SET @ok += 1;
        END TRY
        BEGIN CATCH
            SET @fail += 1;
            PRINT 'FAILED: ' + @name + '  --  ' + ERROR_MESSAGE();
        END CATCH
    END
    ELSE
    BEGIN
        SET @fail += 1;
        PRINT 'SKIPPED (create trigger not found): ' + @name;
    END

    FETCH NEXT FROM cur INTO @name, @def;
END
CLOSE cur;
DEALLOCATE cur;

PRINT '=== Done. Fixed: ' + CAST(@ok AS varchar(10)) + '  Failed: ' + CAST(@fail AS varchar(10)) + ' ===';

-- ตรวจซ้ำ — ต้องเหลือ 0
SELECT remaining_legacy_triggers = COUNT(*)
FROM sys.sql_modules
WHERE definition LIKE '%raiserror @errno @errmsg%';
