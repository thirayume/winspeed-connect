-- ============================================================================
-- STATUS: prepared, NOT run. Running it bypasses worldfert2's identity-mapping guard, so it waits for the owner's
-- explicit go (or map the ADMIN account to worldfert2 and press App Settings > Set Zero there instead).
-- One-off, 20 Nov 2026 — giveaway Set Zero on dbwins_worldfert2, the same moment's rule as company 9 (owner, 20 Nov 2026:
-- "Set Zero ของแถม บน PROD และ UAT ตรงกัน ... เฉพาะ WF-SaleApp").
-- Company 9 was zeroed from App Settings (ADMIN) at 19:44. The App Settings button cannot run on worldfert2 for the
-- ADMIN account (no identity mapping there, IDENTITY_MAPPING_REQUIRED by design), so this does exactly what the button
-- does: one wf.GiveawayZeroLog row (migration 253) and one wf.ChangeEvent. Budgets and withdrawal history are untouched.
--   sqlcmd -b -I -S R740-SRV\SQL2008 -E -f 65001 -d dbwins_worldfert2 -i 20261120-worldfert2-giveaway-set-zero.sql
-- ============================================================================
SET NOCOUNT ON; SET XACT_ABORT ON;
SET ANSI_NULLS ON; SET ANSI_PADDING ON; SET ANSI_WARNINGS ON; SET ARITHABORT ON; SET CONCAT_NULL_YIELDS_NULL ON; SET QUOTED_IDENTIFIER ON; SET NUMERIC_ROUNDABORT OFF;
GO
IF DB_NAME() <> N'dbwins_worldfert2' OR @@SERVERNAME <> N'R740-SRV\SQL2008' BEGIN RAISERROR('STOP: run on dbwins_worldfert2', 16, 1); RETURN; END;
IF OBJECT_ID('wf.GiveawayZeroLog', 'U') IS NULL BEGIN RAISERROR('STOP: migration 253 not applied', 16, 1); RETURN; END;
IF EXISTS (SELECT 1 FROM wf.GiveawayZeroLog WHERE Note = N'Set Zero 20/11/2569 ให้ตรงกับ dbwins_worldfert9') BEGIN RAISERROR('STOP: already done', 16, 1); RETURN; END;

BEGIN TRANSACTION;
DECLARE @before DECIMAL(18,2) = (SELECT ISNULL(SUM(WithdrawnQty), 0) FROM wf.v_GiveawayBudgetStatus);
DECLARE @id INT;
INSERT INTO wf.GiveawayZeroLog (ZeroAt, Note, ActorId) VALUES (GETUTCDATE(), N'Set Zero 20/11/2569 ให้ตรงกับ dbwins_worldfert9', NULL);
SET @id = SCOPE_IDENTITY();
INSERT wf.ChangeEvent (EntityType, EntityId, Action, BeforeJson, AfterJson, ReasonCode, ReasonText, UserId, ActorUserId)
VALUES ('GIVEAWAY_BUDGET', 'ZERO:' + CONVERT(VARCHAR(10), @id), 'SET_ZERO',
        N'{"withdrawn":' + CONVERT(NVARCHAR(30), @before) + N'}', N'{"withdrawn":0}',
        'GIVEAWAY_SET_ZERO', N'Set Zero ของแถมให้ตรงกับ dbwins_worldfert9 (เจ้าของ 20 พ.ย. 2569)', 'SYSTEM', 'SYSTEM');
COMMIT TRANSACTION;
SELECT 'zeroed' AS Step, @before AS WithdrawnBefore, (SELECT ISNULL(SUM(WithdrawnQty), 0) FROM wf.v_GiveawayBudgetStatus) AS WithdrawnNow;
GO
