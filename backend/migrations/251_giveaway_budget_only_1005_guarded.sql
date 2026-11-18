-- @transaction
-- ============================================================================
-- 251_giveaway_budget_only_1005_guarded.sql
-- Replaces 250 (excluded in migration-policy.json; applied on UAT only). Found before the PROD deploy of
-- 18 Nov 2026: dbwins_worldfert2 has no group-1005 goods at all but holds 65 quota lines, so 250 would have
-- removed every one of them. 251 is 250 plus one guard: a database without group-1005 goods is left as it is.
--
-- Owner, 18 Nov 2026: giveaway quotas use only the 98 giveaway goods of WinSpeed group 1005 (ส่งเสริมการขาย).
-- Quota lines that are not one of them are removed ("เพราะเราจะ Set Zero ระบบนี้").
--
-- Found on UAT (a copy of PROD restored the same evening): 32 budget lines imported on 24 Oct 2026 carry only a
-- short name ("30-0-0", "แบนเนอร์ รถเกษตร", ...) and no GoodId.
--  1. A line is linked when exactly one group-1005 good has, letter for letter (trimmed), the name
--     "กระเป๋า สูตร <ItemName> ตรา<Brand>" or the name <ItemName>. UAT: 19 lines, 11 goods.
--     GoodId, GoodCode and GoodName are set; Brand and ItemName (the quota key) stay, so withdrawals saved
--     without a GoodId still count against the line through wf.v_GiveawayBudgetStatus.
--     If the link would give a salesperson two lines of the same good in the same region and year the
--     migration stops instead of merging them.
--  2. Every line that is then still not on a group-1005 good is removed. UAT: 13 lines (formulas 13-3-21,
--     19-6-6, 20-5-3 with 17,000 pieces of budget and no withdrawal; banners and a brochure with no budget).
--     Withdrawal history is not touched.
-- Every row is logged in wf.GiveawayBudgetCleanupLog (full row for removed lines) and in wf.ChangeEvent; the
-- rollback in down/ restores both kinds. SQL Server 2008 R2, compatibility 80 (no CONCAT).
-- ============================================================================
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

IF OBJECT_ID('wf.GiveawayBudgetCleanupLog', 'U') IS NULL
    CREATE TABLE wf.GiveawayBudgetCleanupLog (
        LogId       INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_GiveawayBudgetCleanupLog PRIMARY KEY,
        Migration   VARCHAR(10)    NOT NULL,
        Kind        VARCHAR(10)    NOT NULL,          -- LINKED | REMOVED
        BudgetId    INT            NOT NULL,
        SalesUserId INT            NULL,
        EmpId       NVARCHAR(20)   NULL,
        EmpCode     NVARCHAR(20)   NULL,
        Region      NVARCHAR(60)   NOT NULL,
        PeriodYear  INT            NOT NULL,
        Brand       NVARCHAR(50)   NOT NULL,
        ItemName    NVARCHAR(100)  NOT NULL,
        BudgetQty   DECIMAL(18,2)  NOT NULL,
        BudgetCreatedAt DATETIME2  NOT NULL,
        BudgetUpdatedAt DATETIME2  NOT NULL,
        BudgetAmt   DECIMAL(18,2)  NOT NULL,
        PlanSection NVARCHAR(20)   NULL,
        PlanId      INT            NULL,
        Channel     NVARCHAR(30)   NOT NULL,
        GoodId      VARCHAR(50)    NULL,
        GoodCode    NVARCHAR(50)   NULL,
        GoodName    NVARCHAR(200)  NULL,
        RegionCode  VARCHAR(10)    NULL,
        NewGoodId   VARCHAR(50)    NULL,
        NewGoodCode NVARCHAR(50)   NULL,
        NewGoodName NVARCHAR(200)  NULL,
        CreatedAt   DATETIME2      NOT NULL CONSTRAINT DF_GiveawayBudgetCleanupLog_CreatedAt DEFAULT GETUTCDATE()
    );
GO

IF EXISTS (SELECT 1 FROM wf.GiveawayBudgetCleanupLog WHERE Migration IN ('250', '251'))
BEGIN
    PRINT 'Migration 251: the cleanup already ran here (250 or 251)';
    RETURN;
END;
IF NOT EXISTS (SELECT 1 FROM dbo.EMGood WHERE GoodGroupID = 1005)
BEGIN
    PRINT 'Migration 251: this database has no group-1005 giveaway goods; quota lines left as they are';
    RETURN;
END;

-- 1. exact links to a group-1005 good
DECLARE @link TABLE (BudgetId INT PRIMARY KEY, NewGoodId VARCHAR(50) NOT NULL, NewGoodCode NVARCHAR(50) NULL, NewGoodName NVARCHAR(200) NULL);
INSERT INTO @link (BudgetId, NewGoodId, NewGoodCode, NewGoodName)
SELECT b.Id, CONVERT(VARCHAR(50), g.GoodID), RTRIM(g.GoodCode), RTRIM(g.GoodName1)
FROM wf.GiveawayBudget b
JOIN dbo.EMGood g ON g.GoodGroupID = 1005
 AND (LTRIM(RTRIM(g.GoodName1)) = N'กระเป๋า สูตร ' + LTRIM(RTRIM(b.ItemName)) + N' ตรา' + LTRIM(RTRIM(b.Brand))
      OR LTRIM(RTRIM(g.GoodName1)) = LTRIM(RTRIM(b.ItemName)))
WHERE NULLIF(LTRIM(RTRIM(b.GoodId)), '') IS NULL
  AND (SELECT COUNT(*) FROM dbo.EMGood g2
       WHERE g2.GoodGroupID = 1005
         AND (LTRIM(RTRIM(g2.GoodName1)) = N'กระเป๋า สูตร ' + LTRIM(RTRIM(b.ItemName)) + N' ตรา' + LTRIM(RTRIM(b.Brand))
              OR LTRIM(RTRIM(g2.GoodName1)) = LTRIM(RTRIM(b.ItemName)))) = 1;

IF EXISTS (
    SELECT 1 FROM @link l
    JOIN wf.GiveawayBudget b ON b.Id = l.BudgetId
    JOIN wf.GiveawayBudget d ON d.Id <> b.Id AND d.Region = b.Region AND d.PeriodYear = b.PeriodYear
     AND ISNULL(d.SalesUserId, 0) = ISNULL(b.SalesUserId, 0)
     AND (d.GoodId = l.NewGoodId OR d.Id IN (SELECT l2.BudgetId FROM @link l2 WHERE l2.NewGoodId = l.NewGoodId)))
BEGIN
    RAISERROR(N'STOP 251: linking would create two quota lines of the same good for one salesperson; review them first.', 16, 1);
    RETURN;
END;

INSERT INTO wf.GiveawayBudgetCleanupLog (Migration, Kind, BudgetId, SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName,
    BudgetQty, BudgetCreatedAt, BudgetUpdatedAt, BudgetAmt, PlanSection, PlanId, Channel, GoodId, GoodCode, GoodName, RegionCode,
    NewGoodId, NewGoodCode, NewGoodName)
SELECT '251', 'LINKED', b.Id, b.SalesUserId, b.EmpId, b.EmpCode, b.Region, b.PeriodYear, b.Brand, b.ItemName,
    b.BudgetQty, b.CreatedAt, b.UpdatedAt, b.BudgetAmt, b.PlanSection, b.PlanId, b.Channel, b.GoodId, b.GoodCode, b.GoodName, b.RegionCode,
    l.NewGoodId, l.NewGoodCode, l.NewGoodName
FROM wf.GiveawayBudget b JOIN @link l ON l.BudgetId = b.Id;

UPDATE b SET b.GoodId = l.NewGoodId, b.GoodCode = l.NewGoodCode, b.GoodName = l.NewGoodName, b.UpdatedAt = GETUTCDATE()
FROM wf.GiveawayBudget b JOIN @link l ON l.BudgetId = b.Id;

-- 2. every line still not on a group-1005 good is removed (full row logged first)
DECLARE @remove TABLE (BudgetId INT PRIMARY KEY);
INSERT INTO @remove (BudgetId)
SELECT b.Id FROM wf.GiveawayBudget b
WHERE NOT EXISTS (SELECT 1 FROM dbo.EMGood g WHERE g.GoodGroupID = 1005 AND CONVERT(VARCHAR(50), g.GoodID) = b.GoodId);

INSERT INTO wf.GiveawayBudgetCleanupLog (Migration, Kind, BudgetId, SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName,
    BudgetQty, BudgetCreatedAt, BudgetUpdatedAt, BudgetAmt, PlanSection, PlanId, Channel, GoodId, GoodCode, GoodName, RegionCode)
SELECT '251', 'REMOVED', b.Id, b.SalesUserId, b.EmpId, b.EmpCode, b.Region, b.PeriodYear, b.Brand, b.ItemName,
    b.BudgetQty, b.CreatedAt, b.UpdatedAt, b.BudgetAmt, b.PlanSection, b.PlanId, b.Channel, b.GoodId, b.GoodCode, b.GoodName, b.RegionCode
FROM wf.GiveawayBudget b JOIN @remove r ON r.BudgetId = b.Id;

DELETE b FROM wf.GiveawayBudget b JOIN @remove r ON r.BudgetId = b.Id;

-- one change event per line
INSERT wf.ChangeEvent (EntityType, EntityId, Action, BeforeJson, AfterJson, ReasonCode, ReasonText, UserId, ActorUserId)
SELECT 'GIVEAWAY_BUDGET', CONVERT(VARCHAR(50), l.BudgetId),
       CASE l.Kind WHEN 'LINKED' THEN 'LINK_1005' ELSE 'DELETE' END,
       N'{"region":"' + REPLACE(l.Region, N'"', N'\"') + N'","periodYear":' + CONVERT(NVARCHAR(10), l.PeriodYear)
         + N',"brand":"' + REPLACE(l.Brand, N'"', N'\"') + N'","itemName":"' + REPLACE(l.ItemName, N'"', N'\"')
         + N'","budgetQty":' + CONVERT(NVARCHAR(30), l.BudgetQty)
         + N',"salesUserId":' + ISNULL(CONVERT(NVARCHAR(20), l.SalesUserId), N'null')
         + N',"goodId":' + ISNULL(N'"' + l.GoodId + N'"', N'null') + N'}',
       CASE l.Kind WHEN 'LINKED' THEN N'{"goodId":"' + l.NewGoodId + N'","goodCode":"' + ISNULL(l.NewGoodCode, N'') + N'"}' ELSE NULL END,
       'MIGRATION',
       CASE l.Kind WHEN 'LINKED' THEN N'ผูกกับของแถมกลุ่ม 1005 ที่ชื่อตรงกันทุกตัวอักษร (migration 251)'
                   ELSE N'ไม่ใช่ของแถม 98 รายการของกลุ่ม 1005 เจ้าของให้นำออกจากโควต้า (migration 251)' END,
       'SYSTEM', 'SYSTEM'
FROM wf.GiveawayBudgetCleanupLog l
WHERE l.Migration = '251';

DECLARE @linked INT, @removed INT;
SELECT @linked = COUNT(*) FROM @link;
SELECT @removed = COUNT(*) FROM @remove;
PRINT 'Migration 251: linked ' + CONVERT(VARCHAR(10), @linked) + ', removed ' + CONVERT(VARCHAR(10), @removed) + ' giveaway quota lines';
GO
