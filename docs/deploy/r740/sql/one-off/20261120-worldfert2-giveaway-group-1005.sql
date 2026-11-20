-- ============================================================================
-- STATUS: run on 20 Nov 2026 20:10 with the owner's go, after a rolled-back rehearsal and the COPY_ONLY backup
-- dbwins_worldfert2_predeploy_20261120-201005.bak. Result: group 1005 (same code and name as company 9), 89 goods in
-- it, 89 logged, all 52 quota lines on group-1005 goods; 1 group + 89 good ChangeEvents. WinSpeed fingerprint: only
-- EMGood changed (438 rows before and after); documents, customers and audit unchanged.
-- One-off, 20 Nov 2026 — company 2 (dbwins_worldfert2): giveaway goods into a group 1005 like company 9.
-- Owner, 20 Nov 2026: "ย้ายเข้ากลุ่ม 1005". WinSpeed master data, so only through the wf procedures of migration 248
-- (one transaction, WinSpeed triggers on, ids under lock, a wf.ChangeEvent per change):
--  1. wf.sp_MasterSaveGoodGroup creates the group with company 9's group-1005 code and name; it must get id 1005.
--  2. every worldfert2 good whose GoodCode equals a company-9 group-1005 good moves into it with
--     wf.sp_MasterUpdateGood (code and name unchanged). Found: 89 goods; 9 company-9 giveaways have no worldfert2
--     good (6 of them need units worldfert2 does not have) and are not created here.
--  3. each move is logged in wf.GiveawayAlignLog (Migration 'W2G1005') for the rollback at the end (commented).
-- Acts as worldfert2's admin account (Id 47). Stops without change if it already ran or the id would not be 1005.
--   sqlcmd -b -I -S R740-SRV\SQL2008 -E -f 65001 -d dbwins_worldfert2 -i 20261120-worldfert2-giveaway-group-1005.sql
-- ============================================================================
SET NOCOUNT ON; SET XACT_ABORT ON;
SET ANSI_NULLS ON; SET ANSI_PADDING ON; SET ANSI_WARNINGS ON; SET ARITHABORT ON; SET CONCAT_NULL_YIELDS_NULL ON; SET QUOTED_IDENTIFIER ON; SET NUMERIC_ROUNDABORT OFF;
GO
IF DB_NAME() <> N'dbwins_worldfert2' OR @@SERVERNAME <> N'R740-SRV\SQL2008' BEGIN RAISERROR('STOP: run on dbwins_worldfert2', 16, 1); RETURN; END;
IF EXISTS (SELECT 1 FROM dbo.EMGoodGroup WHERE GoodGroupID = 1005) BEGIN RAISERROR('STOP: group 1005 already exists', 16, 1); RETURN; END;
IF EXISTS (SELECT 1 FROM wf.GiveawayAlignLog WHERE Migration = 'W2G1005') BEGIN RAISERROR('STOP: already ran', 16, 1); RETURN; END;

DECLARE @code VARCHAR(25), @name NVARCHAR(255), @nameEng NVARCHAR(255), @saved INT, @affected INT, @goodId INT, @gCode VARCHAR(50), @gName NVARCHAR(255);
SELECT @code = LTRIM(RTRIM(GoodGroupCode)), @name = LTRIM(RTRIM(GoodGroupName)), @nameEng = GoodGroupNameEng
FROM dbwins_worldfert9.dbo.EMGoodGroup WHERE GoodGroupID = 1005;
IF @code IS NULL BEGIN RAISERROR('STOP: company 9 has no group 1005', 16, 1); RETURN; END;

BEGIN TRANSACTION;
EXEC wf.sp_MasterSaveGoodGroup @GoodGroupID = NULL, @GoodGroupCode = @code, @GoodGroupName = @name, @GoodGroupNameEng = @nameEng,
     @Remark = N'ของแถม (ส่งเสริมการขาย) ตามบริษัท 9, 20/11/2569', @UserId = 47, @ActorUserId = 47, @SavedID = @saved OUTPUT;
IF @saved <> 1005 BEGIN RAISERROR('STOP: the new group did not get id 1005', 16, 1); ROLLBACK TRANSACTION; RETURN; END;

DECLARE goods CURSOR LOCAL FAST_FORWARD FOR
    SELECT w.GoodID, LTRIM(RTRIM(w.GoodCode)), LTRIM(RTRIM(w.GoodName1))
    FROM dbo.EMGood w
    WHERE w.GoodGroupID IS NULL
      AND EXISTS (SELECT 1 FROM dbwins_worldfert9.dbo.EMGood n
                  WHERE n.GoodGroupID = 1005 AND LTRIM(RTRIM(n.GoodCode)) COLLATE DATABASE_DEFAULT = LTRIM(RTRIM(w.GoodCode)) COLLATE DATABASE_DEFAULT)
    ORDER BY w.GoodID;
OPEN goods; FETCH NEXT FROM goods INTO @goodId, @gCode, @gName;
WHILE @@FETCH_STATUS = 0
BEGIN
    EXEC wf.sp_MasterUpdateGood @GoodID = @goodId, @GoodCode = @gCode, @GoodName = @gName, @GoodGroupID = 1005,
         @UserId = 47, @ActorUserId = 47, @Affected = @affected OUTPUT;
    IF @affected <> 1 BEGIN RAISERROR('STOP: a good was not moved', 16, 1); ROLLBACK TRANSACTION; RETURN; END;
    INSERT INTO wf.GiveawayAlignLog (Migration, Kind, RefId, OldGoodId, NewGoodId, OldGoodCode, OldGoodName)
    VALUES ('W2G1005', 'GROUP_MOVE', CONVERT(VARCHAR(50), @goodId), CONVERT(VARCHAR(50), @goodId), '1005', @gCode, @gName);
    FETCH NEXT FROM goods INTO @goodId, @gCode, @gName;
END;
CLOSE goods; DEALLOCATE goods;
COMMIT TRANSACTION;

SELECT 'done' AS Step, (SELECT COUNT(*) FROM dbo.EMGood WHERE GoodGroupID = 1005) AS GoodsIn1005,
       (SELECT COUNT(*) FROM wf.GiveawayAlignLog WHERE Migration = 'W2G1005') AS Logged,
       (SELECT COUNT(*) FROM wf.GiveawayBudget b JOIN dbo.EMGood g ON CONVERT(VARCHAR(50), g.GoodID) = b.GoodId WHERE g.GoodGroupID = 1005) AS QuotaLinesOn1005;
GO

-- Rollback (only with the owner's go): the goods had no group before, and wf.sp_MasterUpdateGood always needs one,
-- so clear the group of each good listed in wf.GiveawayAlignLog (Migration 'W2G1005', RefId = GoodID) in WinSpeed's
-- own goods screen, then in one transaction: wf.sp_MasterDeleteGoodGroup @GoodGroupID = 1005, @UserId = 47,
-- @ActorUserId = 47, @Affected = @a OUTPUT; DELETE FROM wf.GiveawayAlignLog WHERE Migration = 'W2G1005'.
