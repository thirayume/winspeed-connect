-- Rollback of 254: drop the Set Zero request id (the log rows themselves stay).
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO
IF COL_LENGTH('wf.GiveawayZeroLog', 'RequestId') IS NOT NULL
    ALTER TABLE wf.GiveawayZeroLog DROP COLUMN RequestId;
GO
