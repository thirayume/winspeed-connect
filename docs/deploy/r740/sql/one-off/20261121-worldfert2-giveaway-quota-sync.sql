-- ============================================================================
-- One-off, 21 Nov 2026 — dbwins_worldfert2 giveaway quotas made equal to dbwins_worldfert9 (owner, 20 Nov 2026).
-- Sale-App data only (wf.GiveawayBudget); WinSpeed goods are not changed. Run with sqlcmd -E as a SQL administrator:
--   sqlcmd -b -I -S R740-SRV\SQL2008 -E -f 65001 -d dbwins_worldfert2 -i 20261121-worldfert2-giveaway-quota-sync.sql
-- Found before writing it: worldfert2 held a copy of company 9's old 65 lines; every good of company 9's 52 current
-- lines exists in worldfert2 under the same GoodCode (other GoodID). So:
--  1. every current worldfert2 line is logged in full (wf.GiveawayBudgetCleanupLog, Migration 'W2SYNC', REMOVED)
--     and removed;
--  2. company 9's lines are copied, GoodId/GoodName taken from worldfert2's good with the same GoodCode and the
--     salesperson from worldfert2's account with the same username (ids differ); PlanId is left empty (plans are
--     per database); each new line logged as ADDED; withdrawal history is not touched;
--  3. one wf.ChangeEvent records the sync. Rollback: down section at the end (commented), uses the log.
-- Stops without change if any good is missing, if it is not worldfert2, or if it already ran.
-- ============================================================================
SET NOCOUNT ON; SET XACT_ABORT ON;
SET ANSI_NULLS ON; SET ANSI_PADDING ON; SET ANSI_WARNINGS ON; SET ARITHABORT ON; SET CONCAT_NULL_YIELDS_NULL ON; SET QUOTED_IDENTIFIER ON; SET NUMERIC_ROUNDABORT OFF;
GO
IF DB_NAME() <> N'dbwins_worldfert2' OR @@SERVERNAME <> N'R740-SRV\SQL2008' BEGIN RAISERROR('STOP: run on dbwins_worldfert2', 16, 1); RETURN; END;
IF EXISTS (SELECT 1 FROM wf.GiveawayBudgetCleanupLog WHERE Migration = 'W2SYNC') BEGIN RAISERROR('STOP: already synced', 16, 1); RETURN; END;
IF EXISTS (SELECT 1 FROM dbwins_worldfert9.wf.GiveawayBudget b
           JOIN dbwins_worldfert9.dbo.EMGood n ON CONVERT(VARCHAR(50), n.GoodID) = b.GoodId
           WHERE NOT EXISTS (SELECT 1 FROM dbo.EMGood w WHERE w.GoodCode COLLATE DATABASE_DEFAULT = n.GoodCode COLLATE DATABASE_DEFAULT))
   OR EXISTS (SELECT 1 FROM dbwins_worldfert9.wf.GiveawayBudget b
              WHERE NOT EXISTS (SELECT 1 FROM dbwins_worldfert9.dbo.EMGood n WHERE CONVERT(VARCHAR(50), n.GoodID) = b.GoodId))
BEGIN RAISERROR('STOP: a company-9 quota good has no worldfert2 good with the same code', 16, 1); RETURN; END;
IF EXISTS (SELECT 1 FROM dbwins_worldfert9.wf.GiveawayBudget b
           JOIN dbwins_worldfert9.wf.AppUser u9 ON u9.Id = b.SalesUserId
           WHERE NOT EXISTS (SELECT 1 FROM wf.AppUser u2 WHERE u2.Username COLLATE DATABASE_DEFAULT = u9.Username COLLATE DATABASE_DEFAULT))
BEGIN RAISERROR('STOP: a company-9 quota salesperson has no worldfert2 account with the same username', 16, 1); RETURN; END;

BEGIN TRANSACTION;

INSERT INTO wf.GiveawayBudgetCleanupLog (Migration, Kind, BudgetId, SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName,
    BudgetQty, BudgetCreatedAt, BudgetUpdatedAt, BudgetAmt, PlanSection, PlanId, Channel, GoodId, GoodCode, GoodName, RegionCode)
SELECT 'W2SYNC', 'REMOVED', b.Id, b.SalesUserId, b.EmpId, b.EmpCode, b.Region, b.PeriodYear, b.Brand, b.ItemName,
    b.BudgetQty, b.CreatedAt, b.UpdatedAt, b.BudgetAmt, b.PlanSection, b.PlanId, b.Channel, b.GoodId, b.GoodCode, b.GoodName, b.RegionCode
FROM wf.GiveawayBudget b;
DELETE FROM wf.GiveawayBudget;

DECLARE @added TABLE (Id INT);
INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty, CreatedAt, UpdatedAt,
    BudgetAmt, PlanSection, PlanId, Channel, GoodId, GoodCode, GoodName, RegionCode)
OUTPUT inserted.Id INTO @added
SELECT u2.Id, b.EmpId, b.EmpCode, b.Region, b.PeriodYear, b.Brand, b.ItemName, b.BudgetQty, b.CreatedAt, GETUTCDATE(),
    b.BudgetAmt, b.PlanSection, NULL, b.Channel, CONVERT(VARCHAR(50), w.GoodID), RTRIM(w.GoodCode), RTRIM(w.GoodName1), b.RegionCode
FROM dbwins_worldfert9.wf.GiveawayBudget b
JOIN dbwins_worldfert9.dbo.EMGood n ON CONVERT(VARCHAR(50), n.GoodID) = b.GoodId
JOIN dbo.EMGood w ON w.GoodCode COLLATE DATABASE_DEFAULT = n.GoodCode COLLATE DATABASE_DEFAULT
-- user ids differ between the two company databases: the salesperson is matched by username
LEFT JOIN dbwins_worldfert9.wf.AppUser u9 ON u9.Id = b.SalesUserId
LEFT JOIN wf.AppUser u2 ON u2.Username COLLATE DATABASE_DEFAULT = u9.Username COLLATE DATABASE_DEFAULT;

INSERT INTO wf.GiveawayBudgetCleanupLog (Migration, Kind, BudgetId, SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName,
    BudgetQty, BudgetCreatedAt, BudgetUpdatedAt, BudgetAmt, PlanSection, PlanId, Channel, GoodId, GoodCode, GoodName, RegionCode)
SELECT 'W2SYNC', 'ADDED', b.Id, b.SalesUserId, b.EmpId, b.EmpCode, b.Region, b.PeriodYear, b.Brand, b.ItemName,
    b.BudgetQty, b.CreatedAt, b.UpdatedAt, b.BudgetAmt, b.PlanSection, b.PlanId, b.Channel, b.GoodId, b.GoodCode, b.GoodName, b.RegionCode
FROM wf.GiveawayBudget b JOIN @added a ON a.Id = b.Id;

DECLARE @removed INT, @adds INT;
SELECT @removed = COUNT(*) FROM wf.GiveawayBudgetCleanupLog WHERE Migration = 'W2SYNC' AND Kind = 'REMOVED';
SELECT @adds = COUNT(*) FROM @added;
INSERT wf.ChangeEvent (EntityType, EntityId, Action, AfterJson, ReasonCode, ReasonText, UserId, ActorUserId)
VALUES ('GIVEAWAY_BUDGET', 'W2SYNC', 'SYNC_FROM_WORLDFERT9',
    N'{"removed":' + CONVERT(NVARCHAR(10), @removed) + N',"added":' + CONVERT(NVARCHAR(10), @adds) + N'}',
    'OWNER_DECISION', N'โควต้าของแถม worldfert2 ให้ตรงกับ dbwins_worldfert9 (เจ้าของ 20 พ.ย. 2569) จับคู่สินค้าด้วยรหัสตรงตัว', 'SYSTEM', 'SYSTEM');

COMMIT TRANSACTION;
SELECT 'synced' AS Step, @removed AS Removed, @adds AS Added, (SELECT COUNT(*) FROM wf.GiveawayBudget) AS LinesNow, (SELECT SUM(BudgetQty) FROM wf.GiveawayBudget) AS BudgetNow;
GO

-- Rollback (run by hand if ever needed):
-- BEGIN TRAN;
-- DELETE b FROM wf.GiveawayBudget b JOIN wf.GiveawayBudgetCleanupLog l ON l.Migration='W2SYNC' AND l.Kind='ADDED' AND l.BudgetId=b.Id;
-- SET IDENTITY_INSERT wf.GiveawayBudget ON;
-- INSERT INTO wf.GiveawayBudget (Id, SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty, CreatedAt, UpdatedAt, BudgetAmt, PlanSection, PlanId, Channel, GoodId, GoodCode, GoodName, RegionCode)
-- SELECT BudgetId, SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty, BudgetCreatedAt, BudgetUpdatedAt, BudgetAmt, PlanSection, PlanId, Channel, GoodId, GoodCode, GoodName, RegionCode
-- FROM wf.GiveawayBudgetCleanupLog WHERE Migration='W2SYNC' AND Kind='REMOVED';
-- SET IDENTITY_INSERT wf.GiveawayBudget OFF;
-- DELETE FROM wf.GiveawayBudgetCleanupLog WHERE Migration='W2SYNC';
-- COMMIT;
