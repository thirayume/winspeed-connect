-- ============================================================================
-- STATUS: run on 20 Nov 2026 20:18 with the owner's go, after a rolled-back rehearsal and the COPY_ONLY backup
-- dbwins_worldfert2_predeploy_20261120-201740.bak. Created PM00029, PM00030, PM00031 (GoodID 19001-19003, unit "ตัว"
-- 1003, multi-unit flags Y/N/N as company 9); group 1005 now 92 goods (company 9: 98). Skipped PM00023-PM00027
-- (unit "แผ่น") and PM00028 (unit "เล่ม"): worldfert2 has neither unit. WinSpeed fingerprint: only EMGood (438 -> 441).
-- One-off, 20 Nov 2026 — company 2 (dbwins_worldfert2): create the giveaway goods company 9 has in group 1005 and
-- worldfert2 does not (owner, 20 Nov 2026: "สร้างของแถม 9 รหัสที่ขาดใน worldfert2 ด้วย"). Needs group 1005
-- (20261120-worldfert2-giveaway-group-1005.sql). WinSpeed master data, so only wf.sp_MasterCreateGood (migration 248):
-- one transaction, WinSpeed triggers on, GoodID under lock, a wf.ChangeEvent per good.
--  * same GoodCode and name as company 9, group 1005, weight as company 9 (0);
--  * the unit is worldfert2's unit with the same NAME as company 9's unit (ids may differ). A good whose unit
--    worldfert2 lacks is skipped and listed: no wf procedure creates units, so a missing unit is made in WinSpeed first.
--  * the rest of the WinSpeed columns come from worldfert2's newest active group-1005 good (the procedure's template).
--  * each new good is logged in wf.GiveawayAlignLog (Migration 'W2GNEW', Kind 'GOOD_CREATED', RefId = new GoodID).
-- Repeatable: creates only codes still missing, so it can run again once a missing unit exists. Acts as admin Id 47.
--   sqlcmd -b -I -S R740-SRV\SQL2008 -E -f 65001 -d dbwins_worldfert2 -i 20261120-worldfert2-giveaway-create-missing.sql
-- Rollback (owner's go only): wf.sp_MasterDeleteGood for each logged GoodID in one transaction, then delete the log rows.
-- ============================================================================
SET NOCOUNT ON; SET XACT_ABORT ON;
SET ANSI_NULLS ON; SET ANSI_PADDING ON; SET ANSI_WARNINGS ON; SET ARITHABORT ON; SET CONCAT_NULL_YIELDS_NULL ON; SET QUOTED_IDENTIFIER ON; SET NUMERIC_ROUNDABORT OFF;
GO
IF DB_NAME() <> N'dbwins_worldfert2' OR @@SERVERNAME <> N'R740-SRV\SQL2008' BEGIN RAISERROR('STOP: run on dbwins_worldfert2', 16, 1); RETURN; END;
IF NOT EXISTS (SELECT 1 FROM dbo.EMGoodGroup WHERE GoodGroupID = 1005) BEGIN RAISERROR('STOP: group 1005 missing', 16, 1); RETURN; END;

DECLARE @todo TABLE (GoodCode VARCHAR(50), GoodName NVARCHAR(255), GoodWeight MONEY, UnitName VARCHAR(100), W2UnitID INT);
INSERT INTO @todo (GoodCode, GoodName, GoodWeight, UnitName, W2UnitID)
SELECT LTRIM(RTRIM(n.GoodCode)), LTRIM(RTRIM(n.GoodName1)), n.GoodWeight, LTRIM(RTRIM(u.GoodUnitName)),
       (SELECT MIN(w.GoodUnitID) FROM dbo.EMGoodUnit w
        WHERE CONVERT(VARBINARY(100), LTRIM(RTRIM(w.GoodUnitName))) = CONVERT(VARBINARY(100), LTRIM(RTRIM(u.GoodUnitName))))
FROM dbwins_worldfert9.dbo.EMGood n
LEFT JOIN dbwins_worldfert9.dbo.EMGoodUnit u ON u.GoodUnitID = n.MainGoodUnitID
WHERE n.GoodGroupID = 1005 AND ISNULL(n.Inactive, 'A') = 'A'
  AND NOT EXISTS (SELECT 1 FROM dbo.EMGood w WHERE LTRIM(RTRIM(w.GoodCode)) COLLATE DATABASE_DEFAULT = LTRIM(RTRIM(n.GoodCode)) COLLATE DATABASE_DEFAULT);

SELECT 'skipped: unit missing in worldfert2' AS Step, GoodCode FROM @todo WHERE W2UnitID IS NULL ORDER BY GoodCode;

DECLARE @code VARCHAR(50), @name NVARCHAR(255), @weight MONEY, @unit INT, @newId INT, @made INT;
SET @made = 0;
BEGIN TRANSACTION;
DECLARE goods CURSOR LOCAL FAST_FORWARD FOR
    SELECT GoodCode, GoodName, GoodWeight, W2UnitID FROM @todo WHERE W2UnitID IS NOT NULL ORDER BY GoodCode;
OPEN goods; FETCH NEXT FROM goods INTO @code, @name, @weight, @unit;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @newId = NULL;
    EXEC wf.sp_MasterCreateGood @GoodCode = @code, @GoodName = @name, @GoodGroupID = 1005, @MainGoodUnitID = @unit,
         @TemplateGoodID = NULL, @GoodWeight = @weight, @UserId = 47, @ActorUserId = 47, @NewGoodID = @newId OUTPUT;
    IF @newId IS NULL BEGIN RAISERROR('STOP: a good was not created', 16, 1); ROLLBACK TRANSACTION; RETURN; END;
    INSERT INTO wf.GiveawayAlignLog (Migration, Kind, RefId, NewGoodId, OldGoodCode, OldGoodName)
    VALUES ('W2GNEW', 'GOOD_CREATED', CONVERT(VARCHAR(50), @newId), CONVERT(VARCHAR(50), @newId), @code, @name);
    SET @made = @made + 1;
    FETCH NEXT FROM goods INTO @code, @name, @weight, @unit;
END;
CLOSE goods; DEALLOCATE goods;
COMMIT TRANSACTION;

SELECT 'done' AS Step, @made AS Created, (SELECT COUNT(*) FROM dbo.EMGood WHERE GoodGroupID = 1005) AS GoodsIn1005,
       (SELECT COUNT(*) FROM dbwins_worldfert9.dbo.EMGood WHERE GoodGroupID = 1005) AS GoodsIn1005Company9;
SELECT 'created' AS Step, g.GoodID, LTRIM(RTRIM(g.GoodCode)) AS GoodCode, g.MainGoodUnitID, g.GoodWeight, g.Inactive
FROM dbo.EMGood g JOIN wf.GiveawayAlignLog l ON l.Migration = 'W2GNEW' AND l.RefId = CONVERT(VARCHAR(50), g.GoodID) ORDER BY g.GoodID;
GO
