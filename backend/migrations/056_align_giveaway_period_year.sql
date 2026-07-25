-- 056_align_giveaway_period_year.sql
-- Align PeriodYear in wf.GiveawayBudget, wf.GiveawayWithdrawal, and wf.RebatePool to Thai BE (2569)

UPDATE wf.GiveawayBudget
SET PeriodYear = 2569
WHERE PeriodYear < 2500;

UPDATE wf.GiveawayWithdrawal
SET PeriodYear = 2569
WHERE PeriodYear < 2500;

UPDATE wf.RebatePool
SET PeriodYear = 2569
WHERE PeriodYear < 2500;

GO
